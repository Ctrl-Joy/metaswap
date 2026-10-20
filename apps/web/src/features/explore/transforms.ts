// Pure data transforms for the explore pages. No React, no fetching: everything here is unit tested
// (transforms.test.ts). API shapes are normalised here so components read one clean model.
import type { ApiToken } from '@/api/types'
import type {
  CandlePoint,
  ExploreStatsRaw,
  ExploreTokenApiRow,
  PoolApiRow,
  PoolHistoryPoint,
  PoolTicksApi,
  RangeKey,
  SeriesPoint,
  TokenRow,
  TxRow,
} from './types'

export type SortDir = 'asc' | 'desc'

/* ------------------------------------------------------------------ numbers */

export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** The API uses unix seconds; accept milliseconds too. */
export function toSeconds(t: number): number {
  return t > 1e12 ? Math.floor(t / 1000) : t
}

/* ------------------------------------------------------------------ sorting */

/** Sort rows by a key. null, undefined and NaN always sort last, whatever the direction. */
export function sortRows<T>(rows: readonly T[], get: (row: T) => number | string | null | undefined, dir: SortDir): T[] {
  const indexed = rows.map((row, i) => ({ row, i, v: get(row) }))
  indexed.sort((a, b) => {
    const aMissing = a.v === null || a.v === undefined || (typeof a.v === 'number' && Number.isNaN(a.v))
    const bMissing = b.v === null || b.v === undefined || (typeof b.v === 'number' && Number.isNaN(b.v))
    if (aMissing && bMissing) return a.i - b.i
    if (aMissing) return 1
    if (bMissing) return -1
    let c: number
    if (typeof a.v === 'string' || typeof b.v === 'string') c = String(a.v).localeCompare(String(b.v))
    else c = (a.v as number) - (b.v as number)
    if (c === 0) return a.i - b.i
    return dir === 'asc' ? c : -c
  })
  return indexed.map((x) => x.row)
}

/* ------------------------------------------------------------------ tokens */

export type TokenChip = 'all' | 'stablecoins' | 'wrapped'

const STABLE_SYMBOLS = new Set(['mUSDC', 'mUSDT', 'mDAI', 'USDC', 'USDT', 'DAI'])

export function isStablecoin(row: Pick<TokenRow, 'symbol' | 'tags'>): boolean {
  return row.tags.includes('stablecoin') || STABLE_SYMBOLS.has(row.symbol)
}

export function isWrapped(row: Pick<TokenRow, 'symbol' | 'tags'>): boolean {
  return row.tags.includes('wrapped') || row.symbol === 'WETH'
}

/** Normalise one GET /explore/tokens row. Metadata sits under `token`; flat fields are accepted too. */
export function normalizeTokenRow(r: ExploreTokenApiRow): TokenRow | null {
  const t: { address?: string; symbol?: string; name?: string; decimals?: number; tags?: string[] } = r.token ?? { address: r.address, symbol: r.symbol, name: r.name }
  if (!t.address || !t.symbol) return null
  const spark = (r.sparkline ?? [])
    .map((p) => (typeof p === 'number' ? p : p?.priceUsd))
    .map(toNum)
    .filter((n): n is number => n !== null)
  return {
    address: t.address,
    symbol: t.symbol,
    name: t.name ?? t.symbol,
    decimals: Number(t.decimals ?? 18),
    tags: t.tags ?? [],
    priceUsd: toNum(r.priceUsd),
    change1h: toNum(r.change1h),
    change24h: toNum(r.change24h),
    volumeUsd: toNum(r.volumeUsd ?? r.volume24hUsd),
    tvlUsd: toNum(r.tvlUsd),
    fdvUsd: toNum(r.fdvUsd),
    marketCapUsd: toNum(r.marketCapUsd),
    sparkline: spark,
  }
}

export function filterTokenRows(rows: readonly TokenRow[], opts: { query?: string; chip?: TokenChip }): TokenRow[] {
  const q = (opts.query ?? '').trim().toLowerCase()
  const chip = opts.chip ?? 'all'
  return rows.filter((r) => {
    if (chip === 'stablecoins' && !isStablecoin(r)) return false
    if (chip === 'wrapped' && !isWrapped(r)) return false
    if (!q) return true
    return r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.address.toLowerCase().startsWith(q)
  })
}

/* ------------------------------------------------------------------ series */

