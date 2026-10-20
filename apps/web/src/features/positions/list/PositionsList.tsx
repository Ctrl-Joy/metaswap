import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowRight, ChevronRight, Droplet, Layers, Plus } from 'lucide-react'
import type { Address } from 'viem'
import { Banner, ButtonLink, Card, DoubleLogo, EmptyState, SegmentedTabs, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useWallet } from '@/wallet/hooks'
import { useUi } from '@/state/ui'
import { formatPercent, formatUsd } from '@/lib/format'
import { useAccountPositionsData, useAllPools, usePoolDetails, type AnyPositionRow, type ExplorePoolRowW3, type PoolDetail } from '../api'
import { feeLabel } from '../tokens'
import { isFullRange, tickSpacingForFee } from '../math'
import { positionStatus, StatusBadge, type PositionStatus } from '../components/StatusBadge'
import { formatDisplayPrice } from '../components/RangeSelector'

type StatusFilter = 'open' | 'in-range' | 'out-of-range' | 'closed' | 'all'
type VersionFilter = 'all' | 'v3' | 'v2'

export function PositionsList() {
  const { address } = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as StatusFilter | null) ?? 'open'
  const version = (params.get('version') as VersionFilter | null) ?? 'all'
  const setFilter = (k: string, v: string, dflt: string) => {
    const next = new URLSearchParams(params)
    if (v === dflt) next.delete(k)
    else next.set(k, v)
    setParams(next, { replace: true })
  }

  return (
    <div className="relative" data-testid="positions-page">
      {/* Uniswap's dotted backdrop behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[290px] opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, var(--ms-surface-3) 1px, transparent 0)', backgroundSize: '12px 12px' }}
      />
      <div className="relative mx-auto w-full max-w-[1184px] px-4 pt-6 pb-24 md:px-8 md:pt-8">
        <h1 className="text-heading-3 font-medium md:text-[36px] md:leading-10">Supply liquidity to collect fees</h1>
        <p className="mt-2 text-body-2 text-text-2 md:text-body-1">Provide liquidity to MetaSwap V2 and V3 pools and earn fees on every trade.</p>
        <div className="mt-8 flex flex-wrap gap-2">
          <ButtonLink to="/positions/create" data-testid="new-position" className="h-[46px]! rounded-2xl! px-4! text-body-2!">
            <Droplet size={18} className="fill-current" /> Create position
          </ButtonLink>
          <ButtonLink to="/positions/create?version=v2" variant="tint" className="h-[46px]! rounded-2xl! px-4! text-body-2!" data-testid="create-pool">
            <Plus size={20} /> Create pool
          </ButtonLink>
          <ButtonLink to="/launches/create" variant="tint" className="h-[46px]! rounded-2xl! px-4! text-body-2!" data-testid="launch-token">
            <Plus size={20} /> Launch token
          </ButtonLink>
        </div>

        {!address ? (
          <>
            <div className="relative mt-14 flex min-h-[180px] flex-col items-center justify-center overflow-hidden rounded-[20px] bg-accent-tint px-6 py-8 text-center" data-testid="positions-gate">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-40"
                style={{ backgroundImage: 'linear-gradient(var(--ms-accent-tint) 1px, transparent 1px), linear-gradient(90deg, var(--ms-accent-tint) 1px, transparent 1px)', backgroundSize: '32px 32px' }}
              />
              <h2 className="relative text-heading-3 font-medium">Connect your wallet</h2>
              <p className="relative mt-2 text-body-2 text-text-2">To view your positions and rewards you must connect your wallet.</p>
              <button
                type="button"
                onClick={openConnect}
                data-testid="positions-connect"
                className="relative mt-6 inline-flex h-[34px] items-center gap-2 rounded-full bg-surface-3 px-3 text-body-3 font-semibold transition-colors hover:bg-surface-3-hover"
              >
                Connect wallet
              </button>
            </div>
            <TopPoolsTable />
          </>
        ) : (
          <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_360px]">
            <div className="min-w-0">
              <h2 className="mb-4 text-body-1 font-medium">Your positions</h2>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <SegmentedTabs
                  size="sm"
                  ariaLabel="Status filter"
                  value={status}
                  onChange={(v) => setFilter('status', v, 'open')}
                  items={[
                    { value: 'open', label: 'Open', testId: 'filter-status-open' },
                    { value: 'in-range', label: 'In range', testId: 'filter-status-in-range' },
                    { value: 'out-of-range', label: 'Out of range', testId: 'filter-status-out-of-range' },
                    { value: 'closed', label: 'Closed', testId: 'filter-status-closed' },
                    { value: 'all', label: 'All', testId: 'filter-status-all' },
                  ]}
                />
                <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
                <SegmentedTabs
                  size="sm"
                  ariaLabel="Version filter"
                  value={version}
                  onChange={(v) => setFilter('version', v, 'all')}
                  items={[
                    { value: 'all', label: 'All versions', testId: 'filter-version-all' },
                    { value: 'v3', label: 'v3', testId: 'filter-version-v3' },
                    { value: 'v2', label: 'v2', testId: 'filter-version-v2' },
                  ]}
                />
              </div>
              <AccountPositions address={address} status={status} version={version} />
            </div>
            <TopPools />
          </div>
        )}
      </div>
    </div>
  )
}

function poolHref(row: ExplorePoolRowW3) {
  const t0 = typeof row.token0 === 'string' ? undefined : row.token0
  const t1 = typeof row.token1 === 'string' ? undefined : row.token1
  const a = t0?.symbol === 'WETH' ? 'ETH' : (t0?.address ?? '')
  const b = t1?.symbol === 'WETH' ? 'ETH' : (t1?.address ?? '')
  return `/positions/create?currencyA=${a}&currencyB=${b}${row.version === 'v2' ? '&version=v2' : `&fee=${row.fee}`}`
}

/** Signed-out "Top pools" table (Uniswap /positions): #, Pool, TVL, 1D vol, 7D vol, 1D vol/TVL, Pool APR. */
function TopPoolsTable() {
  const q = useAllPools()
  const rows = (q.data ?? []).slice(0, 10)
  const cols = 'grid grid-cols-[28px_minmax(0,1fr)_88px] md:grid-cols-[52px_minmax(0,1fr)_repeat(5,minmax(0,140px))] items-center gap-x-3 px-4 md:px-5'
  return (
    <section className="mt-10" data-testid="top-pools" aria-labelledby="top-pools-title">
      <h2 id="top-pools-title" className="mb-4 text-body-1 font-medium">
        Top pools
      </h2>
      <div className="overflow-hidden rounded-xl">
        <div className={cn(cols, 'h-[54px] rounded-xl bg-surface-2 text-body-3 text-text-2')}>
          <span>#</span>
          <span>Pool</span>
          <span className="text-right">TVL</span>
          <span className="hidden text-right text-text-1 md:block">
            <ArrowDown size={14} className="mr-0.5 inline align-[-2px]" />
            1D vol
          </span>
          <span className="hidden text-right md:block">7D vol</span>
          <span className="hidden text-right md:block">1D vol/TVL</span>
          <span className="hidden text-right md:block">Pool APR</span>
        </div>
        {q.isLoading ? (
          <div className="flex flex-col gap-2 pt-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} width="100%" height={56} rounded="lg" />
            ))}
          </div>
        ) : q.isError ? (
          <p className="px-5 py-6 text-body-3 text-text-2">Pools unavailable.</p>
        ) : (
          [...rows]
            .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
            .map((r, i) => {
              const t0 = typeof r.token0 === 'string' ? undefined : r.token0
              const t1 = typeof r.token1 === 'string' ? undefined : r.token1
              return (
                <Link key={r.address} to={poolHref(r)} className={cn(cols, 'min-h-16 rounded-xl py-2 text-body-2 transition-colors hover:bg-surface-1-hover')} data-testid={`top-pool-${r.address}`}>
                  <span className="pl-1.5 tabular">{i + 1}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <DoubleLogo token0={t0} token1={t1} size={24} />
                    <span className="min-w-0">
                      <span className="block truncate leading-[22px]">
                        {t0?.symbol}/{t1?.symbol}
                      </span>
                      <span className="block text-body-3 whitespace-nowrap text-text-2">
                        {r.version} · {feeLabel(r.fee)}
                      </span>
                    </span>
                  </span>
                  <span className="text-right tabular">{formatUsd(r.tvlUsd, { compact: true })}</span>
                  <span className="hidden text-right tabular md:block">{formatUsd(r.volume24hUsd, { compact: true })}</span>
                  <span className="hidden text-right tabular md:block">{formatUsd(r.volume7dUsd, { compact: true })}</span>
                  <span className="hidden text-right tabular md:block">{r.tvlUsd ? (r.volume24hUsd / r.tvlUsd).toFixed(2) : '-'}</span>
                  <span className="hidden text-right tabular md:block">{formatPercent(r.apr)}</span>
                </Link>
              )
            })
        )}
      </div>
      <ButtonLink to="/explore/pools" variant="outline" size="sm" className="mt-4 h-8! rounded-full! px-3!" data-testid="see-all-pools">
        See all pools <ArrowRight size={16} />
      </ButtonLink>
    </section>
  )
}

