// Explore data hooks. Built on the shared useApiQuery / apiGet (src/api). Keys start with ['api', ...].
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { NATIVE_ADDRESS } from '@metaswap/sdk'
import { apiGet, asList } from '@/api/client'
import { useApiQuery } from '@/api/hooks'
import type { CandlePoint, ExploreStatsRaw, ExploreTokenApiRow, PoolApiRow, PoolDetailApi, PoolHistoryPoint, PoolTicksApi, RangeKey, TokenDetailApi, TokenRow, TxRow } from './types'
import { sumRecentVolume } from './poolFilters'
import { normalizePool, normalizeTokenRow, withNativeEthRow, normalizeTx, RANGES, rangeFrom, toCandles, toSeries, type RangeConfig } from './transforms'

/** Explore polls every 10 s (spec: 10 to 15 s). */
export const EXPLORE_REFRESH_MS = 10_000

/** Token address used in URLs for native ETH. The API maps the sentinel to WETH data. */
export function apiTokenAddress(urlAddress: string): string {
  return urlAddress === 'NATIVE' ? NATIVE_ADDRESS : urlAddress
}

export function useExploreStatsData() {
  return useApiQuery<ExploreStatsRaw>(['explore', 'stats', 'day'], '/explore/stats', { interval: 'day' }, {
    refetchInterval: EXPLORE_REFRESH_MS,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  })
}

export function useExploreTokenRows(range: RangeKey) {
  return useQuery({
    queryKey: ['api', 'explore', 'tokens', 'rows', range],
    queryFn: async ({ signal }) => {
      const body = await apiGet<unknown>('/explore/tokens', { sort: 'volume', order: 'desc', range }, { signal })
      return withNativeEthRow(asList<ExploreTokenApiRow>(body, 'tokens').map(normalizeTokenRow).filter((r): r is TokenRow => r !== null))
    },
    refetchInterval: EXPLORE_REFRESH_MS,
    staleTime: 5_000,
    retry: 0,
    placeholderData: keepPreviousData,
  })
}

export function useExplorePoolRows() {
  return useQuery({
    queryKey: ['api', 'explore', 'pools', 'rows'],
    queryFn: async ({ signal }) => {
      const body = await apiGet<unknown>('/explore/pools', { sort: 'tvl', order: 'desc' }, { signal })
      return asList<PoolApiRow>(body, 'pools').map(normalizePool)
    },
    refetchInterval: EXPLORE_REFRESH_MS,
    staleTime: 5_000,
    retry: 0,
    placeholderData: keepPreviousData,
  })
}

export interface TxFilter {
  type?: 'swap' | 'add' | 'remove'
  token?: string
  pool?: string
}

/** Recent transactions, normalised. `resolve` maps an address to a symbol when a row only has an address. */
export function useExploreTransactions(filter: TxFilter = {}, limit = 50) {
  return useQuery({
    queryKey: ['api', 'explore', 'transactions', 'rows', filter, limit],
    queryFn: async ({ signal }) => {
      const body = await apiGet<unknown>('/explore/transactions', { ...filter, limit }, { signal })
      return asList<Record<string, unknown>>(body, 'transactions')
        .map((item) => normalizeTx(item))
        .filter((t): t is TxRow => t !== null)
    },
    refetchInterval: EXPLORE_REFRESH_MS,
    staleTime: 5_000,
    retry: 0,
    placeholderData: keepPreviousData,
  })
}

/** Token stats. Unknown tokens reject with ApiError status 404 (the page turns that into a not-found state). */
export function useTokenDetail(address: string | undefined) {
  return useApiQuery<TokenDetailApi>(['tokens', 'detail', address], `/tokens/${address}`, undefined, {
    enabled: !!address,
    refetchInterval: EXPLORE_REFRESH_MS,
    staleTime: 5_000,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 1,
  })
}

/** Line data for price mode: price-history for 1H..1Y, daily candle closes for ALL. */
export function useTokenPriceLine(address: string | undefined, range: RangeKey) {
  const cfg = RANGES[range]
  return useQuery({
    queryKey: ['api', 'tokens', address, 'price-line', range],
    enabled: !!address,
    queryFn: async ({ signal }) => {
      if (cfg.priceRange) {
        const body = await apiGet<unknown>(`/tokens/${address}/price-history`, { range: cfg.priceRange }, { signal })
        return toSeries(asList<{ time: number; priceUsd: number }>(body, 'points').map((p) => ({ time: p.time, value: p.priceUsd })))
      }
      const candles = await candlesFor(address!, '1d', undefined, signal)
      return toSeries(candles.map((c) => ({ time: c.time, value: c.close })))
    },
    refetchInterval: EXPLORE_REFRESH_MS,
    placeholderData: keepPreviousData,
    retry: 0,
  })
}

