import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BadgeCheck, Plus, Search, Sparkles, Rocket, CheckCircle2 } from 'lucide-react'
import { Badge, buttonClass, Card, Skeleton, TokenLogo, Usd } from '@/components/ui'
import { ExSortTh, ExTableSkeleton, ExTd, ExTh, ExTHead, ExTr, ExTable } from '../ExploreTable'
import { formatDuration, formatPercent } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useNow, ApiErrorState } from '../ExploreStates'
import { useAuctions } from '../discoveryApi'
import { auctionSecondsLeft, auctionTimeProgress, filterAuctions, type AuctionChip, type AuctionRow, type AuctionStatus } from '../discovery'
import { sortRows, type SortDir } from '../transforms'

const CHIPS: Array<{ value: AuctionChip; label: string; icon: typeof BadgeCheck }> = [
  { value: 'all', label: 'All', icon: Sparkles },
  { value: 'verified', label: 'Verified', icon: BadgeCheck },
  { value: 'new', label: 'New', icon: Sparkles },
  { value: 'launched', label: 'Launched', icon: Rocket },
]

const STATUS_OPTIONS: Array<{ value: AuctionStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'live', label: 'Live' },
  { value: 'starting', label: 'Starting soon' },
  { value: 'launched', label: 'Launched' },
  { value: 'failed', label: 'Failed' },
]

/** Share of the auction that is done: threshold progress when reported, otherwise the elapsed time. */
function progressOf(a: AuctionRow, now: number): number | null {
  if (a.thresholdMetPct !== null) return Math.min(100, Math.max(0, a.thresholdMetPct))
  return auctionTimeProgress(a, now)
}

function ProgressBar({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value)}>
      <div className="h-full rounded-full bg-accent-fill transition-[width] duration-500" style={{ width: `${value ?? 0}%` }} />
    </div>
  )
}

/** Status cell: progress bar and countdown while live, "Starting soon", "Launched" or "Failed". */
function StatusCell({ a, now }: { a: AuctionRow; now: number }) {
  if (a.status === 'launched') return <Badge tone="success">Launched</Badge>
  if (a.status === 'failed') return <Badge tone="critical">Failed</Badge>
  if (a.status === 'starting') {
    const left = a.startsAtMs === null ? null : Math.max(0, Math.floor((a.startsAtMs - now) / 1000))
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-body-2 font-semibold text-text-1">Starting soon</span>
        {left !== null && <span className="text-body-4 tabular text-text-2">{formatDuration(left)}</span>}
      </div>
    )
  }
  const left = auctionSecondsLeft(a, now)
  return (
    <div className="flex w-[140px] flex-col items-end gap-1">
      <ProgressBar value={progressOf(a, now)} />
      <span className="text-body-4 tabular text-text-2">{left === null ? 'Live' : formatDuration(left)}</span>
    </div>
  )
}

function VerifiedMark({ verified }: { verified: boolean }) {
  if (!verified) return null
  return <BadgeCheck size={15} className="shrink-0 text-accent" aria-label="Verified" />
}

/** Top verified auctions: four cards by bid volume. */
function TopAuctions({ rows, now }: { rows: AuctionRow[]; now: number }) {
  const navigate = useNavigate()
  const top = rows.filter((r) => r.verified).sort((a, b) => (b.bidVolumeUsd ?? 0) - (a.bidVolumeUsd ?? 0)).slice(0, 4)
  if (top.length === 0) return null
  return (
    <section aria-label="Top verified auctions" className="flex flex-col gap-4" data-testid="top-auctions">
      <h2 className="flex items-center gap-2 text-heading-3 font-semibold">Top verified auctions</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {top.map((a) => (
          <Card
            key={a.id}
            role="link"
            tabIndex={0}
            data-testid="top-auction-card"
            onClick={() => navigate(`/launches/${encodeURIComponent(a.id)}`)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(`/launches/${encodeURIComponent(a.id)}`)}
            className="flex cursor-pointer flex-col gap-4 p-4 transition-colors hover:bg-surface-1-hover focus-visible:ring-2 focus-visible:ring-focus"
          >
            <div className="flex items-center gap-3">
              <TokenLogo token={{ symbol: a.symbol, logoURI: a.logoURI ?? undefined }} size={36} />
              <div className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 truncate font-semibold text-text-1">
                  <span className="truncate">{a.name}</span>
                  <VerifiedMark verified={a.verified} />
                </span>
                <span className="text-body-3 text-text-2">{a.symbol}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-body-3">
              <div className="flex flex-col">
                <span className="text-text-2">FDV</span>
                <Usd value={a.fdvAtFloorUsd} compact className="text-body-1 font-semibold" />
              </div>
              <div className="flex flex-col">
                <span className="text-text-2">Bid volume</span>
                <Usd value={a.bidVolumeUsd} compact className="text-body-1 font-semibold" />
              </div>
            </div>
            {a.status === 'launched' ? (
              <span className="text-body-3 font-semibold text-success">Launched</span>
            ) : a.status === 'failed' ? (
              <span className="text-body-3 font-semibold text-critical">Failed</span>
            ) : (
              <div className="flex flex-col gap-1.5">
                <ProgressBar value={progressOf(a, now)} />
                <span className="text-body-4 tabular text-text-2">{a.status === 'starting' ? 'Starting soon' : auctionSecondsLeft(a, now) === null ? 'Live' : formatDuration(auctionSecondsLeft(a, now)!)}</span>
              </div>
            )}
          </Card>
        ))}
      </div>
    </section>
  )
}

