import { useMemo, useState } from 'react'
import { CandlestickChart, LineChart } from 'lucide-react'
import { LiveNumber, PercentChange, PillGroup, Skeleton, Usd } from '@/components/ui'
import { formatPrice, formatUsd } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ChartControls, ChartFrame, type ChartStatus } from '../charts/ChartFrame'
import { TimeChart, type HoverInfo } from '../charts/TimeChart'
import { useTokenCandles, useTokenPriceLine, useTokenTvlHistory } from '../api'
import { RANGE_KEYS, RANGES, bucketSum, changeOver, filterRange } from '../transforms'
import type { CandlePoint, RangeKey, SeriesPoint } from '../types'
import { displayLocale } from '@/lib/displayPrefs'
import { t } from '@/i18n'

export type TokenChartMode = 'price' | 'volume' | 'tvl'
type ChartType = 'line' | 'candles'

const MODES: Array<{ value: TokenChartMode; label: string }> = [
  { value: 'price', label: 'Price' },
  { value: 'volume', label: 'Volume' },
  { value: 'tvl', label: 'TVL' },
]

function rangeWindowLabel(range: RangeKey): string {
  return ({ '1H': t('Past hour'), '1D': t('Past day'), '1W': t('Past week'), '1M': t('Past month'), '1Y': t('Past year'), ALL: t('All time') } as const)[range]
}

