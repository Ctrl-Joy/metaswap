import pg from 'pg'
import { CHAIN_TABLES, TABLE_KEYS, groupInserts, type Db, type InsertMode, type Row, type SqlValue, type WriteBatch } from './common'

// BIGINT / NUMERIC (COUNT, SUM over integers) → JS numbers. Values here are block numbers, unix
// times, counts and USD sums, all far below 2^53; token amounts are stored as TEXT.
pg.types.setTypeParser(20, (v) => Number(v))
pg.types.setTypeParser(1700, (v) => Number(v))

const SCHEMA = 'metaswap'

/** Hypertables (partitioned on the unix `timestamp` column) and their Postgres primary keys. */
const HYPERTABLES: Record<string, string[]> = {
  blocks: ['number', 'timestamp'],
  swaps: ['block', 'log_index', 'timestamp'],
  transfers: ['block', 'log_index', 'timestamp'],
  price_points: ['token', 'block', 'timestamp'],
  pool_snapshots: ['pool', 'block', 'timestamp'],
}
const PG_KEYS: Record<string, string[]> = { ...TABLE_KEYS, ...HYPERTABLES }

/** One week of chain time per chunk. */
const CHUNK = 7 * 86400

/**
 * Postgres schema migrations (tracked in metaswap.schema_version). Mirrors the SQLite schema with
 * BIGINT time/block columns and DOUBLE PRECISION USD values; the hot time-series tables are
 * TimescaleDB hypertables, and candles come from continuous aggregates.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE blocks (number BIGINT NOT NULL, hash TEXT NOT NULL, timestamp BIGINT NOT NULL, PRIMARY KEY (number, timestamp));
  CREATE INDEX blocks_number ON blocks(number DESC);
  CREATE TABLE tokens (address TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL, decimals INTEGER NOT NULL);
  CREATE TABLE pools (
    address TEXT PRIMARY KEY, version TEXT NOT NULL, token0 TEXT NOT NULL, token1 TEXT NOT NULL,
    fee INTEGER NOT NULL, tick_spacing INTEGER, created_block BIGINT NOT NULL, created_ts BIGINT NOT NULL
  );
  CREATE TABLE pool_state (
    address TEXT PRIMARY KEY, reserve0 TEXT NOT NULL, reserve1 TEXT NOT NULL, sqrt_price TEXT, tick INTEGER,
    liquidity TEXT, lp_supply TEXT, updated_block BIGINT NOT NULL
  );
  CREATE TABLE swaps (
    block BIGINT NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    pool TEXT NOT NULL, version TEXT NOT NULL, origin TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL,
    amount0 TEXT NOT NULL, amount1 TEXT NOT NULL, amount_usd DOUBLE PRECISION, fee_usd DOUBLE PRECISION,
    PRIMARY KEY (block, log_index, timestamp)
  );
  CREATE INDEX swaps_pool ON swaps(pool, timestamp DESC);
  CREATE INDEX swaps_origin ON swaps(origin);
  CREATE INDEX swaps_block ON swaps(block DESC, log_index DESC);
  CREATE TABLE liquidity_events (
    block BIGINT NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    pool TEXT NOT NULL, version TEXT NOT NULL, type TEXT NOT NULL, origin TEXT NOT NULL, owner TEXT,
    amount0 TEXT NOT NULL, amount1 TEXT NOT NULL, amount_usd DOUBLE PRECISION,
    tick_lower INTEGER, tick_upper INTEGER, liquidity TEXT,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX liq_pool ON liquidity_events(pool, timestamp);
  CREATE INDEX liq_origin ON liquidity_events(origin);
  CREATE TABLE transfers (
    block BIGINT NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    token TEXT NOT NULL, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, amount TEXT NOT NULL,
    PRIMARY KEY (block, log_index, timestamp)
  );
  CREATE INDEX transfers_from ON transfers(from_addr);
  CREATE INDEX transfers_to ON transfers(to_addr);
  CREATE INDEX transfers_token ON transfers(token);
  CREATE TABLE weth_events (
    block BIGINT NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    type TEXT NOT NULL, account TEXT NOT NULL, origin TEXT NOT NULL, amount TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX weth_account ON weth_events(account);
  CREATE INDEX weth_origin ON weth_events(origin);
  CREATE TABLE native_transfers (
    block BIGINT NOT NULL, tx_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (block, tx_index)
  );
  CREATE INDEX native_from ON native_transfers(from_addr);
  CREATE INDEX native_to ON native_transfers(to_addr);
  CREATE TABLE nft_transfers (
    block BIGINT NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    token_id TEXT NOT NULL, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX nft_to ON nft_transfers(to_addr);
  CREATE INDEX nft_token ON nft_transfers(token_id);
  CREATE TABLE nft_events (
    block BIGINT NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    token_id TEXT NOT NULL, type TEXT NOT NULL, liquidity TEXT, amount0 TEXT NOT NULL, amount1 TEXT NOT NULL, origin TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX nft_events_token ON nft_events(token_id);
  CREATE TABLE fills (
    block BIGINT NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    order_hash TEXT NOT NULL, filler TEXT NOT NULL, swapper TEXT NOT NULL, nonce TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX fills_hash ON fills(order_hash);
  CREATE TABLE price_points (
    token TEXT NOT NULL, block BIGINT NOT NULL, timestamp BIGINT NOT NULL, price DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (token, block, timestamp)
  );
  CREATE INDEX price_points_token ON price_points(token, timestamp DESC);
  CREATE INDEX price_points_block ON price_points(token, block DESC);
  CREATE TABLE pool_snapshots (
    pool TEXT NOT NULL, block BIGINT NOT NULL, timestamp BIGINT NOT NULL, reserve0 TEXT NOT NULL, reserve1 TEXT NOT NULL,
    price0 DOUBLE PRECISION, tvl_usd DOUBLE PRECISION, PRIMARY KEY (pool, block, timestamp)
  );
  CREATE INDEX pool_snapshots_pool ON pool_snapshots(pool, block DESC);
  CREATE TABLE x_orders (
    hash TEXT PRIMARY KEY, swapper TEXT NOT NULL, reactor TEXT NOT NULL, nonce TEXT NOT NULL, deadline BIGINT NOT NULL,
    decay_start BIGINT NOT NULL, decay_end BIGINT NOT NULL, exclusive_filler TEXT NOT NULL, exclusivity_override_bps TEXT NOT NULL,
    input_token TEXT NOT NULL, input_start TEXT NOT NULL, input_end TEXT NOT NULL,
    outputs_json TEXT NOT NULL, encoded_order TEXT NOT NULL, signature TEXT NOT NULL,
    status TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    fill_tx TEXT, fill_block BIGINT, filler TEXT, error TEXT
  );
  CREATE INDEX x_orders_swapper ON x_orders(swapper, status);
  CREATE INDEX x_orders_status ON x_orders(status);
  CREATE TABLE earn_events (
    block BIGINT NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    vault TEXT NOT NULL, type TEXT NOT NULL, sender TEXT NOT NULL, owner TEXT NOT NULL, receiver TEXT NOT NULL,
    assets TEXT NOT NULL, shares TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX earn_owner ON earn_events(owner);
  CREATE TABLE launches (
    auction TEXT PRIMARY KEY, token TEXT NOT NULL, launchpad TEXT NOT NULL, creator TEXT NOT NULL,
    name TEXT NOT NULL, symbol TEXT NOT NULL, created_block BIGINT NOT NULL, created_ts BIGINT NOT NULL,
    params_json TEXT
  );
  CREATE INDEX launches_token ON launches(token);
  CREATE TABLE bids (
    block BIGINT NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    auction TEXT NOT NULL, bid_id TEXT NOT NULL, bidder TEXT NOT NULL, amount TEXT NOT NULL, max_price TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX bids_auction ON bids(auction, block);
  CREATE INDEX bids_bidder ON bids(bidder);
  CREATE TABLE settlements (
    auction TEXT PRIMARY KEY, block BIGINT NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    clearing_price TEXT NOT NULL, raised TEXT NOT NULL, launched INTEGER NOT NULL, pool TEXT
  );
  CREATE TABLE claims (
    block BIGINT NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    auction TEXT NOT NULL, bid_id TEXT NOT NULL, bidder TEXT NOT NULL, tokens TEXT NOT NULL, refund TEXT NOT NULL,
    PRIMARY KEY (block, log_index)
  );
  CREATE INDEX claims_bidder ON claims(bidder);
  CREATE TABLE tx_values (
    block BIGINT NOT NULL, tx_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
    from_addr TEXT NOT NULL, to_addr TEXT, value TEXT NOT NULL,
    PRIMARY KEY (block, tx_index)
  );
  CREATE INDEX tx_values_from ON tx_values(from_addr);
  CREATE INDEX tx_values_to ON tx_values(to_addr);

  -- unix seconds "now" for integer-time hypertables (continuous aggregate refresh windows)
  CREATE FUNCTION ${SCHEMA}.unix_now() RETURNS BIGINT LANGUAGE SQL STABLE AS $$ SELECT extract(epoch FROM now())::bigint $$;
  ${Object.keys(HYPERTABLES)
    .map(
      (t) => `SELECT create_hypertable('${SCHEMA}.${t}', by_range('timestamp', ${CHUNK}::bigint));
  SELECT set_integer_now_func('${SCHEMA}.${t}', '${SCHEMA}.unix_now');`,
    )
    .join('\n  ')}
  `,
]

/** Continuous aggregates (created outside a transaction). OHLC from price points, volume from swaps. */
const CAGG_BUCKETS: Record<string, number> = { '1m': 60, '1h': 3600, '1d': 86400 }
function caggStatements(): string[] {
  const out: string[] = []
  for (const [name, sec] of Object.entries(CAGG_BUCKETS)) {
    out.push(`CREATE MATERIALIZED VIEW IF NOT EXISTS ${SCHEMA}.price_ohlc_${name}
      WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
      SELECT token, time_bucket(${sec}::bigint, timestamp) AS bucket,
        first(price, block) AS open, max(price) AS high, min(price) AS low, last(price, block) AS close
      FROM ${SCHEMA}.price_points GROUP BY token, bucket WITH NO DATA`)
    out.push(`CREATE MATERIALIZED VIEW IF NOT EXISTS ${SCHEMA}.swap_volume_${name}
      WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
      SELECT pool, time_bucket(${sec}::bigint, timestamp) AS bucket,
        sum(amount_usd) AS volume_usd, sum(fee_usd) AS fees_usd, count(*) AS swaps
      FROM ${SCHEMA}.swaps GROUP BY pool, bucket WITH NO DATA`)
    const schedule = sec === 60 ? '30 seconds' : sec === 3600 ? '5 minutes' : '1 hour'
    for (const v of [`price_ohlc_${name}`, `swap_volume_${name}`])
      out.push(
        `SELECT add_continuous_aggregate_policy('${SCHEMA}.${v}', start_offset => NULL, end_offset => ${sec}::bigint, schedule_interval => INTERVAL '${schedule}', if_not_exists => true)`,
      )
  }
  return out
}