function matchesStatus(s: PositionStatus, f: StatusFilter) {
  if (f === 'all') return true
  if (f === 'open') return s !== 'closed'
  return s === f
}

function AccountPositions({ address, status, version }: { address: Address; status: StatusFilter; version: VersionFilter }) {
  const q = useAccountPositionsData(address)
  const rows: AnyPositionRow[] = useMemo(() => [...(q.data?.v3 ?? []), ...(q.data?.v2 ?? [])], [q.data])
  const pools = useMemo(() => [...new Set(rows.map((r) => r.pool))], [rows])
  const details = usePoolDetails(pools)
  const detailBy = useMemo(() => {
    const m: Record<string, PoolDetail> = {}
    details.forEach((d, i) => {
      if (d.data) m[pools[i]!.toLowerCase()] = d.data
    })
    return m
  }, [details, pools])

  if (q.isLoading)
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width="100%" height={112} rounded="lg" />
        ))}
      </div>
    )
  if (q.isError)
    return (
      <Banner tone="critical" title="Positions unavailable">
        The MetaSwap API is not reachable, so positions can't be listed right now.
      </Banner>
    )
  const filtered = rows.filter((r) => matchesStatus(positionStatus(r), status) && (version === 'all' || r.version === version))
  if (filtered.length === 0)
    return (
      <Card>
        <EmptyState
          icon={<Layers size={22} />}
          title={rows.length === 0 ? 'No positions yet' : 'No positions match these filters'}
          action={
            <ButtonLink to="/positions/create" data-testid="empty-new-position">
              New position
            </ButtonLink>
          }
        >
          {rows.length === 0 ? 'Open a new position or add liquidity to a pool to start earning fees.' : 'Change the status or version filter to see your other positions.'}
        </EmptyState>
      </Card>
    )
  return (
    <ul className="flex flex-col gap-3" data-testid="positions-list">
      {filtered.map((r) => (
        <li key={r.version === 'v3' ? `v3-${r.tokenId}` : `v2-${r.pair}`}>
          <PositionCard row={r} pool={detailBy[r.pool.toLowerCase()]} />
        </li>
      ))}
    </ul>
  )
}

