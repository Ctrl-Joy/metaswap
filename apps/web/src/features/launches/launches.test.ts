import { describe, expect, it } from 'vitest'
import { decodeFunctionData, getAddress, parseUnits } from 'viem'
import { launchAuctionAbi, launchpadAbi } from './abi'
import { buildBid, buildClaimAll, buildCreateLaunch, buildSettle } from './contracts'
import { clearingPrice, fdvHuman, humanToPrice, isValidBidPrice, pctToBps, priceToHuman, quoteForTokens, snapPriceToTick, tokensForQuote } from './units'
import { formatAge, formatCountdown } from './components/LaunchBits'

const A = getAddress('0x00000000000000000000000000000000000000aa')
const Q = getAddress('0x8A791620dd6260079BF849Dc5567aDC3F2FdC318')

describe('launch price units (whole quote per whole token × 1e18)', () => {
  it('converts human prices independent of quote decimals', () => {
    expect(humanToPrice('0.05')).toBe(5n * 10n ** 16n)
    expect(priceToHuman(5n * 10n ** 16n)).toBeCloseTo(0.05)
    expect(humanToPrice('')).toBeNull()
    expect(humanToPrice('abc')).toBeNull()
  })
  it('tokens for quote match LaunchAuction._tokensFor', () => {
    // 1 mUSDC at 0.05 → 20 tokens
    expect(tokensForQuote(parseUnits('1', 6), humanToPrice('0.05')!, 6)).toBe(parseUnits('20', 18))
    // 1 WETH at 0.0001 → 10,000 tokens
    expect(tokensForQuote(parseUnits('1', 18), humanToPrice('0.0001')!, 18)).toBe(parseUnits('10000', 18))
    expect(quoteForTokens(parseUnits('20', 18), humanToPrice('0.05')!, 6)).toBe(parseUnits('1', 6))
  })
  it('snaps bid prices to ticks, never below floor', () => {
    const floor = humanToPrice('0.01')!
    const tick = floor / 100n
    expect(snapPriceToTick(humanToPrice('0.012345')!, floor, tick)).toBe(humanToPrice('0.0123')!)
    expect(snapPriceToTick(humanToPrice('0.001')!, floor, tick)).toBe(floor)
    expect(isValidBidPrice(humanToPrice('0.0123')!, floor, tick)).toBe(true)
    expect(isValidBidPrice(humanToPrice('0.012345')!, floor, tick)).toBe(false)
    expect(isValidBidPrice(humanToPrice('0.009')!, floor, tick)).toBe(false)
  })
  it('clearing price: floor when undersubscribed, highest covering level otherwise', () => {
    const floor = humanToPrice('0.01')!
    const supply = parseUnits('1000', 18) // 1000 tokens
    // 5 mUSDC at 0.01 buys 500 tokens < supply → floor
    expect(clearingPrice([{ price: floor, demand: parseUnits('5', 6) }], supply, floor, 6)).toBe(floor)
    // 30 mUSDC at 0.02 buys 1500 ≥ 1000 → 0.02 is reachable; bids above none → clears at 0.02
    const p2 = humanToPrice('0.02')!
    expect(clearingPrice([{ price: floor, demand: parseUnits('5', 6) }, { price: p2, demand: parseUnits('30', 6) }], supply, floor, 6)).toBe(p2)
    // 50 mUSDC at 0.05 alone buys 1000 at exactly 0.05 → top level
    const p5 = humanToPrice('0.05')!
    expect(clearingPrice([{ price: p2, demand: parseUnits('100', 6) }, { price: p5, demand: parseUnits('50', 6) }], supply, floor, 6)).toBe(p5)
    // 40 mUSDC above 0.02 buys 1000 at 0.04 → in-between price, rounded to the tick
    expect(clearingPrice([{ price: p2, demand: parseUnits('100', 6) }, { price: p5, demand: parseUnits('40', 6) }], supply, floor, 6, floor / 100n)).toBe(humanToPrice('0.04')!)
  })
  it('FDV and bps helpers', () => {
    expect(fdvHuman(humanToPrice('0.01')!, parseUnits('1000000', 18))).toBeCloseTo(10_000)
    expect(pctToBps('50')).toBe(5000)
    expect(pctToBps('101')).toBeNull()
  })
  it('countdown and age formatting', () => {
    expect(formatCountdown(3 * 3600 + 33 * 60 + 1)).toBe('3h 33m 1s')
    expect(formatCountdown(86400 + 8 * 3600 + 45 * 60)).toBe('1d 8h 45m')
    expect(formatAge(124 * 86400)).toBe('124d')
  })
})