/** Clean a series for lightweight-charts: seconds, finite, ascending, unique times (last wins). */
export function toSeries(points: ReadonlyArray<{ time: number; value: number | null | undefined }>): SeriesPoint[] {
  const byTime = new Map<number, number>()
  for (const p of points) {
    const t = toNum(p.time)
    const v = toNum(p.value)
    if (t === null || v === null) continue
    byTime.set(toSeconds(t), v)
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }))
}

export function toCandles(points: ReadonlyArray<Partial<CandlePoint> & { time: number }>): CandlePoint[] {
  const byTime = new Map<number, CandlePoint>()
  for (const p of points) {
    const t = toNum(p.time)
    const o = toNum(p.open)
    const h = toNum(p.high)
    const l = toNum(p.low)
    const c = toNum(p.close)
    if (t === null || o === null || h === null || l === null || c === null) continue
    const time = toSeconds(t)
    byTime.set(time, { time, open: o, high: h, low: l, close: c, volumeUsd: toNum(p.volumeUsd) ?? 0 })
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

/** Sum values into fixed-width buckets (volume per hour or day). Bucket time is the bucket start. */
export function bucketSum(points: ReadonlyArray<{ time: number; value: number | null | undefined }>, stepSec: number): SeriesPoint[] {
  const out = new Map<number, number>()
  for (const p of toSeries(points)) {
    const b = Math.floor(p.time / stepSec) * stepSec
    out.set(b, (out.get(b) ?? 0) + p.value)
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }))
}

/** Keep points inside the range window ending at `nowSec`. ALL keeps everything. */
export function filterRange<T extends { time: number }>(points: readonly T[], range: RangeKey, nowSec: number): T[] {
  const span = RANGES[range].seconds
  if (span === null) return [...points]
  const from = nowSec - span
  return points.filter((p) => toSeconds(p.time) >= from)
}

/** Percent change of the last point vs the one before it. Null without at least two points. */
export function percentDelta(points: ReadonlyArray<{ time: number; value: number | null | undefined }>): number | null {
  const s = toSeries(points)
  if (s.length < 2) return null
  const prev = s[s.length - 2]!.value
  const last = s[s.length - 1]!.value
  if (prev === 0) return null
  return ((last - prev) / prev) * 100
}

/** Absolute and percent change from the first to the last point. Null without two points. */
export function changeOver(points: ReadonlyArray<{ time: number; value: number | null | undefined }>): { abs: number; pct: number } | null {
  const s = toSeries(points)
  if (s.length < 2) return null
  const first = s[0]!.value
  const last = s[s.length - 1]!.value
  if (first === 0) return null
  return { abs: last - first, pct: ((last - first) / first) * 100 }
}

export function extremes(candles: readonly CandlePoint[]): { high: number; low: number } | null {
  if (!candles.length) return null
  let high = -Infinity
  let low = Infinity
  for (const c of candles) {
    if (c.high > high) high = c.high
    if (c.low < low) low = c.low
  }
  return { high, low }
}

/* ------------------------------------------------------------------ ranges */

export interface RangeConfig {
  label: string
  /** Look-back in seconds; null means everything. */
  seconds: number | null
  /** GET /tokens/:address/price-history?range= (ALL uses daily candles instead). */
  priceRange: '1H' | '1D' | '1W' | '1M' | '1Y' | null
  candleInterval: '1m' | '5m' | '1h' | '1d'
  /** GET /pools/:address/history?interval= */
  poolInterval: 'hour' | 'day'
  /** Bucket width for volume bars. */
  bucketSec: number
}

const HOUR = 3600
const DAY = 24 * HOUR

export const RANGES: Record<RangeKey, RangeConfig> = {
  '1H': { label: '1H', seconds: HOUR, priceRange: '1H', candleInterval: '1m', poolInterval: 'hour', bucketSec: 60 },
  '1D': { label: '1D', seconds: DAY, priceRange: '1D', candleInterval: '5m', poolInterval: 'hour', bucketSec: HOUR },
  '1W': { label: '1W', seconds: 7 * DAY, priceRange: '1W', candleInterval: '1h', poolInterval: 'hour', bucketSec: HOUR },
  '1M': { label: '1M', seconds: 30 * DAY, priceRange: '1M', candleInterval: '1h', poolInterval: 'day', bucketSec: DAY },
  '1Y': { label: '1Y', seconds: 365 * DAY, priceRange: '1Y', candleInterval: '1d', poolInterval: 'day', bucketSec: DAY },
  ALL: { label: 'All', seconds: null, priceRange: null, candleInterval: '1d', poolInterval: 'day', bucketSec: DAY },
}

