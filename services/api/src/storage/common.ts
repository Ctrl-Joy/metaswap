/**
 * Storage layer. Two backends behind one async interface:
 *  - PostgreSQL + TimescaleDB when DATABASE_URL is set (src/storage/postgres.ts)
 *  - SQLite (node:sqlite) otherwise, so tests and fresh clones work without a server (src/storage/sqlite.ts)
 *
 * SQL is written once with `?` placeholders and portable syntax; the Postgres backend rewrites the
 * placeholders. Use `db.jsonField(col, key)` instead of json_extract / ->>.
 * Addresses are stored lower-case; amounts are decimal strings (base units); USD values are floats.
 */

export type SqlValue = string | number | bigint | null
export type Row = Record<string, SqlValue>
export type InsertMode = 'IGNORE' | 'REPLACE'

export type WriteOp = { kind: 'insert'; table: string; row: Row; mode: InsertMode } | { kind: 'run'; sql: string; params: SqlValue[] }

/**
 * Writes collected synchronously (e.g. while the indexer decodes a block range) and applied
 * atomically with `db.write(batch)`. Statements (`run`) are applied first, in order, then the
 * inserts. Duplicate keys within a batch behave like sequential execution (IGNORE keeps the
 * first row, REPLACE the last).
 */
export class WriteBatch {
  readonly ops: WriteOp[] = []
  insert(table: string, row: Row, mode: InsertMode = 'IGNORE') {
    this.ops.push({ kind: 'insert', table, row, mode })
  }
  run(sql: string, ...params: SqlValue[]) {
    this.ops.push({ kind: 'run', sql, params })
  }
  setMeta(key: string, value: string) {
    this.insert('meta', { key, value }, 'REPLACE')
  }
  /** Inserted rows of one table (the indexer publishes these to WebSocket subscribers). */
  rows(table: string): Row[] {
    const out: Row[] = []
    for (const op of this.ops) if (op.kind === 'insert' && op.table === table) out.push(op.row)
    return out
  }
  get size() {
    return this.ops.length
  }
}

export interface Db {
  readonly kind: 'sqlite' | 'postgres'
  /** Connect + run migrations (idempotent; every other method awaits it). */
  init(): Promise<void>
  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): Promise<T[]>
  get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): Promise<T | undefined>
  run(sql: string, ...params: SqlValue[]): Promise<void>
  insert(table: string, row: Row, mode?: InsertMode): Promise<void>
  /** Apply a batch in one transaction. */
  write(batch: WriteBatch): Promise<void>
  getMeta(key: string): Promise<string | undefined>
  setMeta(key: string, value: string): Promise<void>
  /** Wipe everything derived from chain data (new chain detected). */
  resetChainData(): Promise<void>
  /** SQL expression reading `key` from a JSON text column. */
  jsonField(column: string, key: string): string
  close(): Promise<void>
}

/** Logical primary key of every table (dedupe within a batch; SQLite schema). */
export const TABLE_KEYS: Record<string, string[]> = {
  meta: ['key'],
  blocks: ['number'],
  tokens: ['address'],
  pools: ['address'],
  pool_state: ['address'],
  swaps: ['block', 'log_index'],
  liquidity_events: ['block', 'log_index'],
  transfers: ['block', 'log_index'],
  weth_events: ['block', 'log_index'],
  native_transfers: ['block', 'tx_index'],
  nft_transfers: ['block', 'log_index'],
  nft_events: ['block', 'log_index'],
  fills: ['block', 'log_index'],
  price_points: ['token', 'block'],
  pool_snapshots: ['pool', 'block'],
  x_orders: ['hash'],
  earn_events: ['block', 'log_index'],
  launches: ['auction'],
  bids: ['block', 'log_index'],
  settlements: ['auction'],
  claims: ['block', 'log_index'],
  tx_values: ['block', 'tx_index'],
}

/** Tables wiped on a chain reset (everything derived from chain data). */
export const CHAIN_TABLES = Object.keys(TABLE_KEYS)

/** Collapse a batch's inserts per table, honouring IGNORE (first wins) / REPLACE (last wins). */
export function groupInserts(batch: WriteBatch): Map<string, { mode: InsertMode; rows: Row[] }[]> {
  const out = new Map<string, Map<string, { mode: InsertMode; row: Row }>>()
  for (const op of batch.ops) {
    if (op.kind !== 'insert') continue
    const keyCols = TABLE_KEYS[op.table]
    let m = out.get(op.table)
    if (!m) out.set(op.table, (m = new Map()))
    const k = keyCols ? keyCols.map((c) => String(op.row[c])).join('|') : String(m.size)
    if (op.mode === 'IGNORE' && m.has(k)) continue
    if (op.mode === 'REPLACE') m.delete(k) // keep insertion order = last write
    m.set(k, { mode: op.mode, row: op.row })
  }
  const res = new Map<string, { mode: InsertMode; rows: Row[] }[]>()
  for (const [table, m] of out) {
    // split by mode + column set so each group is one multi-row statement
    const groups = new Map<string, { mode: InsertMode; rows: Row[] }>()
    for (const { mode, row } of m.values()) {
      const g = `${mode}:${Object.keys(row).join(',')}`
      let e = groups.get(g)
      if (!e) groups.set(g, (e = { mode, rows: [] }))
      e.rows.push(row)
    }
    res.set(table, [...groups.values()])
  }
  return res
}
