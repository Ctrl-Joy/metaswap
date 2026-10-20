import { useApiQuery } from '@/api/hooks'

/** GET /x/filler — whether the API's built-in filler bot is running. */
export function useXFillerStatus() {
  const q = useApiQuery<Record<string, unknown>>(['x', 'filler'], '/x/filler', undefined, { refetchInterval: 15_000, retry: 0 })
  const d = q.data ?? {}
  const running = d.enabled === true && !d.disabledReason
  return { running: q.isSuccess && running, loading: q.isLoading, data: q.data }
}
