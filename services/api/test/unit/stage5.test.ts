import { describe, expect, it } from 'vitest'
import {
  computeClearing,
  costBasis,
  fillBid,
  historyBuckets,
  marginal,
  quoteFor,
  rankTrending,
  tokensFor,
  trendingScore,
  type PriceLevel,
} from '../../src/stage5/math'
import { parseDataUriJson } from '../../src/stage5/portfolio'

describe('cost basis / unrealized P&L', () => {
  it('averages inflows at their arrival price and applies to the current balance', () => {
    // bought 1 @ $2000 and 3 @ $3000 → avg $2750; hold 2 (sold 2) at $3300
    const r = costBasis(
      [
        { qty: 1, priceUsd: 2000 },
        { qty: 3, priceUsd: 3000 },
      ],
      2,
      3300,
    )
    expect(r.avgCostUsd).toBe(2750)
    expect(r.costBasisUsd).toBe(5500)
    expect(r.valueUsd).toBe(6600)
    expect(r.unrealizedPnlUsd).toBe(1100)
    expect(r.unrealizedPnlPct).toBeCloseTo(20, 10)
  })

  it('ignores unpriced or empty inflows and handles missing prices', () => {
    const r = costBasis([{ qty: 5, priceUsd: null }, { qty: 0, priceUsd: 1 }, { qty: 10, priceUsd: 1 }], 10, 0.9)
    expect(r.avgCostUsd).toBe(1)
    expect(r.unrealizedPnlUsd).toBeCloseTo(-1, 10)
    expect(costBasis([], 1, 5)).toMatchObject({ avgCostUsd: null, costBasisUsd: null, unrealizedPnlUsd: null, valueUsd: 5 })
    expect(costBasis([{ qty: 1, priceUsd: 1 }], 1, null).unrealizedPnlUsd).toBeNull()
  })
})

describe('trending ranking', () => {
  const rows = [
    { key: 'a', volume24hUsd: 1_000_000, change24h: 1 }, // 1e6
    { key: 'b', volume24hUsd: 100_000, change24h: -30 }, // 3e6
    { key: 'c', volume24hUsd: 5_000_000, change24h: 0 }, // 0
    { key: 'd', volume24hUsd: 0, change24h: 50 }, // 0
    { key: 'e', volume24hUsd: 200_000, change24h: 4 }, // 8e5
  ]
  it('scores volume × |1D change| and ranks descending', () => {
    expect(trendingScore(rows[1])).toBe(3_000_000)
    expect(rankTrending(rows, 0, 8).map((r) => r.key)).toEqual(['b', 'a', 'e'])
  })
  it('fills up to the minimum by volume and caps at the maximum', () => {
    expect(rankTrending(rows, 4, 8).map((r) => r.key)).toEqual(['b', 'a', 'e', 'c'])
    expect(rankTrending(rows, 1, 2)).toHaveLength(2)
  })
})

describe('portfolio history buckets', () => {
  const now = 2_000_000_000
  it('produces ~N ascending buckets ending at now', () => {
    const b = historyBuckets('1D', now, now - 30 * 86400)
    expect(b.at(-1)).toBe(now)
    expect(b.length).toBeGreaterThanOrEqual(90)
    expect(b.length).toBeLessThanOrEqual(97)
    expect(b[0]).toBeGreaterThanOrEqual(now - 86400)
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1])
    expect(b[1] - b[0]).toBe(900) // 15 min
  })
  it('clips to the first available timestamp (young chains) and supports ALL', () => {
    const b = historyBuckets('1Y', now, now - 3 * 86400)
    expect(b[0]).toBeGreaterThanOrEqual(now - 3 * 86400)
    expect(b.length).toBeGreaterThan(60)
    const all = historyBuckets('ALL', now, now - 10 * 86400)
    expect(all[0]).toBe(now - 10 * 86400)
    expect(historyBuckets('1H', now, now)).toEqual([now])
    expect(() => historyBuckets('2D', now, 0)).toThrow()
  })
})

