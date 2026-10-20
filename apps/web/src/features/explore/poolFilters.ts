import type { PoolApiRow } from './types'
import { tokenOf } from './transforms'

/** TVL buckets offered by the pools filter modal (Uniswap: <$100k, $100k–$1M, $10M+; we add $1M–$10M). */
export const TVL_BUCKETS = [
  { id: 'lt100k', label: '<$100k', min: 0, max: 100_000 },
  { id: '100k-1m', label: '$100k – $1M', min: 100_000, max: 1_000_000 },
  { id: '1m-10m', label: '$1M – $10M', min: 1_000_000, max: 10_000_000 },
  { id: 'gt10m', label: '$10M+', min: 10_000_000, max: Infinity },
] as const
export type TvlBucketId = (typeof TVL_BUCKETS)[number]['id']

export interface PoolFilters {
  /** Empty = all protocols. */
  versions: Array<'v2' | 'v3'>
  /** APR bounds in percent; null = open. */
  aprMin: number | null
  aprMax: number | null
  /** Empty = any TVL. A pool matches if it falls in any selected bucket. */
  tvl: TvlBucketId[]
}

export const EMPTY_POOL_FILTERS: PoolFilters = { versions: [], aprMin: null, aprMax: null, tvl: [] }

export function activeFilterCount(f: PoolFilters): number {
  return (f.versions.length ? 1 : 0) + (f.aprMin !== null || f.aprMax !== null ? 1 : 0) + (f.tvl.length ? 1 : 0)
}

/** Symbol match that treats the devnet "m" prefix as optional ("usdc" finds mUSDC). */
function symbolMatches(symbol: string, q: string): boolean {
  const s = symbol.toLowerCase()
  return s.includes(q) || s.replace(/^m(?=[a-z])/, '').includes(q)
}

/** Free-text pool search: pair ("weth/musdc", "eth usdc"), single symbol, fee ("0.05"), or address prefix. */
export function poolMatchesQuery(p: PoolApiRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (q.startsWith('0x')) return p.address.toLowerCase().startsWith(q)
  const a = tokenOf(p.token0).symbol
  const b = tokenOf(p.token1).symbol
  const parts = q.split(/[\s/,-]+/).filter(Boolean)
  return parts.every((part) => symbolMatches(a, part) || symbolMatches(b, part) || p.version === part || (p.fee !== null && `${p.fee / 10_000}%`.startsWith(part.replace(/%$/, ''))))
}

export function applyPoolFilters(pools: readonly PoolApiRow[], f: PoolFilters, query = ''): PoolApiRow[] {
  return pools.filter((p) => {
    if (f.versions.length && !f.versions.includes(p.version)) return false
    if (f.aprMin !== null && (p.apr === null || p.apr < f.aprMin)) return false
    if (f.aprMax !== null && (p.apr === null || p.apr > f.aprMax)) return false
    if (f.tvl.length) {
      const tvl = p.tvlUsd ?? -1
      if (!f.tvl.some((id) => {
        const b = TVL_BUCKETS.find((x) => x.id === id)!
        return tvl >= b.min && tvl < b.max
      }))
        return false
    }
    return poolMatchesQuery(p, query)
  })
}

/** Sum of daily volumes over the last `days` days (history points are unix seconds, newest last). */
export function sumRecentVolume(history: ReadonlyArray<{ time: number; volumeUsd: number | null }>, days: number, nowSec = Date.now() / 1000): number | null {
  if (!history.length) return null
  const from = nowSec - days * 86_400
  return history.reduce((s, h) => (h.time >= from && h.volumeUsd !== null && Number.isFinite(h.volumeUsd) ? s + h.volumeUsd : s), 0)
}