/** Fee APR of a position from the pool's 24h fees and the position's share of active liquidity. */
export function positionApr(row: AnyPositionRow, pool: PoolDetail | undefined): number | null {
  if (!pool || !row.valueUsd || pool.fees24hUsd == null) return null
  const s = positionStatus(row)
  if (s !== 'in-range') return 0
  if (row.version === 'v2') return pool.apr ?? null
  const active = Number(pool.liquidity ?? 0)
  if (!active) return null
  const share = Number(row.liquidity) / active
  return ((pool.fees24hUsd * 365 * share) / row.valueUsd) * 100
}

function PositionCard({ row, pool }: { row: AnyPositionRow; pool?: PoolDetail }) {
  const status = positionStatus(row)
  const href = row.version === 'v3' ? `/positions/v3/${row.tokenId}` : `/positions/v2/${row.pair}`
  const fees = row.version === 'v3' ? row.uncollectedFees.valueUsd : null
  const apr = positionApr(row, pool)
  const full = row.version === 'v2' || isFullRange(row.tickLower, row.tickUpper, tickSpacingForFee(row.fee))
  const id = row.version === 'v3' ? row.tokenId : row.pair
  return (
    <Link
      to={href}
      data-testid={`position-card-${row.version}-${id}`}
      className="flex flex-col gap-4 rounded-[20px] border border-border bg-surface-1 p-4 transition-colors hover:bg-surface-1-hover sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <DoubleLogo token0={row.token0} token1={row.token1} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-1 font-medium">
              {row.token0.symbol} / {row.token1.symbol}
            </span>
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-body-4 font-semibold text-text-2">
              {row.version} · {feeLabel(row.fee)}
            </span>
            <StatusBadge status={status} testId={`position-status-${row.version}-${id}`} />
          </div>
          <div className="mt-0.5 text-body-4 text-text-2 tabular">
            {full
              ? 'Full range'
              : `${formatDisplayPrice((row as Extract<AnyPositionRow, { version: 'v3' }>).priceLower)} – ${formatDisplayPrice((row as Extract<AnyPositionRow, { version: 'v3' }>).priceUpper)} ${row.token1.symbol} per ${row.token0.symbol}`}
          </div>
        </div>
        <ChevronRight size={18} className="text-text-3" />
      </div>
      <dl className="grid grid-cols-3 gap-3 text-body-3">
        <div>
          <dt className="text-body-4 text-text-2">Position</dt>
          <dd className="font-semibold tabular">{formatUsd(row.valueUsd)}</dd>
        </div>
        <div>
          <dt className="text-body-4 text-text-2">Fees</dt>
          <dd className="font-semibold tabular">{row.version === 'v3' ? formatUsd(fees) : <span className="text-text-3">Auto-compounded</span>}</dd>
        </div>
        <div>
          <dt className="text-body-4 text-text-2">APR</dt>
          <dd className="font-semibold tabular">{apr === null ? '-' : formatPercent(apr)}</dd>
        </div>
      </dl>
    </Link>
  )
}

