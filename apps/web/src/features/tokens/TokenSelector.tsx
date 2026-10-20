import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { getAddress, type Address } from 'viem'
import { Search, Check, AlertTriangle, X } from 'lucide-react'
import { COMMON_BASE_SYMBOLS, type Token } from '@metaswap/sdk'
import { Modal, TokenLogo, Skeleton, Button, Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { erc20Abi } from '@/lib/abis'
import { formatTokenAmount, formatUsd, shortenAddress } from '@/lib/format'
import { toNumber } from '@/lib/amount'
import { useWallet } from '@/wallet/hooks'
import { useImportedTokens } from '@/state/ui'
import { DEVNET_CHAIN_ID } from '@/config'
import { useTokenBalances } from '@/hooks/useTokenBalances'
import { useTokenList, useTokenPrices } from './useTokenList'
import { isUnknownAddress, searchTokens, sortByBalance } from './tokenSearch'

export interface TokenSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (token: Token) => void
  selected?: Token
  /** Restrict selectable tokens (e.g. no native ETH for limit orders). */
  filter?: (t: Token) => boolean
  title?: string
}

/** Token selector modal (ui-ux.md §3): search, common bases, balances, import unknown tokens. */
export function TokenSelector({ open, onOpenChange, onSelect, selected, filter, title = 'Select a token' }: TokenSelectorProps) {
  const { all, isListed } = useTokenList()
  const { prices } = useTokenPrices()
  const { address } = useWallet()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const tokens = useMemo(() => (filter ? all.filter(filter) : all), [all, filter])
  const { balances, isLoading: balancesLoading } = useTokenBalances(open ? tokens : [], address)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  const results = useMemo(() => {
    const found = searchTokens(tokens, query)
    return query ? found : sortByBalance(found, balances, prices)
  }, [tokens, query, balances, prices])

  const owned = !query && address ? results.filter((t) => (balances[t.address.toLowerCase()] ?? 0n) > 0n) : []
  const rest = !query && address ? results.filter((t) => !owned.includes(t)) : results
  const flat = [...owned, ...rest]
  const commonBases = COMMON_BASE_SYMBOLS.map((s) => tokens.find((t) => t.symbol === s)).filter(Boolean) as Token[]
  const unknown = isUnknownAddress(query, all) ? (query.trim() as Address) : undefined

  const choose = (t: Token) => {
    onSelect(t)
    onOpenChange(false)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(flat.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter' && flat[cursor]) {
      e.preventDefault()
      choose(flat[cursor]!)
    }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const row = (t: Token, i: number) => {
    const bal = balances[t.address.toLowerCase()]
    const price = prices[t.address.toLowerCase()]
    const isSelected = selected?.address.toLowerCase() === t.address.toLowerCase()
    return (
      <button
        key={t.address}
        type="button"
        data-index={i}
        data-testid={`token-option-${t.symbol}`}
        aria-selected={isSelected}
        onMouseEnter={() => setCursor(i)}
        onClick={() => choose(t)}
        className={cn(
          'flex h-16 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors',
          i === cursor ? 'bg-surface-2-hover' : 'hover:bg-surface-2-hover',
          isSelected && 'opacity-60',
        )}
      >
        <TokenLogo token={t} size={36} chainBadge />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{t.name}</span>
          <span className="flex items-center gap-1.5 text-body-3 text-text-2">
            {t.symbol}
            {!t.isNative && <span className="font-mono text-body-4 text-text-3">{shortenAddress(t.address)}</span>}
            {!isListed(t.address) && <Badge tone="warning">Imported</Badge>}
            {t.tags?.includes('stablecoin') && <Badge>Stablecoin</Badge>}
          </span>
        </span>
        {address && (
          <span className="shrink-0 text-right">
            {bal === undefined && balancesLoading ? (
              <Skeleton width={56} height={14} />
            ) : bal && bal > 0n ? (
              <>
                <span className="block text-body-3 tabular">{formatTokenAmount(bal, t.decimals)}</span>
                {price !== undefined && <span className="block text-body-4 text-text-2 tabular">{formatUsd(toNumber(bal, t.decimals) * price)}</span>}
              </>
            ) : null}
          </span>
        )}
        {isSelected && <Check size={18} className="shrink-0 text-accent" />}
      </button>
    )
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} width={480} tall testId="token-selector">
      <div className="flex h-full flex-col">
        <label className="flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-surface-2 px-4 focus-within:ring-1 focus-within:ring-accent">
          <Search size={18} className="text-text-3" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search name, symbol or paste address"
            aria-label="Search tokens"
            data-testid="token-search"
            className="w-full bg-transparent text-body-2 outline-none"
            spellCheck={false}
            autoComplete="off"
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery('')} className="text-text-3 hover:text-text-1">
              <X size={16} />
            </button>
          )}
        </label>

        {!query && commonBases.length > 0 && (
          <div className="mt-3 grid shrink-0 grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Common tokens">
            {commonBases.map((t) => {
              const isSel = selected?.address === t.address
              return (
                <button
                  key={t.address}
                  type="button"
                  disabled={isSel}
                  onClick={() => choose(t)}
                  data-testid={`token-chip-${t.symbol}`}
                  className="flex flex-col items-center gap-1.5 rounded-xl bg-surface-2 px-1 py-2.5 transition-colors hover:bg-surface-2-hover disabled:opacity-50"
                >
                  <TokenLogo token={t} size={28} />
                  <span className="max-w-full truncate text-body-4 font-semibold">{t.symbol}</span>
                </button>
              )
            })}
          </div>
        )}

        <div ref={listRef} className="-mx-2 mt-3 min-h-[240px] flex-1 overflow-y-auto px-2 scrollbar-thin" role="listbox" aria-label="Tokens">
          {unknown ? (
            <ImportToken address={unknown} onImported={choose} />
          ) : flat.length === 0 ? (
            <p className="py-10 text-center text-body-3 text-text-2">No results for “{query}”.</p>
          ) : (
            <>
              {owned.length > 0 && <SectionTitle>Your tokens</SectionTitle>}
              {owned.map((t, i) => row(t, i))}
              <SectionTitle>{query ? 'Search results' : 'Tokens'}</SectionTitle>
              {rest.map((t, i) => row(t, i + owned.length))}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pt-2 pb-1 text-body-3 text-text-2">{children}</div>
}

/** Unknown token by address: read metadata on-chain, warn, require acknowledgement (ui-ux.md §3.6). */
function ImportToken({ address, onImported }: { address: Address; onImported: (t: Token) => void }) {
  const client = usePublicClient()
  const add = useImportedTokens((s) => s.add)
  const [ack, setAck] = useState(false)
  const q = useQuery({
    queryKey: ['token-meta', address],
    enabled: !!client,
    retry: 0,
    queryFn: async () => {
      if (!client) throw new Error('No client')
      const a = getAddress(address)
      const code = await client.getCode({ address: a })
      if (!code || code === '0x') throw new Error('No contract at this address')
      const [symbol, name, decimals] = await Promise.all([
        client.readContract({ address: a, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address: a, abi: erc20Abi, functionName: 'name' }),
        client.readContract({ address: a, abi: erc20Abi, functionName: 'decimals' }),
      ])
      return { address: a, symbol, name, decimals: Number(decimals) }
    },
  })
  if (q.isLoading)
    return (
      <div className="flex items-center gap-3 p-3">
        <Skeleton width={36} height={36} />
        <Skeleton width={160} height={16} />
      </div>
    )
  if (q.isError || !q.data)
    return <p className="py-10 text-center text-body-3 text-text-2" data-testid="import-not-token">Not a token on MetaChain Devnet.</p>
  const meta = q.data
  const token: Token = { chainId: DEVNET_CHAIN_ID, address: meta.address, symbol: meta.symbol, name: meta.name, decimals: meta.decimals, logoURI: `/tokens/${meta.symbol}.svg` }
  return (
    <div className="mt-1 rounded-2xl border border-border p-4" data-testid="import-token">
      <div className="flex items-center gap-3">
        <TokenLogo token={{ symbol: meta.symbol, address: meta.address, logoURI: '' }} size={40} />
        <div>
          <div className="font-semibold">{meta.name}</div>
          <div className="text-body-3 text-text-2">
            {meta.symbol} · {meta.decimals} decimals · <span className="font-mono">{shortenAddress(meta.address)}</span>
          </div>
        </div>
      </div>
      <div className="mt-4 flex gap-3 rounded-xl bg-critical-tint p-3 text-body-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-critical" />
        <div>
          <div className="font-semibold text-critical">Unknown token</div>
          <p className="mt-0.5 text-text-2">This token is not on the MetaSwap list. Anyone can create a token with any name, including fake versions of real tokens. Check the address before trading.</p>
        </div>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-body-3">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="size-4 accent-[var(--ms-accent-fill)]" data-testid="import-ack" />
        I understand the risk
      </label>
      <Button
        className="mt-3"
        fullWidth
        size="lg"
        disabled={!ack}
        data-testid="import-confirm"
        onClick={() => {
          add(token)
          onImported(token)
        }}
      >
        Import {meta.symbol}
      </Button>
    </div>
  )
}
