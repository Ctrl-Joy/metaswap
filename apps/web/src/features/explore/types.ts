// Explore-specific response shapes (services/api/README.md). Loose on purpose: the API is
// the source of truth, and transforms.ts normalises what the UI reads.
import type { ApiToken } from '@/api/types'

export type RangeKey = '1H' | '1D' | '1W' | '1M' | '1Y' | 'ALL'

/** Unix seconds. */
export interface SeriesPoint {
  time: number
  value: number
}

export interface CandlePoint {
  time: number
  open: number
  high: number
  low: number
  close: number
  volumeUsd: number
}

export interface ExploreStatsRaw {
  tvlUsd?: number | null
  volume24hUsd?: number | null
  volume7dUsd?: number | null
  v2?: { tvlUsd?: number | null; volume24hUsd?: number | null; poolCount?: number }
  v3?: { tvlUsd?: number | null; volume24hUsd?: number | null; poolCount?: number }
  volumeHistory?: Array<{ time: number; volumeUsd: number }>
  tvlHistory?: Array<{ time: number; tvlUsd: number }>
  txCount24h?: number
}

/** A row of GET /explore/tokens: the token metadata sits under `token`. */
export interface ExploreTokenApiRow {
  token?: ApiToken
  address?: string
  symbol?: string
  name?: string
  priceUsd: number | null
  change1h?: number | null
  change24h?: number | null
  volume24hUsd?: number | null
  volumeUsd?: number | null
  tvlUsd?: number | null
  fdvUsd?: number | null
  marketCapUsd?: number | null
  sparkline?: Array<number | { time: number; priceUsd: number }>
}

/** Normalised token row used by the tables. */
export interface TokenRow {
  address: string
  symbol: string
  name: string
  decimals: number
  tags: string[]
  priceUsd: number | null
  change1h: number | null
  change24h: number | null
  volumeUsd: number | null
  tvlUsd: number | null
  fdvUsd: number | null
  marketCapUsd: number | null
  sparkline: number[]
}

export interface PoolApiRow {
  address: string
  version: 'v2' | 'v3'
  token0: ApiToken | string
  token1: ApiToken | string
  fee: number | null
  feeTier?: string
  tvlUsd: number | null
  volume24hUsd: number | null
  volume7dUsd: number | null
  fees24hUsd?: number | null
  apr: number | null
}

export interface TokenDetailApi {
  token: ApiToken
  priceUsd: number | null
  change1h: number | null
  change24h: number | null
  volume24hUsd: number | null
  volume7dUsd?: number | null
  tvlUsd: number | null
  fdvUsd: number | null
  marketCapUsd: number | null
  totalSupply?: string | null
  high24hUsd?: number | null
  low24hUsd?: number | null
}

export interface PoolDetailApi extends PoolApiRow {
  reserve0Formatted?: number | null
  reserve1Formatted?: number | null
  reserve0Usd?: number | null
  reserve1Usd?: number | null
  token0Price?: number | null
  token1Price?: number | null
  tick?: number | null
  tickSpacing?: number | null
  sqrtPriceX96?: string | null
  liquidity?: string | null
  fees24hUsd?: number | null
  createdAt?: number | null
}

export interface PoolHistoryPoint {
  time: number
  volumeUsd: number
  feesUsd?: number
  tvlUsd: number
  token0Price: number | null
}

export interface TickApi {
  tick: number
  liquidityNet: string
  liquidityGross: string
  liquidityActive: string
  price0?: number | string
  price1?: number | string
}

export interface PoolTicksApi {
  currentTick: number | null
  sqrtPriceX96?: string
  liquidity?: string
  tickSpacing?: number
  ticks: TickApi[]
}

/** A normalised transaction row (swap, add or remove). */
export interface TxRow {
  id: string
  kind: 'swap' | 'add' | 'remove' | 'other'
  /** Unix milliseconds. */
  timeMs: number
  usd: number | null
  /** Swap: [in, out]. Add/remove: [token0, token1]. Amounts are numbers in whole tokens. */
  legs: Array<{ symbol: string; amount: number | null }>
  wallet: string | null
  txHash: string | null
  pool: string | null
}
