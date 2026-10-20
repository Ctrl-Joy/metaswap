import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Search } from 'lucide-react'
import { NATIVE_ETH, type Token } from '@metaswap/sdk'
import { Modal, SegmentedTabs, TokenLogo, DoubleLogo, Skeleton, PercentChange } from '@/components/ui'
import { useTokenList, useTokenPrices } from '@/features/tokens/useTokenList'
import { nextIndex, pushRecent, searchTokens, sortByVolume, type RecentSearch } from '@/features/tokens/tokenSearch'
import { useExplorePoolRows, useExploreTokenRows } from '@/features/explore/api'
import { formatPrice, shortenAddress, formatUsd, formatPercent } from '@/lib/format'
import { safeStorage } from '@/lib/storage'
import { cn } from '@/lib/cn'
import { CHAIN_SLUG } from '@/config'

type Filter = 'all' | 'tokens' | 'pools'
const RECENT_KEY = 'metaswap.search.recent'

function loadRecent(): RecentSearch[] {
  try {
    const v = JSON.parse((safeStorage.getItem(RECENT_KEY) as string | null) ?? '[]') as unknown
    return Array.isArray(v) ? (v as RecentSearch[]).filter((r) => r && typeof r.id === 'string' && (r.kind === 'token' || r.kind === 'pool')) : []
  } catch {
    return []
  }
}

interface Item {
  key: string
  path: string
  recent: RecentSearch
  node: ReactNode
}

/**
 * Top-bar search (ui-ux.md §1.3): tokens and pools with 24h stats, recent searches, ↑/↓/Enter navigation.
 * "/" and Ctrl/⌘K open it.
 */
