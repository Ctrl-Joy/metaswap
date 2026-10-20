export interface PricePoint {
  /** unix seconds */
  time: number
  price: number
}

export interface VolumePoint {
  time: number
  volumeUsd: number
}

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volumeUsd: number
}

export const INTERVALS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }

export function bucketStart(time: number, intervalSec: number): number {
  return Math.floor(time / intervalSec) * intervalSec
}

/**
 * Minute (or any interval) candles from raw price points and swap volumes.
 * - Each bucket opens at the previous bucket's close (continuous chart).
 * - Buckets without trades are forward-filled flat with zero volume, from the first known price
 *   (or `prevPrice`, the last price before `from`) up to `to`.
 * - `points` must be sorted by time.
 */
export function buildCandles(
  points: PricePoint[],
  volumes: VolumePoint[],
  intervalSec: number,
  from: number,
  to: number,
  prevPrice?: number | null,
  maxCandles = 2000,
): Candle[] {
  const start = bucketStart(from, intervalSec)
  const end = bucketStart(to, intervalSec)
  const volByBucket = new Map<number, number>()
  for (const v of volumes) {
    if (v.time < start || v.time > to) continue
    const b = bucketStart(v.time, intervalSec)
    volByBucket.set(b, (volByBucket.get(b) ?? 0) + v.volumeUsd)
  }
  const out: Candle[] = []
  let last: number | null = prevPrice ?? null
  let i = 0
  // skip points before the window, remembering the latest as the opening price
  while (i < points.length && points[i].time < start) last = points[i++].price
  // keep the most recent `maxCandles` buckets only
  let firstBucket = start
  if ((end - start) / intervalSec + 1 > maxCandles) {
    firstBucket = end - (maxCandles - 1) * intervalSec
    while (i < points.length && points[i].time < firstBucket) last = points[i++].price
  }
  for (let b = firstBucket; b <= end; b += intervalSec) {
    const bEnd = b + intervalSec
    let c: Candle | null = last !== null ? { time: b, open: last, high: last, low: last, close: last, volumeUsd: 0 } : null
    while (i < points.length && points[i].time < bEnd) {
      const p = points[i++].price
      if (!c) c = { time: b, open: p, high: p, low: p, close: p, volumeUsd: 0 }
      c.high = Math.max(c.high, p)
      c.low = Math.min(c.low, p)
      c.close = p
      last = p
    }
    if (c) {
      c.volumeUsd = volByBucket.get(b) ?? 0
      out.push(c)
    }
  }
  return out
}

/** Re-bucket finer candles (e.g. 1m) into a coarser interval (5m/1h/1d). Input sorted by time. */
export function aggregateCandles(candles: Candle[], intervalSec: number): Candle[] {
  const out: Candle[] = []
  for (const c of candles) {
    const b = bucketStart(c.time, intervalSec)
    const cur = out[out.length - 1]
    if (cur && cur.time === b) {
      cur.high = Math.max(cur.high, c.high)
      cur.low = Math.min(cur.low, c.low)
      cur.close = c.close
      cur.volumeUsd += c.volumeUsd
    } else {
      out.push({ ...c, time: b })
    }
  }
  return out
}

/** Sum values into fixed buckets between from..to (inclusive), zero-filled. */
export function bucketSums(values: { time: number; value: number }[], intervalSec: number, from: number, to: number) {
  const start = bucketStart(from, intervalSec)
  const end = bucketStart(to, intervalSec)
  const m = new Map<number, number>()
  for (const v of values) {
    if (v.time < start || v.time > to) continue
    const b = bucketStart(v.time, intervalSec)
    m.set(b, (m.get(b) ?? 0) + v.value)
  }
  const out: { time: number; value: number }[] = []
  for (let b = start; b <= end; b += intervalSec) out.push({ time: b, value: m.get(b) ?? 0 })
  return out
}

/** Last-value-per-bucket series (forward filled) from sorted points. */
export function bucketLast(points: { time: number; value: number }[], intervalSec: number, from: number, to: number) {
  const start = bucketStart(from, intervalSec)
  const end = bucketStart(to, intervalSec)
  const out: { time: number; value: number }[] = []
  let i = 0
  let last: number | null = null
  for (let b = start; b <= end; b += intervalSec) {
    while (i < points.length && points[i].time < b + intervalSec) last = points[i++].value
    if (last !== null) out.push({ time: b, value: last })
  }
  return out
}

export type HistoryInterval = 'minute' | 'hour' | 'day'
export const HISTORY_INTERVAL_SEC: Record<HistoryInterval, number> = { minute: 60, hour: 3600, day: 86400 }
/** How far back each history interval reaches. */
export const HISTORY_WINDOW_SEC: Record<HistoryInterval, number> = { minute: 86400, hour: 7 * 86400, day: 365 * 86400 }

export function parseHistoryInterval(v: string | undefined, dflt: HistoryInterval = 'hour'): HistoryInterval {
  if (v === undefined || v === '') return dflt
  const k = v.toLowerCase()
  const alias: Record<string, HistoryInterval> = { minute: 'minute', '1m': 'minute', hour: 'hour', '1h': 'hour', day: 'day', '1d': 'day' }
  const out = alias[k]
  if (!out) throw new Error('interval must be minute|hour|day')
  return out
}

/**
 * Auto-refinement for young chains so charts are never a single point:
 * while the data spans < 2 hours, `hour` and `day` return minute buckets; while it spans < 2 days,
 * `day` returns hour buckets. `minute` is always honoured as is.
 */
export function effectiveInterval(requested: HistoryInterval, dataSpanSec: number): HistoryInterval {
  if (requested === 'minute') return 'minute'
  if (dataSpanSec < 2 * 3600) return 'minute'
  if (requested === 'day' && dataSpanSec < 2 * 86400) return 'hour'
  return requested
}

/** Range keys used by the web app (1H|1D|1W|1M|1Y|ALL, case-insensitive) → seconds (null = all time). */
export function rangeSeconds(range: string): number | null {
  const m: Record<string, number | null> = { '1h': 3600, '1d': 86400, '1w': 7 * 86400, '1m': 30 * 86400, '1y': 365 * 86400, all: null }
  const k = range.toLowerCase()
  if (!(k in m)) throw new Error('range must be 1H|1D|1W|1M|1Y|ALL')
  return m[k]
}

/** Natural bucket for a range (before auto-refinement). */
export function intervalForRange(range: string): HistoryInterval {
  const s = rangeSeconds(range)
  if (s === null || s > 7 * 86400) return 'day'
  if (s <= 3600) return 'minute'
  return 'hour'
}
