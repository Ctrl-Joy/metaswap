// Launch auction unit conversions and pure maths (unit tested). On-chain prices (floorPrice,
// tickSize, bid maxPrice, clearingPrice) are "whole quote tokens per whole launch token" × 1e18,
// independent of the quote token's decimals (LaunchTypes.sol). Launch tokens have 18 decimals.
import { parseUnits } from 'viem'

export const PRICE_SCALE = 10n ** 18n
export const TOKEN_DECIMALS = 18

/** Human price (quote per token, e.g. 0.01 mUSDC) → on-chain price. */
export function humanToPrice(human: string | number, _quoteDecimals?: number): bigint | null {
  const s = typeof human === 'number' ? toPlain(human) : human.trim()
  if (!s || !/^\d*\.?\d*$/.test(s) || s === '.') return null
  try {
    return parseUnits(s, 18)
  } catch {
    return null
  }
}

/** On-chain price → human quote per token (display only). */
export function priceToHuman(price: bigint, _quoteDecimals?: number): number {
  return Number(price) / 1e18
}

/** Launch tokens (18-dec base units) bought by `quoteAmount` (quote base units) at `price`. */
export function tokensForQuote(quoteAmount: bigint, price: bigint, quoteDecimals: number): bigint {
  if (price === 0n) return 0n
  return (quoteAmount * 10n ** 18n * PRICE_SCALE) / (price * 10n ** BigInt(quoteDecimals))
}

/** Quote base units needed to buy `tokens` at `price` (rounded up). */
export function quoteForTokens(tokens: bigint, price: bigint, quoteDecimals: number): bigint {
  const num = tokens * price * 10n ** BigInt(quoteDecimals)
  const den = PRICE_SCALE * 10n ** 18n
  return num / den + (num % den === 0n ? 0n : 1n)
}

/** Round a price down to a multiple of tickSize, never below floor (rounded up to a tick). */
export function snapPriceToTick(price: bigint, floor: bigint, tickSize: bigint): bigint {
  if (tickSize <= 0n) return price < floor ? floor : price
  const minTick = ((floor + tickSize - 1n) / tickSize) * tickSize
  const snapped = (price / tickSize) * tickSize
  return snapped < minTick ? minTick : snapped
}

export function isValidBidPrice(price: bigint, floor: bigint, tickSize: bigint): boolean {
  return price >= floor && (tickSize === 0n || price % tickSize === 0n)
}

/**
 * Uniform clearing price, mirroring LaunchAuction._computeClearing(): walk levels from the top; the
 * clearing price is the highest level whose cumulative demand buys the auction supply, or, when the
 * bids strictly above a level already buy it, the in-between price rounded up to the tick. The floor
 * when undersubscribed. `levels` ascending or not.
 */
export function clearingPrice(levels: Array<{ price: bigint; demand: bigint }>, supply: bigint, floor: bigint, quoteDecimals: number, tickSize = 1n): bigint {
  const asc = [...levels].sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0))
  const n = asc.length
  if (n === 0) return floor
  const qs = 10n ** BigInt(quoteDecimals)
  let above = 0n
  for (let i = n; i > 0; i--) {
    const p = asc[i - 1]!.price
    const d = asc[i - 1]!.demand
    if (above > 0n && tokensForQuote(above, p, quoteDecimals) >= supply) {
      const num = above * PRICE_SCALE * 10n ** 18n
      const den = supply * qs
      const pStar = num / den + (num % den === 0n ? 0n : 1n)
      let c = ((pStar + tickSize - 1n) / tickSize) * tickSize
      const next = asc[i]!.price
      if (c >= next) c = next
      else if (c <= p) c = p
      return c
    }
    if (tokensForQuote(above + d, p, quoteDecimals) >= supply) return p
    above += d
  }
  return floor
}

/** FDV in quote (human) = price × totalSupply. */
export function fdvHuman(price: bigint, totalSupply: bigint): number {
  return priceToHuman(price) * (Number(totalSupply) / 1e18)
}

function toPlain(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 18 })
}

/** Basis points from a percent string ("80" → 8000). */
export function pctToBps(pct: string): number | null {
  const n = Number(pct)
  if (!pct || !Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n * 100)
}

type Level = { price: bigint; demand: bigint }

/**
 * Demand-weighted interquartile price band ("Bids concentrated at X – Y"): the prices at 25% and 75%
 * of cumulative bid demand, walking levels from low to high. Null without demand.
 */
export function bidConcentration(levels: readonly Level[]): [bigint, bigint] | null {
  const asc = [...levels].filter((l) => l.demand > 0n).sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0))
  const total = asc.reduce((s, l) => s + l.demand, 0n)
  if (total === 0n) return null
  const at = (q: bigint) => {
    let cum = 0n
    for (const l of asc) {
      cum += l.demand
      if (cum * 100n >= total * q) return l.price
    }
    return asc[asc.length - 1]!.price
  }
  return [at(25n), at(75n)]
}

/** Share of the auction supply that bids at or above `clearing` buy at that price, in basis points (≤ 10000). */
export function supplySoldBps(levels: readonly Level[], clearing: bigint, auctionSupply: bigint, quoteDecimals: number): number {
  if (auctionSupply <= 0n || clearing <= 0n) return 0
  const demand = levels.reduce((s, l) => (l.price >= clearing ? s + l.demand : s), 0n)
  const tokens = tokensForQuote(demand, clearing, quoteDecimals)
  const bps = (tokens * 10_000n) / auctionSupply
  return Number(bps > 10_000n ? 10_000n : bps)
}

/** Percent the clearing price sits above the floor (0 at the floor). */
export function pctAboveFloor(clearing: bigint, floor: bigint): number {
  if (floor <= 0n) return 0
  return (Number(clearing) / Number(floor) - 1) * 100
}

/**
 * Clearing price over time, replayed from bids. `levels` are the current on-chain demand levels (all
 * bids); `bids` is the API's recent window (any order). Demand from bids older than the window is
 * recovered as levels − window, so the replay is exact even when only recent bids are listed.
 * Returns one point per bid (unix seconds, on-chain price), starting with the state before the window.
 */
export function clearingHistory(
  levels: ReadonlyArray<{ price: bigint; demand: bigint }>,
  bids: ReadonlyArray<{ time: number; amount: bigint; maxPrice: bigint }>,
  supply: bigint,
  floor: bigint,
  quoteDecimals: number,
  tickSize: bigint,
  startTime: number,
): Array<{ time: number; price: bigint }> {
  const demand = new Map<bigint, bigint>()
  for (const l of levels) demand.set(l.price, (demand.get(l.price) ?? 0n) + l.demand)
  const asc = [...bids].sort((a, b) => a.time - b.time)
  for (const b of asc) demand.set(b.maxPrice, (demand.get(b.maxPrice) ?? 0n) - b.amount)
  const snapshot = () => [...demand.entries()].filter(([, d]) => d > 0n).map(([price, d]) => ({ price, demand: d }))
  const first = asc[0]?.time ?? startTime
  const out: Array<{ time: number; price: bigint }> = [{ time: Math.min(startTime, first - 1), price: clearingPrice(snapshot(), supply, floor, quoteDecimals, tickSize) }]
  for (const b of asc) {
    demand.set(b.maxPrice, (demand.get(b.maxPrice) ?? 0n) + b.amount)
    out.push({ time: b.time, price: clearingPrice(snapshot(), supply, floor, quoteDecimals, tickSize) })
  }
  return out
}
