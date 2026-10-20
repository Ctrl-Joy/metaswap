import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { IconButton, Skeleton } from '@/components/ui'
import { formatAmount } from '@/lib/format'
import type { TickRow } from '../api'
import { tickToDisplayPrice } from '../math'

const HEIGHT = 200
const PAD_X = 12
const AXIS_H = 22
const BINS = 72

export interface LiquidityChartProps {
  ticks: TickRow[] | undefined
  loading?: boolean
  currentTick: number | undefined
  decimals0: number
  decimals1: number
  invert: boolean
  /** Displayed range bounds (display orientation). Undefined = no band. */
  minPrice?: number
  maxPrice?: number
  /** Interactive handles. */
  onDrag?: (which: 'min' | 'max', price: number) => void
  testId?: string
}

/**
 * Liquidity-density histogram (x = price in display orientation, y = active liquidity) with the
 * current price line and a draggable min/max range band. Pure SVG, themed through CSS vars.
 */
export function LiquidityChart({ ticks, loading, currentTick, decimals0, decimals1, invert, minPrice, maxPrice, onDrag, testId = 'liquidity-chart' }: LiquidityChartProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState<'min' | 'max' | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const current = currentTick !== undefined ? tickToDisplayPrice(currentTick, decimals0, decimals1, invert) : undefined

  // Domain: around the current price, widened to show a finite range band; zoom divides the span.
  const [d0, d1] = useMemo(() => {
    if (current === undefined || !Number.isFinite(current)) return [0, 1]
    let lo = current * 0.5
    let hi = current * 1.5
    const finite = (x: number | undefined) => x !== undefined && Number.isFinite(x) && x > current / 50 && x < current * 50
    if (finite(minPrice) && minPrice! < lo) lo = minPrice! - (current - minPrice!) * 0.15
    if (finite(maxPrice) && maxPrice! > hi) hi = maxPrice! + (maxPrice! - current) * 0.15
    const half = Math.max(current - lo, hi - current) / zoom
    return [Math.max(0, current - half), current + half]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, zoom, dragging ? 0 : minPrice, dragging ? 0 : maxPrice])

  const innerW = width - PAD_X * 2
  const x = (p: number) => PAD_X + ((p - d0) / (d1 - d0)) * innerW
  const xToPrice = (px: number) => d0 + ((px - PAD_X) / innerW) * (d1 - d0)
  const plotH = HEIGHT - AXIS_H

  // Histogram bins: active liquidity at each bin's centre price.
  const bins = useMemo(() => {
    if (!ticks?.length) return []
    const sorted = [...ticks].sort((a, b) => a.tick - b.tick)
    const activeAt = (tick: number): number => {
      let lo = 0
      let hi = sorted.length - 1
      let idx = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (sorted[mid]!.tick <= tick) {
          idx = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      return idx < 0 ? 0 : Number(sorted[idx]!.liquidityActive)
    }
    const out: { p0: number; p1: number; liq: number }[] = []
    const step = (d1 - d0) / BINS
    const scale = 10 ** (decimals0 - decimals1)
    for (let i = 0; i < BINS; i++) {
      const p0 = d0 + i * step
      const p1 = p0 + step
      const mid = (p0 + p1) / 2
      if (mid <= 0) continue
      const poolPrice = invert ? 1 / mid : mid
      const tick = Math.floor(Math.log(poolPrice / scale) / Math.log(1.0001))
      out.push({ p0, p1, liq: activeAt(tick) })
    }
    return out
  }, [ticks, d0, d1, decimals0, decimals1, invert])
  const maxLiq = Math.max(1, ...bins.map((b) => b.liq))

  const clampX = (v: number) => Math.min(width - PAD_X, Math.max(PAD_X, v))
  const hasBand = minPrice !== undefined && maxPrice !== undefined && Number.isFinite(minPrice) && maxPrice > 0
  const bx0 = hasBand ? clampX(x(Math.max(minPrice!, d0 - 1))) : 0
  const bx1 = hasBand ? clampX(x(Number.isFinite(maxPrice!) ? Math.min(maxPrice!, d1 + 1e300) : d1)) : 0

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging || !onDrag) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * width
    const p = xToPrice(Math.min(width - PAD_X, Math.max(PAD_X, px)))
    if (p > 0) onDrag(dragging, p)
  }

  const axisTicks = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => d0 + f * (d1 - d0))

  return (
    <div className="relative" ref={wrap} data-testid={testId}>
      {loading ? (
        <Skeleton width="100%" height={HEIGHT} rounded="lg" />
      ) : (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block touch-none select-none"
          onPointerMove={onPointerMove}
          onPointerUp={() => setDragging(null)}
          onPointerLeave={() => setDragging(null)}
          role="img"
          aria-label="Liquidity distribution and selected price range"
        >
          {hasBand && <rect x={Math.min(bx0, bx1)} y={0} width={Math.abs(bx1 - bx0)} height={plotH} className="fill-accent-tint" />}
          {bins.map((b, i) => {
            const h = (b.liq / maxLiq) * (plotH - 16)
            const inBand = hasBand && b.p1 > minPrice! && b.p0 < maxPrice!
            return (
              <rect
                key={i}
                x={x(b.p0) + 0.5}
                y={plotH - h}
                width={Math.max(0.5, x(b.p1) - x(b.p0) - 1)}
                height={h}
                rx={1}
                className={inBand ? 'fill-accent' : 'fill-text-3'}
                opacity={inBand ? 0.85 : 0.45}
              />
            )
          })}
          {current !== undefined && (
            <g data-testid={`${testId}-current`}>
              <line x1={x(current)} x2={x(current)} y1={0} y2={plotH} className="stroke-text-1" strokeDasharray="4 3" strokeWidth={1.25} />
            </g>
          )}
          {hasBand &&
            (['min', 'max'] as const).map((which) => {
              const hx = which === 'min' ? bx0 : bx1
              return (
                <g
                  key={which}
                  data-testid={`${testId}-handle-${which}`}
                  className={onDrag ? 'cursor-ew-resize' : undefined}
                  onPointerDown={(e) => {
                    if (!onDrag) return
                    ;(e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId)
                    setDragging(which)
                  }}
                >
                  <line x1={hx} x2={hx} y1={0} y2={plotH} className="stroke-accent" strokeWidth={2} />
                  {onDrag && (
                    <>
                      <rect x={hx - (which === 'min' ? 14 : 0)} y={plotH / 2 - 18} width={14} height={36} rx={4} className="fill-accent" />
                      <line x1={hx + (which === 'min' ? -9 : 5)} x2={hx + (which === 'min' ? -9 : 5)} y1={plotH / 2 - 8} y2={plotH / 2 + 8} stroke="white" strokeWidth={1.5} />
                      <line x1={hx + (which === 'min' ? -5 : 9)} x2={hx + (which === 'min' ? -5 : 9)} y1={plotH / 2 - 8} y2={plotH / 2 + 8} stroke="white" strokeWidth={1.5} />
                      <rect x={hx - 16} y={0} width={32} height={plotH} fill="transparent" />
                    </>
                  )}
                </g>
              )
            })}
          <line x1={PAD_X} x2={width - PAD_X} y1={plotH} y2={plotH} className="stroke-border" />
          {axisTicks.map((p, i) => (
            <text key={i} x={x(p)} y={HEIGHT - 6} textAnchor="middle" className="fill-text-3 text-[11px] tabular">
              {formatAmount(p, 4)}
            </text>
          ))}
        </svg>
      )}
      <div className="absolute top-1 right-1 flex gap-1">
        <IconButton label="Zoom in" size={32} className="bg-surface-2" onClick={() => setZoom((z) => Math.min(64, z * 2))} data-testid={`${testId}-zoom-in`}>
          <Plus size={14} />
        </IconButton>
        <IconButton label="Zoom out" size={32} className="bg-surface-2" onClick={() => setZoom((z) => Math.max(0.25, z / 2))}>
          <Minus size={14} />
        </IconButton>
        <IconButton label="Reset zoom" size={32} className="bg-surface-2" onClick={() => setZoom(1)}>
          <RotateCcw size={14} />
        </IconButton>
      </div>
    </div>
  )
}
