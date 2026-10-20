import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Flame, LayoutGrid, Plus, Rocket, Sparkles, TrendingUp } from 'lucide-react'
import { ButtonLink, EmptyState, InfoTip, PercentChange, SegmentedTabs, Skeleton, Table, TableSkeleton, Td, Th, THead, Tr } from '@/components/ui'
import { Sparkline } from '@/features/explore/charts/SvgCharts'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useLaunches, useTopVerifiedLaunches, useTrendingLaunches, type LaunchStatusFilter } from './api'
import { launchpadName, sparkValues, type LaunchRow } from './types'
import { Marquee } from '@/components/ui'
import { Countdown, formatAge, LaunchpadChip, LaunchStatusBadge, LaunchTokenLogo, ProgressBar, VerifiedMark, useNow } from './components/LaunchBits'

const auctionHref = (r: LaunchRow) => `/launches/${r.auction}`

/** /launches — banner + ticker, trending carousel, all launches table, live auctions. */
export function LaunchesHome() {
  const all = useLaunches({ status: 'launched', sort: 'volume' })
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-6 pb-24 md:px-8" data-testid="launches-page">
      <LaunchBanner rows={all.data ?? []} loading={all.isLoading} />
      <TrendingCarousel />
      <AllLaunches />
      <Auctions />
    </div>
  )
}

/* ------------------------------------------------------------------ banner + ticker */

