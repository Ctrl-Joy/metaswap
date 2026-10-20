import { getAddress, type Address } from 'viem'
import { erc20Abi } from './abis'
import { HttpError, isNativeAddress, lc, tokenJson, wethAddress, type Context, type TokenInfo } from './context'
import type { Indexer, PoolRuntime } from './indexer/indexer'
import {
  HISTORY_INTERVAL_SEC,
  HISTORY_WINDOW_SEC,
  INTERVALS,
  aggregateCandles,
  bucketLast,
  bucketStart,
  bucketSums,
  buildCandles,
  effectiveInterval,
  intervalForRange,
  parseHistoryInterval,
  rangeSeconds,
  type HistoryInterval,
} from './pricing/candles'
import { pctChange, poolTvlUsd } from './pricing/prices'
import { sqrtPriceToPrice } from './lib/v3math'
import { rankTrending, trendingScore } from './stage5/math'

export const SEED_TAGS: Record<string, string[]> = {
  WETH: ['majors', 'wrapped'],
  mWBTC: ['majors'],
  mUSDC: ['stablecoins'],
  mUSDT: ['stablecoins'],
  mDAI: ['stablecoins'],
  META: ['defi'],
  mLINK: ['defi'],
  mARB: ['l2'],
}
export const TOKEN_CATEGORIES = ['all', 'trending', 'gainers', 'stablecoins', 'majors', 'defi', 'l2', 'memes', 'launched', 'wrapped']

const HOUR = 3600
const CAGG_SEC: Record<string, number> = { '1m': 60, '1h': 3600, '1d': 86400 }
const DAY = 86400

export class Analytics {
  private supplyCache = new Map<string, { block: number; value: bigint }>()
  private memo = new Map<string, { block: number; value: unknown }>()

  constructor(
    private ctx: Context,
    private indexer: Indexer,
  ) {}

  private get db() {
    return this.ctx.db
  }

  /** Chain time of the last indexed block (falls back to wall clock before the first block). */
  now(): number {
    return this.indexer.indexedTimestamp || Math.floor(Date.now() / 1000)
  }

