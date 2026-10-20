import { sqrtPriceToPrice } from '../lib/v3math'

export interface PricingPool {
  address: string
  version: 'v2' | 'v3'
  token0: string
  token1: string
  /** v2: reserves; v3: pool token balances */
  reserve0: bigint
  reserve1: bigint
  /** v3 only */
  sqrtPriceX96?: bigint | null
  /** v3 only: active liquidity (pools with zero in-range liquidity have no meaningful spot price) */
  liquidity?: bigint | null
}

/** Human spot price of token0 in units of token1, or null when the pool is empty. */
export function spotPrice0(pool: PricingPool, decimals0: number, decimals1: number): number | null {
  if (pool.version === 'v3') {
    if (!pool.sqrtPriceX96 || pool.sqrtPriceX96 === 0n) return null
    if (pool.liquidity !== undefined && pool.liquidity !== null && pool.liquidity === 0n) return null
    return sqrtPriceToPrice(pool.sqrtPriceX96, decimals0, decimals1)
  }
  if (pool.reserve0 === 0n || pool.reserve1 === 0n) return null
  return Number(pool.reserve1) / 10 ** decimals1 / (Number(pool.reserve0) / 10 ** decimals0)
}

/**
 * USD price per token from pool spot prices, anchored on stablecoins (= $1).
 *
 * Greedy "deepest path" expansion: at each step, among every pool that pairs an unpriced token
 * with an already-priced one, pick the pool whose priced side holds the most USD and price the
 * other token through it. With MetaSwap's pools this resolves stable → WETH → everything else,
 * while a deep direct stable pool wins over a hop through WETH. Tokens with no route (or only
 * dust liquidity) stay unpriced (absent from the map) instead of being guessed.
 */
export function computeUsdPrices(
  pools: PricingPool[],
  decimals: Map<string, number>,
  stables: Iterable<string>,
  minLiquidityUsd = 1,
): Map<string, number> {
  const prices = new Map<string, number>()
  for (const s of stables) if (decimals.has(s)) prices.set(s, 1)

  const usable = pools
    .map((p) => {
      const d0 = decimals.get(p.token0)
      const d1 = decimals.get(p.token1)
      if (d0 === undefined || d1 === undefined) return null
      const spot = spotPrice0(p, d0, d1)
      if (spot === null || !Number.isFinite(spot) || spot <= 0) return null
      return { p, spot, amt0: Number(p.reserve0) / 10 ** d0, amt1: Number(p.reserve1) / 10 ** d1 }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  for (;;) {
    let best: { token: string; price: number; depth: number } | null = null
    for (const u of usable) {
      const k0 = prices.has(u.p.token0)
      const k1 = prices.has(u.p.token1)
      if (k0 === k1) continue
      if (k0) {
        // token1 unknown: price1 = price0 / spot
        const depth = u.amt0 * prices.get(u.p.token0)!
        if (depth < minLiquidityUsd) continue
        if (!best || depth > best.depth) best = { token: u.p.token1, price: prices.get(u.p.token0)! / u.spot, depth }
      } else {
        const depth = u.amt1 * prices.get(u.p.token1)!
        if (depth < minLiquidityUsd) continue
        if (!best || depth > best.depth) best = { token: u.p.token0, price: prices.get(u.p.token1)! * u.spot, depth }
      }
    }
    if (!best) break
    prices.set(best.token, best.price)
  }
  return prices
}

/** Pool TVL in USD (sum of both sides that have a price; one-sided if only one is priced: doubled). */
export function poolTvlUsd(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number,
  price0: number | undefined,
  price1: number | undefined,
): number | null {
  const a0 = Number(reserve0) / 10 ** decimals0
  const a1 = Number(reserve1) / 10 ** decimals1
  if (price0 !== undefined && price1 !== undefined) return a0 * price0 + a1 * price1
  if (price0 !== undefined) return a0 * price0 * 2
  if (price1 !== undefined) return a1 * price1 * 2
  return null
}

/**
 * USD value of a swap: average of both legs when both are priced (Uniswap subgraph convention),
 * otherwise the priced leg.
 */
export function swapVolumeUsd(
  amount0: bigint,
  amount1: bigint,
  decimals0: number,
  decimals1: number,
  price0: number | undefined,
  price1: number | undefined,
): number | null {
  const v0 = price0 !== undefined ? (Math.abs(Number(amount0)) / 10 ** decimals0) * price0 : undefined
  const v1 = price1 !== undefined ? (Math.abs(Number(amount1)) / 10 ** decimals1) * price1 : undefined
  if (v0 !== undefined && v1 !== undefined) return (v0 + v1) / 2
  return v0 ?? v1 ?? null
}

/** Percent change between two prices, null if either is missing. */
export function pctChange(now: number | null | undefined, then: number | null | undefined): number | null {
  if (now === null || now === undefined || then === null || then === undefined || then === 0) return null
  return ((now - then) / then) * 100
}
