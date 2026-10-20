import { useMemo } from 'react'
import { getAddress, type Address } from 'viem'
import { NATIVE_ETH, type Token } from '@metaswap/sdk'
import { useAccountActivity, useAccountEarn, useAccountPositions, useDemoAccount, usePortfolioQuery } from '@/api/hooks'
import type { ActivityItem, ApiToken, EarnPosition, PortfolioNft, PositionRow } from '@/api/types'
import { useWallet } from '@/wallet/hooks'
import { ANVIL_ACCOUNTS } from '@/config'
import { toNumber } from '@/lib/amount'
import { useTokenList, useTokenPrices } from '@/features/tokens/useTokenList'
import { useTokenBalances } from '@/hooks/useTokenBalances'
import { useSettings } from '@/state/settings'
import { isNative } from '@metaswap/sdk'

export interface PortfolioAccount {
  address: Address | undefined
  /** Signed out: showing the demo wallet. */
  isDemo: boolean
}

/** Connected wallet, or the demo wallet from GET /accounts/demo (Anvil #1 fallback) when signed out. */
export function usePortfolioAccount(): PortfolioAccount {
  const { address } = useWallet()
  const demo = useDemoAccount()
  if (address) return { address, isDemo: false }
  const fallback = demo.isError ? (ANVIL_ACCOUNTS[1] as Address) : undefined
  return { address: demo.data ? getAddress(demo.data) : fallback, isDemo: true }
}

export interface HoldingRow {
  token: Token
  balance: bigint
  priceUsd: number | null
  valueUsd: number | null
  unrealizedPnlUsd: number | null
  unrealizedPnlPct: number | null
  change24h: number | null
}

export interface PortfolioData {
  isLoading: boolean
  /** 'api' = GET /accounts/:a/portfolio; 'chain' = fallback from balances × prices. */
  source: 'api' | 'chain'
  totalUsd: number | null
  change24hUsd: number | null
  change24hPct: number | null
  tokens: HoldingRow[]
  pools: PositionRow[]
  earn: EarnPosition[]
  nfts: PortfolioNft[]
  activity: ActivityItem[]
  poolsLoading: boolean
  earnLoading: boolean
}

export const SMALL_USD = 1

function apiTokenToToken(t: ApiToken & { isNative?: boolean }, find: (a: string) => Token | undefined): Token {
  if (t.isNative || isNative(t.address)) return NATIVE_ETH
  return (
    find(t.address) ?? {
      chainId: t.chainId ?? 31337,
      address: getAddress(t.address),
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      logoURI: t.logoURI ?? `/tokens/${t.symbol}.svg`,
    }
  )
}

/**
 * All portfolio data for an address. Prefers the API's exact portfolio (cost basis, P/L, NFTs);
 * when that endpoint is unavailable it falls back to on-chain balances × prices so the page
 * still works (P/L shows "-").
 */
export function usePortfolioData(address: Address | undefined): PortfolioData {
  const api = usePortfolioQuery(address)
  const { all, find } = useTokenList()
  const { prices } = useTokenPrices()
  const fallbackEnabled = api.isError
  const chain = useTokenBalances(fallbackEnabled ? all : [], address)
  const positions = useAccountPositions(fallbackEnabled ? address : undefined)
  const earn = useAccountEarn(fallbackEnabled ? address : undefined)
  const activity = useAccountActivity(fallbackEnabled ? address : undefined)
  const hideSmall = useSettings((s) => s.hideSmallBalances)

  return useMemo<PortfolioData>(() => {
    const filterSmall = (rows: HoldingRow[]) => rows.filter((r) => r.balance > 0n && (!hideSmall || (r.valueUsd ?? Infinity) >= SMALL_USD))
    if (api.data) {
      const d = api.data
      const tokens = d.tokens
        .map<HoldingRow>((r) => ({
          token: apiTokenToToken(r.token, find),
          balance: BigInt(r.balance || '0'),
          priceUsd: r.priceUsd ?? null,
          valueUsd: r.valueUsd ?? null,
          unrealizedPnlUsd: r.unrealizedPnlUsd ?? null,
          unrealizedPnlPct: r.unrealizedPnlPct ?? null,
          change24h: r.change24h ?? null,
        }))
        .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
      return {
        isLoading: false,
        source: 'api',
        totalUsd: d.totalUsd,
        change24hUsd: d.change24hUsd,
        change24hPct: d.change24hPct,
        tokens: filterSmall(tokens),
        pools: (d.pools ?? []).filter((p) => !p.closed),
        earn: (d.earn ?? []).filter((e) => BigInt(e.shares || '0') > 0n),
        nfts: d.nfts ?? [],
        activity: d.activity ?? [],
        poolsLoading: false,
        earnLoading: false,
      }
    }
    const rows = all
      .map<HoldingRow>((t) => {
        const balance = chain.balances[t.address.toLowerCase()] ?? 0n
        const price = prices[t.address.toLowerCase()]
        return {
          token: t,
          balance,
          priceUsd: price ?? null,
          valueUsd: price !== undefined ? toNumber(balance, t.decimals) * price : null,
          unrealizedPnlUsd: null,
          unrealizedPnlPct: null,
          change24h: null,
        }
      })
      .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
    const totalUsd = rows.reduce((s, r) => s + (r.valueUsd ?? 0), 0)
    return {
      isLoading: api.isLoading || (fallbackEnabled && chain.isLoading),
      source: 'chain',
      totalUsd: api.isLoading ? null : totalUsd,
      change24hUsd: null,
      change24hPct: null,
      tokens: filterSmall(rows),
      pools: (positions.data ?? []).filter((p) => !p.closed),
      earn: (earn.data ?? []).filter((e) => BigInt(e.shares || '0') > 0n),
      nfts: [],
      activity: activity.data ?? [],
      poolsLoading: api.isLoading || positions.isLoading,
      earnLoading: api.isLoading || earn.isLoading,
    }
  }, [api.data, api.isLoading, all, find, prices, chain.balances, chain.isLoading, positions.data, positions.isLoading, earn.data, earn.isLoading, activity.data, fallbackEnabled, hideSmall])
}

/** Mask a formatted value when "hide balances" is on. */
export function useMask() {
  const hidden = useSettings((s) => s.hideBalances)
  return (s: string) => (hidden ? '••••' : s)
}