describe('auction math mirrors LaunchAuction', () => {
  const E18 = 10n ** 18n
  const qd = 6 // mUSDC
  const floor = 50_000_000_000_000_000n // 0.05 quote per token
  const tick = 5_000_000_000_000_000n // 0.005
  const supply = 1_000_000n * E18 // 1M tokens sold

  it('tokensFor / quoteFor round-trip in base units', () => {
    // 1 mUSDC at 0.05 → 20 tokens
    expect(tokensFor(1_000_000n, floor, qd)).toBe(20n * E18)
    expect(quoteFor(20n * E18, floor, qd)).toBe(1_000_000n)
    // WETH quote (18 decimals): 1 WETH at 0.0001 → 10,000 tokens
    expect(tokensFor(E18, 10n ** 14n, 18)).toBe(10_000n * E18)
  })

  it('undersubscribed → clears at the floor and every bid fills fully', () => {
    const levels: PriceLevel[] = [
      { price: floor, demand: 10_000n * 10n ** 6n },
      { price: floor + tick, demand: 5_000n * 10n ** 6n },
    ]
    const cl = computeClearing(levels, supply, floor, tick, qd)
    expect(cl.c).toBe(floor)
    const f = fillBid({ amount: 10_000n * 10n ** 6n, maxPrice: floor }, levels, supply, floor, tick, qd)
    expect(f.refund).toBe(0n)
    expect(f.tokens).toBe(tokensFor(10_000n * 10n ** 6n, floor, qd))
  })

  it('clears at a bid level with pro-rata at the margin; allocations never exceed supply', () => {
    // supply costs 50k at the floor; demand: 30k @0.08, 40k @0.06, 20k @0.05
    const L = (p: bigint, usd: number) => ({ price: p, demand: BigInt(usd) * 10n ** 6n })
    const p6 = 60_000_000_000_000_000n
    const p8 = 80_000_000_000_000_000n
    const levels = [L(floor, 20_000), L(p6, 40_000), L(p8, 30_000)]
    const cl = computeClearing(levels, supply, floor, tick, qd)
    // at 0.06: 70k buys 1.166M ≥ 1M → clears at 0.06, margin = the 40k level
    expect(cl.c).toBe(p6)
    expect(cl.full).toBe(30_000n * 10n ** 6n)
    expect(cl.md).toBe(40_000n * 10n ** 6n)
    const { mTokens, mSpent } = marginal(cl, supply, qd)
    expect(tokensFor(cl.full, cl.c, qd) + mTokens).toBe(supply)
    expect(mSpent).toBeLessThanOrEqual(cl.md)
    const top = fillBid({ amount: 30_000n * 10n ** 6n, maxPrice: p8 }, levels, supply, floor, tick, qd)
    expect(top.refund).toBe(0n)
    const margin = fillBid({ amount: 40_000n * 10n ** 6n, maxPrice: p6 }, levels, supply, floor, tick, qd)
    expect(margin.refund).toBeGreaterThan(0n)
    expect(top.tokens + margin.tokens).toBeLessThanOrEqual(supply)
    expect(supply - (top.tokens + margin.tokens)).toBeLessThan(10n ** 6n) // rounding dust only
    const below = fillBid({ amount: 20_000n * 10n ** 6n, maxPrice: floor }, levels, supply, floor, tick, qd)
    expect(below).toMatchObject({ tokens: 0n, refund: 20_000n * 10n ** 6n })
  })

  it('between levels: higher bids alone buy the supply → price rounded up to the tick', () => {
    const p10 = 100_000_000_000_000_000n
    // 120k at 0.10 buys 1.2M at 0.10; alone they buy 1M at 0.12 → but 0.12 > 0.10 (next) → clears at the next level
    const levels = [
      { price: floor, demand: 10_000n * 10n ** 6n },
      { price: p10, demand: 120_000n * 10n ** 6n },
    ]
    expect(computeClearing(levels, supply, floor, tick, qd).c).toBe(p10)
    // 72k at 0.10: at 0.05 the 72k alone buys 1.44M ≥ supply → p* = 0.072 → tick-rounded 0.075, strictly between levels
    const levels2 = [
      { price: floor, demand: 10_000n * 10n ** 6n },
      { price: p10, demand: 72_000n * 10n ** 6n },
    ]
    const cl = computeClearing(levels2, supply, floor, tick, qd)
    expect(cl.c).toBe(75_000_000_000_000_000n)
    expect(cl.md).toBe(0n)
    expect(cl.full).toBe(72_000n * 10n ** 6n)
  })
})

describe('tokenURI parsing', () => {
  it('decodes base64 and plain data URIs', () => {
    const json = { name: 'MetaSwap V3 Position', image: 'data:image/svg+xml;base64,PHN2Zy8+' }
    expect(parseDataUriJson('data:application/json;base64,' + Buffer.from(JSON.stringify(json)).toString('base64'))).toEqual(json)
    expect(parseDataUriJson('data:application/json,' + encodeURIComponent(JSON.stringify(json)))).toEqual(json)
    expect(parseDataUriJson('https://example.invalid/1')).toBeNull()
  })
})
