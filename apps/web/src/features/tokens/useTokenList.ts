import { useMemo } from 'react'
import { getAddress, isAddress } from 'viem'
import { ALL_TOKENS, deployment, NATIVE_ETH, type Token } from '@metaswap/sdk'
import { useApiTokens, useExploreTokens } from '@/api/hooks'
import { useImportedTokens } from '@/state/ui'
import { DEVNET_CHAIN_ID } from '@/config'

/** Merge the static sdk list, the API's list and user-imported tokens (deduped by address). */
export function mergeTokenLists(...lists: Array<ReadonlyArray<Partial<Token> & Pick<Token, 'address' | 'symbol' | 'decimals'>>>): Token[] {
  const seen = new Map<string, Token>()
  for (const list of lists)
    for (const t of list) {
      if (!t?.address || !isAddress(t.address)) continue
      const key = t.address.toLowerCase()
      if (seen.has(key)) continue
      seen.set(key, {
        chainId: t.chainId ?? DEVNET_CHAIN_ID,
        address: getAddress(t.address),
        symbol: t.symbol,
        name: t.name ?? t.symbol,
        decimals: Number(t.decimals),
        logoURI: t.logoURI ?? `/tokens/${t.symbol}.svg`,
        isNative: t.isNative,
        tags: t.tags,
      })
    }
  return [...seen.values()]
}

export interface TokenListResult {
  /** Listed tokens (sdk + API), native ETH first. */
  listed: Token[]
  /** Listed + imported. */
  all: Token[]
  imported: Token[]
  isListed: (address: string) => boolean
  find: (addressOrSymbol: string | undefined | null) => Token | undefined
}

export function useTokenList(): TokenListResult {
  const api = useApiTokens()
  const imported = useImportedTokens((s) => s.tokens)
  return useMemo(() => {
    const listed = mergeTokenLists(ALL_TOKENS, api.data?.tokens ?? [])
    const all = mergeTokenLists(listed, imported)
    const listedSet = new Set(listed.map((t) => t.address.toLowerCase()))
    const find = (q: string | undefined | null) => {
      if (!q) return undefined
      const n = q.toLowerCase()
      if (n === 'eth') return NATIVE_ETH
      return all.find((t) => t.address.toLowerCase() === n) ?? all.find((t) => t.symbol.toLowerCase() === n)
    }
    return { listed, all, imported, isListed: (a: string) => listedSet.has(a.toLowerCase()), find }
  }, [api.data, imported])
}

/** USD prices keyed by lower-cased address. API explore rows first, deployment seed prices as fallback. */
export function useTokenPrices(): { prices: Record<string, number>; isLoading: boolean; live: boolean } {
  const q = useExploreTokens('volume')
  return useMemo(() => {
    const prices: Record<string, number> = {}
    for (const t of deployment.tokens ?? []) if (t.seedPriceUsd) prices[t.address.toLowerCase()] = t.seedPriceUsd
    let live = false
    for (const row of q.data ?? []) {
      const addr = (row.address ?? row.token?.address) as string | undefined
      if (addr && typeof row.priceUsd === 'number' && Number.isFinite(row.priceUsd)) {
        prices[addr.toLowerCase()] = row.priceUsd
        live = true
      }
    }
    const weth = (deployment.tokens ?? []).find((t) => t.symbol === 'WETH')
    if (weth && prices[weth.address.toLowerCase()] !== undefined) prices[NATIVE_ETH.address.toLowerCase()] = prices[weth.address.toLowerCase()]!
    return { prices, isLoading: q.isLoading, live }
  }, [q.data, q.isLoading])
}

export function priceOf(prices: Record<string, number>, token: Token | undefined): number | undefined {
  if (!token) return undefined
  return prices[token.address.toLowerCase()]
}
