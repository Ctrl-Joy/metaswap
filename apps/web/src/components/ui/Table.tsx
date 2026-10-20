import type { ReactNode, HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Skeleton } from './misc'

/**
 * Data table primitives in the explore style (ui-ux.md §8.4): rounded surface, lighter
 * header row, 56px rows with hover fill. Horizontal scroll on narrow screens.
 */
export function Table({ className, children, minWidth = 640, dense }: { className?: string; children: ReactNode; minWidth?: number; /** 14px text, 12px cell padding. */ dense?: boolean }) {
  return (
    <div className={cn('relative w-full max-w-full overflow-x-auto rounded-2xl border border-border bg-surface-1 scrollbar-thin [contain:inline-size]', className)}>
      <table className={cn('w-full border-collapse text-left', dense ? 'text-body-3 [&_td]:px-3 [&_th]:px-3' : 'text-body-2')} style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-[1] bg-surface-2 text-body-3 text-text-2">
      <tr className="h-12">{children}</tr>
    </thead>
  )
}

export function Th({ className, children, align = 'left', ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th scope="col" className={cn('px-4 font-medium whitespace-nowrap', align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)} {...rest}>
      {children}
    </th>
  )
}

/** Sortable header cell; `active` shows the arrow and full-contrast label. */
export function SortTh({ label, active, direction = 'desc', onClick, align = 'right' }: { label: ReactNode; active: boolean; direction?: 'asc' | 'desc'; onClick: () => void; align?: 'left' | 'right' }) {
  return (
    <Th align={align} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1 hover:text-text-1', active && 'text-text-1')}>
        {active && (direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
        {label}
      </button>
    </Th>
  )
}

export function Tr({ className, onClick, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('h-14 border-t border-border transition-colors first:border-t-0', onClick && 'cursor-pointer hover:bg-surface-2-hover', className)}
      onClick={onClick}
      {...rest}
    >
      {children}
    </tr>
  )
}

export function Td({ className, align = 'left', children, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td className={cn('px-4 whitespace-nowrap tabular', align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)} {...rest}>
      {children}
    </td>
  )
}

/** Skeleton rows matching the final layout. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="h-14 border-t border-border first:border-t-0">
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
