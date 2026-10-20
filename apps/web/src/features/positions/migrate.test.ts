import { describe, expect, it } from 'vitest'
import { fullRangeTicks, getTickAtSqrtRatio, strategyTicks } from './math'
import { planMigration, v2SqrtPrice } from './migrate'

// WETH (18) / mUSDC (6) pair at 3000 mUSDC per WETH: 100 WETH + 300k mUSDC, 1000 LP tokens.
const base = {
  reserve0: 100n * 10n ** 18n,
  reserve1: 300_000n * 10n ** 6n,
  totalSupply: 1000n * 10n ** 18n,
  decimals0: 18,
  decimals1: 6,
  slippageBps: 50,
}

describe('V2 → V3 migration plan', () => {
  it('v2SqrtPrice gives the V2 spot price tick', () => {
    const sqrt = v2SqrtPrice(base.reserve0, base.reserve1, 18, 6)!
    const tick = getTickAtSqrtRatio(sqrt)
    // price 3000 * 10^(6-18) raw → tick ≈ ln(3e-9)/ln(1.0001)
    expect(Math.abs(tick - Math.log(3000e-12) / Math.log(1.0001))).toBeLessThan(2)
  })
  it('full-range migration into a new pool uses nearly everything and creates the pool', () => {
    const [lo, hi] = fullRangeTicks(10)
    const p = planMigration({ ...base, liquidity: 100n * 10n ** 18n, tickLower: lo, tickUpper: hi })!
    expect(p.amount0).toBe(10n * 10n ** 18n)
    expect(p.amount1).toBe(30_000n * 10n ** 6n)
    expect(p.createPoolSqrtPriceX96).toBe(p.sqrtPriceX96)
    expect(p.amount0Desired).toBe(p.removeMin0)
    expect(p.used0).toBeLessThanOrEqual(p.removeMin0)
    expect(p.used1).toBeLessThanOrEqual(p.removeMin1)
    // at the V2 price a full-range position takes ~all of both sides (within slippage + rounding)
    expect(Number(p.used0)).toBeGreaterThan(Number(p.removeMin0) * 0.99)
    expect(Number(p.used1)).toBeGreaterThan(Number(p.removeMin1) * 0.99)
    expect(p.amount0Min).toBeLessThanOrEqual(p.amount0Desired)
    expect(p.left0 + p.used0).toBe(p.amount0)
  })
  it('a one-sided range into an existing pool leaves one token in the wallet', () => {
    const sqrt = v2SqrtPrice(base.reserve0, base.reserve1, 18, 6)!
    const tick = getTickAtSqrtRatio(sqrt)
    const [lo, hi] = strategyTicks('upper', tick, 10)
    const p = planMigration({ ...base, liquidity: 10n * 10n ** 18n, poolSqrtPriceX96: sqrt, tickLower: lo, tickUpper: hi })!
    expect(p.createPoolSqrtPriceX96).toBeUndefined()
    expect(p.used1).toBe(0n) // range above the price → only token0
    expect(p.left1).toBe(p.amount1)
    expect(p.liquidityV3).toBeGreaterThan(0n)
  })
  it('rejects empty input', () => {
    expect(planMigration({ ...base, liquidity: 0n, tickLower: -10, tickUpper: 10 })).toBeNull()
    expect(planMigration({ ...base, liquidity: 1n, tickLower: 10, tickUpper: 10 })).toBeNull()
  })
})
