// Response shapes of the MetaSwap API (services/api). Mirrors the binding contract in PLAN.md
// ("API — services/api"). Amounts are decimal strings in base units unless suffixed Usd/Formatted.
import type { Address, Hex } from 'viem'

export interface HealthResponse {
  ok: boolean
  chainId: number
  indexedBlock: number
  headBlock: number
}

export interface ApiToken {
  chainId: number
  address: Address
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  tags?: string[]
}

export interface TokenListResponse {
  name: string
  tokens: ApiToken[]
}

export interface TokenStats {
  token: ApiToken
  priceUsd: number | null
  change1h: number | null
  change24h: number | null
  volume24hUsd: number | null
  tvlUsd: number | null
  fdvUsd: number | null
  marketCapUsd: number | null
}

export interface ExploreTokenRow {
  address: Address
  symbol: string
  name: string
  decimals: number
  priceUsd: number | null
  change1h?: number | null
  change24h?: number | null
  volume24hUsd?: number | null
  tvlUsd?: number | null
  fdvUsd?: number | null
  sparkline?: Array<{ time: number; priceUsd: number } | number>
  token?: ApiToken
}

export interface ExplorePoolRow {
  address: Address
  version: 'v2' | 'v3'
  token0: ApiToken | Address
  token1: ApiToken | Address
  fee: number | null
  tvlUsd: number
  volume24hUsd: number
  volume7dUsd: number
  apr: number
}

export interface RouteHop {
  type: 'v2' | 'v3'
  pool: Address
  tokenIn: Address | ApiToken
  tokenOut: Address | ApiToken
  fee?: number | null
  percent?: number
}

export interface MethodParameters {
  to: Address
  calldata: Hex
  value: string
  /** Simulated gas +30% (API). Send it as the tx gas limit when present. */
  gasLimit?: string
}

export interface TypedDataPayload {
  domain: Record<string, unknown>
  types: Record<string, Array<{ name: string; type: string }>>
  values?: Record<string, unknown>
  message?: Record<string, unknown>
  primaryType?: string
}

export interface QuoteResponse {
  id?: string
  quoteId?: string
  createdAt?: number
  expiresAt?: number
  tokenIn?: Address | ApiToken
  tokenOut?: Address | ApiToken
  type?: 'EXACT_INPUT' | 'EXACT_OUTPUT'
  route: RouteHop[][]
  /** Per-leg split info aligned with `route`. */
  routes?: Array<{ percent: number; amountIn?: string; amountOut?: string; protocol?: string; routeString?: string }>
  wrap?: 'wrap' | 'unwrap' | null
  amountIn: string
  amountOut: string
  amountOutMin?: string
  amountInMax?: string
  priceImpactBps: number
  gasEstimate: string | number
  gasUsd: number | null
  routeString?: string
  slippageBps?: number
  methodParameters: MethodParameters
  approval?: { required: boolean; token?: Address; spender?: Address }
  permit2?: { required: boolean; spender?: Address; [k: string]: unknown }
  permitData?: TypedDataPayload | null
  feeBps?: number
  feeUsd?: number
}

export interface SwapResponse {
  methodParameters: MethodParameters
  gasEstimate?: string | number
  gasLimit?: string
}

export type OrderStatus = 'open' | 'filled' | 'expired' | 'cancelled' | 'error'

export interface XOrder {
  orderHash: Hex
  hash?: Hex
  status: OrderStatus
  swapper: Address
  encodedOrder?: Hex
  signature?: Hex
  inputToken?: Address
  inputStartAmount?: string
  inputEndAmount?: string
  inputAmount?: string
  outputToken?: Address
  outputStartAmount?: string
  outputEndAmount?: string
  outputAmount?: string
  nonce?: string
  deadline?: number
  decayStartTime?: number
  decayEndTime?: number
  createdAt?: number | string
  fillTxHash?: Hex | null
  txHash?: Hex | null
  filledAt?: number | string | null
  [k: string]: unknown
}

export interface XQuoteResponse {
  tokenIn?: Address
  tokenOut?: Address
  amountIn?: string
  /** Indicative best-case output (start of decay). */
  startAmount?: string
  /** Worst-case / limit output (end of decay). */
  endAmount?: string
  amountOut?: string
  decayStartTime?: number
  decayEndTime?: number
  deadline?: number
  reactor?: Address
  exclusiveFiller?: Address
  exclusivityOverrideBps?: number
  [k: string]: unknown
}

export interface ActivityItem {
  type: string
  txHash?: Hex
  hash?: Hex
  timestamp?: number
  blockNumber?: number
  summary?: string
  tokenIn?: Address | ApiToken
  tokenOut?: Address | ApiToken
  amountIn?: string
  amountOut?: string
  amountUsd?: number
  valueUsd?: number
  [k: string]: unknown
}

export interface BalanceRow {
  token: ApiToken
  balance: string
  priceUsd?: number | null
  valueUsd?: number | null
}

export interface PositionRow {
  version: 'v2' | 'v3'
  tokenId?: string
  pool?: Address
  pair?: Address
  token0: ApiToken | Address
  token1: ApiToken | Address
  fee?: number | null
  liquidity?: string
  inRange?: boolean
  valueUsd?: number | null
  uncollectedFeesUsd?: number | null
  [k: string]: unknown
}

/* ------------------------------------------------------------------ Stage 5: earn + portfolio */

export interface EarnVault {
  address: Address
  asset: ApiToken
  symbol: string
  name?: string
  apyPct: number
  tvlUsd: number | null
  totalAssets: string
  depositors: number
}

export interface EarnPosition {
  vault: Address | EarnVault
  shares: string
  assets: string
  valueUsd: number | null
  depositedUsd: number | null
  lifetimeEarningsUsd: number | null
}

export interface PortfolioToken {
  token: ApiToken & { isNative?: boolean }
  priceUsd: number | null
  balance: string
  valueUsd: number | null
  avgCostUsd?: number | null
  costBasisUsd?: number | null
  unrealizedPnlUsd?: number | null
  unrealizedPnlPct?: number | null
  change24h?: number | null
}

export interface PortfolioNft {
  tokenId: string
  tokenURI?: string
  image?: string
  name?: string
  pool?: Address | null
  [k: string]: unknown
}

export interface PortfolioResponse {
  address: Address
  totalUsd: number
  change24hUsd: number | null
  change24hPct: number | null
  tokens: PortfolioToken[]
  pools: PositionRow[]
  earn: EarnPosition[]
  nfts: PortfolioNft[]
  activity: ActivityItem[]
}
