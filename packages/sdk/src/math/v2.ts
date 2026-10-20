// Exact integer V2 constant-product math (matches MetaSwapV2Library / UniswapV2Library).

export const V2_FEE_BPS = 30n

export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n) throw new Error('INSUFFICIENT_INPUT_AMOUNT')
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('INSUFFICIENT_LIQUIDITY')
  const amountInWithFee = amountIn * 997n
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee)
}

export function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountOut <= 0n) throw new Error('INSUFFICIENT_OUTPUT_AMOUNT')
  if (reserveIn <= 0n || reserveOut <= amountOut) throw new Error('INSUFFICIENT_LIQUIDITY')
  return (reserveIn * amountOut * 1000n) / ((reserveOut - amountOut) * 997n) + 1n
}

/** amountB = amountA * reserveB / reserveA (no fee) — used for "add liquidity" ratio. */
export function quote(amountA: bigint, reserveA: bigint, reserveB: bigint): bigint {
  if (amountA <= 0n) throw new Error('INSUFFICIENT_AMOUNT')
  if (reserveA <= 0n || reserveB <= 0n) throw new Error('INSUFFICIENT_LIQUIDITY')
  return (amountA * reserveB) / reserveA
}

/**
 * Price impact in basis points: how much worse the execution price is than the pool's mid
 * price, net of the LP fee (so a tiny trade reports ~0, matching Uniswap's UI).
 */
export function v2PriceImpactBps(amountIn: bigint, amountOut: bigint, reserveIn: bigint, reserveOut: bigint): number {
  if (amountIn === 0n) return 0
  // mid-price output without impact, after fee
  const ideal = (amountIn * reserveOut * 997n) / (reserveIn * 1000n)
  if (ideal === 0n) return 0
  return Number(((ideal - amountOut) * 10_000n) / ideal)
}