async function candlesFor(address: string, interval: RangeConfig['candleInterval'], from: number | undefined, signal?: AbortSignal): Promise<CandlePoint[]> {
  const body = await apiGet<unknown>(`/tokens/${address}/candles`, { interval, from }, { signal })
  return toCandles(asList<Partial<CandlePoint> & { time: number }>(body, 'candles'))
}

/** OHLC candles (with volume) for candle and volume modes. */
export function useTokenCandles(address: string | undefined, range: RangeKey) {
  const cfg = RANGES[range]
  return useQuery({
    queryKey: ['api', 'tokens', address, 'candles', range],
    enabled: !!address,
    queryFn: ({ signal }) => candlesFor(address!, cfg.candleInterval, rangeFrom(range, Math.floor(Date.now() / 1000)), signal),
    refetchInterval: EXPLORE_REFRESH_MS,
    placeholderData: keepPreviousData,
    retry: 0,
  })
}

/** All-time candles (daily) for the all-time high/low and the ALL range. */
export function useTokenAllCandles(address: string | undefined) {
  return useQuery({
    queryKey: ['api', 'tokens', address, 'candles', 'all-daily'],
    enabled: !!address,
    queryFn: ({ signal }) => candlesFor(address!, '1d', undefined, signal),
    refetchInterval: EXPLORE_REFRESH_MS * 3,
    retry: 0,
  })
}

/**
 * Token TVL history. Not in the PLAN endpoint list: asked of the API owner. Until it exists the
 * request fails and the chart shows "TVL history unavailable" instead of fake numbers.
 */
export function useTokenTvlHistory(address: string | undefined, range: RangeKey) {
  return useQuery({
    queryKey: ['api', 'tokens', address, 'tvl', range],
    enabled: !!address,
    queryFn: async ({ signal }) => {
      const body = await apiGet<unknown>(`/tokens/${address}/tvl-history`, { interval: RANGES[range].poolInterval, from: rangeFrom(range, Math.floor(Date.now() / 1000)) }, { signal })
      return toSeries(asList<{ time: number; tvlUsd: number }>(body, 'points', 'history').map((p) => ({ time: p.time, value: p.tvlUsd })))
    },
    retry: 0,
  })
}

export function usePoolDetail(address: string | undefined) {
  return useApiQuery<PoolDetailApi>(['pools', 'detail', address], `/pools/${address}`, undefined, {
    enabled: !!address,
    refetchInterval: EXPLORE_REFRESH_MS,
    staleTime: 5_000,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 1,
  })
}

export function usePoolHistory(address: string | undefined, interval: 'hour' | 'day') {
  return useQuery({
    queryKey: ['api', 'pools', address, 'history', interval],
    enabled: !!address,
    queryFn: async ({ signal }) => {
      const body = await apiGet<unknown>(`/pools/${address}/history`, { interval }, { signal })
      return asList<PoolHistoryPoint>(body, 'history')
    },
    refetchInterval: EXPLORE_REFRESH_MS,
    placeholderData: keepPreviousData,
    retry: 0,
  })
}

export function usePoolTicks(address: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['api', 'pools', address, 'ticks'],
    enabled: !!address && enabled,
    queryFn: ({ signal }) => apiGet<PoolTicksApi>(`/pools/${address}/ticks`, undefined, { signal }),
    refetchInterval: EXPLORE_REFRESH_MS * 3,
    retry: 0,
  })
}

/** Daily history for many pools at once (shared cache with usePoolHistory(…, 'day')). Keyed by lower-cased address. */
export function usePoolsDayHistories(addresses: readonly string[]): Record<string, PoolHistoryPoint[]> {
  const results = useQueries({
    queries: addresses.map((address) => ({
      queryKey: ['api', 'pools', address, 'history', 'day'],
      queryFn: async ({ signal }: { signal: AbortSignal }) => asList<PoolHistoryPoint>(await apiGet<unknown>(`/pools/${address}/history`, { interval: 'day' }, { signal }), 'history'),
      staleTime: 60_000,
      retry: 0,
    })),
  })
  const out: Record<string, PoolHistoryPoint[]> = {}
  results.forEach((r, i) => {
    if (r.data) out[addresses[i]!.toLowerCase()] = r.data
  })
  return out
}

/**
 * 30-day volume per pool, summed client-side from each pool's daily history (the list endpoint only has
 * 24h/7d). Returns a map keyed by lower-cased pool address; missing entries are still loading.
 */
export function usePools30dVolume(addresses: readonly string[]) {
  const hist = usePoolsDayHistories(addresses)
  const out: Record<string, number | null> = {}
  for (const [k, h] of Object.entries(hist)) out[k] = sumRecentVolume(h, 30)
  return out
}
