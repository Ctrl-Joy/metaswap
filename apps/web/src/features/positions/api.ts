// API hooks for the positions feature (services/api). Shared hooks live in @/api/hooks; these are
// positions-specific shapes that the shared types don't cover.
import { useQueries, useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { apiGet, asList } from '@/api/client'
import { useApiQuery } from '@/api/hooks'
import type { ApiToken, ExplorePoolRow } from '@/api/types'

export interface PositionToken extends ApiToken {
  amount: string
  amountFormatted: number
}

export interface V3PositionRow {
  version: 'v3'
  tokenId: string
  pool: Address
  fee: number
  tickLower: number
  tickUpper: number
  currentTick: number
  priceLower: number
  priceUpper: number
  currentPrice: number
  liquidity: string
  token0: PositionToken
  token1: PositionToken
  uncollectedFees: { amount0: string; amount1: string; valueUsd: number | null }
  valueUsd: number | null
  inRange: boolean
  closed: boolean
}

export interface V2PositionRow {
  version: 'v2'
  pair: Address
  pool: Address
  fee: number
  token0: PositionToken
  token1: PositionToken
  liquidity: string
  totalSupply: string
  shareOfPool: number
  valueUsd: number | null
  inRange: boolean
  closed: boolean
}

export type AnyPositionRow = V3PositionRow | V2PositionRow

export interface AccountPositions {
  address: Address
  blockNumber: string
  v2: V2PositionRow[]
  v3: V3PositionRow[]
}

export function useAccountPositionsData(address: Address | undefined) {
  return useQuery({
    // under ['api','accounts'] so trackTx's invalidation refreshes it after every tx
    queryKey: ['api', 'accounts', address, 'positions', 'lp'],
    queryFn: ({ signal }) => apiGet<AccountPositions>(`/accounts/${address}/positions`, undefined, { signal }),
    enabled: !!address,
    retry: 1,
    refetchInterval: 15_000,
  })
}

export interface PoolDetail {
  address: Address
  version: 'v2' | 'v3'
  token0: ApiToken
  token1: ApiToken
  fee: number
  tvlUsd: number | null
  volume24hUsd: number | null
  fees24hUsd: number | null
  apr: number | null
  tickSpacing?: number
  liquidity?: string
  sqrtPriceX96?: string
  tick?: number
  totalSupply?: string | null
  reserve0?: string
  reserve1?: string
}

export function usePoolDetail(address: Address | undefined) {
  return useApiQuery<PoolDetail>(['pools', address, 'lp'], `/pools/${address}`, undefined, { enabled: !!address, staleTime: 15_000, retry: 0 })
}

/** Details for several pools (position APR). */
export function usePoolDetails(addresses: Address[]) {
  return useQueries({
    queries: addresses.map((a) => ({
      queryKey: ['api', 'pools', a, 'lp', {}],
      queryFn: ({ signal }: { signal: AbortSignal }) => apiGet<PoolDetail>(`/pools/${a}`, undefined, { signal }),
      staleTime: 30_000,
      retry: 0,
    })),
  })
}

export interface TickRow {
  tick: number
  liquidityNet: string
  liquidityGross: string
  liquidityActive: string
  price0: number
  price1: number
}

export interface PoolTicks {
  pool: Address
  fee: number
  tickSpacing: number
  currentTick: number
  sqrtPriceX96: string
  liquidity: string
  ticks: TickRow[]
}

export function usePoolTicks(address: Address | undefined) {
  return useApiQuery<PoolTicks>(['pools', address, 'ticks'], `/pools/${address}/ticks`, undefined, { enabled: !!address, staleTime: 10_000, retry: 0 })
}

export interface ExplorePoolRowW3 extends ExplorePoolRow {
  feeTier?: string
  fees24hUsd?: number
}

/** All pools from /explore/pools (TVL sort) — top pools and fee-tier TVL distribution. */
export function useAllPools() {
  return useQuery({
    queryKey: ['api', 'explore', 'pools', 'tvl'],
    queryFn: async ({ signal }) => asList<ExplorePoolRowW3>(await apiGet<unknown>('/explore/pools', { sort: 'tvl' }, { signal }), 'pools'),
    staleTime: 15_000,
    retry: 0,
  })
}

export function rowTokenAddress(t: ApiToken | Address): string {
  return (typeof t === 'string' ? t : t.address).toLowerCase()
}
