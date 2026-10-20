import { Children, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PercentChange } from './misc'
import { TokenLogo } from './TokenLogo'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export interface MarqueeProps {
  /** Items rendered in order; duplicated once to make the loop seamless. */
  children: ReactNode
  /** Auto-scroll speed in px/s (default 35). 0 disables auto-scroll. */
  speed?: number
  /** Gap between items in px (default 8). */
  gap?: number
  /** Alias of `gap` (launches API). */
  itemGap?: number
  /** Show ‹ › buttons for manual scrolling (default false). */
  arrows?: boolean
  /** Alias of `arrows`. */
  controls?: boolean
  /** Pixels per arrow click (default 320). */
  step?: number
  /** Soft fade at both edges (default false). */
  fade?: boolean
  ariaLabel?: string
  className?: string
  testId?: string
}

/**
 * Continuously scrolling strip (Uniswap's "Trending launches" / ticker look). It is a real
 * horizontal scroller driven by requestAnimationFrame, so manual scrolling, touch and the arrow
 * buttons all work. It pauses on hover, keyboard focus and touch. With prefers-reduced-motion it
 * does not move by itself and the items are not duplicated.
 */
export function Marquee({ children, speed = 35, gap: gapProp, itemGap, arrows, controls, step = 300, fade = false, ariaLabel, className, testId }: MarqueeProps) {
  const gap = gapProp ?? itemGap ?? 8
  const showArrows = arrows ?? controls ?? false
  const ref = useRef<HTMLDivElement>(null)
  const firstSet = useRef<HTMLDivElement>(null)
  const paused = useRef(false)
  const resumeAt = useRef(0)
  const [reduced, setReduced] = useState(prefersReducedMotion)
  const items = Children.toArray(children)
  const animate = speed > 0 && !reduced && items.length > 1

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    if (!animate) return
    let raf = 0
    let last = performance.now()
    let carry = 0
    const tick = (now: number) => {
      const el = ref.current
      const set = firstSet.current
      const dt = Math.min(64, now - last)
      last = now
      if (el && set && !paused.current && now >= resumeAt.current) {
        const loop = set.offsetWidth + gap
        // Only loop when the content overflows the viewport.
        if (loop > el.clientWidth) {
          carry += (speed * dt) / 1000
          const whole = Math.floor(carry)
          if (whole > 0) {
            carry -= whole
            el.scrollLeft += whole
          }
          if (el.scrollLeft >= loop) el.scrollLeft -= loop
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate, speed, gap])

  const nudge = (dir: 1 | -1) => {
    const el = ref.current
    const set = firstSet.current
    if (!el) return
    resumeAt.current = performance.now() + 2500
    if (animate && set && dir < 0 && el.scrollLeft < step) el.scrollLeft += set.offsetWidth + gap
    el.scrollBy({ left: dir * step, behavior: reduced ? 'auto' : 'smooth' })
  }

  const pause = () => {
    paused.current = true
  }
  const resume = () => {
    paused.current = false
  }

  return (
    <div className={cn('group/marquee relative min-w-0', className)} data-testid={testId}>
      <div
        ref={ref}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocus={pause}
        onBlur={resume}
        onTouchStart={pause}
        data-running={animate ? 'true' : 'false'}
        onTouchEnd={() => {
          resume()
          resumeAt.current = performance.now() + 2500
        }}
        className={cn('flex overflow-x-auto overscroll-x-contain [scrollbar-width:none] focus-visible:outline-offset-4 [&::-webkit-scrollbar]:hidden', !animate && 'snap-x')}
        style={
          fade
            ? { maskImage: 'linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)', WebkitMaskImage: 'linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)' }
            : undefined
        }
      >
        <div ref={firstSet} className="flex shrink-0" style={{ gap }}>
          {items.map((child, i) => (
            <div key={i} className="shrink-0 snap-start">
              {child}
            </div>
          ))}
        </div>
        {animate && (
          <div className="flex shrink-0" style={{ gap, marginLeft: gap }} aria-hidden inert>
            {items}
          </div>
        )}
      </div>
      {showArrows && items.length > 0 && (
        <>
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => nudge(-1)}
            className="absolute top-1/2 left-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-1 text-text-2 shadow-short hover:text-text-1"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => nudge(1)}
            className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-1 text-text-2 shadow-short hover:text-text-1"
          >
            <ChevronRight size={16} />
          </button>
        </>
      )}
    </div>
  )
}

export interface ChartCardProps {
  /** Router path the card links to. */
  to: string
  token: { symbol: string; logoURI?: string; address?: string }
  title: string
  subtitle?: string
  /** Mini chart slot (top-right), e.g. the explore area's <Sparkline values=… />. */
  chart?: ReactNode
  /** Big figure on the third row, e.g. "$1.2M FDV" or the value held. */
  primary: ReactNode
  /** Signed % change shown next to `primary` with ▲/▼ colouring. */
  changePct?: number | null
  /** Small line bottom-left, e.g. "$11.9K 24H volume". */
  secondary?: ReactNode
  /** Small pill bottom-right (launchpad, price…). */
  chip?: ReactNode
  testId?: string
}

/** 300×108 chart card in the Uniswap "Trending launches" style; pair with <Marquee>. */
export function ChartCard({ to, token, title, subtitle, chart, primary, changePct, secondary, chip, testId }: ChartCardProps) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="relative flex h-[108px] w-[280px] shrink-0 flex-col justify-between overflow-hidden rounded-2xl border border-border bg-surface-1 p-3.5 transition-colors hover:bg-surface-1-hover md:w-[300px]"
      style={{ backgroundImage: 'radial-gradient(120% 90% at 100% 0%, var(--ms-surface-2) 0%, transparent 60%)' }}
    >
      <div className="flex items-start gap-2.5">
        <TokenLogo token={token} size={36} chainBadge />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-2 font-semibold">{title}</div>
          {subtitle && <div className="truncate text-body-4 text-text-2">{subtitle}</div>}
        </div>
        {chart && <div className="pointer-events-none -mt-0.5 -mr-0.5 shrink-0 opacity-90">{chart}</div>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-body-3 font-semibold tabular">
            <span className="truncate">{primary}</span>
            {changePct !== undefined && <PercentChange value={changePct} className="text-body-4" />}
          </div>
          {secondary && <div className="truncate text-body-4 text-text-2 tabular">{secondary}</div>}
        </div>
        {chip && <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-body-4 font-medium text-text-1 tabular">{chip}</span>}
      </div>
    </Link>
  )
}

/** Compact pill for tickers: logo, label, ▲/▼ %. */
export function TickerPill({ to, token, label, changePct, testId }: { to?: string; token: { symbol: string; logoURI?: string; address?: string }; label: string; changePct?: number | null; testId?: string }) {
  const body = (
    <>
      <TokenLogo token={token} size={20} />
      <span className="text-body-3 font-medium">{label}</span>
      {changePct !== undefined && <PercentChange value={changePct} className="text-body-4" />}
    </>
  )
  const cls = 'flex h-9 shrink-0 items-center gap-2 rounded-full border border-border bg-surface-1 pr-3 pl-1.5 transition-colors hover:bg-surface-2'
  return to ? (
    <Link to={to} className={cls} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <span className={cls} data-testid={testId}>
      {body}
    </span>
  )
}
