import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

/**
 * Schema migrations, applied in order. Each entry runs once (tracked in PRAGMA user_version).
 * Addresses are stored lower-case; amounts are decimal strings (base units); USD values REAL.
 */
const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE blocks (number INTEGER PRIMARY KEY, hash TEXT NOT NULL, timestamp INTEGER NOT NULL);
  CREATE TABLE tokens (address TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL, decimals INTEGER NOT NULL);
  CREATE TABLE pools (
    address TEXT PRIMARY KEY, version TEXT NOT NULL, token0 TEXT NOT NULL, token1 TEXT NOT NULL,
    fee INTEGER NOT NULL, tick_spacing INTEGER, created_block INTEGER NOT NULL, created_ts INTEGER NOT NULL
  );
  CREATE TABLE pool_state (
    address TEXT PRIMARY KEY, reserve0 TEXT NOT NULL, reserve1 TEXT NOT NULL, sqrt_price TEXT, tick INTEGER,
    liquidity TEXT, lp_supply TEXT, updated_block INTEGER NOT NULL
  );
  CREATE TABLE swaps (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    pool TEXT NOT NULL, version TEXT NOT NULL, origin TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL,
    amount0 TEXT NOT NULL, amount1 TEXT NOT NULL, amount_usd REAL, fee_usd REAL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX swaps_pool ON swaps(pool, timestamp);
  CREATE INDEX swaps_ts ON swaps(timestamp);
  CREATE INDEX swaps_origin ON swaps(origin);
  CREATE TABLE liquidity_events (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    pool TEXT NOT NULL, version TEXT NOT NULL, type TEXT NOT NULL, origin TEXT NOT NULL, owner TEXT,
    amount0 TEXT NOT NULL, amount1 TEXT NOT NULL, amount_usd REAL,
    tick_lower INTEGER, tick_upper INTEGER, liquidity TEXT,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX liq_pool ON liquidity_events(pool, timestamp);
  CREATE INDEX liq_origin ON liquidity_events(origin);
  CREATE TABLE transfers (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    token TEXT NOT NULL, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, amount TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX transfers_from ON transfers(from_addr);
  CREATE INDEX transfers_to ON transfers(to_addr);
  CREATE INDEX transfers_token ON transfers(token);
  CREATE TABLE weth_events (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    type TEXT NOT NULL, account TEXT NOT NULL, origin TEXT NOT NULL, amount TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE TABLE native_transfers (
    block INTEGER NOT NULL, tx_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (block, tx_index)
  );
  CREATE INDEX native_from ON native_transfers(from_addr);
  CREATE INDEX native_to ON native_transfers(to_addr);
  CREATE TABLE nft_transfers (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    token_id TEXT NOT NULL, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX nft_to ON nft_transfers(to_addr);
  CREATE TABLE nft_events (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    token_id TEXT NOT NULL, type TEXT NOT NULL, liquidity TEXT, amount0 TEXT NOT NULL, amount1 TEXT NOT NULL, origin TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE TABLE fills (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    order_hash TEXT NOT NULL, filler TEXT NOT NULL, swapper TEXT NOT NULL, nonce TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX fills_hash ON fills(order_hash);
  CREATE TABLE price_points (token TEXT NOT NULL, block INTEGER NOT NULL, timestamp INTEGER NOT NULL, price REAL NOT NULL, PRIMARY KEY (token, block));
  CREATE INDEX price_points_ts ON price_points(token, timestamp);
  CREATE TABLE pool_snapshots (
    pool TEXT NOT NULL, block INTEGER NOT NULL, timestamp INTEGER NOT NULL, reserve0 TEXT NOT NULL, reserve1 TEXT NOT NULL,
    price0 REAL, tvl_usd REAL, PRIMARY KEY (pool, block)
  );
  CREATE INDEX pool_snapshots_ts ON pool_snapshots(timestamp);
  CREATE TABLE x_orders (
    hash TEXT PRIMARY KEY, swapper TEXT NOT NULL, reactor TEXT NOT NULL, nonce TEXT NOT NULL, deadline INTEGER NOT NULL,
    decay_start INTEGER NOT NULL, decay_end INTEGER NOT NULL, exclusive_filler TEXT NOT NULL, exclusivity_override_bps TEXT NOT NULL,
    input_token TEXT NOT NULL, input_start TEXT NOT NULL, input_end TEXT NOT NULL,
    outputs_json TEXT NOT NULL, encoded_order TEXT NOT NULL, signature TEXT NOT NULL,
    status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    fill_tx TEXT, fill_block INTEGER, filler TEXT, error TEXT
  );
  CREATE INDEX x_orders_swapper ON x_orders(swapper, status);
  CREATE INDEX x_orders_status ON x_orders(status);
  `,
]

/** Tables wiped on a chain reset (everything derived from chain data). */
export const CHAIN_TABLES = [
  'blocks',
  'tokens',
  'pools',
  'pool_state',
  'swaps',
  'liquidity_events',
  'transfers',
  'weth_events',
  'native_transfers',
  'nft_transfers',
  'nft_events',
  'fills',
  'price_points',
  'pool_snapshots',
  'x_orders',
  'meta',
]

export type Row = Record<string, SQLInputValue>

export class Db {
  readonly raw: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;')
    this.migrate()
  }

  private migrate() {
    const current = (this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[v])
        this.raw.exec(`PRAGMA user_version = ${v + 1}`)
      })
    }
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN')
    try {
      const out = fn()
      this.raw.exec('COMMIT')
      return out
    } catch (e) {
      this.raw.exec('ROLLBACK')
      throw e
    }
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[]
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.raw.prepare(sql).run(...params)
  }

  /** INSERT OR IGNORE / REPLACE helper keyed by an object's fields. */
  insert(table: string, row: Row, mode: 'IGNORE' | 'REPLACE' = 'IGNORE') {
    const keys = Object.keys(row)
    const sql = `INSERT OR ${mode} INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
    return this.raw.prepare(sql).run(...keys.map((k) => row[k]))
  }

  getMeta(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value
  }

  setMeta(key: string, value: string) {
    this.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value)
  }

  resetChainData() {
    this.tx(() => {
      for (const t of CHAIN_TABLES) this.raw.exec(`DELETE FROM ${t}`)
    })
  }

  close() {
    this.raw.close()
  }
}
