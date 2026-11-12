import type { ReactNode, HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, Search } from 'lucide-react'
import { Popover } from '@/components/ui'
import { cn } from '@/lib/cn'

// Portfolio-page primitives measured against Uniswap's portfolio (docs/analysis/measured/portfolio*.styles.txt):
// table header 42px / radius 12 / surface-2, rows 72px (4px pad, 64px inner hover radius 12), 14px cells with
// 20px side padding; pill buttons 34px; dropdowns and search inputs 40px / radius 12.

export function PfTable({ children, minWidth = 600, className, testId }: { children: ReactNode; minWidth?: number; className?: string; testId?: string }) {
  return (
    <div className={cn('relative w-full max-w-full overflow-x-auto scrollbar-thin [contain:inline-size]', className)} data-testid={testId}>
      <table className="w-full border-separate border-spacing-0 text-left text-body-3" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

export function PfHead({ children }: { children: ReactNode }) {
  return (
    <thead className="text-body-3 text-text-2">
      <tr className="h-[42px] [&>th]:bg-surface-2 [&>th:first-child]:rounded-l-xl [&>th:last-child]:rounded-r-xl">{children}</tr>
    </thead>
  )
}

export function PfTh({ className, children, align = 'left', ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th scope="col" className={cn('px-3 font-medium whitespace-nowrap first:pl-5 last:pr-5', align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)} {...rest}>
      {children}
    </th>
  )
}

/** Body row: 72px tall; hover fills the inner 64px band with rounded ends (Uniswap row style). */
export function PfTr({ className, onClick, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'group h-[72px]',
        '[&>td]:border-y-4 [&>td]:border-transparent [&>td]:bg-clip-padding [&>td:first-child]:rounded-l-2xl [&>td:last-child]:rounded-r-2xl',
        onClick && 'cursor-pointer hover:[&>td]:bg-surface-2',
        className,
      )}
      onClick={onClick}
      {...rest}
    >
      {children}
    </tr>
  )
}

export function PfTd({ className, align = 'left', children, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td className={cn('px-3 whitespace-nowrap tabular first:pl-5 last:pr-5', align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)} {...rest}>
      {children}
    </td>
  )
}

/** Token / pool cell: 32px logo, 14px name, 12px secondary line. */
export function NameCell({ logo, name, sub }: { logo: ReactNode; name: ReactNode; sub?: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="mr-1 shrink-0">{logo}</span>
      <span className="min-w-0">
        <span className="block max-w-[164px] truncate text-body-3 text-text-1">{name}</span>
        {sub && <span className="block text-body-4 text-text-2">{sub}</span>}
      </span>
    </span>
  )
}

/** "View all tokens →": 34px pill with hairline border. */
export function PillLink({ to, label, testId, className }: { to: string; label: string; testId?: string; className?: string }) {
  return (
    <Link to={to} data-testid={testId} className={cn('inline-flex h-[34px] items-center gap-2 rounded-full border border-border px-3 text-body-3 font-semibold text-text-1 transition-colors hover:bg-surface-2', className)}>
      {label} <ArrowRight size={16} />
    </Link>
  )
}

export function SearchField({ value, onChange, placeholder, width = 280, testId }: { value: string; onChange: (v: string) => void; placeholder: string; width?: number; testId?: string }) {
  return (
    <label className="relative flex h-10 w-full items-center md:w-[var(--w)]" style={{ ['--w' as string]: `${width}px` }}>
      <Search size={18} className="pointer-events-none absolute left-3 text-text-2" aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={testId}
        className="h-10 w-full rounded-xl border border-border bg-surface-2 pr-3 pl-10 text-body-3 text-text-1 outline-none placeholder:text-text-2 focus:border-accent"
      />
    </label>
  )
}

/** 40px bordered dropdown (All networks / All types / All time). */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  icon,
  testId,
  align = 'start',
  width = 200,
  className,
  compactLabel,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string; icon?: ReactNode; testId?: string }>
  onChange?: (v: T) => void
  icon?: ReactNode
  testId?: string
  align?: 'start' | 'end'
  width?: number
  className?: string
  /** Hide the label below 640px (icon + chevron only). */
  compactLabel?: boolean
}) {
  const cur = options.find((o) => o.value === value)
  return (
    <Popover
      align={align}
      className="p-2"
      trigger={
        <button
          type="button"
          data-testid={testId}
          className={cn('inline-flex h-10 items-center gap-2 rounded-xl border border-border pr-1.5 pl-3 text-body-3 font-semibold text-text-1 transition-colors hover:bg-surface-2', className)}
        >
          {icon ?? cur?.icon}
          <span className={cn('whitespace-nowrap', compactLabel && 'hidden sm:inline')}>{cur?.label}</span>
          <ChevronDown size={20} className="text-text-2" aria-hidden />
        </button>
      }
    >
      <div role="menu" style={{ width }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="menuitemradio"
            aria-checked={o.value === value}
            data-testid={o.testId}
            onClick={() => onChange?.(o.value)}
            className="flex h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-body-3 font-semibold text-text-1 hover:bg-surface-2"
          >
            {o.icon}
            <span className="flex-1">{o.label}</span>
            {o.value === value && <Check size={16} className="text-accent" />}
          </button>
        ))}
      </div>
    </Popover>
  )
}

/** Section title (18px) + optional 14px subtitle, inset 8px like Uniswap. */
export function PfSectionHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-7 flex items-end justify-between gap-3 px-2">
      <div>
        <h2 className="text-body-1 font-medium">{title}</h2>
        {subtitle && <div className="text-body-3 text-text-2">{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}
