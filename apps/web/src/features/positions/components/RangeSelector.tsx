import { useEffect, useState } from 'react'
import { ArrowLeftRight, Minus, Plus } from 'lucide-react'
import { Banner, SegmentedTabs } from '@/components/ui'
import { sanitizeAmountInput } from '@/lib/amount'
import { formatAmount } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Token } from '../tokens'
import type { TickRow } from '../api'
import { LiquidityChart } from './LiquidityChart'
import { displayPriceToTick, fullRangeTicks, isFullRange, maxUsableTick, minUsableTick, stepTick, tickToDisplayPrice } from '../math'

export function formatDisplayPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return p === Infinity ? '∞' : '0'
  if (p > 1e15) return '∞'
  if (p < 1e-12) return '0'
  return formatAmount(p, 6)
}

export interface RangeSelectorProps {
  token0: Token
  token1: Token
  spacing: number
  /** Current pool tick (or the tick of the starting price for a new pool). */
  currentTick: number | undefined
  tickLower: number
  tickUpper: number
  onChange: (lower: number, upper: number) => void
  invert: boolean
  onInvert: () => void
  ticks?: TickRow[]
  ticksLoading?: boolean
}

/** Full / custom range, histogram with handles, min/max inputs with tick-snapping steppers. */
export function RangeSelector({ token0, token1, spacing, currentTick, tickLower, tickUpper, onChange, invert, onInvert, ticks, ticksLoading }: RangeSelectorProps) {
  const full = isFullRange(tickLower, tickUpper, spacing)
  const [mode, setMode] = useState<'full' | 'custom'>(full ? 'full' : 'custom')
  useEffect(() => setMode(full ? 'full' : 'custom'), [full])

  const d0 = token0.decimals
  const d1 = token1.decimals
  const base = invert ? token1 : token0
  const quote = invert ? token0 : token1
  const unit = `${quote.symbol} per ${base.symbol}`

  // display min/max ↔ pool ticks: with inversion, the displayed min comes from the upper tick
  const minTick = invert ? tickUpper : tickLower
  const maxTick = invert ? tickLower : tickUpper
  const atMinEdge = tickLower <= minUsableTick(spacing)
  const atMaxEdge = tickUpper >= maxUsableTick(spacing)
  const minDisplay = (invert ? atMaxEdge : atMinEdge) ? 0 : tickToDisplayPrice(minTick, d0, d1, invert)
  const maxDisplay = (invert ? atMinEdge : atMaxEdge) ? Infinity : tickToDisplayPrice(maxTick, d0, d1, invert)

  const setSide = (which: 'min' | 'max', tick: number) => {
    // which = displayed side; map back to pool ticks
    let lower = tickLower
    let upper = tickUpper
    const poolSide = (which === 'min') !== invert ? 'lower' : 'upper'
    if (poolSide === 'lower') lower = tick
    else upper = tick
    if (lower >= upper) {
      if (poolSide === 'lower') lower = upper - spacing
      else upper = lower + spacing
    }
    lower = Math.max(minUsableTick(spacing), lower)
    upper = Math.min(maxUsableTick(spacing), upper)
    onChange(lower, upper)
  }

  const commitPrice = (which: 'min' | 'max', price: number) => {
    if (which === 'min' && price === 0) return setSide('min', invert ? maxUsableTick(spacing) : minUsableTick(spacing))
    const t = displayPriceToTick(price, d0, d1, invert, spacing)
    if (t !== null) setSide(which, t)
  }

  const setPreset = (pct: number) => {
    if (currentTick === undefined) return
    const delta = Math.round(Math.log(1 + pct / 100) / Math.log(1.0001))
    const lo = Math.max(minUsableTick(spacing), Math.floor((currentTick - delta) / spacing) * spacing)
    const hi = Math.min(maxUsableTick(spacing), Math.ceil((currentTick + delta) / spacing) * spacing)
    onChange(lo, hi === lo ? lo + spacing : hi)
  }

  const outOfRange = currentTick !== undefined && (currentTick < tickLower || currentTick >= tickUpper)

  return (
    <div className="flex flex-col gap-4" data-testid="range-selector">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedTabs
          ariaLabel="Range type"
          value={mode}
          onChange={(m) => {
            setMode(m)
            if (m === 'full') onChange(...fullRangeTicks(spacing))
            else if (full) setPreset(10)
          }}
          items={[
            { value: 'full', label: 'Full range', testId: 'range-full' },
            { value: 'custom', label: 'Custom range', testId: 'range-custom' },
          ]}
        />
        <button
          type="button"
          onClick={onInvert}
          data-testid="range-invert"
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-body-4 font-semibold text-text-2 hover:text-text-1"
        >
          <ArrowLeftRight size={14} />
          {base.symbol} / {quote.symbol}
        </button>
      </div>

      {mode === 'full' ? (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-body-3 text-text-2">
          Full range positions provide liquidity at every price, like V2. They earn fewer fees per dollar than concentrated positions but never go out of range.
        </p>
      ) : (
        <>
          <div className="rounded-2xl bg-surface-2 p-3">
            <div className="mb-1 flex items-center justify-between text-body-4 text-text-2">
              <span>
                Current price:{' '}
                <span className="font-semibold text-text-1 tabular" data-testid="range-current-price">
                  {currentTick !== undefined ? formatDisplayPrice(tickToDisplayPrice(currentTick, d0, d1, invert)) : '-'}
                </span>{' '}
                {unit}
              </span>
            </div>
            <LiquidityChart
              ticks={ticks}
              loading={ticksLoading}
              currentTick={currentTick}
              decimals0={d0}
              decimals1={d1}
              invert={invert}
              minPrice={minDisplay}
              maxPrice={maxDisplay}
              onDrag={(which, price) => commitPrice(which, price)}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[1, 5, 10, 20, 50].map((p) => (
              <button key={p} type="button" onClick={() => setPreset(p)} data-testid={`range-preset-${p}`} className="h-7 rounded-full bg-surface-2 px-3 text-body-4 font-semibold text-text-2 hover:text-text-1">
                ±{p}%
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PriceInput
              label="Min price"
              unit={unit}
              value={minDisplay}
              testId="range-min"
              onCommit={(p) => commitPrice('min', p)}
              onStep={(dir) => setSide('min', stepTick(minTick, spacing, dir, invert))}
            />
            <PriceInput
              label="Max price"
              unit={unit}
              value={maxDisplay}
              testId="range-max"
              onCommit={(p) => commitPrice('max', p)}
              onStep={(dir) => setSide('max', stepTick(maxTick, spacing, dir, invert))}
            />
          </div>
          {outOfRange && (
            <Banner tone="warning" title="Your position will not earn fees">
              The current price is outside this range, so you deposit only one token until the price moves into it.
            </Banner>
          )}
        </>
      )}
    </div>
  )
}

function PriceInput({ label, unit, value, onCommit, onStep, testId }: { label: string; unit: string; value: number; onCommit: (p: number) => void; onStep: (d: 'up' | 'down') => void; testId: string }) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const shown = formatDisplayPrice(value)
  useEffect(() => {
    if (!focused) setText(shown === '∞' ? '∞' : shown.replace(/,/g, ''))
  }, [shown, focused])
  const commit = () => {
    setFocused(false)
    if (text === '∞') return
    const n = Number(text)
    if (Number.isFinite(n) && n >= 0) onCommit(n)
  }
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface-1 p-3" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <div className="text-body-4 text-text-2">{label}</div>
        <input
          inputMode="decimal"
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          onChange={(e) => {
            const v = sanitizeAmountInput(e.target.value, 18)
            if (v !== null) setText(v)
          }}
          data-testid={`${testId}-input`}
          aria-label={`${label} (${unit})`}
          className={cn('w-full bg-transparent text-heading-3 font-medium outline-none tabular')}
        />
        <div className="truncate text-body-4 text-text-3">{unit}</div>
      </div>
      <div className="flex flex-col gap-1">
        <button type="button" aria-label={`Increase ${label}`} data-testid={`${testId}-inc`} onClick={() => onStep('up')} className="flex size-7 items-center justify-center rounded-lg bg-surface-2 text-text-2 hover:text-text-1">
          <Plus size={14} />
        </button>
        <button type="button" aria-label={`Decrease ${label}`} data-testid={`${testId}-dec`} onClick={() => onStep('down')} className="flex size-7 items-center justify-center rounded-lg bg-surface-2 text-text-2 hover:text-text-1">
          <Minus size={14} />
        </button>
      </div>
    </div>
  )
}