/** `?` placeholders → `$1..$n` (outside quoted literals). */
export function toPg(sql: string): string {
  let n = 0
  let out = ''
  let quote: string | null = null
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null
      out += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
      out += ch
    } else if (ch === '?') out += `$${++n}`
    else out += ch
  }
  return out
}

const val = (v: SqlValue) => (typeof v === 'bigint' ? v.toString() : v)
const MAX_PARAMS = 30_000

type Queryable = { query: (text: string, values?: unknown[]) => Promise<pg.QueryResult> }

/** PostgreSQL + TimescaleDB backend (schema `metaswap`). */
export class PostgresDb implements Db {
  readonly kind = 'postgres' as const
  readonly pool: pg.Pool
  private ready: Promise<void> | null = null

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 10 })
    this.pool.on('connect', (c) => {
      c.query(`SET search_path TO ${SCHEMA}, public`).catch(() => {})
    })
    this.pool.on('error', (e) => console.error('[db] idle client error', e.message))
  }

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.migrate().catch((e) => {
        this.ready = null
        throw e
      })
    }
    return this.ready
  }

  private async migrate() {
    const c = await this.pool.connect()
    try {
      await c.query('CREATE EXTENSION IF NOT EXISTS timescaledb')
      await c.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
      await c.query(`SET search_path TO ${SCHEMA}, public`)
      await c.query('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)')
      const cur = (await c.query('SELECT max(v) AS v FROM schema_version')).rows[0]?.v ?? 0
      for (let v = Number(cur); v < MIGRATIONS.length; v++) {
        await c.query('BEGIN')
        try {
          await c.query(MIGRATIONS[v])
          await c.query('INSERT INTO schema_version (v) VALUES ($1)', [v + 1])
          await c.query('COMMIT')
        } catch (e) {
          await c.query('ROLLBACK')
          throw e
        }
      }
      for (const s of caggStatements()) await c.query(s)
    } finally {
      c.release()
    }
  }

  private async q(sql: string, params: SqlValue[]) {
    await this.init()
    return this.pool.query(toPg(sql), params.map(val))
  }

  async all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): Promise<T[]> {
    return (await this.q(sql, params)).rows as T[]
  }

  async get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
    return (await this.q(sql, params)).rows[0] as T | undefined
  }

  async run(sql: string, ...params: SqlValue[]) {
    await this.q(sql, params)
  }

  private async insertRows(c: Queryable, table: string, rows: Row[], mode: InsertMode) {
    if (!rows.length) return
    const cols = Object.keys(rows[0])
    const keys = PG_KEYS[table] ?? []
    const conflict =
      mode === 'IGNORE' || !keys.length
        ? 'ON CONFLICT DO NOTHING'
        : (() => {
            const upd = cols.filter((k) => !keys.includes(k))
            return upd.length ? `ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${upd.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}` : 'ON CONFLICT DO NOTHING'
          })()
    const per = Math.max(1, Math.floor(MAX_PARAMS / cols.length))
    for (let i = 0; i < rows.length; i += per) {
      const chunk = rows.slice(i, i + per)
      const params: unknown[] = []
      const values = chunk.map((r) => `(${cols.map((k) => (params.push(val(r[k] ?? null)), `$${params.length}`)).join(',')})`)
      await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')} ${conflict}`, params)
    }
  }

  async insert(table: string, row: Row, mode: InsertMode = 'IGNORE') {
    await this.init()
    await this.insertRows(this.pool, table, [row], mode)
  }

  async write(batch: WriteBatch) {
    await this.init()
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      for (const op of batch.ops) if (op.kind === 'run') await c.query(toPg(op.sql), op.params.map(val))
      for (const [table, groups] of groupInserts(batch)) for (const g of groups) await this.insertRows(c, table, g.rows, g.mode)
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      c.release()
    }
    await this.refreshAggregates(batch)
  }

  /**
   * Keep the continuous aggregates exact right after each commit. TimescaleDB's real-time
   * aggregation covers buckets above the materialization watermark, but rows written below it
   * (backfill, a replayed chain whose clock is behind the wall clock, rollbacks) would read stale
   * until the next policy run. Refreshing the written window, including the current bucket,
   * keeps candles identical to the raw data at every block.
   */
  private async refreshAggregates(batch: WriteBatch) {
    const touched: Record<string, [number, number] | null> = { price_ohlc: null, swap_volume: null }
    const span = (key: string, rows: Row[]) => {
      for (const r of rows) {
        const t = Number(r.timestamp)
        const cur = touched[key]
        touched[key] = cur ? [Math.min(cur[0], t), Math.max(cur[1], t)] : [t, t]
      }
    }
    span('price_ohlc', batch.rows('price_points'))
    span('swap_volume', batch.rows('swaps'))
    const deletes = batch.ops.some((o) => o.kind === 'run' && /DELETE FROM (price_points|swaps)/i.test(o.sql))
    for (const [view, range] of Object.entries(touched)) {
      if (!range && !deletes) continue
      for (const [name, sec] of Object.entries(CAGG_BUCKETS)) {
        const lo = deletes || !range ? null : Math.floor(range[0] / sec) * sec
        const hi = deletes || !range ? null : (Math.floor(range[1] / sec) + 1) * sec
        await this.pool.query(`CALL refresh_continuous_aggregate('${SCHEMA}.${view}_${name}', $1::bigint, $2::bigint)`, [lo, hi]).catch((e) => console.error('[db] aggregate refresh', (e as Error).message))
      }
    }
  }

  async getMeta(key: string) {
    return (await this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key))?.value
  }

  async setMeta(key: string, value: string) {
    await this.insert('meta', { key, value }, 'REPLACE')
  }

  /** New chain: drop the schema (hypertables, aggregates and their jobs) and migrate afresh. */
  async resetChainData() {
    await this.init()
    await this.pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    this.ready = null
    await this.init()
    void CHAIN_TABLES
  }

  jsonField(column: string, key: string) {
    return `(${column}::json ->> '${key}')`
  }

  async close() {
    await this.pool.end()
  }
}
