import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { Modal, SegmentedTabs, TokenLogo, DoubleLogo, Skeleton } from '@/components/ui'
import { useTokenList, useTokenPrices } from '@/features/tokens/useTokenList'
import { searchTokens } from '@/features/tokens/tokenSearch'
import { useExplorePools } from '@/api/hooks'
import { formatPrice, shortenAddress, formatUsd } from '@/lib/format'
import { CHAIN_SLUG } from '@/config'
import { NATIVE_ETH } from '@metaswap/sdk'

type Filter = 'all' | 'tokens' | 'pools'

/** Top-bar search (ui-ux.md §1.3): tokens and pools; "/" opens it. */
export function SearchModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const { all, find } = useTokenList()
  const { prices } = useTokenPrices()
  const pools = useExplorePools('tvl')
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.closest('input,textarea,[contenteditable]')) return
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
  }, [open])

  const tokens = useMemo(() => searchTokens(all, query).slice(0, 8), [all, query])
  const poolRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (pools.data ?? [])
      .map((p) => {
        const t0 = typeof p.token0 === 'string' ? find(p.token0) : find(p.token0.address)
        const t1 = typeof p.token1 === 'string' ? find(p.token1) : find(p.token1.address)
        return { p, t0, t1, name: `${t0?.symbol ?? '?'}/${t1?.symbol ?? '?'}` }
      })
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.p.address.toLowerCase().includes(q))
      .slice(0, 6)
  }, [pools.data, query, find])

  const go = (path: string) => {
    onOpenChange(false)
    navigate(path)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Search" width={520} testId="search-modal">
      <label className="flex h-12 items-center gap-2 rounded-2xl bg-surface-2 px-4 focus-within:ring-1 focus-within:ring-accent">
        <Search size={18} className="text-text-3" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tokens and pools" aria-label="Search tokens and pools" className="w-full bg-transparent text-body-2 outline-none" />
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
      {filter !== 'pools' && (
        <section className="mt-3">
          <h3 className="px-1 pb-1 text-body-3 text-text-2">{query ? 'Tokens' : 'Popular tokens'}</h3>
          {tokens.length === 0 && <p className="px-1 py-4 text-body-3 text-text-3">No tokens match “{query}”.</p>}
          {tokens.map((t) => {
            return (
              <button key={t.address} onClick={() => go(`/explore/tokens/${CHAIN_SLUG}/${t.isNative ? 'NATIVE' : t.address}`)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2">
                <TokenLogo token={t} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block text-body-4 text-text-2">
                    {t.symbol} {t.isNative ? '' : <span className="font-mono text-text-3">{shortenAddress(t.address)}</span>}
                  </span>
                </span>
                <span className="text-body-3 tabular">{formatPrice(prices[(t.isNative ? NATIVE_ETH.address : t.address).toLowerCase()])}</span>
              </button>
            )
          })}
        </section>
      )}
      {filter !== 'tokens' && (
        <section className="mt-3">
          <h3 className="px-1 pb-1 text-body-3 text-text-2">Pools</h3>
          {pools.isLoading && <Skeleton width="100%" height={44} rounded="lg" />}
          {pools.isError && <p className="px-1 py-2 text-body-3 text-text-3">Pool data unavailable (API offline).</p>}
          {poolRows.map(({ p, t0, t1, name }) => (
            <button key={p.address} onClick={() => go(`/explore/pools/${CHAIN_SLUG}/${p.address}`)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2">
              <DoubleLogo token0={t0} token1={t1} size={24} />
              <span className="flex-1 font-medium">
                {name} <span className="ml-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-body-4 text-text-2">{p.version} {p.fee ? `${p.fee / 10_000}%` : ''}</span>
              </span>
              <span className="text-body-3 text-text-2 tabular">{formatUsd(p.tvlUsd, { compact: true })} TVL</span>
            </button>
          ))}
        </section>
      )}
    </Modal>
  )
}