export function SearchModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [active, setActive] = useState(-1)
  const [recent, setRecent] = useState<RecentSearch[]>(loadRecent)
  const { all, find } = useTokenList()
  const { prices } = useTokenPrices()
  const tokenStats = useExploreTokenRows('1D')
  const pools = useExplorePoolRows()
  const navigate = useNavigate()
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && typeof el.closest === 'function' && el.closest('input,textarea,select,[contenteditable]')) return
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        onOpenChange(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpenChange])

  useEffect(() => {
    if (!open) setQuery('')
    else setRecent(loadRecent())
  }, [open])

  // 24h stats by lower-cased address; native ETH mirrors WETH.
  const stats = useMemo(() => {
    const m: Record<string, { change: number | null; fdv: number | null; volume: number | null }> = {}
    for (const r of tokenStats.data ?? []) m[r.address.toLowerCase()] = { change: r.change24h, fdv: r.fdvUsd, volume: r.volumeUsd }
    const weth = all.find((t) => t.symbol === 'WETH')
    if (weth && m[weth.address.toLowerCase()]) m[NATIVE_ETH.address.toLowerCase()] = m[weth.address.toLowerCase()]!
    return m
  }, [tokenStats.data, all])

  const tokens = useMemo(() => {
    if (query.trim()) return searchTokens(all, query).slice(0, 8)
    const vols = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.volume]))
    return sortByVolume(all, vols).slice(0, 5)
  }, [all, query, stats])

  const poolRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (pools.data ?? [])
      .map((p) => {
        const t0 = typeof p.token0 === 'string' ? find(p.token0) : find(p.token0.address)
        const t1 = typeof p.token1 === 'string' ? find(p.token1) : find(p.token1.address)
        return { p, t0, t1, name: `${t0?.symbol ?? '?'}/${t1?.symbol ?? '?'}` }
      })
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.p.address.toLowerCase().includes(q) || r.name.toLowerCase().replace(/(^|\/)m(?=[a-z])/g, '$1').includes(q))
      .sort((a, b) => (b.p.volume24hUsd ?? -1) - (a.p.volume24hUsd ?? -1))
      .slice(0, q ? 6 : 3)
  }, [pools.data, query, find])

  const tokenPath = (t: Token) => `/explore/tokens/${CHAIN_SLUG}/${t.isNative ? 'NATIVE' : t.address}`
  const poolPath = (address: string) => `/explore/pools/${CHAIN_SLUG}/${address}`

  const tokenNode = (t: Token) => {
    const st = stats[t.address.toLowerCase()]
    return (
      <>
        <TokenLogo token={t} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{t.name}</span>
          <span className="block truncate text-body-4 text-text-2">
            {t.symbol} {st?.fdv ? <span className="text-text-3">· {formatUsd(st.fdv, { compact: true })} FDV</span> : !t.isNative && <span className="font-mono text-text-3">{shortenAddress(t.address)}</span>}
          </span>
        </span>
        <span className="flex flex-col items-end">
          <span className="text-body-3 tabular">{formatPrice(prices[(t.isNative ? NATIVE_ETH.address : t.address).toLowerCase()])}</span>
          <PercentChange value={st?.change ?? null} className="text-body-4" />
        </span>
      </>
    )
  }

  const items = useMemo(() => {
    const sections: Array<{ title: ReactNode; items: Item[]; testId: string }> = []
    if (!query.trim() && recent.length && filter === 'all') {
      sections.push({
        testId: 'search-recent',
        title: (
          <span className="flex items-center justify-between">
            <span>Recent</span>
            <button
              type="button"
              className="text-body-4 font-semibold text-text-2 hover:text-text-1"
              data-testid="search-clear-recent"
              onClick={() => {
                safeStorage.removeItem(RECENT_KEY)
                setRecent([])
              }}
            >
              Clear
            </button>
          </span>
        ),
        items: recent.map((r) => ({
          key: `recent-${r.kind}-${r.id}`,
          path: r.kind === 'token' ? `/explore/tokens/${CHAIN_SLUG}/${r.id}` : poolPath(r.id),
          recent: r,
          node: (() => {
            const t = r.kind === 'token' ? find(r.id === 'NATIVE' ? 'ETH' : r.id) : undefined
            return t ? (
              tokenNode(t)
            ) : (
              <>
                <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-text-2">
                  <Clock size={16} />
                </span>
                <span className="flex-1 font-medium">{r.label}</span>
              </>
            )
          })(),
        })),
      })
    }
    if (filter !== 'pools') {
      sections.push({
        testId: 'search-tokens',
        title: query.trim() ? 'Tokens' : 'Tokens by 24H volume',
        items: tokens.map((t) => ({
          key: `token-${t.address}`,
          path: tokenPath(t),
          recent: { kind: 'token', id: t.isNative ? 'NATIVE' : t.address, label: t.symbol },
          node: tokenNode(t),
        })),
      })
    }
    if (filter !== 'tokens') {
      sections.push({
        testId: 'search-pools',
        title: query.trim() ? 'Pools' : 'Pools by 24H volume',
        items: poolRows.map(({ p, t0, t1, name }) => ({
          key: `pool-${p.address}`,
          path: poolPath(p.address),
          recent: { kind: 'pool', id: p.address, label: `${name} ${p.version}${p.fee ? ` ${p.fee / 10_000}%` : ''}` },
          node: (
            <>
              <DoubleLogo token0={t0} token1={t1} size={24} />
              <span className="flex-1 font-medium">
                {name} <span className="ml-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-body-4 text-text-2">{p.version} {p.fee ? `${p.fee / 10_000}%` : ''}</span>
              </span>
              <span className="flex flex-col items-end text-body-4 tabular">
                <span className="text-text-1">{formatUsd(p.volume24hUsd, { compact: true })} vol</span>
                <span className="text-text-2">{p.apr !== null ? `${formatPercent(p.apr)} APR` : '-'}</span>
              </span>
            </>
          ),
        })),
      })
    }
    return sections
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, recent, filter, tokens, poolRows, stats, prices, find])

  const flat = useMemo(() => items.flatMap((s) => s.items), [items])
  useEffect(() => setActive(-1), [query, filter, open])

  const go = (item: Item) => {
    const next = pushRecent(recent, item.recent)
    safeStorage.setItem(RECENT_KEY, JSON.stringify(next))
    setRecent(next)
    onOpenChange(false)
    navigate(item.path)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = nextIndex(active, flat.length, e.key)
      setActive(n)
      listRef.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      const item = flat[active] ?? (query.trim() ? flat[0] : undefined)
      if (item) {
        e.preventDefault()
        go(item)
      }
    }
  }

  let idx = -1
  const activeId = active >= 0 ? `search-option-${active}` : undefined
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Search" width={520} testId="search-modal">
      <label className="flex h-12 items-center gap-2 rounded-2xl bg-surface-2 px-4 focus-within:ring-1 focus-within:ring-accent">
        <Search size={18} className="text-text-3" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search by name, symbol, or address"
          aria-label="Search tokens and pools"
          role="combobox"
          aria-expanded
          aria-controls="search-results"
          aria-activedescendant={activeId}
          data-testid="search-input"
          className="w-full bg-transparent text-body-2 outline-none"
        />
      </label>
      <SegmentedTabs
        className="mt-3"
        size="sm"
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'all', label: 'All' },
          { value: 'tokens', label: 'Tokens' },
          { value: 'pools', label: 'Pools' },
        ]}
      />
      <div id="search-results" role="listbox" aria-label="Search results" ref={listRef}>
        {items.map((s) => (
          <section key={s.testId} className="mt-3" data-testid={s.testId}>
            <h3 className="px-1 pb-1 text-body-3 text-text-2">{s.title}</h3>
            {s.testId === 'search-tokens' && s.items.length === 0 && <p className="px-1 py-4 text-body-3 text-text-3">No tokens match “{query}”.</p>}
            {s.testId === 'search-pools' && pools.isLoading && <Skeleton width="100%" height={44} rounded="lg" />}
            {s.testId === 'search-pools' && pools.isError && <p className="px-1 py-2 text-body-3 text-text-3">Pool data unavailable (API offline).</p>}
            {s.testId === 'search-pools' && !pools.isLoading && !pools.isError && s.items.length === 0 && query.trim() && <p className="px-1 py-4 text-body-3 text-text-3">No pools match “{query}”.</p>}
            {s.items.map((item) => {
              idx += 1
              const i = idx
              return (
                <button
                  key={item.key}
                  id={`search-option-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  data-testid={`search-option-${i}`}
                  data-active={i === active ? 'true' : undefined}
                  onClick={() => go(item)}
                  onMouseMove={() => active !== i && setActive(i)}
                  className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2', i === active && 'bg-surface-2')}
                >
                  {item.node}
                </button>
              )
            })}
          </section>
        ))}
      </div>
    </Modal>
  )
}
