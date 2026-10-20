import { useMemo, useState } from 'react'
import { PercentChange, Skeleton, Usd } from '@/components/ui'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ChartFrame, type ChartStatus } from './charts/ChartFrame'
import { TimeChart, type HoverInfo } from './charts/TimeChart'
import { useExploreStatsData } from './api'
import { exploreStatTiles, toSeries } from './transforms'
import type { ExploreStatsRaw } from './types'

/** Date label for a chart readout: "Oct 20, 9:10 PM". */
function dateLabel(sec: number): string {
  return new Date(sec * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Stats strip: 1D volume, Total TVL, V2 TVL, V3 TVL, each with a "% today" delta when history allows. */
export function ExploreStats() {
  const q = useExploreStatsData()
  const tiles = exploreStatTiles(q.data as ExploreStatsRaw | undefined)
  const loading = q.isLoading && !q.data
  return (
    <section aria-label="Explore statistics" className="grid grid-cols-2 gap-y-6 md:grid-cols-4" data-testid="explore-stats">
      {tiles.map((t, i) => (
        <div key={t.key} className={cn('flex min-w-0 flex-col gap-1 px-0 md:px-6', i > 0 && 'md:border-l md:border-border', i % 2 === 1 && 'border-l border-border pl-4 md:pl-6', i % 2 === 0 && 'pr-4 md:pr-6')} data-testid={`stat-${t.key}`}>
          <span className="text-body-3 text-text-2">{t.label}</span>
          {loading ? (
            <Skeleton width={120} height={30} />
          ) : (
            <span className="text-heading-3 font-semibold tabular md:text-heading-2">{formatUsd(t.value, { compact: true })}</span>
          )}
          {t.delta !== null && !loading && (
            <span className="text-body-3">
              <PercentChange value={t.delta} />
              <span className="ml-1 text-text-2">today</span>
            </span>
          )}
        </div>
      ))}
    </section>
  )
}

/** TVL area chart and volume bar chart with a hover crosshair. Short histories show an honest note. */
export function ExploreCharts() {
  const q = useExploreStatsData()
  const stats = q.data as ExploreStatsRaw | undefined
  const tvl = useMemo(() => toSeries((stats?.tvlHistory ?? []).map((p) => ({ time: p.time, value: p.tvlUsd }))), [stats])
  const vol = useMemo(() => toSeries((stats?.volumeHistory ?? []).map((p) => ({ time: p.time, value: p.volumeUsd }))), [stats])
  const [hoverTvl, setHoverTvl] = useState<HoverInfo | null>(null)
  const [hoverVol, setHoverVol] = useState<HoverInfo | null>(null)

  const tvlStatus: ChartStatus = q.isError && !stats ? 'error' : !stats ? 'loading' : tvl.length >= 2 ? 'ready' : 'empty'
  const volStatus: ChartStatus = q.isError && !stats ? 'error' : !stats ? 'loading' : vol.length >= 2 ? 'ready' : 'empty'
  const latestTvl = tvl.at(-1)
  const latestVol = vol.at(-1)
  const shownTvl = hoverTvl?.value ?? latestTvl?.value ?? null
  const shownVol = hoverVol?.value ?? latestVol?.value ?? null
  const note = (n: number) => `History starts at seeding (${n} point${n === 1 ? '' : 's'} so far). The chart fills in as trades happen.`

  return (
    <section aria-label="Explore charts" className="grid gap-6 rounded-2xl border border-border bg-surface-1 p-4 md:grid-cols-2 md:p-6" data-testid="explore-charts">
      <ChartFrame
        testId="tvl-chart-frame"
        status={tvlStatus}
        onRetry={() => q.refetch()}
        emptyTitle="TVL history is still building"
        emptyText={note(tvl.length)}
        header={
          <div className="flex flex-col gap-0.5">
            <span className="text-body-3 text-text-2">Total TVL</span>
            <span className="text-heading-3 font-semibold tabular" data-testid="tvl-readout">
              {shownTvl === null ? '-' : <Usd value={shownTvl} compact />}
            </span>
            <span className="text-body-3 text-text-2">{hoverTvl ? dateLabel(hoverTvl.time) : latestTvl ? dateLabel(latestTvl.time) : 'No history yet'}</span>
          </div>
        }
      >
        {tvlStatus === 'ready' && <TimeChart kind="area" data={tvl} formatValue={(v) => formatUsd(v, { compact: true })} onHover={setHoverTvl} testId="tvl-chart" ariaLabel="Total value locked over time" className="size-full" />}
      </ChartFrame>
      <ChartFrame
        testId="volume-chart-frame"
        status={volStatus}
        onRetry={() => q.refetch()}
        emptyTitle="Volume history is still building"
        emptyText={note(vol.length)}
        header={
          <div className="flex flex-col gap-0.5">
            <span className="text-body-3 text-text-2">Volume (daily)</span>
            <span className="text-heading-3 font-semibold tabular" data-testid="volume-readout">
              {shownVol === null ? '-' : <Usd value={shownVol} compact />}
            </span>
            <span className="text-body-3 text-text-2">{hoverVol ? dateLabel(hoverVol.time) : latestVol ? dateLabel(latestVol.time) : 'No history yet'}</span>
          </div>
        }
      >
        {volStatus === 'ready' && <TimeChart kind="bar" data={vol} formatValue={(v) => formatUsd(v, { compact: true })} onHover={setHoverVol} testId="volume-chart" ariaLabel="Trading volume per day" className="size-full" />}
      </ChartFrame>
    </section>
  )
}
