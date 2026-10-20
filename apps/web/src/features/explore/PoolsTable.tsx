import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, SlidersHorizontal } from 'lucide-react'
import { Badge, buttonClass, DoubleLogo, SortTh, Table, TableSkeleton, Td, Th, THead, Tr, Usd } from '@/components/ui'
import { CHAIN_SLUG } from '@/config'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiErrorState } from './ExploreStates'
import { feeLabel, sortRows, tokenOf, volumeOverTvl, type SortDir } from './transforms'
import type { PoolApiRow } from './types'
import { usePools30dVolume } from './api'
import { PoolFiltersModal } from './PoolFiltersModal'
import { activeFilterCount, applyPoolFilters, EMPTY_POOL_FILTERS, type PoolFilters } from './poolFilters'

type SortKey = 'rank' | 'tvl' | 'apr' | 'volume' | 'volume30d' | 'ratio'

export function poolHref(address: string): string {
  return `/explore/pools/${CHAIN_SLUG}/${address}`
}

/** Pools list: double logo, pair, version and fee chips, TVL, APR and volume. Rows open the pool page. */
export function PoolsTable({
  pools,
  isLoading,
  error,
  onRetry,
  showNewPosition = true,
  emptyText = 'No pools yet. Create the first one.',
  testId = 'pools-table',
  toolbar = showNewPosition,
}: {
  pools: PoolApiRow[] | undefined
  isLoading: boolean
  error: unknown
  onRetry: () => void
  showNewPosition?: boolean
  emptyText?: string
  testId?: string
  /** Search box + filters button above the table (Explore pools tab). */
  toolbar?: boolean
}) {
  const navigate = useNavigate()
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'volume', dir: 'desc' })
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<PoolFilters>(EMPTY_POOL_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const addresses = useMemo(() => (pools ?? []).map((p) => p.address), [pools])
  const vol30 = usePools30dVolume(addresses)
  const v30 = (p: PoolApiRow) => vol30[p.address.toLowerCase()] ?? null

  const visible = useMemo(() => {
    const getter: Record<SortKey, (p: PoolApiRow) => number | null> = {
      rank: () => null,
      tvl: (p) => p.tvlUsd,
      apr: (p) => p.apr,
      volume: (p) => p.volume24hUsd,
      volume30d: v30,
      ratio: (p) => volumeOverTvl(p.volume24hUsd, p.tvlUsd),
    }
    const base = applyPoolFilters(pools ?? [], filters, query)
    return sort.key === 'rank' ? base : sortRows(base, getter[sort.key], sort.dir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools, sort, filters, query, vol30])
  const nFilters = activeFilterCount(filters)
  const maxApr = useMemo(() => Math.max(0, ...(pools ?? []).map((p) => p.apr ?? 0)), [pools])

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  if (error && !pools) return <ApiErrorState error={error} onRetry={onRetry} title="Could not load pools" />

  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      {(showNewPosition || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {showNewPosition && (
            <Link to="/positions/create" className={buttonClass({ variant: 'tint', size: 'md' })}>
              <Plus size={16} aria-hidden />
              New position
            </Link>
          )}
          {toolbar && (
            <>
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                data-testid="pool-filters-button"
                aria-label={nFilters ? `Filters (${nFilters} active)` : 'Filters'}
                className={cn('inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-body-3 font-semibold transition-colors', nFilters ? 'border-accent bg-accent-tint text-accent' : 'border-border text-text-2 hover:bg-surface-2 hover:text-text-1')}
              >
                <SlidersHorizontal size={16} aria-hidden />
                Filters
                {nFilters > 0 && <span className="rounded-full bg-accent-fill px-1.5 text-body-4 text-white tabular">{nFilters}</span>}
              </button>
              <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-border px-3.5 focus-within:border-accent sm:max-w-[280px]">
                <Search size={16} className="shrink-0 text-text-3" aria-hidden />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search pools" aria-label="Search pools" data-testid="pool-search" className="w-full min-w-0 bg-transparent text-body-3 outline-none" />
              </label>
              <PoolFiltersModal open={filtersOpen} onOpenChange={setFiltersOpen} value={filters} onApply={setFilters} maxApr={maxApr} />
            </>
          )}
        </div>
      )}
      <Table minWidth={860}>
        <THead>
          <Th className="sticky left-0 z-[2] w-12 bg-surface-2">#</Th>
          <Th className="sticky left-12 z-[2] bg-surface-2">Pool</Th>
          <SortTh label="TVL" active={sort.key === 'tvl'} direction={sort.dir} onClick={() => toggle('tvl')} />
          <SortTh label="1D vol" active={sort.key === 'volume'} direction={sort.dir} onClick={() => toggle('volume')} />
          <SortTh label="30D vol" active={sort.key === 'volume30d'} direction={sort.dir} onClick={() => toggle('volume30d')} />
          <SortTh label="1D vol/TVL" active={sort.key === 'ratio'} direction={sort.dir} onClick={() => toggle('ratio')} />
          <SortTh label="Pool APR" active={sort.key === 'apr'} direction={sort.dir} onClick={() => toggle('apr')} />
        </THead>
        {isLoading && !pools ? (
          <TableSkeleton rows={8} cols={7} />
        ) : visible.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-body-2 text-text-2" data-testid="pools-empty">
                {(pools?.length ?? 0) > 0 ? "No pools match your search or filters." : emptyText}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody>
            {visible.map((p, i) => {
              const t0 = tokenOf(p.token0)
              const t1 = tokenOf(p.token1)
              const fee = feeLabel(p.fee)
              const rank = (pools ?? []).indexOf(p) + 1
              const href = poolHref(p.address)
              return (
                <Tr key={p.address} className="group" onClick={() => navigate(href)} data-testid="pool-row" data-pool={p.address} data-version={p.version} data-index={i}>
                  <Td className="sticky left-0 z-[1] w-12 bg-surface-1 text-text-2 group-hover:bg-surface-2-hover">{rank}</Td>
                  <Td className="sticky left-12 z-[1] bg-surface-1 group-hover:bg-surface-2-hover">
                    <Link to={href} className="flex items-center gap-3 focus-visible:outline-none" onClick={(e) => e.stopPropagation()}>
                      <DoubleLogo token0={{ symbol: t0.symbol, address: t0.address }} token1={{ symbol: t1.symbol, address: t1.address }} size={28} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold text-text-1">
                          {t0.symbol} / {t1.symbol}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Badge tone="neutral">{p.version}</Badge>
                          {fee && <Badge tone="neutral">{fee}</Badge>}
                        </span>
                      </span>
                    </Link>
                  </Td>
                  <Td align="right">
                    <Usd value={p.tvlUsd} compact />
                  </Td>
                  <Td align="right">
                    <Usd value={p.volume24hUsd} compact />
                  </Td>
                  <Td align="right" data-testid="pool-vol30d">
                    {v30(p) === null ? <span className="text-text-3">-</span> : <Usd value={v30(p)} compact />}
                  </Td>
                  <Td align="right" className={cn(volumeOverTvl(p.volume24hUsd, p.tvlUsd) === null && 'text-text-3')} data-testid="pool-vol-tvl">
                    {formatRatio(volumeOverTvl(p.volume24hUsd, p.tvlUsd))}
                  </Td>
                  <Td align="right">{p.apr === null ? '-' : formatPercent(p.apr, { digits: 2 })}</Td>
                </Tr>
              )
            })}
          </tbody>
        )}
      </Table>
    </div>
  )
}

/** 1D volume / TVL as a plain ratio with two decimals (Uniswap shows "12.55", not a percentage). */
export function formatRatio(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return '-'
  if (r > 0 && r < 0.01) return '<0.01'
  return r.toFixed(2)
}
