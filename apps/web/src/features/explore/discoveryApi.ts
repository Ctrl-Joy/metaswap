// Hooks for the Explore additions (Trending, Earn vaults, Auctions). The endpoints are being built by
// the API. Until they are deployed the API answers 404 and these hooks resolve to an empty list, so the
// sections hide themselves instead of crashing. Other errors (API down) still surface to the caller.
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/api/client'
import { ApiError } from '@/lib/errors'
import { normalizeTokenRow } from './transforms'
import { listFrom, normalizeAuction, normalizeVault, type AuctionRow, type VaultCard } from './discovery'
import type { ExploreTokenApiRow, TokenRow } from './types'

/** GET that resolves to `[]` when the endpoint is not deployed yet (404 / 501). */
async function listOrEmpty(path: string, params: Record<string, string | number | undefined> | undefined, signal?: AbortSignal): Promise<unknown[]> {
  try {
    return listFrom(await apiGet<unknown>(path, params, { signal }), ['tokens', 'trending', 'vaults', 'launches', 'auctions'])
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 501)) return []
    throw e
  }
}

/** Trending tokens for the Trending row. Same row shape as /explore/tokens. */
export function useTrendingTokens() {
  return useQuery({
    queryKey: ['api', 'explore', 'trending'],
    queryFn: async ({ signal }) => {
      const rows = await listOrEmpty('/explore/trending', undefined, signal)
      return rows.map((r) => normalizeTokenRow(r as ExploreTokenApiRow)).filter((r): r is TokenRow => r !== null)
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 0,
  })
}

/** Yield vaults for the Earn row. */
export function useEarnVaults() {
  return useQuery({
    queryKey: ['api', 'earn', 'vaults'],
    queryFn: async ({ signal }) => (await listOrEmpty('/earn/vaults', undefined, signal)).map(normalizeVault).filter((v): v is VaultCard => v !== null),
    staleTime: 30_000,
    retry: 0,
  })
}

/** All auctions (launches). Filtering by chip, status and search happens client-side. */
export function useAuctions() {
  return useQuery({
    queryKey: ['api', 'launches', 'list'],
    queryFn: async ({ signal }) => (await listOrEmpty('/launches', undefined, signal)).map(normalizeAuction).filter((a): a is AuctionRow => a !== null),
    refetchInterval: 15_000,
    retry: 0,
  })
}