function TopPools() {
  const q = useAllPools()
  const rows = (q.data ?? []).slice(0, 6)
  return (
    <aside className="flex flex-col gap-3" data-testid="top-pools">
      <h2 className="text-body-1 font-medium">Top pools by TVL</h2>
      {q.isLoading ? (
        [0, 1, 2, 3].map((i) => <Skeleton key={i} width="100%" height={64} rounded="lg" />)
      ) : q.isError ? (
        <p className="text-body-3 text-text-2">Pools unavailable.</p>
      ) : (
        rows.map((r) => <TopPoolRow key={r.address} row={r} />)
      )}
      <Link to="/explore/pools" className="text-body-3 font-semibold text-accent hover:underline">
        Explore more pools
      </Link>
    </aside>
  )
}

function TopPoolRow({ row }: { row: ExplorePoolRowW3 }) {
  const t0 = typeof row.token0 === 'string' ? undefined : row.token0
  const t1 = typeof row.token1 === 'string' ? undefined : row.token1
  return (
    <Link to={poolHref(row)} className="flex items-center gap-3 rounded-[20px] border border-border bg-surface-1 p-4 hover:bg-surface-1-hover" data-testid={`top-pool-${row.address}`}>
      <DoubleLogo token0={t0} token1={t1} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-body-3 font-semibold">
          {t0?.symbol}/{t1?.symbol}
          <span className="rounded-full bg-surface-3 px-1.5 text-body-4 text-text-2">
            {row.version} {feeLabel(row.fee)}
          </span>
        </div>
        <div className="text-body-4 text-text-2">{formatUsd(row.tvlUsd, { compact: true })} TVL</div>
      </div>
      <div className="text-right">
        <div className="text-body-3 font-semibold text-success tabular">{formatPercent(row.apr)}</div>
        <div className="text-body-4 text-text-3">APR</div>
      </div>
    </Link>
  )
}
