import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import type { Address } from 'viem'
import { apiGet, asList } from './client'
import type {
  ActivityItem,
  BalanceRow,
  ExplorePoolRow,
  ExploreTokenRow,
  HealthResponse,
  PositionRow,
  TokenListResponse,
  TokenStats,
  XOrder,
  OrderStatus,
} from './types'

// TanStack Query hooks for every read endpoint of services/api (PLAN.md "API").
// Query keys all start with ['api', ...] so they can be invalidated together.
// feature areas: add new endpoints here rather than calling fetch() in components.

type Opts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>

export function useApiQuery<T>(key: readonly unknown[], path: string, params?: Record<string, string | number | undefined>, opts?: Opts<T>) {
  return useQuery<T, Error, T, readonly unknown[]>({
    queryKey: ['api', ...key, params ?? {}],
    queryFn: ({ signal }) => apiGet<T>(path, params, { signal }),
    ...opts,
  })
}

export function useHealth(opts?: Opts<HealthResponse>) {
  return useApiQuery<HealthResponse>(['health'], '/health', undefined, { refetchInterval: 10_000, retry: 0, ...opts })
}

export function useApiTokens() {
  return useApiQuery<TokenListResponse>(['tokens'], '/tokens', undefined, { staleTime: 60_000, retry: 0 })
}

export function useTokenStats(address: Address | undefined, opts?: Opts<TokenStats>) {
  return useApiQuery<TokenStats>(['tokens', address], `/tokens/${address}`, undefined, { enabled: !!address, staleTime: 15_000, ...opts })
}

export function useTokenCandles(address: Address | undefined, interval: '1m' | '5m' | '1h' | '1d', from?: number, to?: number) {
  return useApiQuery<Array<{ time: number; open: number; high: number; low: number; close: number; volumeUsd: number }>>(
    ['tokens', address, 'candles'],
    `/tokens/${address}/candles`,
    { interval, from, to },
    { enabled: !!address },
  )
}

export function usePriceHistory(address: Address | undefined, range: '1H' | '1D' | '1W' | '1M' | '1Y') {
  return useApiQuery<Array<{ time: number; priceUsd: number }>>(['tokens', address, 'price-history'], `/tokens/${address}/price-history`, { range }, { enabled: !!address })
}

export function useExploreStats() {
  return useApiQuery<Record<string, unknown>>(['explore', 'stats'], '/explore/stats', undefined, { staleTime: 15_000 })
}

export function useExploreTokens(sort: 'volume' | 'tvl' | 'price' | 'change' = 'volume', order: 'asc' | 'desc' = 'desc') {
  return useQuery({
    queryKey: ['api', 'explore', 'tokens', sort, order],
    queryFn: async ({ signal }) => asList<ExploreTokenRow>(await apiGet<unknown>('/explore/tokens', { sort, order }, { signal }), 'tokens'),
    staleTime: 15_000,
    retry: 0,
  })
}

export function useExplorePools(sort: 'tvl' | 'volume' | 'apr' = 'tvl') {
  return useQuery({
    queryKey: ['api', 'explore', 'pools', sort],
    queryFn: async ({ signal }) => asList<ExplorePoolRow>(await apiGet<unknown>('/explore/pools', { sort }, { signal }), 'pools'),
    staleTime: 15_000,
  })
}

export function useExploreTransactions(params: { type?: 'swap' | 'add' | 'remove'; token?: string; pool?: string } = {}) {
  return useQuery({
    queryKey: ['api', 'explore', 'transactions', params],
    queryFn: async ({ signal }) => asList<ActivityItem>(await apiGet<unknown>('/explore/transactions', params, { signal }), 'transactions'),
    refetchInterval: 5_000,
  })
}

export function usePool(address: Address | undefined) {
  return useApiQuery<Record<string, unknown>>(['pools', address], `/pools/${address}`, undefined, { enabled: !!address })
}

export function useAccountActivity(address: Address | undefined) {
  return useQuery({
    queryKey: ['api', 'accounts', address, 'activity'],
    queryFn: async ({ signal }) => asList<ActivityItem>(await apiGet<unknown>(`/accounts/${address}/activity`, undefined, { signal }), 'activity'),
    enabled: !!address,
    refetchInterval: 10_000,
    retry: 0,
  })
}

export function useAccountPositions(address: Address | undefined) {
  return useQuery({
    queryKey: ['api', 'accounts', address, 'positions'],
    queryFn: async ({ signal }) => asList<PositionRow>(await apiGet<unknown>(`/accounts/${address}/positions`, undefined, { signal }), 'positions'),
    enabled: !!address,
    retry: 0,
  })
}

export function useAccountBalances(address: Address | undefined) {
  return useQuery({
    queryKey: ['api', 'accounts', address, 'balances'],
    queryFn: async ({ signal }) => asList<BalanceRow>(await apiGet<unknown>(`/accounts/${address}/balances`, undefined, { signal }), 'balances'),
    enabled: !!address,
    retry: 0,
  })
}

export function useXOrders(swapper: Address | undefined, status?: OrderStatus) {
  return useQuery({
    queryKey: ['api', 'x', 'orders', swapper, status ?? 'all'],
    queryFn: async ({ signal }) => asList<XOrder>(await apiGet<unknown>('/x/orders', { swapper, status }, { signal }), 'orders'),
    enabled: !!swapper,
    refetchInterval: 3_000,
    retry: 0,
  })
}
