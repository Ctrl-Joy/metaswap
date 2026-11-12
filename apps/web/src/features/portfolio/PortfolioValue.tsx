import { useMemo, useState } from 'react'
import type { Address } from 'viem'
import { ChevronDown, Check } from 'lucide-react'
import { LiveNumber, Popover, Skeleton } from '@/components/ui'
import { usePortfolioHistory, type PortfolioRange } from '@/api/hooks'
import { TimeChart, type HoverInfo } from '@/features/explore/charts/TimeChart'
import { ChartFrame } from '@/features/explore/charts/ChartFrame'
import { formatUsd, fixedNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiError } from '@/lib/errors'
import { useMask } from './usePortfolioData'
import { displayLocale } from '@/lib/displayPrefs'
import { t } from '@/i18n'

const RANGES: PortfolioRange[] = ['1H', '1D', '1W', '1M', '1Y', 'ALL']

function hoverDate(t: number, range: PortfolioRange): string {
  const d = new Date(t * 1000)
  return range === '1H' || range === '1D'
    ? d.toLocaleString(displayLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(displayLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Big total + today's change, and the portfolio value chart (the explore area's TimeChart, trend-coloured area).
 * Hovering the chart moves the headline to the hovered value/date. (`isDemo` is accepted for the
 * callers; the signed-out connect prompt is the banner at the top of the page.)
 */
export function PortfolioValue({ address, totalUsd, change24hUsd, change24hPct, loading, range: rangeProp, onRangeChange }: {
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
      <div className="text-heading-2 font-medium tabular" data-testid="portfolio-total">
        {loading || headline === null ? <Skeleton width={200} height={40} rounded="lg" /> : hover?.value != null ? mask(formatUsd(headline)) : <LiveNumber value={headline} tween format={(n) => mask(formatUsd(n))} />}
      </div>
      <div className="mt-2 flex min-h-[22px] items-center gap-1.5 text-body-2 text-text-2">
        {delta !== null && delta !== undefined && !loading ? (
          <>
            <span className={cn('inline-flex items-center gap-1 tabular', delta > 0 ? 'text-success' : delta < 0 ? 'text-critical' : 'text-text-2')} data-testid="portfolio-change">
              <span aria-hidden className="text-[0.7em]">{delta >= 0 ? '▲' : '▼'}</span>
              {mask(formatUsd(Math.abs(delta)))} ({fixedNumber(Math.abs(deltaPct ?? 0), 2)}%)
            </span>
            <span>{hover ? hoverDate(hover.time, range) : range === '1D' ? t('today') : range === 'ALL' ? t('past all time') : t('past {range}', { range })}</span>
          </>
        ) : loading ? (
          <Skeleton width={140} height={14} />
        ) : null}
      </div>
      <div className="relative mt-4">
        <ChartFrame
          status={status}
          fetching={history.isFetching}
          heightClass="h-[220px] md:h-[300px]"
          emptyTitle={t('No value history yet')}
          emptyText={t('History will appear as your balances change.')}
          errorText={t('Portfolio history is unavailable right now.')}
          onRetry={() => void history.refetch()}
          testId="portfolio-chart"
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <RangePills value={range} onChange={setRange} />
              <BalanceMode />
            </div>
          }
        >
          <TimeChart kind="area" data={data} formatValue={(v) => formatUsd(v, { compact: v >= 100_000 })} onHover={setHover} ariaLabel={t('Portfolio value')} testId="portfolio-value-chart" className="size-full" />
        </ChartFrame>
      </div>
    </div>
  )
}

/** Range pills in a bordered capsule (Uniswap: 34px, radius 20, 24px pills, selected = surface-3). */
function RangePills({ value, onChange }: { value: PortfolioRange; onChange: (r: PortfolioRange) => void }) {
  return (
    <div role="radiogroup" aria-label={t('Chart range')} className="inline-flex h-[34px] items-center gap-2 rounded-[20px] border border-border p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          data-testid={`portfolio-range-${r}`}
          className={cn('h-6 rounded-full px-2 text-body-4 font-semibold transition-colors', value === r ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:text-text-1')}
        >
          {r === 'ALL' ? t('All') : r}
        </button>
      ))}
    </div>
  )
}

/** "Total balance ⌄" chart-mode selector (only one mode on the devnet build). */
function BalanceMode() {
  return (
    <Popover
      align="end"
      className="w-[200px] p-2"
      trigger={
        <button type="button" data-testid="portfolio-chart-mode" className="inline-flex h-[30px] items-center gap-1 rounded-full border border-border pr-2 pl-3 text-body-4 font-semibold text-text-1 hover:bg-surface-2">
          {t('Total balance')} <ChevronDown size={16} className="text-text-2" aria-hidden />
        </button>
      }
    >
      <div className="flex h-10 items-center justify-between rounded-lg px-2 text-body-3 font-semibold">
        {t('Total balance')} <Check size={16} className="text-accent" />
      </div>
    </Popover>
  )
}
