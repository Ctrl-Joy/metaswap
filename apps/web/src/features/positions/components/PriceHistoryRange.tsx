import { useEffect, useMemo, useRef, useState } from 'react'
import { SegmentedTabs, Skeleton } from '@/components/ui'
import { usePoolHistory } from '@/features/explore/api'
import { formatSubscript, formatAmount } from '@/lib/format'

const HEIGHT = 150
const PAD = { l: 8, r: 64, t: 8, b: 20 }

type Range = '1D' | '1W' | '1M' | 'ALL'
const RANGES: Array<{ value: Range; label: string; sec: number; interval: 'hour' | 'day' }> = [
  { value: '1D', label: '1D', sec: 86_400, interval: 'hour' },
  { value: '1W', label: '1W', sec: 7 * 86_400, interval: 'hour' },
  { value: '1M', label: '1M', sec: 30 * 86_400, interval: 'day' },
  { value: 'ALL', label: 'All time', sec: Infinity, interval: 'day' },
]

export interface HistoryPoint {
  time: number
  price: number
}

/** Pool price history (token1 per token0, human units) in display orientation, clipped to a window. */
export function displayHistory(history: ReadonlyArray<{ time: number; token0Price: number | null }>, invert: boolean, windowSec: number, nowSec = Date.now() / 1000): HistoryPoint[] {
  const from = nowSec - windowSec
  return history
    .filter((h) => h.time >= from && h.token0Price !== null && Number.isFinite(h.token0Price) && h.token0Price > 0)
    .map((h) => ({ time: h.time, price: invert ? 1 / h.token0Price! : h.token0Price! }))
}

/** Y domain covering the line, the current price and any finite part of the range band, with 8% padding. */
export function historyDomain(points: readonly HistoryPoint[], current: number | undefined, min?: number, max?: number): [number, number] | null {
  const vals = points.map((p) => p.price)
  if (current !== undefined && Number.isFinite(current)) vals.push(current)
  if (!vals.length) return null
  const ref = vals[vals.length - 1]!
  for (const b of [min, max]) if (b !== undefined && Number.isFinite(b) && b > ref / 20 && b < ref * 20) vals.push(b)
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (hi === lo) {
    lo *= 0.95
    hi *= 1.05
  }
  const pad = (hi - lo) * 0.08
  return [Math.max(0, lo - pad), hi + pad]
}

const fmt = (p: number) => formatSubscript(p) ?? formatAmount(p, 5)

/**
 * Price history behind the selected range (Uniswap's range chart): line over time, shaded min–max band,
 * dashed current price; the part of the line inside the band is accented.
 */
export function PriceHistoryRange({ poolAddress, invert, current, minPrice, maxPrice }: { poolAddress: string | undefined; invert: boolean; current: number | undefined; minPrice?: number; maxPrice?: number }) {
  const [range, setRange] = useState<Range>('1W')
  const cfg = RANGES.find((r) => r.value === range)!
  const q = usePoolHistory(poolAddress, cfg.interval)
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const points = useMemo(() => displayHistory(q.data ?? [], invert, cfg.sec), [q.data, invert, cfg.sec])
  const domain = historyDomain(points, current, minPrice, maxPrice)
  const innerW = width - PAD.l - PAD.r
  const plotH = HEIGHT - PAD.t - PAD.b
  const t0 = points[0]?.time ?? 0
  const t1 = points.at(-1)?.time ?? 1
  const x = (t: number) => PAD.l + (t1 === t0 ? innerW : ((t - t0) / (t1 - t0)) * innerW)
  const y = (p: number) => (domain ? PAD.t + (1 - (p - domain[0]) / (domain[1] - domain[0])) * plotH : 0)
  const clampY = (v: number) => Math.min(PAD.t + plotH, Math.max(PAD.t, v))
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.price).toFixed(1)}`).join('')
  const hasBand = domain && minPrice !== undefined && maxPrice !== undefined && maxPrice > 0
  const bandTop = hasBand ? clampY(y(Number.isFinite(maxPrice!) ? maxPrice! : domain![1])) : 0
  const bandBottom = hasBand ? clampY(y(minPrice!)) : 0

  return (
    <div className="flex flex-col gap-2" data-testid="range-price-history">
      <div ref={wrap} className="relative">
        {q.isLoading && !q.data ? (
          <Skeleton width="100%" height={HEIGHT} rounded="lg" />
        ) : !domain || points.length < 2 ? (
          <div className="flex h-[150px] items-center justify-center rounded-xl bg-surface-2 text-body-3 text-text-2" data-testid="range-price-history-empty">
            {poolAddress ? 'Not enough price history yet' : 'No price history for a new pool'}
          </div>
        ) : (
          <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} className="block" role="img" aria-label="Pool price history with the selected range">
            <defs>
              <clipPath id="range-band-clip">
                <rect x={0} y={bandTop} width={width} height={Math.max(0, bandBottom - bandTop)} />
              </clipPath>
            </defs>
            {hasBand && <rect x={PAD.l} y={bandTop} width={innerW} height={Math.max(0, bandBottom - bandTop)} className="fill-accent-tint" data-testid="range-price-band" />}
            <path d={path} fill="none" className="stroke-text-3" strokeWidth={1.5} />
            {hasBand && <path d={path} fill="none" className="stroke-accent" strokeWidth={1.75} clipPath="url(#range-band-clip)" />}
            {current !== undefined && domain && (
              <>
                <line x1={PAD.l} x2={PAD.l + innerW} y1={y(current)} y2={y(current)} className="stroke-text-2" strokeDasharray="3 3" />
                <circle cx={x(t1)} cy={y(points.at(-1)!.price)} r={3} className="fill-accent" />
              </>
            )}
            {domain &&
              [0, 0.5, 1].map((f) => {
                const p = domain[0] + f * (domain[1] - domain[0])
                return (
                  <text key={f} x={width - PAD.r + 6} y={y(p) + 4} className="fill-text-3 text-[11px] tabular">
                    {fmt(p)}
                  </text>
                )
              })}
            {[t0, (t0 + t1) / 2, t1].map((t, i) => (
              <text key={i} x={x(t)} y={HEIGHT - 4} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="fill-text-3 text-[11px]">
                {new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </text>
            ))}
          </svg>
        )}
      </div>
      <SegmentedTabs size="sm" ariaLabel="Price history range" value={range} onChange={setRange} items={RANGES.map((r) => ({ value: r.value, label: r.label, testId: `range-history-${r.value}` }))} />
    </div>
  )
}