export const RANGE_KEYS: RangeKey[] = ['1H', '1D', '1W', '1M', '1Y', 'ALL']

/** `from` (unix seconds) for candle requests, or undefined for ALL. */
export function rangeFrom(range: RangeKey, nowSec: number): number | undefined {
  const span = RANGES[range].seconds
  return span === null ? undefined : nowSec - span
}

/* ------------------------------------------------------------------ pools */

export function tokenOf(x: ApiToken | string | undefined): { address: string; symbol: string; name: string; decimals?: number; tags: string[] } {
  if (!x) return { address: '', symbol: '?', name: '?', tags: [] }
  if (typeof x === 'string') return { address: x, symbol: x.slice(0, 6), name: x, tags: [] }
  return { address: x.address, symbol: x.symbol, name: x.name ?? x.symbol, decimals: x.decimals, tags: x.tags ?? [] }
}

/** Fee in basis points (500 = 0.05%) to a label such as "0.05%". */
export function feeLabel(fee: number | null | undefined): string | null {
  if (fee === null || fee === undefined || !Number.isFinite(fee)) return null
  return `${Number((fee / 10_000).toFixed(2))}%`
}

export function poolHasToken(pool: Pick<PoolApiRow, 'token0' | 'token1'>, address: string): boolean {
  const n = address.toLowerCase()
  return tokenOf(pool.token0).address.toLowerCase() === n || tokenOf(pool.token1).address.toLowerCase() === n
}

/** Volume divided by TVL (a ratio, not a percent). Null when TVL is missing or zero. */
export function volumeOverTvl(volume: number | null, tvl: number | null): number | null {
  if (volume === null || tvl === null || tvl <= 0) return null
  return volume / tvl
}

export function normalizePool(p: PoolApiRow): PoolApiRow {
  return {
    ...p,
    fee: toNum(p.fee),
    tvlUsd: toNum(p.tvlUsd),
    volume24hUsd: toNum(p.volume24hUsd),
    volume7dUsd: toNum(p.volume7dUsd),
    apr: toNum(p.apr),
  }
}

/** Two-colour balance split as shares (0..1). Falls back to an even split when unknown. */
export function balanceShares(r0: number | null | undefined, r1: number | null | undefined): [number, number] {
  const a = toNum(r0) ?? 0
  const b = toNum(r1) ?? 0
  const total = a + b
  if (total <= 0) return [0.5, 0.5]
  return [a / total, b / total]
}

/** One pool history field as a clean series. */
export function poolSeries(history: readonly PoolHistoryPoint[], field: 'volumeUsd' | 'tvlUsd' | 'token0Price'): SeriesPoint[] {
  return toSeries(history.map((h) => ({ time: h.time, value: h[field] })))
}

/* ------------------------------------------------------------------ ticks */

/** Price of token0 in token1 for a tick (1.0001^tick), used when the API omits price0. */
export function tickPrice(tick: number): number {
  return Math.pow(1.0001, tick)
}

export interface LiquidityBar {
  tick: number
  price: number
  liquidity: number
  /** true for the initialised range that contains the current tick. */
  current: boolean
}

/** Histogram bars for the V3 liquidity chart, in price order. The bar holding the current tick is flagged. */
export function liquidityBars(data: PoolTicksApi, invert = false): LiquidityBar[] {
  const cur = data.currentTick ?? 0
  const ordered = [...data.ticks].sort((a, b) => a.tick - b.tick)
  const bars: LiquidityBar[] = []
  ordered.forEach((t, i) => {
    const p0 = toNum(t.price0) ?? tickPrice(t.tick)
    const price = invert ? 1 / p0 : p0
    if (!Number.isFinite(price) || price <= 0) return
    const next = ordered[i + 1]
    const current = t.tick <= cur && (next === undefined || next.tick > cur)
    bars.push({ tick: t.tick, price, liquidity: toNum(t.liquidityActive) ?? 0, current })
  })
  return invert ? bars.sort((a, b) => a.price - b.price) : bars
}

export interface DepthPoint {
  price: number
  /** Cumulative active liquidity moving down from the current price (below it). */
  left: number
  /** Cumulative active liquidity moving up from the current price (above it). */
  right: number
}

/**
 * Depth: cumulative active liquidity moving away from the current tick on each side. Ticks at or below
 * the current tick accumulate going down, ticks above accumulate going up. It is a chart approximation:
 * token-amount depth needs tick-width integration, which the API does not expose.
 */