function timeLabel(sec: number, range: RangeKey): string {
  const d = new Date(sec * 1000)
  if (range === '1Y' || range === 'ALL' || range === '1M') return d.toLocaleDateString(displayLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
  return d.toLocaleString(displayLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Price header + chart for a token. Owns the range, mode and chart type. The crosshair updates the
 * headline price, the change, and the date label (ui-ux.md §9.2–9.3).
 */
export function TokenChartPanel({ address, symbol, latestPriceUsd, apiChange24h }: { address: string; symbol: string; latestPriceUsd: number | null; apiChange24h: number | null }) {
  const [range, setRange] = useState<RangeKey>('1D')
  const [mode, setMode] = useState<TokenChartMode>('price')
  const [type, setType] = useState<ChartType>('line')
  const [hover, setHover] = useState<HoverInfo | null>(null)

  const priceLine = useTokenPriceLine(address, range)
  const candles = useTokenCandles(address, range)
  const tvl = useTokenTvlHistory(address, range)
  const nowSec = Math.floor(Date.now() / 1000)

  // Series for the active mode, clipped to the range window (the API already limits candles).
  const priceSeries: SeriesPoint[] = useMemo(() => filterRange(priceLine.data ?? [], range, nowSec), [priceLine.data, range, nowSec])
  const candleData: CandlePoint[] = useMemo(() => filterRange(candles.data ?? [], range, nowSec), [candles.data, range, nowSec])
  const volumeSeries: SeriesPoint[] = useMemo(() => bucketSum(candleData.map((c) => ({ time: c.time, value: c.volumeUsd })), RANGES[range].bucketSec), [candleData, range])
  const tvlSeries = useMemo(() => filterRange(tvl.data ?? [], range, nowSec), [tvl.data, range, nowSec])

  const effectiveType: ChartType = mode === 'price' ? type : 'line'
  const activeSeries = mode === 'price' ? priceSeries : mode === 'volume' ? volumeSeries : tvlSeries
  const change = changeOver(activeSeries)

  let status: ChartStatus = 'ready'
  if (mode === 'price') {
    if (priceLine.isError && !priceLine.data) status = 'error'
    else if (type === 'candles' && candles.isError && !candles.data) status = 'error'
    else if (priceLine.isLoading && !priceLine.data) status = 'loading'
    else if (type === 'candles' && candles.isLoading && !candles.data) status = 'loading'
    else if (type === 'candles' ? candleData.length < 2 : priceSeries.length < 2) status = 'empty'
  } else if (mode === 'volume') {
    if (candles.isError && !candles.data) status = 'error'
    else if (candles.isLoading && !candles.data) status = 'loading'
    else if (volumeSeries.length < 1) status = 'empty'
  } else {
    if (tvl.isError) status = 'error'
    else if (tvl.isLoading && !tvl.data) status = 'loading'
    else if (tvlSeries.length < 2) status = 'empty'
  }

  const retry = () => {
    void priceLine.refetch()
    void candles.refetch()
    void tvl.refetch()
  }

  // Headline: the hovered point when the crosshair is over the chart, otherwise the latest value.
  const headValue = hover?.value ?? (mode === 'price' ? latestPriceUsd : activeSeries.at(-1)?.value ?? null)
  const headChange = hover && change ? (hover.value !== null && activeSeries[0] ? { abs: hover.value - activeSeries[0].value, pct: ((hover.value - activeSeries[0].value) / activeSeries[0].value) * 100 } : null) : change
  const showApiChange = !hover && mode === 'price' && range === '1D' && !change && apiChange24h !== null
  const headLabel = hover ? timeLabel(hover.time, range) : rangeWindowLabel(range)
  const fmt = mode === 'price' ? (v: number) => formatPrice(v) : (v: number) => formatUsd(v, { compact: true })

  return (
    <section className="flex flex-col" data-testid="token-chart-panel">
      {/* As on Uniswap, the price sits above the plot, so the line never runs through it. */}
      <div className="mb-4 flex flex-col gap-1">
        <div className="text-heading-2 font-medium tabular" data-testid="token-price" aria-live="polite">
          {headValue === null ? <Skeleton width={180} height={44} /> : mode === 'price' ? hover ? formatPrice(headValue) : <LiveNumber value={headValue} format={(n) => formatPrice(n)} /> : <Usd value={headValue} compact />}
        </div>
        <div className="flex items-center gap-2 text-body-2">
          {headChange ? (
            <>
              <PercentChange value={headChange.pct} />
              <span className={cn('tabular', headChange.abs >= 0 ? 'text-success' : 'text-critical')}>
                {headChange.abs >= 0 ? '+' : '-'}
                {formatUsd(Math.abs(headChange.abs))}
              </span>
            </>
          ) : showApiChange ? (
            <PercentChange value={apiChange24h} />
          ) : (
            <span className="text-text-3">-</span>
          )}
          <span className="text-text-2">{headLabel}</span>
        </div>
      </div>

      <ChartFrame
        testId="token-chart"
        status={status}
        fetching={mode === 'price' ? priceLine.isFetching : candles.isFetching}
        onRetry={retry}
        emptyTitle={mode === 'tvl' ? t('TVL history unavailable') : t('Not enough history yet')}
        emptyText={
          mode === 'tvl'
            ? t('TVL is recorded from pool balances. It appears here once the indexer has history for this token.')
            : t('Only a few trades so far for {symbol} in this range. The chart fills in as trading continues.', { symbol })
        }
        errorText={mode === 'tvl' ? t('TVL history is not available yet.') : t('Chart unavailable right now.')}
        heightClass="h-[260px] md:h-[320px]"
        footer={
          <ChartControls
            left={<PillGroup ariaLabel={t('Chart range')} value={range} onChange={setRange} items={RANGE_KEYS.map((r) => ({ value: r, label: t(RANGES[r].label), testId: `range-${r}` }))} />}
            right={
              <>
                {mode === 'price' && (
                  <PillGroup
                    ariaLabel={t('Chart type')}
                    value={type}
                    onChange={setType}
                    className="[&>button]:w-[34px]"
                    items={[
                      { value: 'line', label: <LineChart size={16} />, title: t('Line'), testId: 'chart-type-line' },
                      { value: 'candles', label: <CandlestickChart size={16} />, title: t('Candlesticks'), testId: 'chart-type-candles' },
                    ]}
                  />
                )}
                <PillGroup ariaLabel={t('Chart mode')} value={mode} onChange={(m) => { setMode(m); setHover(null) }} items={MODES.map((m) => ({ value: m.value, label: t(m.label), testId: `mode-${m.value}` }))} />
              </>
            }
          />
        }
      >
        {status === 'ready' && mode === 'price' && effectiveType === 'line' && (
          <TimeChart kind="area" data={priceSeries} formatValue={fmt} onHover={setHover} testId="token-price-chart" ariaLabel={t('{symbol} price chart', { symbol })} className="size-full" />
        )}
        {status === 'ready' && mode === 'price' && effectiveType === 'candles' && (
          <TimeChart kind="candles" data={candleData} formatValue={fmt} onHover={setHover} testId="token-candle-chart" ariaLabel={t('{symbol} candlestick chart', { symbol })} className="size-full" />
        )}
        {status === 'ready' && mode === 'volume' && (
          <TimeChart kind="bar" data={volumeSeries} formatValue={fmt} onHover={setHover} testId="token-volume-chart" ariaLabel={t('{symbol} volume chart', { symbol })} className="size-full" />
        )}
        {status === 'ready' && mode === 'tvl' && (
          <TimeChart kind="area" data={tvlSeries} formatValue={fmt} onHover={setHover} testId="token-tvl-chart" ariaLabel={t('{symbol} TVL chart', { symbol })} className="size-full" />
        )}
      </ChartFrame>
    </section>
  )
}
