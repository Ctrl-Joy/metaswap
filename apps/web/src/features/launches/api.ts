import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { apiGet, asList } from '@/api/client'
import type { LaunchDetail, LaunchRow } from './types'
import { liveInterval } from '@/api/realtime'

export type LaunchStatusFilter = 'all' | 'active' | 'upcoming' | 'launched' | 'failed'
export type LaunchSort = 'fdv' | 'volume' | 'liquidity' | 'age' | 'bidVolume'

export interface LaunchQuery {
  status?: LaunchStatusFilter
  launchpad?: string
  verified?: boolean
  sort?: LaunchSort
  q?: string
}

const REFRESH = 10_000

export function useLaunches(query: LaunchQuery = {}) {
  return useQuery({
    queryKey: ['api', 'launches', 'list', query],
    queryFn: async ({ signal }) =>
      asList<LaunchRow>(
        await apiGet<unknown>('/launches', { status: query.status, launchpad: query.launchpad, verified: query.verified === undefined ? undefined : String(query.verified), sort: query.sort, q: query.q }, { signal }),
        'launches',
      ),
    refetchInterval: liveInterval(REFRESH),
    placeholderData: keepPreviousData,
    retry: 0,
  })
}

export function useTrendingLaunches() {
  return useQuery({
    queryKey: ['api', 'launches', 'trending'],
    queryFn: async ({ signal }) => asList<LaunchRow>(await apiGet<unknown>('/launches/trending', undefined, { signal }), 'launches'),
    refetchInterval: liveInterval(REFRESH),
    retry: 0,
  })
}

export function useTopVerifiedLaunches() {
  return useQuery({
    queryKey: ['api', 'launches', 'top-verified'],
    queryFn: async ({ signal }) => asList<LaunchRow>(await apiGet<unknown>('/launches/top-verified', undefined, { signal }), 'launches'),
    refetchInterval: liveInterval(REFRESH),
    retry: 0,
  })
}

export function useLaunchDetail(auction: Address | undefined, bidsOf?: Address) {
  return useQuery({
    // under ['api','accounts'] too? no: trackTx invalidates ['api','accounts'] only; we refetch on an interval
    queryKey: ['api', 'launches', 'detail', auction, bidsOf],
    queryFn: ({ signal }) => apiGet<LaunchDetail>(`/launches/${auction}`, { bidsOf }, { signal }),
    enabled: !!auction,
    refetchInterval: liveInterval(5_000),
    retry: 0,
  })
}
