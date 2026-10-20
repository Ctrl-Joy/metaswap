// /launches API shapes (docs/specs/STAGE5.md §3). Loose on purpose: chain reads are the source of
// truth on the auction page; the API adds USD values, history and discovery.
import type { Address, Hex } from 'viem'

export type LaunchStatus = 'upcoming' | 'active' | 'ended' | 'launched' | 'failed'

/** On-chain `status()` enum order. */
export const STATUS_BY_INDEX: LaunchStatus[] = ['upcoming', 'active', 'ended', 'launched', 'failed']

export interface LaunchRow {
  auction: Address
  token: Address
  name: string
  symbol: string
  logoURI?: string | null
  launchpad: string | { address?: Address; name: string }
  launchpadAddress?: Address
  verified: boolean
  status: LaunchStatus
  startTime: number
  endTime: number
  ageSec?: number | null
  floorPrice?: string
  quoteToken?: Address | { address: Address; symbol: string; decimals: number }
  fdvAtFloorUsd?: number | null
  bidVolumeUsd?: number | null
  thresholdUsd?: number | null
  thresholdPct?: number | null
  clearingPriceUsd?: number | null
  pool?: Address | null
  fdvUsd?: number | null
  volume24hUsd?: number | null
  liquidityUsd?: number | null
  change1h?: number | null
  change1d?: number | null
  sparkline?: Array<number | { time: number; priceUsd?: number; value?: number }>
}

export interface PriceLevel {
  price: string
  demand: string
}

export interface LaunchBid {
  bidId: string | number
  bidder: Address
  amount: string
  maxPrice: string
  amountUsd?: number | null
  time?: number
  timestamp?: number
  txHash?: Hex
  claimed?: boolean
}

export interface LaunchDetail extends LaunchRow {
  params?: Record<string, unknown>
  priceLevels?: PriceLevel[]
  bids?: LaunchBid[]
  bidsOf?: LaunchBid[]
  description?: string
  website?: string
}

export function launchpadName(row: Pick<LaunchRow, 'launchpad'>): string {
  return typeof row.launchpad === 'string' ? row.launchpad : row.launchpad?.name ?? ''
}

export function sparkValues(row: Pick<LaunchRow, 'sparkline'>): number[] {
  return (row.sparkline ?? []).map((p) => (typeof p === 'number' ? p : (p.priceUsd ?? p.value ?? 0))).filter((v) => Number.isFinite(v))
}