export function depthCurve(data: PoolTicksApi, invert = false): DepthPoint[] {
  const cur = data.currentTick ?? 0
  const ordered = [...data.ticks].sort((a, b) => a.tick - b.tick)
  const out: DepthPoint[] = []
  const priceOf = (t: { tick: number; price0?: number | string }) => {
    const p0 = toNum(t.price0) ?? tickPrice(t.tick)
    return invert ? 1 / p0 : p0
  }
  let acc = 0
  for (const t of ordered.filter((x) => x.tick <= cur).reverse()) {
    acc += toNum(t.liquidityActive) ?? 0
    out.push({ price: priceOf(t), left: acc, right: 0 })
  }
  acc = 0
  for (const t of ordered.filter((x) => x.tick > cur)) {
    acc += toNum(t.liquidityActive) ?? 0
    out.push({ price: priceOf(t), left: 0, right: acc })
  }
  return out.filter((p) => Number.isFinite(p.price) && p.price > 0).sort((a, b) => a.price - b.price)
}

/** Price at the current tick, for the "you are here" marker. */
export function currentPrice(data: PoolTicksApi, invert = false): number | null {
  if (data.currentTick === null || data.currentTick === undefined) return null
  const p = tickPrice(data.currentTick)
  return invert ? 1 / p : p
}

/* ------------------------------------------------------------------ transactions */

function amountOf(obj: unknown): number | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  return toNum(o.amountFormatted) ?? toNum(o.amount)
}

function symbolOf(obj: unknown, resolve?: (addressOrSymbol: string) => string | undefined): string {
  if (typeof obj === 'string') return resolve?.(obj) ?? obj.slice(0, 6)
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>
    if (typeof o.symbol === 'string') return o.symbol
    if (typeof o.address === 'string') return resolve?.(o.address) ?? o.address.slice(0, 6)
  }
  return '?'
}

/** Normalise one explore/activity transaction. Swaps carry tokenIn/tokenOut, adds and removes token0/token1. */
export function normalizeTx(item: Record<string, unknown>, resolve?: (addressOrSymbol: string) => string | undefined): TxRow | null {
  const type = String(item.type ?? '').toLowerCase()
  const kind: TxRow['kind'] = type === 'swap' ? 'swap' : type === 'add' || type === 'mint' ? 'add' : type === 'remove' || type === 'burn' ? 'remove' : 'other'
  const ts = toNum(item.timestamp)
  if (ts === null) return null
  const txHash = typeof item.txHash === 'string' ? item.txHash : null
  const legs = kind === 'swap' ? [item.tokenIn, item.tokenOut] : [item.token0, item.token1]
  return {
    id: `${txHash ?? 'tx'}:${String(item.logIndex ?? '')}:${kind}`,
    kind,
    timeMs: toSeconds(ts) * 1000,
    usd: toNum(item.amountUsd ?? item.valueUsd),
    legs: legs.map((l) => ({ symbol: symbolOf(l, resolve), amount: amountOf(l) })),
    wallet: typeof item.account === 'string' ? item.account : null,
    txHash,
    pool: typeof item.pool === 'string' ? item.pool : null,
  }
}

export function txTitle(tx: TxRow): string {
  if (tx.kind === 'swap') return `Swap ${tx.legs[0]?.symbol ?? '?'} for ${tx.legs[1]?.symbol ?? '?'}`
  if (tx.kind === 'add') return 'Add'
  if (tx.kind === 'remove') return 'Remove'
  return 'Other'
}

/* ------------------------------------------------------------------ stats */

export interface StatTile {
  key: string
  label: string
  value: number | null
  /** Percent change today from the history; null when there is not enough history to compare. */
  delta: number | null
}

export function exploreStatTiles(s: ExploreStatsRaw | undefined): StatTile[] {
  return [
    {
      key: 'volume',
      label: '1D volume',
      value: toNum(s?.volume24hUsd),
      delta: percentDelta((s?.volumeHistory ?? []).map((p) => ({ time: p.time, value: p.volumeUsd }))),
    },
    {
      key: 'tvl',
      label: 'Total TVL',
      value: toNum(s?.tvlUsd),
      delta: percentDelta((s?.tvlHistory ?? []).map((p) => ({ time: p.time, value: p.tvlUsd }))),
    },
    { key: 'v2', label: 'V2 TVL', value: toNum(s?.v2?.tvlUsd), delta: null },
    { key: 'v3', label: 'V3 TVL', value: toNum(s?.v3?.tvlUsd), delta: null },
  ]
}
