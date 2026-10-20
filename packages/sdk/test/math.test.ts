import { describe, expect, it } from 'vitest'
import * as v2 from '../src/math/v2'
import * as v3 from '../src/math/v3'
import { formatAmount, formatPercent, formatPrice, formatUsd, safeParseUnits, shortenAddress } from '../src/format'

describe('v2 math', () => {
  const r0 = 1_000n * 10n ** 18n
  const r1 = 3_000_000n * 10n ** 6n

  it('getAmountOut matches the Uniswap V2 formula', () => {
    const amountIn = 10n ** 18n
    const expected = (amountIn * 997n * r1) / (r0 * 1000n + amountIn * 997n)
    expect(v2.getAmountOut(amountIn, r0, r1)).toBe(expected)
  })

  it('getAmountIn is the inverse of getAmountOut (rounding up)', () => {
    const out = 2_000n * 10n ** 6n
    const amountIn = v2.getAmountIn(out, r0, r1)
    expect(v2.getAmountOut(amountIn, r0, r1)).toBeGreaterThanOrEqual(out)
    expect(v2.getAmountOut(amountIn - 1n, r0, r1)).toBeLessThan(out)
  })

  it('reports near-zero impact for tiny trades and large impact for big ones', () => {
    const small = 10n ** 15n
    expect(v2.v2PriceImpactBps(small, v2.getAmountOut(small, r0, r1), r0, r1)).toBeLessThanOrEqual(1)
    const big = 100n * 10n ** 18n
    expect(v2.v2PriceImpactBps(big, v2.getAmountOut(big, r0, r1), r0, r1)).toBeGreaterThan(800)
  })

  it('rejects empty pools', () => {
    expect(() => v2.getAmountOut(1n, 0n, 1n)).toThrow('INSUFFICIENT_LIQUIDITY')
  })
})

describe('v3 math', () => {
  it('tick 0 is price 1 for equal decimals', () => {
    expect(v3.tickToPrice(0, 18, 18)).toBe(1)
  })

  it('priceToTick and tickToPrice round-trip for WETH/USDC-style decimals', () => {
    // token0 = USDC (6), token1 = WETH (18): 1 USDC = 1/3000 WETH
    const price = 1 / 3000
    const tick = v3.priceToTick(price, 6, 18)
    const back = v3.tickToPrice(tick, 6, 18)
    expect(Math.abs(back - price) / price).toBeLessThan(0.0002)
  })

  it('sqrtPriceX96 conversion round-trips', () => {
    const sqrt = v3.priceToSqrtPriceX96(3000, 18, 6)
    expect(v3.sqrtPriceX96ToPrice(sqrt, 18, 6)).toBeCloseTo(3000, 6)
  })

  it('snaps to usable ticks and computes full range', () => {
    expect(v3.nearestUsableTick(61, 60)).toBe(60)
    expect(v3.nearestUsableTick(-91, 60)).toBe(-120)
    expect(v3.fullRangeTicks(60)).toEqual([-887220, 887220])
    expect(v3.tickSpacingForFee(500)).toBe(10)
  })

  it('amountsForLiquidity is single-sided outside the range', () => {
    const sqrt = v3.priceToSqrtPriceX96(1, 18, 18)
    expect(v3.amountsForLiquidity(10n ** 18n, sqrt, 100, 200).amount1).toBe(0)
    expect(v3.amountsForLiquidity(10n ** 18n, sqrt, -200, -100).amount0).toBe(0)
    const inRange = v3.amountsForLiquidity(10n ** 18n, sqrt, -100, 100)
    expect(inRange.amount0).toBeGreaterThan(0)
    expect(inRange.amount1).toBeGreaterThan(0)
  })
})

describe('formatting', () => {
  it('formats USD like the Uniswap UI', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.004)).toBe('<$0.01')
    expect(formatUsd(1234.567)).toBe('$1,234.57')
    expect(formatUsd(1_234_567_890, { compact: true })).toBe('$1.2B')
    expect(formatUsd(undefined)).toBe('-')
  })

  it('formats prices and amounts', () => {
    expect(formatPrice(3000)).toBe('$3,000.00')
    expect(formatPrice(0.0001234567)).toBe('$0.0001235')
    expect(formatAmount(1234.56789)).toBe('1,234.57')
    expect(formatAmount(0.0000001)).toBe('<0.000001')
    expect(formatAmount(0)).toBe('0')
  })

  it('formats percents with sign', () => {
    expect(formatPercent(1.234, { sign: true })).toBe('+1.23%')
    expect(formatPercent(-0.5, { sign: true })).toBe('-0.50%')
  })

  it('parses user input safely', () => {
    expect(safeParseUnits('1,000.5', 6)).toBe(1_000_500_000n)
    expect(safeParseUnits('0.1234567', 6)).toBe(123_456n)
    expect(safeParseUnits('abc', 18)).toBeNull()
    expect(safeParseUnits('', 18)).toBeNull()
  })

  it('shortens addresses', () => {
    expect(shortenAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe('0xf39F...2266')
  })
})
