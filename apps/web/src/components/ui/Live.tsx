import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

// "Live" polish for values pushed over the WebSocket (Uniswap-style): a brief green/red flash when a
// number changes, a short tween for headline totals, and a slide-in for rows that appear after first
// paint. Everything uses the Web Animations API and is skipped under prefers-reduced-motion.

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

const FLASH_UP = 'var(--color-success)'
const FLASH_DOWN = 'var(--color-critical)'

/** Direction of the last change of `value` (null on first render or when unchanged). */
export function changeDirection(prev: number | null | undefined, next: number | null | undefined): 'up' | 'down' | null {
  if (prev == null || next == null || !Number.isFinite(prev) || !Number.isFinite(next) || prev === next) return null
  return next > prev ? 'up' : 'down'
}

/** Ref that flashes the element's text colour when `value` changes. */
export function useValueFlash<T extends HTMLElement>(value: number | null | undefined) {
  const ref = useRef<T>(null)
  const prev = useRef(value)
  useEffect(() => {
    const dir = changeDirection(prev.current, value)
    prev.current = value
    const el = ref.current
    if (!dir || !el || prefersReducedMotion() || typeof el.animate !== 'function') return
    el.animate([{ color: dir === 'up' ? FLASH_UP : FLASH_DOWN }, { color: dir === 'up' ? FLASH_UP : FLASH_DOWN, offset: 0.35 }, {}], { duration: 900, easing: 'ease-out' })
  }, [value])
  return ref
}

/** Animate a number from its previous value to `value` (ms), returning the value to display. */
export function useTweenedNumber(value: number | null | undefined, ms = 600): number | null | undefined {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    from.current = value
    if (value == null || start == null || start === value || prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
      setShown(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const e = 1 - (1 - k) ** 3
      setShown(start + (value - start) * e)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

/**
 * A number that flashes green/red when it changes; with `tween` it also counts to the new value.
 * `format` renders the (possibly tweening) number.
 */
export function LiveNumber({
  value,
  format,
  tween,
  className,
  testId,
  fallback = '-',
}: {
  value: number | null | undefined
  format: (n: number) => ReactNode
  tween?: boolean
  className?: string
  testId?: string
  fallback?: ReactNode
}) {
  const ref = useValueFlash<HTMLSpanElement>(value)
  const tweened = useTweenedNumber(value)
  const shown = tween ? tweened : value
  return (
    <span ref={ref} className={cn('tabular', className)} data-testid={testId} data-value={value ?? undefined}>
      {shown == null || !Number.isFinite(shown) ? fallback : format(shown)}
    </span>
  )
}

/**
 * Rows whose id first appears after the initial render get a slide-in + highlight.
 * Usage: `const enter = useRowEnter(rows.map(r => r.id))` then `<tr ref={enter(row.id)}>`.
 */
export function useRowEnter(ids: readonly string[]) {
  const known = useRef<Set<string> | null>(null)
  const fresh = useRef<Set<string>>(new Set())
  // the first non-empty list is the baseline (a table that loads in must not animate every row)
  if (known.current === null) {
    if (ids.length) known.current = new Set(ids)
  } else {
    for (const id of ids) if (!known.current.has(id)) fresh.current.add(id)
  }
  useEffect(() => {
    if (known.current) for (const id of ids) known.current.add(id)
  }, [ids])
  return useCallback((id: string) => {
    if (!fresh.current.has(id)) return undefined
    return (el: HTMLElement | null) => {
      if (!el || !fresh.current.delete(id)) return
      el.dataset.live = 'new'
      if (prefersReducedMotion() || typeof el.animate !== 'function') return
      el.animate(
        [
          { transform: 'translateY(-8px)', opacity: 0, backgroundColor: 'var(--color-accent-tint)' },
          { transform: 'none', opacity: 1, backgroundColor: 'var(--color-accent-tint)', offset: 0.3 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 1400, easing: 'ease-out' },
      )
    }
  }, [])
}
