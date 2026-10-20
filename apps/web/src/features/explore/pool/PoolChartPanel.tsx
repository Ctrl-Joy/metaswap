import { useMemo, useState } from 'react'
import { SegmentedTabs, Skeleton } from '@/components/ui'
import { formatAmount, formatUsd } from '@/lib/format'
import { ChartControls, ChartFrame, type ChartStatus } from '../charts/ChartFrame'
import { TimeChart, type HoverInfo } from '../charts/TimeChart'
import { DepthChart, LiquidityHistogram } from '../charts/SvgCharts'
import { usePoolHistory, usePoolTicks } from '../api'
import { bucketSum, currentPrice, depthCurve, filterRange, liquidityBars, poolSeries, RANGES, RANGE_KEYS, toSeries } from '../transforms'
import type { PoolDetailApi, RangeKey, SeriesPoint } from '../types'

export type PoolChartTab = 'price' | 'volume' | 'liquidity' | 'depth'

const TABS: Array<{ value: PoolChartTab; label: string }> = [
  { value: 'price', label: 'Price' },
  { value: 'volume', label: 'Volume' },
  { value: 'liquidity', label: 'Liquidity' },
  { value: 'depth', label: 'Depth' },
]

/** Pool chart: price, volume and liquidity (V3 tick histogram, V2 TVL line) and V3 depth. */
export function PoolChartPanel({
  pool,
  address,
  invert,
}: {
  pool: PoolDetailApi
  address: string
  invert: boolean
}) {
  const [tab, setTab] = useState<PoolChartTab>('price')
  const [range, setRange] = useState<RangeKey>('1D')
  const isV3 = pool.version === 'v3'
  const cfg = RANGES[range]
  const nowSec = Math.floor(Date.now() / 1000)
  const history = usePoolHistory(address, cfg.poolInterval)
  const ticks = usePoolTicks(address, isV3 && (tab === 'liquidity' || tab === 'depth'))
  const [hover, setHover] = useState<HoverInfo | null>(null)

  const hist = history.data ?? []
  const priceSeries: SeriesPoint[] = useMemo(() => {
    const base = poolSeries(hist, 'token0Price')
    return toSeries(filterRange(base.map((p) => ({ time: p.time, value: p.value })), range, nowSec).map((p) => ({ time: p.time, value: invert ? 1 / p.value : p.value })))
  }, [hist, range, nowSec, invert])
  const volumeSeries: SeriesPoint[] = useMemo(() => bucketSum(filterRange(hist.map((h) => ({ time: h.time, value: h.volumeUsd })), range, nowSec), cfg.bucketSec), [hist, range, nowSec, cfg.bucketSec])
  const tvlSeries: SeriesPoint[] = useMemo(() => filterRange(poolSeries(hist, 'tvlUsd'), range, nowSec), [hist, range, nowSec])

  const bars = useMemo(() => (ticks.data ? liquidityBars(ticks.data, invert) : []), [ticks.data, invert])
  const depth = useMemo(() => (ticks.data ? depthCurve(ticks.data, invert) : []), [ticks.data, invert])
  const curPrice = ticks.data ? currentPrice(ticks.data, invert) : null
  const curIdx = bars.findIndex((b) => b.current)

  const t0 = pool.token0 && typeof pool.token0 === 'object' ? pool.token0.symbol : '?'
  const t1 = pool.token1 && typeof pool.token1 === 'object' ? pool.token1.symbol : '?'
  const [base, quote] = invert ? [t1, t0] : [t0, t1]

  // Status per tab.
  let status: ChartStatus = 'ready'
  if (tab === 'price' || tab === 'volume') {
    if (history.isError && !history.data) status = 'error'
    else if (history.isLoading && !history.data) status = 'loading'
    else if (tab === 'price' ? priceSeries.length < 2 : volumeSeries.length < 1) status = 'empty'
  } else if (tab === 'liquidity') {
    if (!isV3) status = tvlSeries.length >= 2 ? 'ready' : 'empty'
    else if (ticks.isError) status = 'error'
    else if (ticks.isLoading && !ticks.data) status = 'loading'
    else if (bars.length === 0) status = 'empty'
  } else {
    if (!isV3) status = 'empty'
    else if (ticks.isError) status = 'error'
    else if (ticks.isLoading && !ticks.data) status = 'loading'
    else if (depth.length === 0) status = 'empty'
  }

  const headValue = (() => {
    if (hover?.value !== undefined && hover?.value !== null) return hover.value
    if (tab === 'price') return priceSeries.at(-1)?.value ?? null
    if (tab === 'volume') return volumeSeries.at(-1)?.value ?? null
    if (tab === 'liquidity' && !isV3) return tvlSeries.at(-1)?.value ?? null
    return null
  })()
  const headLabel = tab === 'price' ? headValue === null ? null : `1 ${base} = ${formatAmount(headValue)} ${quote}` : tab === 'volume' ? 'Volume' : tab === 'liquidity' ? (isV3 ? 'Liquidity by price' : 'Total value locked') : 'Cumulative depth'

  const showRange = tab === 'price' || tab === 'volume' || (tab === 'liquidity' && !isV3)
  const rangeFooter = showRange ? (
    <SegmentedTabs size="sm" ariaLabel="Chart range" value={range} onChange={setRange} items={RANGE_KEYS.map((r) => ({ value: r, label: RANGES[r].label, testId: `pool-range-${r}` }))} />
  ) : (
    <span className="text-body-3 text-text-2">{isV3 ? 'Snapshot of current liquidity' : 'V2 pools chart TVL history'}</span>
  )

  return (
    <section className="flex flex-col gap-4" data-testid="pool-chart-panel">
      <SegmentedTabs size="md" ariaLabel="Pool chart" value={tab} onChange={(t) => { setTab(t); setHover(null) }} items={TABS.map((t) => ({ value: t.value, label: t.label, testId: `pool-tab-${t.value}` }))} className="flex-wrap" />
      <ChartFrame
        testId="pool-chart"
        status={status}
        fetching={history.isFetching}
        onRetry={() => { void history.refetch(); void ticks.refetch() }}
        emptyTitle={tab === 'depth' && !isV3 ? 'Depth is for v3 pools' : 'Not enough history yet'}
        emptyText={tab === 'depth' && !isV3 ? 'V2 pools hold liquidity across the full curve, so there is no tick depth to show.' : 'Pool history fills in as swaps and liquidity changes are indexed.'}
        heightClass="h-[260px] md:h-[340px]"
        header={
          <div className="flex flex-col gap-0.5">
            <span className="text-heading-3 font-semibold tabular" data-testid="pool-headline">
              {headValue === null ? (tab === 'price' || tab === 'volume' ? <Skeleton width={160} height={28} /> : '-') : tab === 'price' ? `${formatAmount(headValue)} ${quote}` : formatUsd(headValue, { compact: true })}
            </span>
            <span className="text-body-3 text-text-2" data-testid="pool-headline-label">{hover ? new Date(hover.time * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : headLabel ?? <Skeleton width={140} height={16} />}</span>
          </div>
        }
        footer={<ChartControls left={rangeFooter} right={null} />}
      >
        {status === 'ready' && tab === 'price' && <TimeChart kind="line" data={priceSeries} formatValue={(v) => formatAmount(v)} onHover={setHover} testId="pool-price-chart" ariaLabel="Pool price" className="size-full" />}
        {status === 'ready' && tab === 'volume' && <TimeChart kind="bar" data={volumeSeries} formatValue={(v) => formatUsd(v, { compact: true })} onHover={setHover} testId="pool-volume-chart" ariaLabel="Pool volume" className="size-full" />}
        {status === 'ready' && tab === 'liquidity' && isV3 && (
          <div className="flex size-full flex-col gap-2">
            <LiquidityHistogram bars={bars} currentPriceIndex={curIdx >= 0 ? curIdx : null} ariaLabel="Liquidity by price" className="min-h-0 flex-1" />
            <PriceAxis left={bars[0]?.price} right={bars.at(-1)?.price} current={curPrice} base={base} quote={quote} />
          </div>
        )}
        {status === 'ready' && tab === 'liquidity' && !isV3 && <TimeChart kind="area" data={tvlSeries} formatValue={(v) => formatUsd(v, { compact: true })} onHover={setHover} testId="pool-tvl-chart" ariaLabel="Pool TVL" className="size-full" />}
        {status === 'ready' && tab === 'depth' && isV3 && (
          <div className="flex size-full flex-col gap-2">
            <DepthChart points={depth} currentPriceIndex={depth.findIndex((p) => curPrice !== null && p.price >= curPrice)} ariaLabel="Cumulative depth" className="min-h-0 flex-1" />
            <PriceAxis left={depth[0]?.price} right={depth.at(-1)?.price} current={curPrice} base={base} quote={quote} />
          </div>
        )}
      </ChartFrame>
    </section>
  )
}

function PriceAxis({ left, right, current, base, quote }: { left?: number; right?: number; current: number | null; base: string; quote: string }) {
  const fmt = (v?: number) => (v === undefined ? '-' : formatAmount(v))
  return (
    <div className="flex items-center justify-between text-body-4 text-text-2 tabular" data-testid="price-axis">
      <span>{fmt(left)}</span>
      <span className="text-text-1">
        {current !== null ? `Current: 1 ${base} = ${fmt(current)} ${quote}` : ''}
      </span>
      <span>{fmt(right)}</span>
    </div>
  )
}
