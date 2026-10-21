import { useState, type ReactNode } from 'react'
import * as RTooltip from '@radix-ui/react-tooltip'
import * as RPopover from '@radix-ui/react-popover'
import { AlertTriangle, Check, Copy, Info, OctagonAlert, CircleCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatUsd, formatAmount } from '@/lib/format'

/* ---------------------------------------------------------------- Skeleton */

/** Shimmering placeholder. Never show fake zeros while loading (ui-ux.md §12.1). */
export function Skeleton({ className, width, height, rounded = 'full' }: { className?: string; width?: number | string; height?: number | string; rounded?: 'full' | 'lg' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn('skeleton inline-block align-middle', rounded === 'full' ? 'rounded-full' : rounded === 'lg' ? 'rounded-lg' : 'rounded-md', className)}
      style={{ width, height: height ?? '1em' }}
    />
  )
}

/* ---------------------------------------------------------------- Tooltip */

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={150} skipDelayDuration={300}>
      {children}
    </RTooltip.Provider>
  )
}

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="z-[1400] max-w-[280px] rounded-lg border border-border bg-surface-1 px-3 py-2 text-body-4 text-text-1 shadow-medium animate-pop-in"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

/** Small (i) icon with a tooltip, for labels in details rows. */
export function InfoTip({ content, label = 'More info' }: { content: ReactNode; label?: string }) {
  return (
    <Tooltip content={content}>
      <button type="button" aria-label={label} className="inline-flex text-text-3 hover:text-text-2">
        <Info size={14} />
      </button>
    </Tooltip>
  )
}

/* ---------------------------------------------------------------- Popover */

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'end',
  className,
  autoFocus = true,
  sideOffset = 8,
}: {
  trigger: ReactNode
  children: ReactNode
  open?: boolean
  onOpenChange?: (o: boolean) => void
  align?: 'start' | 'center' | 'end'
  className?: string
  /** false: keep focus on the trigger when opening (avoids popping the first tooltip inside). */
  autoFocus?: boolean
  sideOffset?: number
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          sideOffset={sideOffset}
          onOpenAutoFocus={autoFocus ? undefined : (e) => e.preventDefault()}
          collisionPadding={12}
          className={cn('z-[1100] rounded-2xl border border-border bg-surface-1 p-4 shadow-large outline-none animate-pop-in', className)}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  )
}

/* ---------------------------------------------------------------- Tabs */

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  testId?: string
}

