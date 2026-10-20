import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import type { Token } from '@metaswap/sdk'
import { apiGet } from '@/api/client'
import type { QuoteResponse } from '@/api/types'
import { ApiError } from '@/lib/errors'
import { QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS } from '@/config'
import type { QuoteStatus } from './ctaState'

export interface QuoteParams {
  tokenIn: Token
  tokenOut: Token
  amount: bigint
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT'
  slippageBps: number
  recipient?: Address
  deadlineMinutes: number
  protocols: string
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

function paramKey(p: QuoteParams | null) {
  if (!p) return null
  return [p.tokenIn.address, p.tokenOut.address, p.amount.toString(), p.type, p.slippageBps, p.recipient ?? '', p.deadlineMinutes, p.protocols].join('|')
}

export function fetchQuote(p: QuoteParams, signal?: AbortSignal): Promise<QuoteResponse> {
  const deadline = Math.floor(Date.now() / 1000) + p.deadlineMinutes * 60
  return apiGet<QuoteResponse>(
    '/quote',
    {
      tokenIn: p.tokenIn.address,
      tokenOut: p.tokenOut.address,
      amount: p.amount.toString(),
      type: p.type,
      slippageBps: p.slippageBps,
      recipient: p.recipient,
      swapper: p.recipient,
      deadline,
      protocols: p.protocols,
    },
    { signal },
  )
}

/** True when the API says "no route" (404/422 or a NO_ROUTE code). */
export function isNoRouteError(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'NO_ROUTE' || e.status === 404 || e.status === 422 || /no route|insufficient liquidity/i.test(e.message))
}

/**
 * Debounced GET /quote (300ms) refreshed every 15s. Returns the quote for the *current* params
 * only when they match (`stale` otherwise) so the UI never shows a quote for old input.
 */
export function useSwapQuote(params: QuoteParams | null, opts: { enabled?: boolean; paused?: boolean } = {}) {
  const key = paramKey(params)
  const debouncedKey = useDebounced(key, QUOTE_DEBOUNCE_MS)
  const debounced = useMemo(() => (debouncedKey === key ? params : null), [debouncedKey, key, params])
  const enabled = (opts.enabled ?? true) && !!debounced
  const q = useQuery({
    queryKey: ['quote', debouncedKey],
    queryFn: ({ signal }) => fetchQuote(debounced!, signal),
    enabled,
    retry: (count, e) => !isNoRouteError(e) && !(e instanceof ApiError && e.status === 0) && count < 1,
    refetchInterval: opts.paused ? false : QUOTE_REFRESH_MS,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
  const matches = q.data !== undefined && !q.isPlaceholderData && debouncedKey === key
  let status: QuoteStatus = 'idle'
  if (!params) status = 'idle'
  else if (q.isError && !q.isFetching && debouncedKey === key) status = isNoRouteError(q.error) ? 'no-route' : 'error'
  else if (matches) status = 'success'
  else status = 'loading'
  return {
    quote: matches ? q.data : undefined,
    /** Previous quote (for dimmed display while the new one loads). */
    lastQuote: q.data,
    status,
    error: q.error,
    apiDown: q.error instanceof ApiError && q.error.status === 0,
    stale: !matches,
    isFetching: q.isFetching,
    updatedAt: q.dataUpdatedAt,
    refetch: q.refetch,
  }
}
