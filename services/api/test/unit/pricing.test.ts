import { describe, expect, it } from 'vitest'
import { aggregateCandles, bucketLast, bucketSums, buildCandles } from '../../src/pricing/candles'
import { computeUsdPrices, pctChange, poolTvlUsd, spotPrice0, swapVolumeUsd, type PricingPool } from '../../src/pricing/prices'
import { Q96, getAmountsForLiquidity, getSqrtRatioAtTick, sqrtPriceToPrice } from '../../src/lib/v3math'

const USDC = 'usdc'
const USDT = 'usdt'
const WETH = 'weth'
const META = 'meta'
const BTC = 'btc'
const LONELY = 'lonely'
const decimals = new Map([
  [USDC, 6],
  [USDT, 6],
  [WETH, 18],
  [META, 18],
  [BTC, 8],
  [LONELY, 18],
])
const e = (n: number, d: number) => BigInt(Math.round(n * 10 ** 6)) * 10n ** BigInt(d) / 10n ** 6n

// v3 sqrtPrice for a human price of token0 in token1
const sqrtFor = (price: number, d0: number, d1: number) => BigInt(Math.floor(Math.sqrt(price * 10 ** (d1 - d0)) * 2 ** 96))

describe('USD pricing', () => {
  const pools: PricingPool[] = [
    // WETH/USDC v2 deep: 1000 WETH : 3,000,000 USDC → $3000 (token0 = usdc by lexical order here: 'usdc' > 'weth'? keep explicit)
    { address: 'p1', version: 'v2', token0: USDC, token1: WETH, reserve0: e(3_000_000, 6), reserve1: e(1000, 18) },
    // shallow WETH/USDT at a wrong price: should not win against the deep pool
    { address: 'p2', version: 'v2', token0: USDT, token1: WETH, reserve0: e(500, 6), reserve1: e(1, 18) },
    // META/WETH v3 at 8/3000 WETH per META
    { address: 'p3', version: 'v3', token0: META, token1: WETH, reserve0: e(100_000, 18), reserve1: e(266, 18), sqrtPriceX96: sqrtFor(8 / 3000, 18, 18), liquidity: 1n },
    // BTC/WETH: 1 BTC = 20 WETH
    { address: 'p4', version: 'v2', token0: BTC, token1: WETH, reserve0: e(10, 8), reserve1: e(200, 18) },
  ]

  it('anchors stables and walks the deepest path', () => {
    const prices = computeUsdPrices(pools, decimals, [USDC, USDT])
    expect(prices.get(USDC)).toBe(1)
    expect(prices.get(WETH)!).toBeCloseTo(3000, 6)
    expect(prices.get(META)!).toBeCloseTo(8, 4)
    expect(prices.get(BTC)!).toBeCloseTo(60_000, 3)
    expect(prices.has(LONELY)).toBe(false)
  })

  it('spot prices: v2 reserves and v3 sqrtPrice', () => {
    expect(spotPrice0(pools[0], 6, 18)!).toBeCloseTo(1 / 3000, 10)
    expect(spotPrice0(pools[2], 18, 18)!).toBeCloseTo(8 / 3000, 8)
    expect(spotPrice0({ ...pools[2], liquidity: 0n }, 18, 18)).toBeNull()
  })

  it('tvl, volume and change helpers', () => {
    expect(poolTvlUsd(e(3_000_000, 6), e(1000, 18), 6, 18, 1, 3000)).toBeCloseTo(6_000_000, 2)
    expect(poolTvlUsd(e(100, 6), e(1, 18), 6, 18, 1, undefined)).toBeCloseTo(200, 6)
    expect(swapVolumeUsd(e(3000, 6), -e(1, 18), 6, 18, 1, 3000)).toBeCloseTo(3000, 6)
    expect(swapVolumeUsd(e(3000, 6), -e(1, 18), 6, 18, undefined, 3000)).toBeCloseTo(3000, 6)
    expect(pctChange(110, 100)).toBeCloseTo(10)
    expect(pctChange(1, null)).toBeNull()
  })
})

describe('candles', () => {
  const points = [
    { time: 60, price: 10 },
    { time: 90, price: 12 },
    { time: 100, price: 9 },
    { time: 200, price: 11 },
  ]
  const vols = [
    { time: 61, volumeUsd: 5 },
    { time: 99, volumeUsd: 7 },
    { time: 200, volumeUsd: 1 },
  ]

  it('builds minute OHLC with continuity and forward fill', () => {
    const c = buildCandles(points, vols, 60, 60, 300)
    expect(c.map((x) => x.time)).toEqual([60, 120, 180, 240, 300])
    expect(c[0]).toEqual({ time: 60, open: 10, high: 12, low: 9, close: 9, volumeUsd: 12 })
    expect(c[1]).toEqual({ time: 120, open: 9, high: 9, low: 9, close: 9, volumeUsd: 0 })
    expect(c[2]).toEqual({ time: 180, open: 9, high: 11, low: 9, close: 11, volumeUsd: 1 })
    expect(c[4].close).toBe(11)
  })

  it('uses the price before the window as the opening price', () => {
    const c = buildCandles(points.slice(3), [], 60, 120, 240, 9)
    expect(c[0]).toMatchObject({ time: 120, open: 9, close: 9 })
    expect(c[1]).toMatchObject({ time: 180, open: 9, high: 11, close: 11 })
  })

  it('aggregates 1m → 5m preserving OHLC + volume', () => {
    const m = buildCandles(points, vols, 60, 0, 599)
    const five = aggregateCandles(m, 300)
    expect(five).toHaveLength(2)
    expect(five[0]).toEqual({ time: 0, open: 10, high: 12, low: 9, close: 11, volumeUsd: 13 })
    expect(five[1]).toMatchObject({ time: 300, open: 11, close: 11, volumeUsd: 0 })
  })

  it('bucket sums and last values', () => {
    expect(bucketSums([{ time: 5, value: 1 }, { time: 65, value: 2 }, { time: 70, value: 3 }], 60, 0, 130)).toEqual([
      { time: 0, value: 1 },
      { time: 60, value: 5 },
      { time: 120, value: 0 },
    ])
    expect(bucketLast([{ time: 5, value: 1 }, { time: 65, value: 2 }], 60, 0, 130)).toEqual([
      { time: 0, value: 1 },
      { time: 60, value: 2 },
      { time: 120, value: 2 },
    ])
  })
})

describe('v3 math', () => {
  it('getSqrtRatioAtTick matches known values', () => {
    expect(getSqrtRatioAtTick(0)).toBe(Q96)
    expect(getSqrtRatioAtTick(-887272)).toBe(4295128739n)
    expect(getSqrtRatioAtTick(887272)).toBe(1461446703485210103287273052203988822378723970342n)
    expect(sqrtPriceToPrice(getSqrtRatioAtTick(6932), 18, 18)).toBeCloseTo(1.0001 ** 6932, 6)
  })

  it('position amounts in/below/above range', () => {
    const L = 10n ** 18n
    const inRange = getAmountsForLiquidity(Q96, -600, 600, L)
    expect(inRange.amount0).toBeGreaterThan(0n)
    expect(inRange.amount1).toBeGreaterThan(0n)
    expect(getAmountsForLiquidity(getSqrtRatioAtTick(-1000), -600, 600, L).amount1).toBe(0n)
    expect(getAmountsForLiquidity(getSqrtRatioAtTick(1000), -600, 600, L).amount0).toBe(0n)
  })
})
