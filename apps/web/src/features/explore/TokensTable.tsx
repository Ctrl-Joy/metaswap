import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { NATIVE_ADDRESS } from '@metaswap/sdk'
import { PercentChange, SegmentedTabs, SortTh, Table, TableSkeleton, Td, Th, THead, Tr, TokenLogo, Usd } from '@/components/ui'
import { CHAIN_SLUG } from '@/config'
import { formatPrice } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Sparkline } from './charts/SvgCharts'
import { ApiErrorState } from './ExploreStates'
import { filterTokenRows, sortRows, type SortDir, type TokenChip } from './transforms'
import type { RangeKey, TokenRow } from './types'

type SortKey = 'rank' | 'price' | 'change1h' | 'change24h' | 'fdv' | 'volume'

const CHIPS: Array<{ value: TokenChip; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'stablecoins', label: 'Stablecoins' },
  { value: 'wrapped', label: 'Wrapped' },
]

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: '1H', label: '1H' },
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: 'All time' },
]

/** URL of a token's detail page. Native ETH uses the NATIVE sentinel in URLs. */
export function tokenHref(address: string): string {
  const path = address.toLowerCase() === NATIVE_ADDRESS.toLowerCase() ? 'NATIVE' : address
  return `/explore/tokens/${CHAIN_SLUG}/${path}`
}

/** Sortable, searchable token list with chips and a volume time-range dropdown. */
export function TokensTable({
  rows,
  isLoading,
  error,
  onRetry,
  range,
  onRangeChange,
}: {
  rows: TokenRow[] | undefined
  isLoading: boolean
  error: unknown
  onRetry: () => void
  range: RangeKey
  onRangeChange: (r: RangeKey) => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<TokenChip>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'volume', dir: 'desc' })

  const visible = useMemo(() => {
    const filtered = filterTokenRows(rows ?? [], { query, chip })
    const getter: Record<SortKey, (r: TokenRow) => number | string | null> = {
      rank: (r) => (rows ?? []).indexOf(r),
      price: (r) => r.priceUsd,
      change1h: (r) => r.change1h,
      change24h: (r) => r.change24h,
      fdv: (r) => r.fdvUsd,
      volume: (r) => r.volumeUsd,
    }
    return sortRows(filtered, getter[sort.key], sort.key === 'rank' ? 'asc' : sort.dir)
  }, [rows, query, chip, sort])

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  if (error && !rows) return <ApiErrorState error={error} onRetry={onRetry} title="Could not load tokens" />

  return (
    <div className="flex flex-col gap-4" data-testid="tokens-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs items={CHIPS.map((c) => ({ value: c.value, label: c.label, testId: `chip-${c.value}` }))} value={chip} onChange={setChip} size="sm" ariaLabel="Token filter" className="flex-wrap" />
        <div className="flex items-center gap-2">
          <label className="relative flex items-center">
            <span className="sr-only">Volume window</span>
            <select
              data-testid="volume-range"
              value={range}
              onChange={(e) => onRangeChange(e.target.value as RangeKey)}
              className="h-9 rounded-full border border-border bg-surface-1 pr-8 pl-3 text-body-3 font-semibold text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="relative flex w-[180px] items-center sm:w-[220px]">
            <Search size={16} className="pointer-events-none absolute left-3 text-text-3" aria-hidden />
            <span className="sr-only">Search tokens</span>
            <input
              data-testid="token-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tokens"
              className="h-9 w-full rounded-full border border-border bg-surface-1 pr-3 pl-9 text-body-3 text-text-1 outline-none placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
        </div>
      </div>

      <Table minWidth={760} className="scrollbar-thin">
        <THead>
          <Th className="sticky left-0 z-[2] w-12 bg-surface-2">#</Th>
          <Th className="sticky left-12 z-[2] bg-surface-2">Token</Th>
          <SortTh label="Price" active={sort.key === 'price'} direction={sort.dir} onClick={() => toggleSort('price')} />
          <SortTh label="1H" active={sort.key === 'change1h'} direction={sort.dir} onClick={() => toggleSort('change1h')} />
          <SortTh label="1D" active={sort.key === 'change24h'} direction={sort.dir} onClick={() => toggleSort('change24h')} />
          <SortTh label="FDV" active={sort.key === 'fdv'} direction={sort.dir} onClick={() => toggleSort('fdv')} />
          <SortTh label={`Volume ${RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ''}`} active={sort.key === 'volume'} direction={sort.dir} onClick={() => toggleSort('volume')} />
          <Th align="right">1D chart</Th>
        </THead>
        {isLoading && !rows ? (
          <TableSkeleton rows={8} cols={8} />
        ) : visible.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-body-2 text-text-2" data-testid="tokens-empty">
                {rows && rows.length ? 'No tokens match this filter.' : 'No tokens are listed yet.'}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody>
            {visible.map((r) => {
              const rank = (rows ?? []).indexOf(r) + 1
              const href = tokenHref(r.address)
              return (
                <Tr key={r.address} className="group" onClick={() => navigate(href)} data-testid="token-row" data-symbol={r.symbol}>
                  <Td className={cn('sticky left-0 z-[1] w-12 bg-surface-1 text-text-2 group-hover:bg-surface-2-hover')}>{rank}</Td>
                  <Td className={cn('sticky left-12 z-[1] bg-surface-1 group-hover:bg-surface-2-hover')}>
                    <Link to={href} className="flex items-center gap-3 focus-visible:outline-none" onClick={(e) => e.stopPropagation()}>
                      <TokenLogo token={{ symbol: r.symbol, address: r.address }} size={28} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold text-text-1">{r.name}</span>
                        <span className="text-body-4 text-text-2">{r.symbol}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td align="right" className="text-text-1">
                    {formatPrice(r.priceUsd)}
                  </Td>
                  <Td align="right">
                    <PercentChange value={r.change1h} />
                  </Td>
                  <Td align="right">
                    <PercentChange value={r.change24h} />
                  </Td>
                  <Td align="right">
                    <Usd value={r.fdvUsd} compact />
                  </Td>
                  <Td align="right">
                    <Usd value={r.volumeUsd} compact />
                  </Td>
                  <Td align="right">
                    <Sparkline values={r.sparkline} className="ml-auto" />
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
