// V2 → V3 migration planning (pure, unit tested). Like Uniswap's V3Migrator flow, done as two
// user transactions on devnet: V2 router removeLiquidity → NPM.multicall([createAndInitialize?, mint]).
import { amountsForLiquidity, getSqrtRatioAtTick, liquidityForAmounts, minusSlippage, mintAmountsWithSlippage, priceToSqrtPriceX96, v2AmountsForLiquidity } from './math'

export interface MigrationInput {
  /** LP tokens to migrate. */
  liquidity: bigint
  reserve0: bigint
  reserve1: bigint
  totalSupply: bigint
  decimals0: number
  decimals1: number
  /** Target V3 pool price; undefined when the pool does not exist (it is created at the V2 price). */
  poolSqrtPriceX96?: bigint
  tickLower: number
  tickUpper: number
  slippageBps: number
}

export interface MigrationPlan {
  /** Expected V2 withdrawal. */
  amount0: bigint
  amount1: bigint
  /** Minimums for removeLiquidity. */
  removeMin0: bigint
  removeMin1: bigint
  /** Price used for the mint (existing pool, or the V2 spot price for a new pool). */
  sqrtPriceX96: bigint
  /** Set when the V3 pool must be created + initialised. */
  createPoolSqrtPriceX96?: bigint
  /** Mint inputs: only what the removal is guaranteed to return. */
  amount0Desired: bigint
  amount1Desired: bigint
  amount0Min: bigint
  amount1Min: bigint
  liquidityV3: bigint
  /** Expected amounts deposited into V3 and left in the wallet. */
  used0: bigint
  used1: bigint
  left0: bigint
  left1: bigint
}

/** V2 spot price (token1 per token0, human units) → sqrtPriceX96. */
export function v2SqrtPrice(reserve0: bigint, reserve1: bigint, decimals0: number, decimals1: number): bigint | null {
  if (reserve0 === 0n || reserve1 === 0n) return null
  const p = Number(reserve1) / 10 ** decimals1 / (Number(reserve0) / 10 ** decimals0)
  return priceToSqrtPriceX96(p, decimals0, decimals1)
}

export function planMigration(i: MigrationInput): MigrationPlan | null {
  if (i.liquidity <= 0n || i.totalSupply <= 0n || i.tickLower >= i.tickUpper) return null
  const { amount0, amount1 } = v2AmountsForLiquidity(i.liquidity, i.reserve0, i.reserve1, i.totalSupply)
  const removeMin0 = minusSlippage(amount0, i.slippageBps)
  const removeMin1 = minusSlippage(amount1, i.slippageBps)
  const create = i.poolSqrtPriceX96 === undefined
  const sqrtP = i.poolSqrtPriceX96 ?? v2SqrtPrice(i.reserve0, i.reserve1, i.decimals0, i.decimals1)
  if (!sqrtP) return null
  const { liquidity, amount0Min, amount1Min } = mintAmountsWithSlippage(sqrtP, i.tickLower, i.tickUpper, removeMin0, removeMin1, i.slippageBps)
  const used = amountsForLiquidity(sqrtP, i.tickLower, i.tickUpper, liquidity, true)
  const used0 = used.amount0 > removeMin0 ? removeMin0 : used.amount0
  const used1 = used.amount1 > removeMin1 ? removeMin1 : used.amount1
  return {
    amount0,
    amount1,
    removeMin0,
    removeMin1,
    sqrtPriceX96: sqrtP,
    createPoolSqrtPriceX96: create ? sqrtP : undefined,
    amount0Desired: removeMin0,
    amount1Desired: removeMin1,
    amount0Min,
    amount1Min,
    liquidityV3: liquidity,
    used0,
    used1,
    left0: amount0 - used0,
    left1: amount1 - used1,
  }
}

/** Re-export for tests: the V3 liquidity a pair of amounts buys in a range. */
export function v3LiquidityFor(sqrtP: bigint, tickLower: number, tickUpper: number, a0: bigint, a1: bigint): bigint {
  return liquidityForAmounts(sqrtP, getSqrtRatioAtTick(tickLower), getSqrtRatioAtTick(tickUpper), a0, a1)
}
