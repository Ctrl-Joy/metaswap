import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Coins } from 'lucide-react'
import type { Address } from 'viem'
import type { Token } from '@metaswap/sdk'
import { EmptyState, Skeleton, TokenLogo } from '@/components/ui'
import { useTokenBalances, type Balances } from '@/hooks/useTokenBalances'
import { useTokenList, useTokenPrices } from '@/features/tokens/useTokenList'
import { useSettings } from '@/state/settings'
import { formatPrice, formatTokenAmount, formatUsd } from '@/lib/format'
import { toNumber } from '@/lib/amount'
import { CHAIN_SLUG } from '@/config'

export const SMALL_BALANCE_USD = 1

export interface Holding {
  token: Token
  balance: bigint
  price?: number
  valueUsd?: number
}

export function holdingsFrom(tokens: readonly Token[], balances: Balances, prices: Record<string, number>, hideSmall: boolean): Holding[] {
  return tokens
    .map((token) => {
      const balance = balances[token.address.toLowerCase()] ?? 0n
      const price = prices[token.address.toLowerCase()]
      return { token, balance, price, valueUsd: price !== undefined ? toNumber(balance, token.decimals) * price : undefined }
    })
    .filter((h) => h.balance > 0n && (!hideSmall || (h.valueUsd ?? Infinity) >= SMALL_BALANCE_USD))
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
}

/** Portfolio holdings (balances × prices) for an account; shared by the drawer and /portfolio. */
export function usePortfolio(address: Address | undefined) {
  const { all } = useTokenList()
  const { prices } = useTokenPrices()
  const hideSmall = useSettings((s) => s.hideSmallBalances)
  const { balances, isLoading } = useTokenBalances(all, address)
  return useMemo(() => {
    const holdings = holdingsFrom(all, balances, prices, hideSmall)
    const total = holdingsFrom(all, balances, prices, false).reduce((s, h) => s + (h.valueUsd ?? 0), 0)
    return { holdings, total, isLoading }
  }, [all, balances, prices, hideSmall, isLoading])
}

export function TokenBalancesList({ address, onNavigate, limit }: { address: Address; onNavigate?: () => void; limit?: number }) {
  const { holdings, isLoading } = usePortfolio(address)
  if (isLoading)
    return (
      <div className="flex flex-col gap-3 p-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton width={36} height={36} />
            <Skeleton width={140} height={14} />
          </div>
        ))}
      </div>
    )
  if (holdings.length === 0)
    return (
      <EmptyState icon={<Coins size={20} />} title="No tokens yet" className="py-8">
        Get free test tokens on the <Link to="/buy" onClick={onNavigate} className="text-accent hover:underline">Buy</Link> page.
      </EmptyState>
    )
  return (
    <ul className="flex flex-col" data-testid="token-balances">
      {holdings.slice(0, limit).map((h) => (
        <li key={h.token.address}>
          <Link
            to={`/explore/tokens/${CHAIN_SLUG}/${h.token.isNative ? 'NATIVE' : h.token.address}`}
            onClick={onNavigate}
            className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2"
            data-testid={`holding-${h.token.symbol}`}
          >
            <TokenLogo token={h.token} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-3 font-semibold">{h.token.name}</span>
              <span className="block text-body-4 text-text-2 tabular">
                {formatTokenAmount(h.balance, h.token.decimals)} {h.token.symbol}
              </span>
            </span>
            <span className="text-right">
              <span className="block text-body-3 font-medium tabular">{h.valueUsd !== undefined ? formatUsd(h.valueUsd) : '-'}</span>
              <span className="block text-body-4 text-text-2 tabular">{formatPrice(h.price)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
