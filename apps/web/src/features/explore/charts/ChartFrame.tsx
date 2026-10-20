import type { ReactNode } from 'react'
import { ChartLine, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'

export type ChartStatus = 'loading' | 'error' | 'empty' | 'ready'

/**
 * Shared chart wrapper for every explore chart: header readout, the chart body with loading, empty
 * and error states, and a footer with range and mode controls. Never shows fake zeros while loading.
 */
export function ChartFrame({
  status,
  fetching = false,
  header,
  footer,
  children,
  emptyTitle = 'No chart data yet',
  emptyText = 'Price and volume history appear as trades happen on the devnet.',
  errorText = 'Chart unavailable right now.',
  onRetry,
  heightClass = 'h-[260px] md:h-[340px]',
  testId,
  className,
}: {
  status: ChartStatus
  fetching?: boolean
  header?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  emptyTitle?: string
  emptyText?: string
  errorText?: string
  onRetry?: () => void
  heightClass?: string
  testId?: string
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)} data-testid={testId} data-status={status}>
      {header}
      <div className={cn('relative min-w-0', heightClass)}>
        {status === 'ready' && <div className={cn('absolute inset-0 transition-opacity duration-150', fetching && 'opacity-60')}>{children}</div>}
        {status === 'loading' && <div aria-hidden className="skeleton absolute inset-0 rounded-xl" data-testid="chart-loading" />}
        {status === 'empty' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl text-center text-text-2" data-testid="chart-empty">
            <ChartLine size={28} className="text-text-3" aria-hidden />
            <div className="text-body-2 font-semibold text-text-1">{emptyTitle}</div>
            <div className="max-w-sm text-body-3">{emptyText}</div>
          </div>
        )}
        {status === 'error' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl text-center text-text-2" data-testid="chart-error">
            <div className="text-body-2">{errorText}</div>
            {onRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry} leftIcon={<RefreshCw size={14} />}>
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
      {footer}
    </div>
  )
}

/** Segmented-control row under a chart: range pills on the left, mode toggles on the right. */
export function ChartControls({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1">{left}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{right}</div>
    </div>
  )
}
