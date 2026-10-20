import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, Search, Smile, TrendingUp, LayoutGrid } from 'lucide-react'
import { NATIVE_ADDRESS } from '@metaswap/sdk'
import { Badge, PercentChange, Popover, SortTh, Table, TableSkeleton, Td, Th, THead, Tr, TokenLogo, Usd } from '@/components/ui'
import { CHAIN_SLUG } from '@/config'
import { formatPrice } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Sparkline } from './charts/SvgCharts'
import { ApiErrorState } from './ExploreStates'
import { useTrendingTokens } from './discoveryApi'
import { CATEGORY_LABEL, MORE_CATEGORIES, PRIMARY_CATEGORIES, matchesCategory, parseCategory, tokenBadges, type TokenCategory } from './discovery'
import { filterTokenRows, sortRows, type SortDir } from './transforms'
import type { RangeKey, TokenRow } from './types'

type SortKey = 'rank' | 'price' | 'change1h' | 'change24h' | 'fdv' | 'volume'

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: '1H', label: '1H' },
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: 'All time' },
]

const CHIP_ICON: Partial<Record<TokenCategory, typeof TrendingUp>> = {
  trending: TrendingUp,
  gainers: TrendingUp,
  memes: Smile,
}

/** URL of a token's detail page. Native ETH uses the NATIVE sentinel in URLs. */
export function tokenHref(address: string): string {
  const path = address.toLowerCase() === NATIVE_ADDRESS.toLowerCase() ? 'NATIVE' : address
  return `/explore/tokens/${CHAIN_SLUG}/${path}`
}

/** Sortable, searchable token list. The category chip lives in `?category=` so links can deep-link to it. */
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
  const [params, setParams] = useSearchParams()
  const category = parseCategory(params.get('category'))
  const [moreOpen, setMoreOpen] = useState(false)
  const [query, setQuery] = useState('')
  const trending = useTrendingTokens()
  const trendingSet = useMemo(() => new Set((trending.data ?? []).map((t) => t.address.toLowerCase())), [trending.data])
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'volume', dir: 'desc' })
  // Top Gainers sorts by 24h change unless the user picked another column.
  const effectiveSort = category === 'gainers' && sort.key === 'volume' ? { key: 'change24h' as SortKey, dir: 'desc' as SortDir } : sort

  const setCategory = (c: TokenCategory) => {
    const next = new URLSearchParams(params)
    if (c === 'all') next.delete('category')
    else next.set('category', c)
    setParams(next, { replace: true })
  }

  const visible = useMemo(() => {
    const inCategory = (rows ?? []).filter((r) => matchesCategory(r, category, trendingSet))
    const filtered = filterTokenRows(inCategory, { query })
    const getter: Record<SortKey, (r: TokenRow) => number | string | null> = {
      rank: (r) => (rows ?? []).indexOf(r),
      price: (r) => r.priceUsd,
      change1h: (r) => r.change1h,
      change24h: (r) => r.change24h,
      fdv: (r) => r.fdvUsd,
      volume: (r) => r.volumeUsd,
    }
    return sortRows(filtered, getter[effectiveSort.key], effectiveSort.key === 'rank' ? 'asc' : effectiveSort.dir)
  }, [rows, query, category, trendingSet, effectiveSort])

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  if (error && !rows) return <ApiErrorState error={error} onRetry={onRetry} title="Could not load tokens" />

  const moreActive = MORE_CATEGORIES.some((c) => c.value === category)

  return (
    <div className="flex flex-col gap-4" data-testid="tokens-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Token categories" className="flex flex-wrap items-center gap-1">
          {PRIMARY_CATEGORIES.map((c) => {
            const Icon = CHIP_ICON[c.value]
            const active = category === c.value
            return (
              <button
                key={c.value}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`chip-${c.value}`}
                onClick={() => setCategory(c.value)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-body-3 font-semibold transition-colors duration-150',
                  active ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:bg-surface-2-hover hover:text-text-1',
                )}
              >
                {Icon && <Icon size={14} aria-hidden />}
                {c.label}
              </button>
            )
          })}
          <Popover
            open={moreOpen}
            onOpenChange={setMoreOpen}
            align="start"
            trigger={
              <button
                type="button"
                data-testid="chip-more"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-full px-3 text-body-3 font-semibold transition-colors duration-150',
                  moreActive ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:bg-surface-2-hover hover:text-text-1',
                )}
              >
                <LayoutGrid size={14} aria-hidden />
                {moreActive ? CATEGORY_LABEL[category] : 'More'}
                <ChevronDown size={14} aria-hidden />
              </button>
            }
            className="w-[200px] p-2"
          >
            <ul role="menu" className="flex flex-col">
              {MORE_CATEGORIES.map((c) => (
                <li key={c.value} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`more-${c.value}`}
                    onClick={() => {
                      setCategory(c.value)
                      setMoreOpen(false)
                    }}
                    className={cn('flex w-full rounded-xl px-3 py-2 text-left text-body-2 hover:bg-surface-2-hover', category === c.value && 'font-semibold text-text-1')}
                  >
                    {c.label}
                  </button>
                </li>
              ))}
            </ul>
          </Popover>
        </div>
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
          <SortTh label="Price" active={effectiveSort.key === 'price'} direction={effectiveSort.dir} onClick={() => toggleSort('price')} />
          <SortTh label="1H" active={effectiveSort.key === 'change1h'} direction={effectiveSort.dir} onClick={() => toggleSort('change1h')} />
          <SortTh label="1D" active={effectiveSort.key === 'change24h'} direction={effectiveSort.dir} onClick={() => toggleSort('change24h')} />
          <SortTh label="FDV" active={effectiveSort.key === 'fdv'} direction={effectiveSort.dir} onClick={() => toggleSort('fdv')} />
          <SortTh label={`Volume ${RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ''}`} active={effectiveSort.key === 'volume'} direction={effectiveSort.dir} onClick={() => toggleSort('volume')} />
          <Th align="right">1D chart</Th>
        </THead>
        {isLoading && !rows ? (
          <TableSkeleton rows={8} cols={8} />
        ) : visible.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-body-2 text-text-2" data-testid="tokens-empty">
                {rows && rows.length ? `No tokens in ${CATEGORY_LABEL[category]} right now.` : 'No tokens are listed yet.'}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody>
            {visible.map((r) => {
              const rank = (rows ?? []).indexOf(r) + 1
              const href = tokenHref(r.address)
              const badges = tokenBadges(r)
              return (
                <Tr key={r.address} className="group" onClick={() => navigate(href)} data-testid="token-row" data-symbol={r.symbol}>
                  <Td className="sticky left-0 z-[1] w-12 bg-surface-1 text-text-2 group-hover:bg-surface-2-hover">{rank}</Td>
                  <Td className="sticky left-12 z-[1] bg-surface-1 group-hover:bg-surface-2-hover">
                    <Link to={href} className="flex items-center gap-3 focus-visible:outline-none" onClick={(e) => e.stopPropagation()}>
                      <TokenLogo token={{ symbol: r.symbol, address: r.address }} size={28} />
                      <span className="flex min-w-0 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-semibold text-text-1">{r.name}</span>
                          {badges.slice(0, 2).map((b) => (
                            <Badge key={b} tone="neutral" className="shrink-0 !px-1.5 !py-0 text-[11px]">
                              {b}
                            </Badge>
                          ))}
                        </span>
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
