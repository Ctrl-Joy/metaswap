import { useMemo, useState } from 'react'
import type { Address } from 'viem'
import { Button, SegmentedTabs, Skeleton } from '@/components/ui'
import { usePortfolioHistory, type PortfolioRange } from '@/api/hooks'
import { TimeChart, type HoverInfo } from '@/features/explore/charts/TimeChart'
import { ChartFrame, ChartControls } from '@/features/explore/charts/ChartFrame'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useUi } from '@/state/ui'
import { ApiError } from '@/lib/errors'
import { useMask } from './usePortfolioData'

const RANGES: PortfolioRange[] = ['1H', '1D', '1W', '1M', '1Y', 'ALL']

function hoverDate(t: number, range: PortfolioRange): string {
  const d = new Date(t * 1000)
  return range === '1H' || range === '1D'
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Big total + today's change, and the portfolio value chart (the explore area's TimeChart, trend-coloured area).
 * Hovering the chart moves the headline to the hovered value/date. Demo mode adds the
 * "Track your portfolio / Connect wallet" overlay (ui reference: stage5/portfolio.webp).
 */
export function PortfolioValue({ address, isDemo, totalUsd, change24hUsd, change24hPct, loading, range: rangeProp, onRangeChange }: {
  range?: PortfolioRange
  onRangeChange?: (r: PortfolioRange) => void
  address: Address | undefined
  isDemo: boolean
  totalUsd: number | null
  change24hUsd: number | null
  change24hPct: number | null
  loading: boolean
}) {
  const [ownRange, setOwnRange] = useState<PortfolioRange>('1D')
  const range = rangeProp ?? ownRange
  const setRange = onRangeChange ?? setOwnRange
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const history = usePortfolioHistory(address, range)
  const openConnect = useUi((s) => s.openConnect)
  const mask = useMask()
  const data = useMemo(() => (history.data ?? []).map((p) => ({ time: p.time, value: p.valueUsd })).filter((p) => Number.isFinite(p.value)), [history.data])
  const first = data[0]?.value
  const headline = hover?.value ?? totalUsd
  // Headline delta: hovered point vs the range start; otherwise the API's 24h change, falling back to
  // the selected range's first history point.
  const apiDelta = range === '1D' && change24hUsd != null ? { usd: change24hUsd, pct: change24hPct } : null
  const fromFirst = (v: number | null) => (v != null && first ? { usd: v - first, pct: ((v - first) / first) * 100 } : null)
  const d = hover?.value != null ? fromFirst(hover.value) : (apiDelta ?? fromFirst(totalUsd))
  const delta = d?.usd ?? null
  const deltaPct = d?.pct ?? null
  const notFound = history.error instanceof ApiError && (history.error.status === 404 || history.error.status === 501)
  const status = history.isLoading ? 'loading' : history.isError && !notFound ? 'error' : data.length < 2 ? 'empty' : 'ready'

  return (
    <div className="min-w-0" data-testid="portfolio-value">
      <div className="text-[40px] leading-[44px] font-semibold tracking-[-0.02em] tabular md:text-heading-1" data-testid="portfolio-total">
        {loading || headline === null ? <Skeleton width={200} height={44} rounded="lg" /> : mask(formatUsd(headline))}
      </div>
      <div className="mt-1 flex min-h-6 items-center gap-1.5 text-body-3 text-text-2">
        {delta !== null && delta !== undefined && !loading ? (
          <>
            <span className={cn('inline-flex items-center gap-1 tabular', delta > 0 ? 'text-success' : delta < 0 ? 'text-critical' : 'text-text-2')} data-testid="portfolio-change">
              <span aria-hidden>{delta >= 0 ? '▲' : '▼'}</span>
              {mask(formatUsd(Math.abs(delta)))} ({Math.abs(deltaPct ?? 0).toFixed(2)}%)
            </span>
            <span>{hover ? hoverDate(hover.time, range) : range === '1D' ? 'today' : `past ${range === 'ALL' ? 'all time' : range}`}</span>
          </>
        ) : loading ? (
          <Skeleton width={140} height={14} />
        ) : null}
      </div>
      <div className="relative mt-4">
        <ChartFrame
          status={status}
          fetching={history.isFetching}
          heightClass="h-[200px] md:h-[300px]"
          emptyTitle="No value history yet"
          emptyText="History will appear as your balances change."
          errorText="Portfolio history is unavailable right now."
          onRetry={() => void history.refetch()}
          testId="portfolio-chart"
          footer={
            <ChartControls
              left={<SegmentedTabs size="sm" ariaLabel="Chart range" value={range} onChange={setRange} items={RANGES.map((r) => ({ value: r, label: r === 'ALL' ? 'All' : r, testId: `portfolio-range-${r}` }))} />}
            />
          }
        >
          <TimeChart kind="area" data={data} formatValue={(v) => formatUsd(v, { compact: v >= 100_000 })} onHover={setHover} ariaLabel="Portfolio value" testId="portfolio-value-chart" className="size-full" />
        </ChartFrame>
        {isDemo && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-1/95 py-2 pr-2 pl-4 shadow-medium backdrop-blur md:absolute md:right-0 md:bottom-0 md:mt-0 md:justify-start" data-testid="track-portfolio">
            <span className="text-body-3 font-medium">Track your portfolio</span>
            <Button size="sm" onClick={openConnect}>
              Connect wallet
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