function LaunchBanner({ rows, loading }: { rows: LaunchRow[]; loading: boolean }) {
  const items = rows.filter((r) => r.change1d !== undefined && r.change1d !== null).slice(0, 16)
  return (
    <section className="rounded-3xl border border-border bg-surface-1 p-4 md:p-5" data-testid="launch-banner">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-fill text-white">
          <Rocket size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-body-1 font-semibold">Launch and trade</div>
          <div className="text-body-3 text-text-2">Raise liquidity for a new token with a fair batch auction, then trade it on MetaSwap.</div>
        </div>
        <Link to="/launches/create" aria-label="Launch a token" data-testid="banner-create" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-1 hover:bg-surface-3-hover">
          <ArrowRight size={20} />
        </Link>
      </div>
      <div className="mt-4 [mask-image:linear-gradient(90deg,transparent,black_4%,black_96%,transparent)]">
        {loading ? (
          <Skeleton width="100%" height={36} rounded="full" />
        ) : items.length === 0 ? (
          <div className="py-2 text-body-3 text-text-3" data-testid="launch-ticker">No launched tokens yet. Be the first.</div>
        ) : (
          <Marquee testId="launch-ticker" ariaLabel="Launched tokens ticker" speed={35}>
            {items.map((r) => (
              <Link key={r.auction} to={auctionHref(r)} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pr-3 pl-1 text-body-3 hover:bg-surface-2-hover">
                <LaunchTokenLogo row={r} size={24} />
                <span className="font-semibold">{r.name}</span>
                <PercentChange value={r.change1d} />
              </Link>
            ))}
          </Marquee>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ trending carousel */

function TrendingCarousel() {
  const q = useTrendingLaunches()
  const rows = q.data ?? []
  return (
    <section className="mt-8" data-testid="trending-launches">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-heading-3 font-semibold">
          Trending launches <InfoTip content="Launched tokens ranked by 24h trading volume." />
        </h2>
      </div>
      {q.isLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} width={260} height={132} rounded="lg" className="shrink-0" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="w-full rounded-2xl border border-border p-6 text-center text-body-3 text-text-2">{q.isError ? 'Launches are unavailable right now.' : 'No trending launches yet.'}</div>
      ) : (
        <Marquee arrows itemGap={12} speed={30} ariaLabel="Trending launches" testId="trending-strip">
          {rows.map((r) => <TrendingCard key={r.auction} row={r} />)}
        </Marquee>
      )}
    </section>
  )
}

function TrendingCard({ row }: { row: LaunchRow }) {
  const spark = sparkValues(row)
  return (
    <Link to={auctionHref(row)} className="flex w-[260px] flex-col gap-3 rounded-2xl border border-border bg-surface-1 p-4 hover:bg-surface-2" data-testid={`trending-card-${row.symbol}`}>
      <div className="flex items-start gap-2.5">
        <LaunchTokenLogo row={row} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-2 font-semibold">{row.name}</div>
          <div className="text-body-4 text-text-2">{row.symbol}</div>
        </div>
        <Sparkline values={spark} width={84} height={32} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-body-1 font-semibold tabular">{formatUsd(row.fdvUsd, { compact: true })}</span>
        <span className="text-body-4 text-text-2">FDV</span>
        <PercentChange value={row.change1d} className="text-body-4" />
      </div>
      <div className="flex items-center justify-between text-body-4 text-text-2">
        <span>
          <span className="font-semibold text-text-1 tabular">{formatUsd(row.volume24hUsd, { compact: true })}</span> 24H volume
        </span>
        <LaunchpadChip name={launchpadName(row)} />
      </div>
    </Link>
  )
}

/* ------------------------------------------------------------------ all launches table */

type ListMode = 'all' | 'recent' | 'trending'

function useLaunchpadFilter() {
  const [params, setParams] = useSearchParams()
  const launchpad = params.get('launchpad') ?? ''
  const set = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('launchpad', v)
    else next.delete('launchpad')
    setParams(next, { replace: true })
  }
  return [launchpad, set] as const
}

function AllLaunches() {
  const [mode, setMode] = useState<ListMode>('all')
  const [launchpad, setLaunchpad] = useLaunchpadFilter()
  const q = useLaunches({ status: 'launched', sort: mode === 'recent' ? 'age' : 'volume', launchpad: launchpad || undefined })
  const pads = usePadNames()
  const navigate = useNavigate()
  const rows = useMemo(() => {
    let r = q.data ?? []
    if (mode === 'recent') r = [...r].sort((a, b) => (a.ageSec ?? Infinity) - (b.ageSec ?? Infinity))
    if (mode === 'trending') r = [...r].sort((a, b) => (b.volume24hUsd ?? 0) * Math.abs(b.change1d ?? 0) - (a.volume24hUsd ?? 0) * Math.abs(a.change1d ?? 0))
    if (launchpad) r = r.filter((x) => launchpadName(x) === launchpad)
    return r
  }, [q.data, mode, launchpad])
  return (
    <section className="mt-10" data-testid="all-launches">
      <h2 className="mb-3 text-heading-3 font-semibold">All launches</h2>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedTabs
          size="sm"
          ariaLabel="Launch list"
          value={mode}
          onChange={setMode}
          items={[
            { value: 'all', label: <span className="inline-flex items-center gap-1"><LayoutGrid size={14} />All</span>, testId: 'launches-mode-all' },
            { value: 'recent', label: <span className="inline-flex items-center gap-1"><Sparkles size={14} />Recently launched</span>, testId: 'launches-mode-recent' },
            { value: 'trending', label: <span className="inline-flex items-center gap-1"><TrendingUp size={14} />Trending</span>, testId: 'launches-mode-trending' },
          ]}
        />
        <select
          value={launchpad}
          onChange={(e) => setLaunchpad(e.target.value)}
          aria-label="Launchpad"
          data-testid="launchpad-filter"
          className="h-9 rounded-full border border-border bg-surface-1 px-3 text-body-3 font-semibold text-text-1"
        >
          <option value="">All launchpads</option>
          {pads.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <Table minWidth={860}>
        <THead>
          <Th className="w-10">#</Th>
          <Th>Token</Th>
          <Th>Launchpad</Th>
          <Th align="right">FDV</Th>
          <Th align="right">24H volume</Th>
          <Th align="right">Liquidity</Th>
          <Th align="right">1H</Th>
          <Th align="right">1D</Th>
          <Th align="right">Age</Th>
        </THead>
        {q.isLoading ? (
          <TableSkeleton rows={5} cols={9} />
        ) : (
          <tbody>
            {rows.map((r, i) => (
              <Tr key={r.auction} onClick={() => navigate(auctionHref(r))} data-testid={`launch-row-${r.symbol}`}>
                <Td className="text-text-2">{i + 1}</Td>
                <Td>
                  <Link to={auctionHref(r)} className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                    <LaunchTokenLogo row={r} size={28} />
                    <span>
                      <span className="flex items-center gap-1 font-semibold">
                        {r.name} <VerifiedMark verified={r.verified} />
                      </span>
                      <span className="block text-body-4 text-text-2">{r.symbol}</span>
                    </span>
                  </Link>
                </Td>
                <Td>
                  <LaunchpadChip name={launchpadName(r)} />
                </Td>
                <Td align="right">{formatUsd(r.fdvUsd, { compact: true })}</Td>
                <Td align="right">{formatUsd(r.volume24hUsd, { compact: true })}</Td>
                <Td align="right">{formatUsd(r.liquidityUsd, { compact: true })}</Td>
                <Td align="right">
                  <PercentChange value={r.change1h} />
                </Td>
                <Td align="right">
                  <PercentChange value={r.change1d} />
                </Td>
                <Td align="right" className="text-text-2">
                  {formatAge(r.ageSec)}
                </Td>
              </Tr>
            ))}
          </tbody>
        )}
      </Table>
      {!q.isLoading && rows.length === 0 && (
        <EmptyState icon={<Rocket size={20} />} title={q.isError ? 'Launches unavailable' : 'No launches yet'} action={<ButtonLink to="/launches/create">Launch a token</ButtonLink>}>
          {q.isError ? 'The MetaSwap API is not reachable.' : 'Graduated launches show up here with their pool stats.'}
        </EmptyState>
      )}
    </section>
  )
}

function usePadNames(): string[] {
  const q = useLaunches({ status: 'all' })
  return useMemo(() => [...new Set((q.data ?? []).map(launchpadName).filter(Boolean))].sort(), [q.data])
}

/* ------------------------------------------------------------------ auctions */

function Auctions() {
  const [status, setStatus] = useState<LaunchStatusFilter | 'verified'>('active')
  const q = useLaunches({ status: status === 'verified' ? 'all' : status, verified: status === 'verified' ? true : undefined, sort: 'bidVolume' })
  const top = useTopVerifiedLaunches()
  const navigate = useNavigate()
  const now = useNow(5000)
  const rows = q.data ?? []
  return (
    <section className="mt-10" data-testid="auctions">
      {(top.data?.length ?? 0) > 0 && (
        <>
          <h2 className="mb-3 flex items-center gap-1.5 text-heading-3 font-semibold">
            Top verified auctions <InfoTip content="Auctions verified by their launchpad." />
          </h2>
          <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {top.data!.map((r) => (
              <Link key={r.auction} to={auctionHref(r)} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-1 p-4 hover:bg-surface-2" data-testid={`verified-card-${r.symbol}`}>
                <div className="flex items-center gap-2.5">
                  <LaunchTokenLogo row={r} size={32} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 truncate text-body-2 font-semibold">
                      {r.name} <VerifiedMark verified />
                    </div>
                    <div className="text-body-4 text-text-2">{r.symbol}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-body-4 text-text-2">
                  <span>
                    FDV
                    <span className="block text-body-2 font-semibold text-text-1 tabular">{formatUsd(r.fdvUsd ?? r.fdvAtFloorUsd, { compact: true })}</span>
                  </span>
                  <span>
                    Bid volume
                    <span className="block text-body-2 font-semibold text-text-1 tabular">{formatUsd(r.bidVolumeUsd, { compact: true })}</span>
                  </span>
                </div>
                <StatusCell row={r} now={now} />
              </Link>
            ))}
          </div>
        </>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading-3 font-semibold">Auctions</h2>
        <ButtonLink to="/launches/create" size="sm" variant="secondary" data-testid="launch-auction">
          <Plus size={16} /> Launch auction
        </ButtonLink>
      </div>
      <SegmentedTabs
        size="sm"
        className="mb-3"
        ariaLabel="Auction status"
        value={status}
        onChange={setStatus}
        items={[
          { value: 'active', label: <span className="inline-flex items-center gap-1"><Flame size={14} />Live</span>, testId: 'auctions-active' },
          { value: 'upcoming', label: 'Starting soon', testId: 'auctions-upcoming' },
          { value: 'verified', label: 'Verified', testId: 'auctions-verified' },
          { value: 'launched', label: 'Launched', testId: 'auctions-launched' },
          { value: 'failed', label: 'Failed', testId: 'auctions-failed' },
          { value: 'all', label: 'All', testId: 'auctions-all' },
        ]}
      />
      <Table minWidth={760}>
        <THead>
          <Th>Token</Th>
          <Th align="right">FDV at floor</Th>
          <Th align="right">Bid volume</Th>
          <Th align="right">Launch threshold</Th>
          <Th align="right">Status</Th>
        </THead>
        {q.isLoading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (
          <tbody>
            {rows.map((r) => (
              <Tr key={r.auction} onClick={() => navigate(auctionHref(r))} data-testid={`auction-row-${r.symbol}`}>
                <Td>
                  <span className="flex items-center gap-2.5">
                    <LaunchTokenLogo row={r} size={28} />
                    <span className="font-semibold">{r.name}</span>
                    <span className="text-text-2">{r.symbol}</span>
                    <VerifiedMark verified={r.verified} />
                  </span>
                </Td>
                <Td align="right">{formatUsd(r.fdvAtFloorUsd, { compact: true })}</Td>
                <Td align="right">{r.bidVolumeUsd ? formatUsd(r.bidVolumeUsd, { compact: true }) : '-'}</Td>
                <Td align="right">
                  <span className="block">{formatUsd(r.thresholdUsd, { compact: true })}</span>
                  <span className="block text-body-4 text-text-2">{(r.thresholdPct ?? 0).toFixed(2)}% met</span>
                </Td>
                <Td align="right" className="w-48">
                  <StatusCell row={r} now={now} />
                </Td>
              </Tr>
            ))}
          </tbody>
        )}
      </Table>
      {!q.isLoading && rows.length === 0 && (
        <EmptyState icon={<Rocket size={20} />} title={q.isError ? 'Auctions unavailable' : 'No auctions here'}>
          {q.isError ? 'The MetaSwap API is not reachable.' : 'Try another status, or launch your own token.'}
        </EmptyState>
      )}
    </section>
  )
}

function StatusCell({ row, now }: { row: LaunchRow; now: number }) {
  if (row.status === 'active') {
    const total = Math.max(1, row.endTime - row.startTime)
    const elapsed = ((now - row.startTime) / total) * 100
    return (
      <span className="flex flex-col items-end gap-1">
        <ProgressBar value={elapsed} className="w-24" />
        <Countdown to={row.endTime} className="text-body-4 text-text-2" />
      </span>
    )
  }
  if (row.status === 'upcoming')
    return (
      <span className="flex flex-col items-end">
        <span className="font-semibold">Starting soon</span>
        <Countdown to={row.startTime} className="text-body-4 text-text-2" />
      </span>
    )
  return (
    <span className={cn('flex justify-end')}>
      <LaunchStatusBadge status={row.status} />
    </span>
  )
}