  private cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.memo.get(key)
    if (hit && hit.block === this.indexer.indexedBlock) return hit.value as Promise<T>
    const value = fn().catch((e) => {
      this.memo.delete(key)
      throw e
    })
    this.memo.set(key, { block: this.indexer.indexedBlock, value })
    if (this.memo.size > 500) this.memo.clear()
    return value
  }

  resolveToken(address: string): TokenInfo {
    const t = this.indexer.tokens.getSync(address)
    if (!t) throw new HttpError(404, `Unknown token ${address}`)
    return t
  }

  /** Pool-side token key (native ETH → WETH). */
  poolKey(address: string): string {
    return isNativeAddress(address) ? lc(wethAddress(this.ctx)) : lc(address)
  }

  priceUsd(address: string): number | null {
    return this.indexer.prices.get(this.poolKey(address)) ?? null
  }

  async priceAt(token: string, time: number): Promise<number | null> {
    const key = this.poolKey(token)
    const row =
      (await this.db.get<{ price: number }>('SELECT price FROM price_points WHERE token = ? AND timestamp <= ? ORDER BY timestamp DESC, block DESC LIMIT 1', key, time)) ??
      (await this.db.get<{ price: number }>('SELECT price FROM price_points WHERE token = ? ORDER BY timestamp ASC, block ASC LIMIT 1', key))
    return row?.price ?? null
  }

  /**
   * Price lookups for many timestamps with one query per token: loads each token's points in
   * [from, to] plus the last one before `from`. `at(token, t)` has priceAt's semantics (last price at
   * or before t, else the token's first price).
   */
  async priceBook(tokens: string[], from: number, to: number): Promise<(token: string, t: number) => number | null> {
    const keys = [...new Set(tokens.map((t) => this.poolKey(t)))]
    const series = new Map<string, { t: number[]; p: number[]; first: number | null }>()
    await Promise.all(
      keys.map(async (key) => {
        const [seed, rows] = await Promise.all([
          this.db.get<{ timestamp: number; price: number }>('SELECT timestamp, price FROM price_points WHERE token = ? AND timestamp < ? ORDER BY timestamp DESC, block DESC LIMIT 1', key, from),
          this.db.all<{ timestamp: number; price: number }>('SELECT timestamp, price FROM price_points WHERE token = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp, block', key, from, to),
        ])
        const pts = seed ? [seed, ...rows] : rows
        const first = seed ? null : (rows[0]?.price ?? (await this.priceAt(key, to)))
        series.set(key, { t: pts.map((r) => Number(r.timestamp)), p: pts.map((r) => r.price), first })
      }),
    )
    return (token: string, t: number) => {
      const s = series.get(this.poolKey(token))
      if (!s) return null
      let lo = 0
      let hi = s.t.length - 1
      let idx = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (s.t[mid] <= t) {
          idx = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      return idx >= 0 ? s.p[idx] : (s.first ?? s.p[0] ?? null)
    }
  }

  async totalSupply(token: string): Promise<bigint | null> {
    const key = this.poolKey(token)
    const hit = this.supplyCache.get(key)
    if (hit && hit.block === this.indexer.indexedBlock) return hit.value
    try {
      const value = await this.ctx.client.readContract({ address: getAddress(key), abi: erc20Abi, functionName: 'totalSupply' })
      this.supplyCache.set(key, { block: this.indexer.indexedBlock, value })
      return value
    } catch {
      return null
    }
  }

  poolTvl(p: PoolRuntime): number | null {
    return poolTvlUsd(
      p.reserve0,
      p.reserve1,
      this.indexer.decimals.get(p.token0) ?? 18,
      this.indexer.decimals.get(p.token1) ?? 18,
      this.indexer.prices.get(p.token0),
      this.indexer.prices.get(p.token1),
    )
  }

  tokenTvl(token: string): number {
    const key = this.poolKey(token)
    const price = this.indexer.prices.get(key)
    if (price === undefined) return 0
    const d = this.indexer.decimals.get(key) ?? 18
    let amount = 0
    for (const p of this.indexer.pools.values()) {
      if (p.token0 === key) amount += Number(p.reserve0) / 10 ** d
      else if (p.token1 === key) amount += Number(p.reserve1) / 10 ** d
    }
    return amount * price
  }

  async tokenVolume(token: string, since: number): Promise<number> {
    const key = this.poolKey(token)
    const row = await this.db.get<{ v: number | null }>(
      'SELECT SUM(s.amount_usd) AS v FROM swaps s JOIN pools p ON p.address = s.pool WHERE (p.token0 = ? OR p.token1 = ?) AND s.timestamp > ?',
      key,
      key,
      since,
    )
    return row?.v ?? 0
  }

  /** % change of the token's USD price over the last `seconds`. */
  async changeSince(address: string, seconds: number): Promise<number | null> {
    return pctChange(this.priceUsd(address), await this.priceAt(address, this.now() - seconds))
  }

  async tokenStatsChange24h(address: string): Promise<number | null> {
    return pctChange(this.priceUsd(address), await this.priceAt(address, this.now() - DAY))
  }

  async tokenStats(address: string) {
    const token = this.resolveToken(address)
    const now = this.now()
    const priceUsd = this.priceUsd(token.address)
    const [supply, p1h, p24h, volume24hUsd, volume7dUsd, high24hUsd, low24hUsd] = await Promise.all([
      this.totalSupply(token.address),
      this.priceAt(token.address, now - HOUR),
      this.priceAt(token.address, now - DAY),
      this.tokenVolume(token.address, now - DAY),
      this.tokenVolume(token.address, now - 7 * DAY),
      this.priceExtreme(token.address, now - DAY, 'MAX'),
      this.priceExtreme(token.address, now - DAY, 'MIN'),
    ])
    const fdv = priceUsd !== null && supply !== null ? (Number(supply) / 10 ** token.decimals) * priceUsd : null
    return {
      token: tokenJson(this.ctx, token),
      priceUsd,
      change1h: pctChange(priceUsd, p1h),
      change24h: pctChange(priceUsd, p24h),
      volume24hUsd,
      volume7dUsd,
      tvlUsd: this.tokenTvl(token.address),
      fdvUsd: fdv,
      // devnet tokens have no locked/vesting supply: circulating == total
      marketCapUsd: fdv,
      totalSupply: supply?.toString() ?? null,
      high24hUsd,
      low24hUsd,
    }
  }

  private async priceExtreme(address: string, since: number, fn: 'MAX' | 'MIN'): Promise<number | null> {
    const row = await this.db.get<{ v: number | null }>(`SELECT ${fn}(price) AS v FROM price_points WHERE token = ? AND timestamp > ?`, this.poolKey(address), since)
    return row?.v ?? this.priceUsd(address)
  }

  async candles(address: string, interval: string, from?: number, to?: number) {
    const sec = INTERVALS[interval]
    if (!sec || !['1m', '5m', '1h', '1d'].includes(interval)) throw new HttpError(400, 'interval must be 1m|5m|1h|1d')
    this.resolveToken(address)
    const key = this.poolKey(address)
    const end = to ?? this.now()
    const defaultSpan = { '1m': 6 * HOUR, '5m': DAY, '1h': 7 * DAY, '1d': 365 * DAY }[interval]!
    const start = from ?? end - defaultSpan
    // minute candles over the window, aggregated to the requested interval
    const minuteFrom = bucketStart(start, sec)
    const prev = (await this.db.get<{ price: number }>('SELECT price FROM price_points WHERE token = ? AND timestamp < ? ORDER BY timestamp DESC, block DESC LIMIT 1', key, minuteFrom))?.price ?? null
    if (this.db.kind === 'postgres') return this.candlesFromAggregates(key, interval, sec, minuteFrom, end, prev)
    const points = (await this.db.all<{ timestamp: number; price: number }>('SELECT timestamp, price FROM price_points WHERE token = ? AND timestamp >= ? AND timestamp <= ? ORDER BY block', key, minuteFrom, end)).map((r) => ({
      time: Number(r.timestamp),
      price: r.price,
    }))
    const volumes = await this.tokenVolumes(key, minuteFrom, end)
    if (sec === 60) return buildCandles(points, volumes, 60, minuteFrom, end, prev)
    // build at minute resolution only when the window is small enough; otherwise directly
    const minutes = (end - minuteFrom) / 60
    if (minutes <= 20_000) {
      const minute = buildCandles(points, volumes, 60, minuteFrom, end, prev, 20_001)
      return aggregateCandles(minute, sec).slice(-2000)
    }
    return buildCandles(points, volumes, sec, minuteFrom, end, prev)
  }

  private async tokenVolumes(key: string, from: number, to: number) {
    return (
      await this.db.all<{ timestamp: number; amount_usd: number | null }>(
        'SELECT s.timestamp, s.amount_usd FROM swaps s JOIN pools p ON p.address = s.pool WHERE (p.token0 = ? OR p.token1 = ?) AND s.timestamp >= ? AND s.timestamp <= ?',
        key,
        key,
        from,
        to,
      )
    ).map((r) => ({ time: Number(r.timestamp), volumeUsd: r.amount_usd ?? 0 }))
  }

  /**
   * Postgres: candles from the TimescaleDB continuous aggregates (price_ohlc_* / swap_volume_*).
   * Each aggregate bucket becomes open/high/low/close points fed through the same builder, so the
   * output (continuous opens, forward-filled gaps) matches the SQLite path exactly.
   */
  private async candlesFromAggregates(key: string, interval: string, sec: number, from: number, end: number, prev: number | null) {
    const agg = sec >= 86400 ? '1d' : sec >= 3600 ? '1h' : '1m'
    const aggSec = CAGG_SEC[agg]
    // whole buckets from the aggregates; the bucket holding `end` from raw rows (it may extend past `end`)
    const tail = bucketStart(end, aggSec)
    const [ohlc, vols, tailPoints, tailVols] = await Promise.all([
      this.db.all<{ bucket: number; open: number; high: number; low: number; close: number }>(
        `SELECT bucket, open, high, low, close FROM price_ohlc_${agg} WHERE token = ? AND bucket >= ? AND bucket < ? ORDER BY bucket`,
        key,
        from,
        tail,
      ),
      this.db.all<{ bucket: number; v: number | null }>(
        `SELECT v.bucket, SUM(v.volume_usd) AS v FROM swap_volume_${agg} v JOIN pools p ON p.address = v.pool WHERE (p.token0 = ? OR p.token1 = ?) AND v.bucket >= ? AND v.bucket < ? GROUP BY v.bucket`,
        key,
        key,
        from,
        tail,
      ),
      this.db.all<{ timestamp: number; price: number }>('SELECT timestamp, price FROM price_points WHERE token = ? AND timestamp >= ? AND timestamp <= ? ORDER BY block', key, Math.max(tail, from), end),
      this.tokenVolumes(key, Math.max(tail, from), end),
    ])
    const points = [
      ...ohlc.flatMap((c) => [c.open, c.high, c.low, c.close].map((price) => ({ time: Number(c.bucket), price }))),
      ...tailPoints.map((r) => ({ time: Number(r.timestamp), price: r.price })),
    ]
    const volumes = [...vols.map((v) => ({ time: Number(v.bucket), volumeUsd: v.v ?? 0 })), ...tailVols]
    if (sec === aggSec) return buildCandles(points, volumes, sec, from, end, prev)
    const buckets = (end - from) / aggSec
    if (buckets <= 20_000) return aggregateCandles(buildCandles(points, volumes, aggSec, from, end, prev, 20_001), sec).slice(-2000)
    return buildCandles(points, volumes, sec, from, end, prev)
  }

  async priceHistory(address: string, range: string) {
    const spec: Record<string, [number, number]> = {
      '1H': [HOUR, 60],
      '1D': [DAY, 300],
      '1W': [7 * DAY, HOUR],
      '1M': [30 * DAY, 4 * HOUR],
      '1Y': [365 * DAY, DAY],
    }
    const s = spec[range.toUpperCase()]
    if (!s) throw new HttpError(400, 'range must be 1H|1D|1W|1M|1Y')
    this.resolveToken(address)
    return this.priceSeries(this.poolKey(address), this.now() - s[0], this.now(), s[1])
  }

  private async priceSeries(key: string, from: number, to: number, step: number) {
    // the last point before the window seeds the forward fill; then everything inside it
    const before = await this.db.get<{ timestamp: number; price: number }>('SELECT timestamp, price FROM price_points WHERE token = ? AND timestamp < ? ORDER BY timestamp DESC, block DESC LIMIT 1', key, bucketStart(from, step))
    const inside = await this.db.all<{ timestamp: number; price: number }>('SELECT timestamp, price FROM price_points WHERE token = ? AND timestamp >= ? AND timestamp <= ? ORDER BY block', key, bucketStart(from, step), to)
    const points = [...(before ? [before] : []), ...inside].map((r) => ({ time: Number(r.timestamp), value: r.price }))
    const series = bucketLast(points, step, from, to)
    // bucketLast forward-fills empty buckets; drop those repeats (keeping the first and last
    // point) so charts draw a line between actual price changes instead of a staircase.
    const out = series
      .filter((p, i, arr) => i === 0 || i === arr.length - 1 || p.value !== arr[i - 1].value)
      .map((p) => ({ time: p.time, priceUsd: p.value }))
    // make the last point the live price
    const live = this.indexer.prices.get(key)
    if (out.length && live !== undefined) out[out.length - 1].priceUsd = live
    return out
  }

  async poolVolume(pool: string, since: number): Promise<{ volume: number; fees: number }> {
    const r = await this.db.get<{ v: number | null; f: number | null }>('SELECT SUM(amount_usd) AS v, SUM(fee_usd) AS f FROM swaps WHERE pool = ? AND timestamp > ?', pool, since)
    return { volume: r?.v ?? 0, fees: r?.f ?? 0 }
  }

  async poolRow(p: PoolRuntime) {
    const now = this.now()
    const tvlUsd = this.poolTvl(p)
    const [d24, d7] = await Promise.all([this.poolVolume(p.address, now - DAY), this.poolVolume(p.address, now - 7 * DAY)])
    const t0 = this.resolveToken(p.token0)
    const t1 = this.resolveToken(p.token1)
    return {
      address: getAddress(p.address),
      version: p.version,
      token0: tokenJson(this.ctx, t0),
      token1: tokenJson(this.ctx, t1),
      fee: p.fee,
      feeTier: `${p.fee / 10000}%`,
      tvlUsd,
      volume24hUsd: d24.volume,
      volume7dUsd: d7.volume,
      fees24hUsd: d24.fees,
      // APR in percent: annualised 24h fees over TVL
      apr: tvlUsd && tvlUsd > 0 ? ((d24.fees * 365) / tvlUsd) * 100 : 0,
    }
  }

  explorePools(sort = 'tvl', order = 'desc') {
    return this.cached(`pools:${sort}:${order}`, async () => {
      const rows = await Promise.all([...this.indexer.pools.values()].map((p) => this.poolRow(p)))
      const key = { tvl: 'tvlUsd', volume: 'volume24hUsd', apr: 'apr', volume7d: 'volume7dUsd' }[sort] as keyof (typeof rows)[number]
      if (!key) throw new HttpError(400, 'sort must be tvl|volume|apr')
      const dir = order === 'asc' ? 1 : -1
      return rows.sort((a, b) => dir * ((Number(a[key]) || 0) - (Number(b[key]) || 0)))
    })
  }

  /** Discovery tags (STAGE5 §3): seed tags by symbol, `launched` + `memes` for launchpad tokens. */
  tagsFor(address: string): string[] {
    const t = this.indexer.tokens.getSync(address)
    if (!t) return []
    if (t.isNative) return ['majors']
    if (this.indexer.launchedTokens.has(lc(t.address))) return ['launched', 'memes']
    return SEED_TAGS[t.symbol] ?? []
  }

  async exploreTokens(sort = 'volume', order = 'desc', range = '1D', category = 'all') {
    const cat = category.toLowerCase()
    if (!TOKEN_CATEGORIES.includes(cat)) throw new HttpError(400, `category must be ${TOKEN_CATEGORIES.join('|')}`)
    let span: number | null
    try {
      span = rangeSeconds(range)
    } catch (e) {
      throw new HttpError(400, (e as Error).message)
    }
    const since = span === null ? 0 : this.now() - span
    // launch tokens appear once they trade (their auction graduated and seeded a pool)
    const tokens = this.indexer.tokens.all().filter((t) => !this.indexer.launchedTokens.has(lc(t.address)) || this.indexer.prices.has(lc(t.address)))
    const rows = await Promise.all(
      tokens.map(async (t) => {
        const [s, volumeUsd, sparkline] = await Promise.all([this.tokenStats(t.address), this.tokenVolume(t.address, since), this.sparkline(t.address)])
        // volumeUsd = volume over the requested range (volume24hUsd is always 24h)
        return { ...s, range: range.toUpperCase(), volumeUsd, tags: this.tagsFor(t.address), sparkline }
      }),
    )
    if (cat === 'trending') return rankTrending(rows.map((r) => ({ ...r, key: r.token.address })), 0, rows.length)
    if (cat === 'gainers') return rows.filter((r) => (r.change24h ?? 0) > 0).sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
    const filtered = cat === 'all' ? rows : rows.filter((r) => r.tags.includes(cat))
    const key = { volume: 'volumeUsd', tvl: 'tvlUsd', price: 'priceUsd', change: 'change24h', fdv: 'fdvUsd', change1h: 'change1h' }[sort] as keyof (typeof rows)[number]
    if (!key) throw new HttpError(400, 'sort must be volume|tvl|price|change')
    const dir = order === 'asc' ? 1 : -1
    return filtered.sort((a, b) => dir * ((Number(a[key]) || 0) - (Number(b[key]) || 0)))
  }

  /** GET /explore/trending: 4–8 rows ranked by 24h volume × |1D change| (launched tokens included). */
  async trending() {
    const rows = await this.exploreTokens('volume', 'desc', '1D', 'all')
    return rankTrending(rows.map((r) => ({ ...r, key: r.token.address })), 4, 8).map(({ key: _k, ...r }) => ({ ...r, trendingScore: trendingScore(r) }))
  }

  /** ~48-point price line over the last 24h (or since the first trade on a young chain). */
  async sparkline(address: string) {
    const key = this.poolKey(address)
    const first = (await this.db.get<{ t: number | null }>('SELECT MIN(timestamp) AS t FROM price_points WHERE token = ?', key))?.t
    const now = this.now()
    const span = Math.max(60, Math.min(DAY, now - Number(first ?? now)))
    const step = Math.max(10, Math.ceil(span / 48))
    return this.priceSeries(key, now - span, now, step)
  }

  /** Seconds of indexed history (first pool snapshot → now). */
  async dataSpan(): Promise<number> {
    const first = (await this.db.get<{ t: number | null }>('SELECT MIN(timestamp) AS t FROM pool_snapshots'))?.t
    return first === null || first === undefined ? 0 : this.now() - Number(first)
  }

  parseInterval(v: string | undefined, dflt: HistoryInterval = 'hour'): HistoryInterval {
    try {
      return parseHistoryInterval(v, dflt)
    } catch (e) {
      throw new HttpError(400, (e as Error).message)
    }
  }

  async exploreStats(requested: HistoryInterval = 'hour') {
    const interval = effectiveInterval(requested, await this.dataSpan())
    return this.cached(`stats:${requested}:${interval}`, async () => {
      const now = this.now()
      const pools = [...this.indexer.pools.values()]
      const byVersion = async (v: 'v2' | 'v3') => {
        const ps = pools.filter((p) => p.version === v)
        const tvl = ps.reduce((acc, p) => acc + (this.poolTvl(p) ?? 0), 0)
        const vol = (await this.db.get<{ v: number | null }>('SELECT SUM(amount_usd) AS v FROM swaps WHERE version = ? AND timestamp > ?', v, now - DAY))?.v ?? 0
        const vol7 = (await this.db.get<{ v: number | null }>('SELECT SUM(amount_usd) AS v FROM swaps WHERE version = ? AND timestamp > ?', v, now - 7 * DAY))?.v ?? 0
        return { tvlUsd: tvl, volume24hUsd: vol, volume7dUsd: vol7, poolCount: ps.length }
      }
      const [v2, v3] = await Promise.all([byVersion('v2'), byVersion('v3')])
      const step = HISTORY_INTERVAL_SEC[interval]
      const span = HISTORY_WINDOW_SEC[interval]
      const swaps = await this.db.all<{ timestamp: number; amount_usd: number | null; version: string }>('SELECT timestamp, amount_usd, version FROM swaps WHERE timestamp > ?', now - span)
      const volumeHistory = bucketSums(swaps.map((s) => ({ time: Number(s.timestamp), value: s.amount_usd ?? 0 })), step, now - span, now)
      const first = volumeHistory.findIndex((b) => b.value > 0)
      return {
        tvlUsd: v2.tvlUsd + v3.tvlUsd,
        volume24hUsd: v2.volume24hUsd + v3.volume24hUsd,
        volume7dUsd: v2.volume7dUsd + v3.volume7dUsd,
        v2,
        v3,
        interval,
        requestedInterval: requested,
        bucketSec: step,
        volumeHistory: volumeHistory.slice(Math.max(0, first)).map((b) => ({ time: b.time, volumeUsd: b.value })),
        tvlHistory: await this.tvlHistory(step, now - span, now),
        txCount24h: Number((await this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM swaps WHERE timestamp > ?', now - DAY))?.c ?? 0),
      }
    })
  }

  /** Protocol TVL per bucket = Σ pools' last snapshot TVL at bucket end. */
  private async tvlHistory(step: number, from: number, to: number, pool?: string) {
    const snaps = await this.db.all<{ pool: string; timestamp: number; tvl_usd: number | null }>(
      pool ? 'SELECT pool, timestamp, tvl_usd FROM pool_snapshots WHERE pool = ? ORDER BY block' : 'SELECT pool, timestamp, tvl_usd FROM pool_snapshots ORDER BY block',
      ...(pool ? [pool] : []),
    )
    const start = bucketStart(from, step)
    const end = bucketStart(to, step)
    const latest = new Map<string, number>()
    const out: { time: number; tvlUsd: number }[] = []
    let i = 0
    for (let b = start; b <= end; b += step) {
      while (i < snaps.length && Number(snaps[i].timestamp) < b + step) {
        latest.set(snaps[i].pool, snaps[i].tvl_usd ?? 0)
        i++
      }
      if (latest.size) out.push({ time: b, tvlUsd: [...latest.values()].reduce((a, v) => a + v, 0) })
    }
    return out
  }

  /**
   * Token TVL over time: Σ over pools holding the token of (token reserve at bucket end × token
   * price at bucket end). Accepts a web range (1H..ALL) or interval/from/to.
   */
  async tokenTvlHistory(address: string, q: { range?: string; interval?: string; from?: number; to?: number }) {
    this.resolveToken(address)
    const key = this.poolKey(address)
    const now = q.to ?? this.now()
    let from: number
    let requested: HistoryInterval
    try {
      if (q.range) {
        const s = rangeSeconds(q.range)
        requested = q.interval ? parseHistoryInterval(q.interval) : intervalForRange(q.range)
        from = q.from ?? (s === null ? 0 : now - s)
      } else {
        requested = parseHistoryInterval(q.interval, 'hour')
        from = q.from ?? now - HISTORY_WINDOW_SEC[requested]
      }
    } catch (e) {
      throw new HttpError(400, (e as Error).message)
    }
    const pools = [...this.indexer.pools.values()].filter((p) => p.token0 === key || p.token1 === key)
    if (pools.length === 0) return []
    const firstTs = (
      await this.db.get<{ t: number | null }>(
        `SELECT MIN(timestamp) AS t FROM pool_snapshots WHERE pool IN (${pools.map(() => '?').join(',')})`,
        ...pools.map((p) => p.address),
      )
    )?.t
    if (firstTs === null || firstTs === undefined) return []
    const interval = effectiveInterval(requested, now - Number(firstTs))
    const step = HISTORY_INTERVAL_SEC[interval]
    from = Math.max(from, Number(firstTs), interval === 'minute' ? now - HISTORY_WINDOW_SEC.minute : 0)
    const decimals = this.indexer.decimals.get(key) ?? 18
    type Ev = { time: number; block: number; kind: 'snap'; pool: string; amount: number } | { time: number; block: number; kind: 'price'; price: number }
    const events: Ev[] = []
    for (const p of pools) {
      const col = p.token0 === key ? 'reserve0' : 'reserve1'
      for (const r of await this.db.all<{ timestamp: number; block: number; r: string }>(`SELECT timestamp, block, ${col} AS r FROM pool_snapshots WHERE pool = ? ORDER BY block`, p.address))
        events.push({ time: Number(r.timestamp), block: Number(r.block), kind: 'snap', pool: p.address, amount: Number(r.r) / 10 ** decimals })
    }
    for (const r of await this.db.all<{ timestamp: number; block: number; price: number }>('SELECT timestamp, block, price FROM price_points WHERE token = ? ORDER BY block', key))
      events.push({ time: Number(r.timestamp), block: Number(r.block), kind: 'price', price: r.price })
    events.sort((a, b) => a.block - b.block)
    const start = bucketStart(from, step)
    const end = bucketStart(now, step)
    const reserves = new Map<string, number>()
    let price: number | null = null
    let i = 0
    const out: { time: number; tvlUsd: number }[] = []
    for (let b = start; b <= end; b += step) {
      while (i < events.length && events[i].time < b + step) {
        const e = events[i++]
        if (e.kind === 'snap') reserves.set(e.pool, e.amount)
        else price = e.price
      }
      if (price !== null && reserves.size) out.push({ time: b, tvlUsd: [...reserves.values()].reduce((a, v) => a + v, 0) * price })
    }
    return out
  }

  async poolDetail(address: string) {
    const p = this.indexer.pools.get(lc(address))
    if (!p) throw new HttpError(404, `Unknown pool ${address}`)
    const d0 = this.indexer.decimals.get(p.token0) ?? 18
    const d1 = this.indexer.decimals.get(p.token1) ?? 18
    let token0Price: number | null = null
    if (p.version === 'v3' && p.sqrtPriceX96) token0Price = sqrtPriceToPrice(p.sqrtPriceX96, d0, d1)
    else if (p.reserve0 > 0n) token0Price = Number(p.reserve1) / 10 ** d1 / (Number(p.reserve0) / 10 ** d0)
    const now = this.now()
    const prevTvl = (await this.db.get<{ tvl_usd: number | null }>('SELECT tvl_usd FROM pool_snapshots WHERE pool = ? AND timestamp <= ? ORDER BY block DESC LIMIT 1', p.address, now - DAY))?.tvl_usd
    const prevVol = (await this.db.get<{ v: number | null }>('SELECT SUM(amount_usd) AS v FROM swaps WHERE pool = ? AND timestamp > ? AND timestamp <= ?', p.address, now - 2 * DAY, now - DAY))?.v
    const row = await this.poolRow(p)
    return {
      ...row,
      tickSpacing: p.tickSpacing,
      reserve0: p.reserve0.toString(),
      reserve1: p.reserve1.toString(),
      reserve0Formatted: Number(p.reserve0) / 10 ** d0,
      reserve1Formatted: Number(p.reserve1) / 10 ** d1,
      reserve0Usd: this.indexer.prices.has(p.token0) ? (Number(p.reserve0) / 10 ** d0) * this.indexer.prices.get(p.token0)! : null,
      reserve1Usd: this.indexer.prices.has(p.token1) ? (Number(p.reserve1) / 10 ** d1) * this.indexer.prices.get(p.token1)! : null,
      liquidity: p.liquidity?.toString() ?? null,
      sqrtPriceX96: p.sqrtPriceX96?.toString() ?? null,
      tick: p.tick,
      totalSupply: p.version === 'v2' ? p.lpSupply.toString() : null,
      token0Price,
      token1Price: token0Price ? 1 / token0Price : null,
      token0PriceUsd: this.indexer.prices.get(p.token0) ?? null,
      token1PriceUsd: this.indexer.prices.get(p.token1) ?? null,
      tvlChange24h: pctChange(row.tvlUsd, prevTvl ?? null),
      volumeChange24h: pctChange(row.volume24hUsd, prevVol ?? null),
      createdBlock: p.createdBlock,
      createdAt: p.createdTs,
    }
  }

  async poolHistory(address: string, requested: HistoryInterval = 'hour') {
    const p = this.indexer.pools.get(lc(address))
    if (!p) throw new HttpError(404, `Unknown pool ${address}`)
    const now = this.now()
    const interval = effectiveInterval(requested, now - p.createdTs)
    const step = HISTORY_INTERVAL_SEC[interval]
    const span = HISTORY_WINDOW_SEC[interval]
    const from = Math.max(now - span, p.createdTs)
    const swaps = await this.db.all<{ timestamp: number; amount_usd: number | null; fee_usd: number | null }>('SELECT timestamp, amount_usd, fee_usd FROM swaps WHERE pool = ? AND timestamp > ?', p.address, from - step)
    const vol = bucketSums(swaps.map((s) => ({ time: Number(s.timestamp), value: s.amount_usd ?? 0 })), step, from, now)
    const fees = bucketSums(swaps.map((s) => ({ time: Number(s.timestamp), value: s.fee_usd ?? 0 })), step, from, now)
    const tvl = new Map((await this.tvlHistory(step, from, now, p.address)).map((t) => [t.time, t.tvlUsd]))
    const prices = (await this.db.all<{ timestamp: number; price0: number | null }>('SELECT timestamp, price0 FROM pool_snapshots WHERE pool = ? ORDER BY block', p.address))
      .filter((r) => r.price0 !== null)
      .map((r) => ({ time: Number(r.timestamp), value: r.price0! }))
    const price = new Map(bucketLast(prices, step, from, now).map((x) => [x.time, x.value]))
    return vol.map((v, i) => ({
      time: v.time,
      volumeUsd: v.value,
      feesUsd: fees[i].value,
      tvlUsd: tvl.get(v.time) ?? null,
      token0Price: price.get(v.time) ?? null,
    }))
  }

  /** V3 liquidity distribution from indexed Mint/Burn events (exact: same deltas the pool applies). */
  async poolTicks(address: string) {
    const p = this.indexer.pools.get(lc(address))
    if (!p) throw new HttpError(404, `Unknown pool ${address}`)
    if (p.version !== 'v3') throw new HttpError(400, 'ticks are only available for v3 pools')
    const net = new Map<number, bigint>()
    const gross = new Map<number, bigint>()
    for (const e of await this.db.all<{ type: string; tick_lower: number; tick_upper: number; liquidity: string }>(
      "SELECT type, tick_lower, tick_upper, liquidity FROM liquidity_events WHERE pool = ? AND version = 'v3' ORDER BY block, log_index",
      p.address,
    )) {
      const L = BigInt(e.liquidity) * (e.type === 'add' ? 1n : -1n)
      net.set(e.tick_lower, (net.get(e.tick_lower) ?? 0n) + L)
      net.set(e.tick_upper, (net.get(e.tick_upper) ?? 0n) - L)
      gross.set(e.tick_lower, (gross.get(e.tick_lower) ?? 0n) + L)
      gross.set(e.tick_upper, (gross.get(e.tick_upper) ?? 0n) + L)
    }
    const d0 = this.indexer.decimals.get(p.token0) ?? 18
    const d1 = this.indexer.decimals.get(p.token1) ?? 18
    const ticks = [...gross.entries()]
      .filter(([, g]) => g > 0n)
      .map(([t]) => t)
      .sort((a, b) => a - b)
    let active = 0n
    const out = ticks.map((tick) => {
      active += net.get(tick) ?? 0n
      return {
        tick,
        liquidityNet: (net.get(tick) ?? 0n).toString(),
        liquidityGross: (gross.get(tick) ?? 0n).toString(),
        // liquidity active in [tick, nextTick)
        liquidityActive: active.toString(),
        price0: 1.0001 ** tick * 10 ** (d0 - d1),
        price1: 1 / (1.0001 ** tick * 10 ** (d0 - d1)),
      }
    })
    return {
      pool: getAddress(p.address),
      token0: tokenJson(this.ctx, this.resolveToken(p.token0)),
      token1: tokenJson(this.ctx, this.resolveToken(p.token1)),
      fee: p.fee,
      tickSpacing: p.tickSpacing,
      currentTick: p.tick,
      sqrtPriceX96: p.sqrtPriceX96?.toString() ?? null,
      liquidity: p.liquidity?.toString() ?? null,
      ticks: out,
    }
  }

  async transactions(opts: { type?: string; token?: string; pool?: string; account?: string; limit?: number; before?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500)
    const out: Record<string, unknown>[] = []
    const where: string[] = []
    const params: (string | number)[] = []
    if (opts.pool) {
      where.push('x.pool = ?')
      params.push(lc(opts.pool))
    }
    if (opts.token) {
      const k = this.poolKey(opts.token)
      where.push('(p.token0 = ? OR p.token1 = ?)')
      params.push(k, k)
    }
    if (opts.account) {
      where.push('x.origin = ?')
      params.push(lc(opts.account))
    }
    if (opts.before) {
      where.push('x.block < ?')
      params.push(opts.before)
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const types = opts.type ? opts.type.split(',') : ['swap', 'add', 'remove']
    if (types.includes('swap')) {
      for (const r of await this.db.all<Record<string, string | number | null>>(
        `SELECT x.*, p.token0, p.token1, p.fee FROM swaps x JOIN pools p ON p.address = x.pool ${w} ORDER BY x.block DESC, x.log_index DESC LIMIT ?`,
        ...params,
        limit,
      ))
        out.push(this.swapTx(r))
    }
    const liqTypes = types.filter((t) => t === 'add' || t === 'remove')
    if (liqTypes.length) {
      const typeClause = `x.type IN (${liqTypes.map(() => '?').join(',')}) AND (x.amount0 != '0' OR x.amount1 != '0')`
      for (const r of await this.db.all<Record<string, string | number | null>>(
        `SELECT x.*, p.token0, p.token1, p.fee FROM liquidity_events x JOIN pools p ON p.address = x.pool ${w ? `${w} AND ${typeClause}` : `WHERE ${typeClause}`} ORDER BY x.block DESC, x.log_index DESC LIMIT ?`,
        ...params,
        ...liqTypes,
        limit,
      ))
        out.push(this.liqTx(r))
    }
    return out.sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber) || Number(b.logIndex) - Number(a.logIndex)).slice(0, limit)
  }

  private amountJson(token: string, raw: bigint) {
    const t = this.resolveToken(token)
    return { ...tokenJson(this.ctx, t), amount: raw.toString(), amountFormatted: Number(raw) / 10 ** t.decimals }
  }

  swapTx(r: Record<string, string | number | null>) {
    const a0 = BigInt(r.amount0 as string)
    const a1 = BigInt(r.amount1 as string)
    // pool perspective: positive = paid into the pool by the trader
    const [tin, ain, tout, aout] = a0 > 0n ? [r.token0, a0, r.token1, -a1] : [r.token1, a1, r.token0, -a0]
    return {
      type: 'swap',
      txHash: r.tx_hash,
      blockNumber: Number(r.block),
      logIndex: Number(r.log_index),
      timestamp: Number(r.timestamp),
      version: r.version,
      pool: getAddress(r.pool as string),
      fee: Number(r.fee),
      account: getAddress(r.origin as string),
      tokenIn: this.amountJson(tin as string, ain as bigint),
      tokenOut: this.amountJson(tout as string, aout as bigint),
      amountUsd: r.amount_usd,
    }
  }

  liqTx(r: Record<string, string | number | null>) {
    return {
      type: r.type,
      txHash: r.tx_hash,
      blockNumber: Number(r.block),
      logIndex: Number(r.log_index),
      timestamp: Number(r.timestamp),
      version: r.version,
      pool: getAddress(r.pool as string),
      fee: Number(r.fee),
      account: getAddress(r.origin as string),
      token0: this.amountJson(r.token0 as string, BigInt(r.amount0 as string)),
      token1: this.amountJson(r.token1 as string, BigInt(r.amount1 as string)),
      amountUsd: r.amount_usd,
    }
  }

  tokenListJson() {
    return this.indexer.tokens.all().map((t) => tokenJson(this.ctx, t))
  }

  addressOf(a: string): Address {
    return getAddress(a)
  }
}
