import { useState } from 'react'
import { formatAmount } from '@/lib/format'

export interface DistributionBar {
  price: number
  demand: number
}

const W = 640
const H = 220
const AXIS = 22

/**
 * Demand per price level (quote committed at each max price) with the clearing price marked.
 * Bars at or above the clearing price fill (accent); bars below would be refunded (muted).
 * Thin on purpose: swap for the explore area's shared chart component when one fits.
 */
export function BidDistributionChart({ bars, clearing, floor, quoteSymbol, testId = 'bid-distribution' }: { bars: DistributionBar[]; clearing: number; floor: number; quoteSymbol: string; testId?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (bars.length === 0)
    return (
      <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-border text-body-3 text-text-2" data-testid={testId}>
        No bids yet. Bids appear here by max price.
      </div>
    )
  const sorted = [...bars].sort((a, b) => a.price - b.price)
  const max = Math.max(...sorted.map((b) => b.demand), 1)
  const n = sorted.length
  const slot = W / Math.max(n, 8)
  const bw = Math.max(4, slot * 0.7)
  const offset = (W - slot * n) / 2
  const xOf = (i: number) => offset + i * slot + (slot - bw) / 2
  // clearing line sits between the bars around it
  let ci = sorted.findIndex((b) => b.price >= clearing)
  if (ci < 0) ci = n
  const cx = ci === 0 ? offset + 2 : ci >= n ? offset + n * slot - 2 : offset + ci * slot
  const hb = hover !== null ? sorted[hover] : undefined
  return (
    <div className="relative" data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[220px] w-full" preserveAspectRatio="none" role="img" aria-label="Bid demand by max price" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={(H - AXIS) * f} y2={(H - AXIS) * f} stroke="var(--ms-border)" strokeDasharray="1 5" strokeLinecap="round" />
        ))}
        {sorted.map((b, i) => {
          const h = (b.demand / max) * (H - AXIS - 12)
          const filled = b.price >= clearing
          return (
            <rect
              key={b.price}
              x={xOf(i)}
              y={H - AXIS - h}
              width={bw}
              height={Math.max(1, h)}
              rx={2}
              fill={filled ? 'var(--ms-accent)' : 'var(--ms-text-3)'}
              opacity={hover === null || hover === i ? (filled ? 0.9 : 0.5) : 0.35}
              onMouseEnter={() => setHover(i)}
            />
          )
        })}
        <line x1={cx} x2={cx} y1={0} y2={H - AXIS} stroke="var(--ms-success)" strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-body-4 text-text-3 tabular">
        <span>
          {formatAmount(sorted[0]!.price)} {quoteSymbol}
        </span>
        <span className="text-success">Clearing {formatAmount(clearing)}{clearing <= floor ? ' (floor)' : ''}</span>
        <span>{formatAmount(sorted[n - 1]!.price)}</span>
      </div>
      {hb && (
        <div className="pointer-events-none absolute top-1 left-1 rounded-lg border border-border bg-surface-1 px-2 py-1 text-body-4 shadow-short">
          Max price {formatAmount(hb.price)} {quoteSymbol} · {formatAmount(hb.demand)} {quoteSymbol} bid
        </div>
      )}
    </div>
  )
}