describe('launch calldata', () => {
  it('createLaunch encodes LaunchParams', () => {
    const p = {
      name: 'Pixel Pup',
      symbol: 'PUP',
      totalSupply: parseUnits('1000000', 18),
      auctionSupplyBps: 5000n,
      quoteToken: Q,
      floorPrice: humanToPrice('0.01')!,
      tickSize: humanToPrice('0.0001')!,
      startTime: 100n,
      endTime: 200n,
      launchThreshold: parseUnits('1000', 6),
      liquidityBps: 5000n,
      poolFee: 10000,
      description: 'd',
      website: 'https://x.test',
    }
    const tx = buildCreateLaunch(A, p)
    const d = decodeFunctionData({ abi: launchpadAbi, data: tx.data })
    expect(d.functionName).toBe('createLaunch')
    expect(d.args![0]).toEqual(p)
  })
  it('bid vs bidETH, settle, claimAll', () => {
    const b = buildBid(A, 10n, 20n, false)
    expect(decodeFunctionData({ abi: launchAuctionAbi, data: b.data })).toMatchObject({ functionName: 'bid', args: [10n, 20n] })
    expect(b.value).toBe(0n)
    const e = buildBid(A, 10n, 20n, true)
    expect(decodeFunctionData({ abi: launchAuctionAbi, data: e.data })).toMatchObject({ functionName: 'bidETH', args: [20n] })
    expect(e.value).toBe(10n)
    expect(decodeFunctionData({ abi: launchAuctionAbi, data: buildSettle(A).data }).functionName).toBe('settle')
    expect(decodeFunctionData({ abi: launchAuctionAbi, data: buildClaimAll(A).data }).functionName).toBe('claimAll')
  })
})

describe('launch revert messages', () => {
  it('maps InvalidParams codes and auction errors from nested viem errors', async () => {
    const { launchRevertMessage } = await import('./contracts')
    expect(launchRevertMessage({ cause: { data: { errorName: 'InvalidParams', args: [7] } } })).toMatch(/end after it starts/)
    expect(launchRevertMessage({ cause: { cause: { data: { errorName: 'InvalidPrice', args: [] } } } })).toMatch(/tick size/)
    expect(launchRevertMessage(new Error('boom'))).toBeNull()
  })
})

import { bidConcentration, pctAboveFloor, supplySoldBps } from './units'

describe('auction detail maths', () => {
  const E18 = 10n ** 18n
  const lv = (p: number, d: number) => ({ price: BigInt(Math.round(p * 1000)) * (E18 / 1000n), demand: BigInt(d) * 10n ** 6n })
  it('bidConcentration returns the demand-weighted interquartile band', () => {
    const levels = [lv(0.01, 10), lv(0.02, 40), lv(0.03, 40), lv(0.05, 10)]
    const [lo, hi] = bidConcentration(levels)!
    expect(lo).toBe(lv(0.02, 0).price)
    expect(hi).toBe(lv(0.03, 0).price)
    expect(bidConcentration([])).toBeNull()
  })
  it('supplySoldBps counts demand at or above the clearing price, capped at 100%', () => {
    // 100 mUSDC at >= 0.02 buys 5,000 tokens at 0.02 → 50% of a 10,000 supply
    const levels = [lv(0.01, 1000), lv(0.02, 60), lv(0.03, 40)]
    expect(supplySoldBps(levels, lv(0.02, 0).price, 10_000n * E18, 6)).toBe(5000)
    expect(supplySoldBps(levels, lv(0.01, 0).price, 10_000n * E18, 6)).toBe(10_000)
    expect(supplySoldBps(levels, 0n, 1n, 6)).toBe(0)
  })
  it('pctAboveFloor', () => {
    expect(pctAboveFloor(2n * E18, E18)).toBeCloseTo(100)
    expect(pctAboveFloor(E18, E18)).toBe(0)
  })
})

import { clearingHistory } from './units'

describe('clearingHistory', () => {
  const E18 = 10n ** 18n
  const floor = E18 / 100n // 0.01
  const supply = 10_000n * E18
  it('replays bids and recovers older demand from the levels', () => {
    // 50 mUSDC at 0.01 (old, not in the window), then 100 mUSDC at 0.02 (recent)
    const old = { price: floor, demand: 50n * 10n ** 6n }
    const recent = { time: 200, amount: 100n * 10n ** 6n, maxPrice: 2n * floor }
    const levels = [old, { price: 2n * floor, demand: recent.amount }]
    const h = clearingHistory(levels, [recent], supply, floor, 6, floor / 10n, 100)
    expect(h).toHaveLength(2)
    expect(h[0]!.time).toBe(100)
    expect(h[0]!.price).toBe(floor) // undersubscribed → floor
    expect(h[1]!.time).toBe(200)
    expect(h[1]!.price).toBeGreaterThanOrEqual(floor)
  })
})
