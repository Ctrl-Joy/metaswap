import type { HTMLAttributes, Ref, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/components/ui'

/**
 * Explore table primitives: a ledger. A 40px header of small secondary labels over a rule, then
 * 64px token/pool rows or 56px transaction rows split by hairlines. The active sort column is
 * full-contrast. The wrapper scrolls sideways on narrow screens instead of widening the page.
 */

export function ExTable({ children, minWidth = 760, className }: { children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div className={cn('relative w-full max-w-full overflow-x-auto scrollbar-thin [contain:inline-size]', className)}>
      <table className="w-full border-separate border-spacing-0 text-left" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

/** Header row: 40px, 13px labels, ruled off from the body. */
export function ExTHead({ children }: { children: ReactNode }) {
  return (
    <thead className="text-[13px] leading-4 text-text-2">
      <tr className="h-10">{children}</tr>
    </thead>
  )
}

export function ExTh({ className, children, align = 'left', ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border px-3 font-medium whitespace-nowrap md:px-4',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  )
}

/** Sortable header. The active column shows its arrow and full-contrast label. */
export function ExSortTh({
  label,
  active,
  direction = 'desc',
  onClick,
  align = 'right',
  className,
}: {
  label: ReactNode
  active: boolean
  direction?: 'asc' | 'desc'
  onClick: () => void
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <ExTh align={align} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={className}>
      <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1 hover:text-text-1 touch:h-10', active && 'text-text-1')}>
        {active && (direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
        {label}
      </button>
    </ExTh>
  )
}

/** Body row. `height` is 64 for tokens and pools, 56 for transactions. */
export function ExTr({ className, onClick, height = 64, children, rowRef, ...rest }: HTMLAttributes<HTMLTableRowElement> & { height?: 56 | 64; rowRef?: Ref<HTMLTableRowElement> }) {
  return (
    <tr
      ref={rowRef}
      className={cn('transition-colors [&>td]:border-b [&>td]:border-border last:[&>td]:border-b-0', height === 64 ? 'h-16' : 'h-14', onClick && 'cursor-pointer hover:bg-surface-2', className)}
      onClick={onClick}
      {...rest}
    >
      {children}
    </tr>
  )
}

export function ExTd({ className, align = 'left', children, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td className={cn('px-3 whitespace-nowrap tabular text-body-2 md:px-4', align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)} {...rest}>
      {children}
    </td>
  )
}

/** Skeleton rows at the real row height (never fake zeros while loading). */
export function ExTableSkeleton({ rows = 8, cols = 7, height = 64 }: { rows?: number; cols?: number; height?: 56 | 64 }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className={cn('[&>td]:border-b [&>td]:border-border last:[&>td]:border-b-0', height === 64 ? 'h-16' : 'h-14')}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-4">
              {c === 1 ? (
                <span className="flex items-center gap-3">
                  <Skeleton width={28} height={28} />
                  <Skeleton width={110} height={14} />
                </span>
              ) : (
                <Skeleton width={c === 0 ? 16 : 64} height={14} />
              )}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

/** Uniswap-style section tabs: 24px text tabs, no underline. Each tab is a link so URLs sync. */
export function ExploreSectionTabs<T extends string>({ items, value, onSelect, className, size = 'lg' }: { items: Array<{ value: T; label: string; testId?: string; href?: string }>; value: T; onSelect?: (v: T) => void; className?: string; size?: 'lg' | 'md' }) {
  return (
    <div role="tablist" aria-label="Explore sections" className={cn('flex items-center overflow-x-auto scrollbar-thin', size === 'lg' ? 'gap-6' : 'gap-5', className)}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={it.testId}
            onClick={() => onSelect?.(it.value)}
            className={cn('shrink-0 font-medium transition-colors touch:py-2', size === 'lg' ? 'text-[22px] leading-7 tracking-[-0.015em] md:text-[24px]' : 'text-[18px] leading-6', active ? 'text-text-1' : 'text-text-2 hover:text-text-1')}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
