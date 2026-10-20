// Discovery helpers for the Explore additions: token categories and badges, Trending, Earn vaults and
// Auctions (launches). The Trending, Earn and Launches endpoints are being built by the API, so every
// normaliser here accepts several plausible shapes and returns empty lists rather than throwing.
import type { TokenRow } from './types'
import { toNum, toSeconds } from './transforms'

/* ------------------------------------------------------------------ categories & badges */

export type TokenCategory = 'all' | 'trending' | 'stablecoins' | 'gainers' | 'memes' | 'majors' | 'defi' | 'l2' | 'launched' | 'wrapped'

/** Chips shown in the bar. Chips after "Memes" live under the More ▾ dropdown. */
export const PRIMARY_CATEGORIES: Array<{ value: TokenCategory; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'trending', label: 'Trending' },
  { value: 'stablecoins', label: 'Stablecoins' },
  { value: 'gainers', label: 'Top Gainers' },
  { value: 'memes', label: 'Memes' },
]

export const MORE_CATEGORIES: Array<{ value: TokenCategory; label: string }> = [
  { value: 'majors', label: 'Majors' },
  { value: 'defi', label: 'DeFi' },
  { value: 'l2', label: 'L2' },
  { value: 'launched', label: 'Launched' },
  { value: 'wrapped', label: 'Wrapped' },
]

export const CATEGORY_LABEL: Record<TokenCategory, string> = Object.fromEntries(
  [...PRIMARY_CATEGORIES, ...MORE_CATEGORIES].map((c) => [c.value, c.label]),
) as Record<TokenCategory, string>

export function parseCategory(v: string | null | undefined): TokenCategory {
  const known = Object.keys(CATEGORY_LABEL) as TokenCategory[]
  return (known as string[]).includes(v ?? '') ? (v as TokenCategory) : 'all'
}

/** Tag ids used in the API and their badge labels. */
const TAG_LABEL: Record<string, string> = {
  majors: 'Majors',
  stablecoin: 'Stablecoins',
  stablecoins: 'Stablecoins',
  wrapped: 'Wrapped',
  defi: 'DeFi',
  l2: 'L2',
  launched: 'Launched',
  meme: 'Memes',
  memes: 'Memes',
}

const MAJOR_SYMBOLS = new Set(['ETH', 'WETH', 'mWBTC'])
const STABLE_SYMBOLS = new Set(['mUSDC', 'mUSDT', 'mDAI', 'USDC', 'USDT', 'DAI'])

/** Badge labels for a token row: API tags plus the symbol-derived ones (Majors, Stablecoins, Wrapped). */
export function tokenBadges(row: Pick<TokenRow, 'symbol' | 'tags'>): string[] {
  const set = new Set<string>()
  for (const t of row.tags) {
    const label = TAG_LABEL[t.toLowerCase()]
    if (label) set.add(label)
  }
  if (MAJOR_SYMBOLS.has(row.symbol)) set.add('Majors')
  if (STABLE_SYMBOLS.has(row.symbol)) set.add('Stablecoins')
  if (row.symbol === 'WETH') set.add('Wrapped')
  return [...set]
}

/** Whether a row belongs to a category chip. `trending` is the set of trending token addresses. */
export function matchesCategory(row: TokenRow, category: TokenCategory, trending: ReadonlySet<string>): boolean {
  switch (category) {
    case 'all':
      return true
    case 'trending':
      return trending.has(row.address.toLowerCase())
    case 'stablecoins':
      return tokenBadges(row).includes('Stablecoins')
    case 'gainers':
      return (row.change24h ?? 0) > 0
    case 'wrapped':
      return tokenBadges(row).includes('Wrapped')
    case 'majors':
      return tokenBadges(row).includes('Majors')
    default: {
      // Remaining chips map to a tag label.
      const label = CATEGORY_LABEL[category]
      return tokenBadges(row).includes(label)
    }
  }
}

/* ------------------------------------------------------------------ trending */

/** Accepts GET /explore/trending as a bare list or `{ tokens | trending | items: [...] }`. */
export function listFrom(body: unknown, keys: string[]): unknown[] {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const k of [...keys, 'items', 'data', 'rows']) {
      const v = (body as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v
    }
  }
  return []
}

/* ------------------------------------------------------------------ earn vaults */

export interface VaultCard {
  id: string
  symbol: string
  name: string
  address: string | null
  /** Logo symbol (the underlying token). */
  logoSymbol: string
  apyPct: number | null
  tvlUsd: number | null
}

