import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Continuously auto-scrolling strip (ticker / carousel). Items are rendered twice and the scroll
 * position wraps at the halfway point, so it runs forever. Pauses on hover and keyboard focus,
 * arrows nudge it, and with prefers-reduced-motion it is a plain scrollable row.
 */
export function Marquee({
  children,
  speed = 40,
  arrows = false,
  className,
  itemGap = 8,
  testId,
  ariaLabel,
}: {
  children: ReactNode[]
  /** pixels per second */
  speed?: number
  arrows?: boolean
  className?: string
  itemGap?: number
  testId?: string
  ariaLabel?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const paused = useRef(false)
  const [reduced] = useState(prefersReducedMotion)
  const animate = !reduced && children.length > 1

  useEffect(() => {
    if (!animate) return
    let raf = 0
    let last = performance.now()
    let carry = 0
    const tick = (t: number) => {
      const el = ref.current
      const dt = Math.min(64, t - last)
      last = t
      if (el && !paused.current) {
        carry += (speed * dt) / 1000
        const whole = Math.floor(carry)
        carry -= whole
        if (whole) {
          const half = el.scrollWidth / 2
          let next = el.scrollLeft + whole
          if (half > 0 && next >= half) next -= half
          el.scrollLeft = next
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate, speed])

  const nudge = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    const half = el.scrollWidth / 2
    if (animate && dir < 0 && el.scrollLeft < 300) el.scrollLeft += half
    el.scrollBy({ left: dir * 300, behavior: 'smooth' })
  }

  const items = animate ? [...children, ...children] : children
  return (
    <div className={cn('relative', className)} data-testid={testId}>
      <div
        ref={ref}
        role="region"
        aria-label={ariaLabel}
        data-running={animate ? 'true' : 'false'}
        onMouseEnter={() => (paused.current = true)}
        onMouseLeave={() => (paused.current = false)}
        onFocus={() => (paused.current = true)}
        onBlur={() => (paused.current = false)}
        onTouchStart={() => (paused.current = true)}
        onTouchEnd={() => (paused.current = false)}
        className={cn('flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', !animate && 'snap-x')}
        style={{ gap: itemGap }}
      >
        {items.map((child, i) => (
          <div key={i} className="shrink-0 snap-start" aria-hidden={i >= children.length || undefined} inert={i >= children.length || undefined}>
            {child}
          </div>
        ))}
      </div>
      {arrows && (
        <>
          <button type="button" aria-label="Scroll left" onClick={() => nudge(-1)} className="absolute top-1/2 left-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-1 text-text-2 shadow-short hover:text-text-1">
            <ChevronLeft size={16} />
          </button>
          <button type="button" aria-label="Scroll right" onClick={() => nudge(1)} className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-1 text-text-2 shadow-short hover:text-text-1">
            <ChevronRight size={16} />
          </button>
        </>
      )}
    </div>
  )
}
