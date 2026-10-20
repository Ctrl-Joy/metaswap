import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Badge, buttonClass, DoubleLogo, SortTh, Table, TableSkeleton, Td, Th, THead, Tr, Usd } from '@/components/ui'
import { CHAIN_SLUG } from '@/config'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiErrorState } from './ExploreStates'
import { feeLabel, sortRows, tokenOf, volumeOverTvl, type SortDir } from './transforms'
import type { PoolApiRow } from './types'

type SortKey = 'rank' | 'tvl' | 'apr' | 'volume' | 'volume7d' | 'ratio'

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
}: {
  pools: PoolApiRow[] | undefined
  isLoading: boolean
  error: unknown
  onRetry: () => void
  showNewPosition?: boolean
  emptyText?: string
  testId?: string
}) {
  const navigate = useNavigate()
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'tvl', dir: 'desc' })

  const visible = useMemo(() => {
    const getter: Record<SortKey, (p: PoolApiRow) => number | null> = {
      rank: () => null,
      tvl: (p) => p.tvlUsd,
      apr: (p) => p.apr,
      volume: (p) => p.volume24hUsd,
      volume7d: (p) => p.volume7dUsd,
      ratio: (p) => volumeOverTvl(p.volume24hUsd, p.tvlUsd),
    }
    const base = pools ?? []
    return sort.key === 'rank' ? base : sortRows(base, getter[sort.key], sort.dir)
  }, [pools, sort])

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  if (error && !pools) return <ApiErrorState error={error} onRetry={onRetry} title="Could not load pools" />

  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      {showNewPosition && (
        <div className="flex justify-end">
          <Link to="/positions/create" className={buttonClass({ variant: 'tint', size: 'md' })}>
            <Plus size={16} aria-hidden />
            New position
          </Link>
        </div>
      )}
      <Table minWidth={860}>
        <THead>
          <Th className="sticky left-0 z-[2] w-12 bg-surface-2">#</Th>
          <Th className="sticky left-12 z-[2] bg-surface-2">Pool</Th>
          <SortTh label="TVL" active={sort.key === 'tvl'} direction={sort.dir} onClick={() => toggle('tvl')} />
          <SortTh label="APR" active={sort.key === 'apr'} direction={sort.dir} onClick={() => toggle('apr')} />
          <SortTh label="1D vol" active={sort.key === 'volume'} direction={sort.dir} onClick={() => toggle('volume')} />
          <SortTh label="7D vol" active={sort.key === 'volume7d'} direction={sort.dir} onClick={() => toggle('volume7d')} />
          <SortTh label="1D vol/TVL" active={sort.key === 'ratio'} direction={sort.dir} onClick={() => toggle('ratio')} />
        </THead>
        {isLoading && !pools ? (
          <TableSkeleton rows={8} cols={7} />
        ) : visible.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-body-2 text-text-2" data-testid="pools-empty">
                {emptyText}
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
                <Tr key={p.address} className="group" onClick={() => navigate(href)} data-testid="pool-row" data-pool={p.address} data-index={i}>
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
                  <Td align="right">{p.apr === null ? '-' : formatPercent(p.apr, { digits: 2 })}</Td>
                  <Td align="right">
                    <Usd value={p.volume24hUsd} compact />
                  </Td>
                  <Td align="right">
                    <Usd value={p.volume7dUsd} compact />
                  </Td>
                  <Td align="right" className={cn(volumeOverTvl(p.volume24hUsd, p.tvlUsd) === null && 'text-text-3')}>
                    {volumeOverTvl(p.volume24hUsd, p.tvlUsd) === null ? '-' : formatPercent((volumeOverTvl(p.volume24hUsd, p.tvlUsd) ?? 0) * 100, { digits: 2 })}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        )}
      </Table>
    </div>
  )
}