/** Normalises a vault from GET /earn/vaults. The route key is the vault slug or address. */
export function normalizeVault(v: unknown): VaultCard | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const token = (o.token && typeof o.token === 'object' ? o.token : null) as Record<string, unknown> | null
  const symbol = String(token?.symbol ?? o.symbol ?? o.underlying ?? '')
  const address = typeof o.address === 'string' ? o.address : typeof o.vault === 'string' ? (o.vault as string) : null
  const id = String(o.slug ?? o.id ?? address ?? '')
  if (!id || !symbol) return null
  return {
    id,
    symbol,
    name: String(o.name ?? token?.name ?? symbol),
    address,
    logoSymbol: symbol,
    apyPct: toNum(o.apy ?? o.apyPct ?? o.apr),
    tvlUsd: toNum(o.tvlUsd ?? o.tvl),
  }
}

/* ------------------------------------------------------------------ auctions (launches) */

export type AuctionStatus = 'live' | 'starting' | 'launched' | 'failed'

export interface AuctionRow {
  id: string
  name: string
  symbol: string
  address: string | null
  verified: boolean
  isNew: boolean
  /** Fully diluted value at the auction floor, USD. */
  fdvAtFloorUsd: number | null
  bidVolumeUsd: number | null
  thresholdUsd: number | null
  /** Share of the launch threshold already bid, 0..100. */
  thresholdMetPct: number | null
  status: AuctionStatus
  /** Unix milliseconds. */
  startsAtMs: number | null
  endsAtMs: number | null
  logoURI: string | null
}

const STATUS_MAP: Record<string, AuctionStatus> = {
  active: 'live',
  live: 'live',
  open: 'live',
  starting: 'starting',
  upcoming: 'starting',
  scheduled: 'starting',
  launched: 'launched',
  settled: 'launched',
  failed: 'failed',
  cancelled: 'failed',
}

function ms(v: unknown): number | null {
  const n = toNum(v)
  if (n !== null) return toSeconds(n) * 1000
  if (typeof v === 'string' && v) {
    const t = Date.parse(v)
    if (Number.isFinite(t)) return t
  }
  return null
}

/** Normalises one auction from GET /launches. Unknown fields become null, never a fake zero. */
export function normalizeAuction(a: unknown): AuctionRow | null {
  if (!a || typeof a !== 'object') return null
  const o = a as Record<string, unknown>
  const token = (o.token && typeof o.token === 'object' ? o.token : {}) as Record<string, unknown>
  const symbol = String(o.symbol ?? token.symbol ?? '')
  const id = String(o.slug ?? o.id ?? o.address ?? token.address ?? '')
  if (!id || !symbol) return null
  const statusRaw = String(o.status ?? 'live').toLowerCase()
  return {
    id,
    name: String(o.name ?? token.name ?? symbol),
    symbol,
    address: typeof token.address === 'string' ? token.address : typeof o.tokenAddress === 'string' ? o.tokenAddress : null,
    verified: o.verified === true || token.verified === true,
    isNew: o.isNew === true || o.new === true,
    fdvAtFloorUsd: toNum(o.fdvAtFloorUsd ?? o.fdvUsd ?? o.fdv),
    bidVolumeUsd: toNum(o.bidVolumeUsd ?? o.bidVolume),
    thresholdUsd: toNum(o.thresholdUsd ?? o.threshold),
    thresholdMetPct: toNum(o.thresholdMetPct ?? o.thresholdPct),
    status: STATUS_MAP[statusRaw] ?? 'live',
    startsAtMs: ms(o.startsAt ?? o.start),
    endsAtMs: ms(o.endsAt ?? o.end),
    logoURI: typeof o.logoURI === 'string' ? o.logoURI : typeof token.logoURI === 'string' ? (token.logoURI as string) : null,
  }
}

/** Time-based progress of an auction, 0..100, from its start and end. Null when either bound is unknown. */
export function auctionTimeProgress(a: Pick<AuctionRow, 'startsAtMs' | 'endsAtMs'>, nowMs: number): number | null {
  if (a.startsAtMs === null || a.endsAtMs === null || a.endsAtMs <= a.startsAtMs) return null
  return Math.min(100, Math.max(0, ((nowMs - a.startsAtMs) / (a.endsAtMs - a.startsAtMs)) * 100))
}

/** Remaining seconds to the end of an auction (0 once it has ended, null when unknown). */
export function auctionSecondsLeft(a: Pick<AuctionRow, 'endsAtMs'>, nowMs: number): number | null {
  if (a.endsAtMs === null) return null
  return Math.max(0, Math.floor((a.endsAtMs - nowMs) / 1000))
}

export type AuctionChip = 'all' | 'verified' | 'new' | 'launched'

export function filterAuctions(rows: readonly AuctionRow[], chip: AuctionChip, status: AuctionStatus | 'all', query: string): AuctionRow[] {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => {
    if (chip === 'verified' && !r.verified) return false
    if (chip === 'new' && !r.isNew) return false
    if (chip === 'launched' && r.status !== 'launched') return false
    if (status !== 'all' && r.status !== status) return false
    if (!q) return true
    return r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q)
  })
}
