import { useState } from 'react'
import { cn } from '@/lib/cn'
import type { DepthPoint, LiquidityBar } from '../transforms'

/**
 * Small SVG charts for non-time data (V3 tick liquidity, cumulative depth). Colours come from the
 * theme variables through `fill`/`stroke: var(--ms-*)`, so light and dark both work.
 */

const W = 600
const H = 260
const PAD_B = 6

/** Sparkline for list rows: green when the series ends up, red when down, dashed when flat/unknown. */
export function Sparkline({ values, width = 96, height = 32, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height} className={className} aria-hidden>
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="var(--ms-border)" strokeDasharray="3 3" />
      </svg>
    )
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - 2 - ((v - min) / span) * (height - 4)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const up = values[values.length - 1]! >= values[0]!
  const color = up ? 'var(--ms-success)' : 'var(--ms-critical)'
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Liquidity histogram: one bar per initialised tick range, with the current price marked. */
export function LiquidityHistogram({ bars, currentPriceIndex, className, ariaLabel }: { bars: LiquidityBar[]; currentPriceIndex: number | null; className?: string; ariaLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (bars.length === 0) return null
  const max = Math.max(...bars.map((b) => b.liquidity), 1)
  const bw = W / bars.length
  const currentIdx = currentPriceIndex ?? bars.findIndex((b) => b.current)
  return (
    <div className={cn('relative h-full w-full', className)} role="img" aria-label={ariaLabel} data-testid="liquidity-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="size-full">
        {bars.map((b, i) => {
          const h = Math.max(1, (b.liquidity / max) * (H - PAD_B))
          const active = i === hover || i === currentIdx
          return (
            <rect
              key={b.tick}
              x={i * bw + 0.5}
              y={H - h}
              width={Math.max(1, bw - 1)}
              height={h}
              fill="var(--ms-accent)"
              fillOpacity={active ? 0.95 : 0.35}
              onMouseEnter={() => setHover(i)}
            />
          )
        })}
        {currentIdx >= 0 && (
          <line x1={currentIdx * bw + bw / 2} x2={currentIdx * bw + bw / 2} y1={0} y2={H} stroke="var(--ms-text-1)" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
    </div>
  )
}

/** Cumulative depth: filled areas for both sides of the current price. */
export function DepthChart({ points, currentPriceIndex, className, ariaLabel }: { points: DepthPoint[]; currentPriceIndex: number | null; className?: string; ariaLabel?: string }) {
  if (points.length === 0) return null
  const max = Math.max(...points.map((p) => Math.max(p.left, p.right)), 1)
  const n = points.length
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_B - 4)
  const path = (side: 'left' | 'right') => {
    const top = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[side]).toFixed(1)}`).join(' ')
    return `${top} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`
  }
  const cur = currentPriceIndex === null ? null : Math.min(Math.max(currentPriceIndex, 0), n - 1)
  return (
    <div className={cn('relative h-full w-full', className)} role="img" aria-label={ariaLabel} data-testid="depth-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="size-full">
        <path d={path('left')} fill="var(--ms-critical)" fillOpacity={0.18} stroke="var(--ms-critical)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={path('right')} fill="var(--ms-success)" fillOpacity={0.18} stroke="var(--ms-success)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {cur !== null && <line x1={x(cur)} x2={x(cur)} y1={0} y2={H} stroke="var(--ms-text-1)" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  )
}