/** Pill segmented control (active = surface-3 pill). Used for swap tabs, ranges, slippage mode. */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  className,
  ariaLabel,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('inline-flex items-center gap-1', className)}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={it.disabled}
            data-testid={it.testId}
            onClick={() => onChange(it.value)}
            className={cn(
              'rounded-full font-semibold transition-colors duration-150 disabled:opacity-40',
              size === 'sm' ? 'h-7 px-2.5 text-body-4' : 'h-9 px-3.5 text-body-3',
              active ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:bg-surface-2-hover hover:text-text-1',
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

/** Large text tabs with an underline (portfolio, explore). */
export function UnderlineTabs<T extends string>({ items, value, onChange, className }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex items-center gap-5 border-b border-border overflow-x-auto scrollbar-thin', className)}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            data-testid={it.testId}
            onClick={() => onChange(it.value)}
            className={cn(
              '-mb-px shrink-0 border-b-2 pb-2.5 text-body-1 font-medium transition-colors',
              active ? 'border-text-1 text-text-1' : 'border-transparent text-text-2 hover:text-text-1',
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

/* ---------------------------------------------------------------- Numbers */

/** Percent text without trailing zeros ("1.5%", "12%"), like Uniswap. */
export function trimPercent(abs: number, digits = 2): string {
  return `${Number(abs.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits })}%`
}

/** Signed percent with filled ▲/▼ and success/critical colour; exactly 0 reads a neutral "0%". */
export function PercentChange({ value, className, digits = 2 }: { value: number | null | undefined; className?: string; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cn('text-text-3', className)}>-</span>
  const rounded = Number(value.toFixed(digits))
  const up = rounded > 0
  const down = rounded < 0
  return (
    <span className={cn('relative inline-flex items-center gap-0.5 tabular', up ? 'text-success' : down ? 'text-critical' : 'text-text-2', className)} data-testid="percent-change">
      {(up || down) && (
        <span aria-hidden className="text-[0.75em] leading-none">
          {up ? '▲' : '▼'}
        </span>
      )}
      <span>{trimPercent(Math.abs(rounded), digits)}</span>
      <span className="sr-only">{up ? 'up' : down ? 'down' : 'unchanged'}</span>
    </span>
  )
}

export function Usd({ value, compact, className }: { value: number | null | undefined; compact?: boolean; className?: string }) {
  return <span className={cn('tabular', className)}>{formatUsd(value, { compact })}</span>
}

export function Amount({ value, symbol, className }: { value: number | string | null | undefined; symbol?: string; className?: string }) {
  return (
    <span className={cn('tabular', className)}>
      {formatAmount(value)}
      {symbol ? ` ${symbol}` : ''}
    </span>
  )
}

/* ---------------------------------------------------------------- Badge / Switch / Banner */

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'critical'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-surface-3 text-text-2',
    accent: 'bg-accent-tint text-accent',
    success: 'bg-success-tint text-success',
    warning: 'bg-warning-tint text-warning',
    critical: 'bg-critical-tint text-critical',
  }
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-body-4 font-semibold', tones[tone], className)}>{children}</span>
}

export function Switch({ checked, onChange, label, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-40',
        checked ? 'bg-accent-fill' : 'bg-surface-3-solid',
      )}
    >
      <span className={cn('inline-block size-5 rounded-full bg-white shadow-short transition-transform duration-150', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  )
}

export function Banner({ tone = 'warning', title, children, action, className, icon }: { tone?: 'info' | 'warning' | 'critical' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode }) {
  const tones = {
    info: 'bg-accent-tint text-text-1 [&_.banner-icon]:text-accent',
    warning: 'bg-warning-tint text-text-1 [&_.banner-icon]:text-warning',
    critical: 'bg-critical-tint text-text-1 [&_.banner-icon]:text-critical',
    success: 'bg-success-tint text-text-1 [&_.banner-icon]:text-success',
  }
  const DefaultIcon = tone === 'critical' ? OctagonAlert : tone === 'success' ? CircleCheck : tone === 'info' ? Info : AlertTriangle
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-xl px-4 py-3 text-body-3', tones[tone], className)}>
      <span className="banner-icon mt-px shrink-0">{icon ?? <DefaultIcon size={18} />}</span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title ? 'mt-0.5 text-text-2' : '')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- Copy */

export function CopyButton({ value, label = 'Copy', className, children }: { value: string; label?: string; className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
        } catch {
          /* clipboard blocked */
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className={cn('inline-flex items-center gap-1.5 rounded-full text-text-2 transition-colors hover:text-text-1', className)}
    >
      {children}
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </button>
  )
}

/* ---------------------------------------------------------------- Empty state / card */

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icon && <div className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-surface-3 text-text-2">{icon}</div>}
      <div className="text-body-1 font-semibold">{title}</div>
      {children && <div className="max-w-sm text-body-3 text-text-2">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-[20px] border border-border bg-surface-1', className)} {...rest}>
      {children}
    </div>
  )
}

/**
 * Uniswap's chart pill capsule (range / mode / chart-type): 34px tall, radius 20, hairline border,
 * 4px padding, 8px gap; 24px pills (2px 8px padding, 12px/535); selected pill = surface-3 fill.
 */
export function PillGroup<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: Array<{ value: T; label: ReactNode; testId?: string; title?: string }>
  value: T
  onChange: (v: T) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('inline-flex h-[34px] items-center gap-2 rounded-[20px] border border-border p-1', className)}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={value === it.value}
          aria-label={it.title}
          title={it.title}
          data-testid={it.testId}
          onClick={() => onChange(it.value)}
          className={cn('inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-body-4 font-semibold transition-colors', value === it.value ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:text-text-1')}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
