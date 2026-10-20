// V3 price/tick helpers for UI and API. Floating point is fine for display; on-chain amounts
// always come from QuoterV2 / the pool itself.

export const Q96 = 2n ** 96n
export const MIN_TICK = -887272
export const MAX_TICK = 887272

export const FEE_TIERS = [
  { fee: 100, tickSpacing: 1, label: '0.01%', description: 'Best for very stable pairs.' },
  { fee: 500, tickSpacing: 10, label: '0.05%', description: 'Best for stable pairs.' },
  { fee: 3000, tickSpacing: 60, label: '0.3%', description: 'Best for most pairs.' },
  { fee: 10000, tickSpacing: 200, label: '1%', description: 'Best for exotic pairs.' },
] as const

export function tickSpacingForFee(fee: number): number {
  const tier = FEE_TIERS.find((t) => t.fee === fee)
  if (!tier) throw new Error(`Unsupported fee tier ${fee}`)
  return tier.tickSpacing
}

/** Human price of token0 in units of token1. */
export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const ratio = Number(sqrtPriceX96) / Number(Q96)
  return ratio * ratio * 10 ** (decimals0 - decimals1)
}

/** Human price of token0 in units of token1 at a tick. */
export function tickToPrice(tick: number, decimals0: number, decimals1: number): number {
  return 1.0001 ** tick * 10 ** (decimals0 - decimals1)
}

/** Nearest tick (floored) for a human token0 price in token1 units. */
export function priceToTick(price: number, decimals0: number, decimals1: number): number {
  const raw = price / 10 ** (decimals0 - decimals1)
  return Math.floor(Math.log(raw) / Math.log(1.0001))
}

export function nearestUsableTick(tick: number, tickSpacing: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing
  const minUsable = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing
  const maxUsable = Math.floor(MAX_TICK / tickSpacing) * tickSpacing
  return Math.min(maxUsable, Math.max(minUsable, rounded))
}

export function fullRangeTicks(tickSpacing: number): [number, number] {
  return [Math.ceil(MIN_TICK / tickSpacing) * tickSpacing, Math.floor(MAX_TICK / tickSpacing) * tickSpacing]
}

/** sqrtPriceX96 for a human price of token0 in token1 units (for pool initialization). */
export function priceToSqrtPriceX96(price: number, decimals0: number, decimals1: number): bigint {
  const raw = price / 10 ** (decimals0 - decimals1)
  // split to keep precision: sqrt(raw) * 2^96
  const sqrt = Math.sqrt(raw)
  const scaled = sqrt * 2 ** 48
  return BigInt(Math.floor(scaled * 2 ** 48))
}

/**
 * Token amounts for liquidity L in [tickLower, tickUpper] at the current sqrt price.
 * Returns raw (base-unit) amounts as floats — display only.
 */
export function amountsForLiquidity(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
): { amount0: number; amount1: number } {
  const L = Number(liquidity)
  const sp = Number(sqrtPriceX96) / Number(Q96)
  const sa = Math.sqrt(1.0001 ** tickLower)
  const sb = Math.sqrt(1.0001 ** tickUpper)
  if (sp <= sa) return { amount0: (L * (sb - sa)) / (sa * sb), amount1: 0 }
  if (sp >= sb) return { amount0: 0, amount1: L * (sb - sa) }
  return { amount0: (L * (sb - sp)) / (sp * sb), amount1: L * (sp - sa) }
}

/** Ratio helper for the deposit step: given amount0, how much token1 is needed (raw units). */
export function amount1ForAmount0(
  amount0: number,
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
): number {
  const sp = Number(sqrtPriceX96) / Number(Q96)
  const sa = Math.sqrt(1.0001 ** tickLower)
  const sb = Math.sqrt(1.0001 ** tickUpper)
  if (sp <= sa) return 0
  if (sp >= sb) return Number.POSITIVE_INFINITY
  const L = (amount0 * sp * sb) / (sb - sp)
  return L * (sp - sa)
}