/** Auctions tab: top verified cards, filters, the launch button, and the auctions table. */
export function AuctionsSection() {
  const q = useAuctions()
  const now = useNow(1000)
  const navigate = useNavigate()
  const [chip, setChip] = useState<AuctionChip>('all')
  const [status, setStatus] = useState<AuctionStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: 'fdv' | 'bid' | 'threshold'; dir: SortDir }>({ key: 'bid', dir: 'desc' })
  const rows = q.data ?? []

  const visible = useMemo(() => {
    const filtered = filterAuctions(rows, chip, status, query)
    const getter = {
      fdv: (a: AuctionRow) => a.fdvAtFloorUsd,
      bid: (a: AuctionRow) => a.bidVolumeUsd,
      threshold: (a: AuctionRow) => a.thresholdMetPct,
    }[sort.key]
    return sortRows(filtered, getter, sort.dir)
  }, [rows, chip, status, query, sort])

  const toggle = (key: 'fdv' | 'bid' | 'threshold') => setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  const launchButton = (
    <Link to="/launches/create" className={buttonClass({ variant: 'primary', size: 'md' })} data-testid="launch-auction">
      <Plus size={16} aria-hidden /> Launch auction
    </Link>
  )

  if (q.isError && !q.data) return <ApiErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load auctions" />

  return (
    <div className="flex flex-col gap-8" data-testid="auctions-section">
      {q.isLoading && !q.data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} width="100%" height={170} rounded="lg" className="!rounded-2xl" />
          ))}
        </div>
      ) : (
        <TopAuctions rows={rows} now={now} />
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-heading-3 font-semibold">Auctions</h2>
          <div className="flex flex-wrap items-center gap-2">
            {launchButton}
            <label className="relative flex items-center">
              <span className="sr-only">Status</span>
              <select
                data-testid="auction-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as AuctionStatus | 'all')}
                className="h-9 rounded-full border border-border bg-surface-1 pr-8 pl-3 text-body-3 font-semibold text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="relative flex w-[180px] items-center sm:w-[220px]">
              <Search size={16} className="pointer-events-none absolute left-3 text-text-3" aria-hidden />
              <span className="sr-only">Search auctions</span>
              <input
                data-testid="auction-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search auctions"
                className="h-9 w-full rounded-full border border-border bg-surface-1 pr-3 pl-9 text-body-3 text-text-1 outline-none placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
          </div>
        </div>

        <div role="tablist" aria-label="Auction filters" className="flex flex-wrap items-center gap-1">
          {CHIPS.map((c) => {
            const Icon = c.icon
            const active = chip === c.value
            return (
              <button
                key={c.value}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`auction-chip-${c.value}`}
                onClick={() => setChip(c.value)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-body-3 font-semibold transition-colors duration-150',
                  active ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:bg-surface-2-hover hover:text-text-1',
                )}
              >
                <Icon size={14} aria-hidden />
                {c.label}
              </button>
            )
          })}
        </div>

        <ExTable minWidth={820}>
          <ExTHead>
            <ExTh>Token</ExTh>
            <ExSortTh label="FDV at floor" active={sort.key === 'fdv'} direction={sort.dir} onClick={() => toggle('fdv')} />
            <ExSortTh label="Bid volume" active={sort.key === 'bid'} direction={sort.dir} onClick={() => toggle('bid')} />
            <ExSortTh label="Launch threshold" active={sort.key === 'threshold'} direction={sort.dir} onClick={() => toggle('threshold')} />
            <ExTh align="right">Status</ExTh>
          </ExTHead>
          {q.isLoading && !q.data ? (
            <ExTableSkeleton rows={6} cols={5} />
          ) : visible.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center" data-testid="auctions-empty">
                  <div className="flex flex-col items-center gap-3">
                    <CheckCircle2 size={22} className="text-text-3" aria-hidden />
                    <span className="text-body-1 font-semibold text-text-1">{rows.length ? 'No auctions match these filters' : 'No auctions yet'}</span>
                    <span className="max-w-sm text-body-3 text-text-2">Launch a token with a fair-price auction. Bids decide the price, and the token launches once the threshold is met.</span>
                    <button type="button" onClick={() => navigate('/launches/create')} className={buttonClass({ variant: 'tint', size: 'sm' })}>
                      Launch auction
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {visible.map((a) => (
                <ExTr key={a.id} className="group" onClick={() => navigate(`/launches/${encodeURIComponent(a.id)}`)} data-testid="auction-row" data-auction={a.id}>
                  <ExTd>
                    <span className="flex items-center gap-3">
                      <TokenLogo token={{ symbol: a.symbol, logoURI: a.logoURI ?? undefined }} size={28} />
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-semibold text-text-1">{a.name}</span>
                        <span className="text-body-3 text-text-2">{a.symbol}</span>
                        <VerifiedMark verified={a.verified} />
                      </span>
                    </span>
                  </ExTd>
                  <ExTd align="right">
                    <Usd value={a.fdvAtFloorUsd} compact />
                  </ExTd>
                  <ExTd align="right">{a.bidVolumeUsd === null ? <span className="text-text-3">-</span> : <Usd value={a.bidVolumeUsd} compact />}</ExTd>
                  <ExTd align="right">
                    {a.thresholdUsd === null ? (
                      <span className="text-text-3">-</span>
                    ) : (
                      <div className="flex flex-col items-end">
                        <Usd value={a.thresholdUsd} compact className="font-semibold" />
                        <span className="text-body-4 text-text-2">{a.thresholdMetPct === null ? '-' : `${formatPercent(a.thresholdMetPct, { digits: 2 })} met`}</span>
                      </div>
                    )}
                  </ExTd>
                  <ExTd align="right">
                    <StatusCell a={a} now={now} />
                  </ExTd>
                </ExTr>
              ))}
            </tbody>
          )}
        </ExTable>
      </section>
    </div>
  )
}
