import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { CHAIN_TABLES, groupInserts, type Db, type InsertMode, type Row, type SqlValue, type WriteBatch } from './common'

/**
 * SQLite schema migrations, applied in order (tracked in PRAGMA user_version).
 * The Postgres schema (src/storage/postgres.ts) mirrors it.
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
  // 2 — Stage 5: earn vaults, launchpads/auctions
  `
  CREATE TABLE earn_events (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    vault TEXT NOT NULL, type TEXT NOT NULL, sender TEXT NOT NULL, owner TEXT NOT NULL, receiver TEXT NOT NULL,
    assets TEXT NOT NULL, shares TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX earn_owner ON earn_events(owner);
  CREATE TABLE launches (
    auction TEXT PRIMARY KEY, token TEXT NOT NULL, launchpad TEXT NOT NULL, creator TEXT NOT NULL,
    name TEXT NOT NULL, symbol TEXT NOT NULL, created_block INTEGER NOT NULL, created_ts INTEGER NOT NULL,
    params_json TEXT
  );
  CREATE INDEX launches_token ON launches(token);
  CREATE TABLE bids (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    auction TEXT NOT NULL, bid_id TEXT NOT NULL, bidder TEXT NOT NULL, amount TEXT NOT NULL, max_price TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX bids_auction ON bids(auction, block);
  CREATE INDEX bids_bidder ON bids(bidder);
  CREATE TABLE settlements (
    auction TEXT PRIMARY KEY, block INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    clearing_price TEXT NOT NULL, raised TEXT NOT NULL, launched INTEGER NOT NULL, pool TEXT
  );
  CREATE TABLE claims (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    auction TEXT NOT NULL, bid_id TEXT NOT NULL, bidder TEXT NOT NULL, tokens TEXT NOT NULL, refund TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX claims_bidder ON claims(bidder);
  `,
  // 3 — every value-carrying tx (ETH balance reconstruction for portfolio history)
  `
  CREATE TABLE tx_values (
    block INTEGER NOT NULL, tx_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
    from_addr TEXT NOT NULL, to_addr TEXT, value TEXT NOT NULL,
    PRIMARY KEY (block, tx_index)
  );
  CREATE INDEX tx_values_from ON tx_values(from_addr);
  CREATE INDEX tx_values_to ON tx_values(to_addr);
  `,
]

const val = (v: SqlValue): SQLInputValue => (typeof v === 'bigint' ? v.toString() : v)

/** SQLite backend (node:sqlite, synchronous underneath; every call completes before it resolves). */
export class SqliteDb implements Db {
  readonly kind = 'sqlite' as const
  readonly raw: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;')
    const current = (this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.txSync(() => {
        this.raw.exec(MIGRATIONS[v])
        this.raw.exec(`PRAGMA user_version = ${v + 1}`)
      })
    }
  }

  async init() {}

  private txSync<T>(fn: () => T): T {
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

  async all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params.map(val)) as T[]
  }

  async get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
    return this.raw.prepare(sql).get(...params.map(val)) as T | undefined
  }

  async run(sql: string, ...params: SqlValue[]) {
    this.raw.prepare(sql).run(...params.map(val))
  }

  private insertSync(table: string, row: Row, mode: InsertMode) {
    const keys = Object.keys(row)
    const sql = `INSERT OR ${mode} INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
    this.raw.prepare(sql).run(...keys.map((k) => val(row[k])))
  }

  async insert(table: string, row: Row, mode: InsertMode = 'IGNORE') {
    this.insertSync(table, row, mode)
  }

  async write(batch: WriteBatch) {
    this.txSync(() => {
      for (const op of batch.ops) if (op.kind === 'run') this.raw.prepare(op.sql).run(...op.params.map(val))
      for (const [table, groups] of groupInserts(batch)) for (const g of groups) for (const row of g.rows) this.insertSync(table, row, g.mode)
    })
  }

  async getMeta(key: string) {
    return (this.raw.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value
  }

  async setMeta(key: string, value: string) {
    this.raw.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
  }

  async resetChainData() {
    this.txSync(() => {
      for (const t of CHAIN_TABLES) this.raw.exec(`DELETE FROM ${t}`)
    })
  }

  jsonField(column: string, key: string) {
    return `json_extract(${column}, '$.${key}')`
  }

  async close() {
    this.raw.close()
  }
}
