// Pure helpers for Stage 5 (portfolio P/L, trending, history buckets, auction math).

// ---------------- cost basis ----------------

export interface Inflow {
  /** whole-token quantity (human units) */
  qty: number
  /** USD price per whole token when it arrived (null = unknown, ignored) */
  priceUsd: number | null
}

/**
 * Average-cost basis: every inflow is valued at the USD price when it arrived; the average cost per
 * token is Σ(qty·price)/Σqty over priced inflows, and the cost basis of the current balance is
 * avgCost × balance. Unrealized P/L = value − cost basis.
 */
export function costBasis(inflows: Inflow[], balance: number, priceNow: number | null) {
  let q = 0
  let cost = 0
  for (const i of inflows) {
    if (i.priceUsd === null || !(i.qty > 0) || !Number.isFinite(i.priceUsd)) continue
    q += i.qty
    cost += i.qty * i.priceUsd
  }
  const avgCostUsd = q > 0 ? cost / q : null
  const costBasisUsd = avgCostUsd === null ? null : avgCostUsd * balance
  const valueUsd = priceNow === null ? null : priceNow * balance
  const unrealizedPnlUsd = costBasisUsd === null || valueUsd === null ? null : valueUsd - costBasisUsd
  const unrealizedPnlPct = unrealizedPnlUsd === null || !costBasisUsd ? null : (unrealizedPnlUsd / costBasisUsd) * 100
  return { avgCostUsd, costBasisUsd, valueUsd, unrealizedPnlUsd, unrealizedPnlPct }
}

// ---------------- trending ----------------

export interface TrendingInput {
  key?: string
  volume24hUsd: number
  change24h: number | null
}

/** Trending score = 24h volume × |1D change %|. */
export function trendingScore(t: TrendingInput): number {
  return (t.volume24hUsd || 0) * Math.abs(t.change24h ?? 0)
}

/**
 * Rank by trending score; return between `min` and `max` rows. Rows with a zero score only fill up
 * to `min` (ordered by volume) so the strip is never empty on a quiet chain.
 */
export function rankTrending<T extends TrendingInput>(rows: T[], min = 4, max = 8): T[] {
  const scored = rows.filter((r) => trendingScore(r) > 0).sort((a, b) => trendingScore(b) - trendingScore(a))
  const out = scored.slice(0, max)
  if (out.length < min) {
    const rest = rows.filter((r) => !out.includes(r)).sort((a, b) => (b.volume24hUsd || 0) - (a.volume24hUsd || 0))
    out.push(...rest.slice(0, min - out.length))
  }
  return out
}

// ---------------- history buckets ----------------

export const PORTFOLIO_RANGES: Record<string, { span: number | null; buckets: number }> = {
  '1H': { span: 3600, buckets: 60 },
  '1D': { span: 86400, buckets: 96 },
  '1W': { span: 7 * 86400, buckets: 84 },
  '1M': { span: 30 * 86400, buckets: 120 },
  '1Y': { span: 365 * 86400, buckets: 122 },
  ALL: { span: null, buckets: 120 },
}

/**
 * Bucket boundaries (unix seconds, ascending, ending exactly at `now`) for a portfolio range.
 * The range is clipped to `firstTs` (chain/indexer start) so a young chain doesn't produce a long
 * flat prefix; the step is rounded to whole minutes (or seconds for very short spans).
 */
export function historyBuckets(range: string, now: number, firstTs: number): number[] {
  const cfg = PORTFOLIO_RANGES[range.toUpperCase()]
  if (!cfg) throw new Error('range must be 1H|1D|1W|1M|1Y|ALL')
  const start = Math.max(firstTs, cfg.span === null ? firstTs : now - cfg.span)
  const span = Math.max(0, now - start)
  if (span === 0) return [now]
  let step = span / cfg.buckets
  step = step >= 60 ? Math.round(step / 60) * 60 : Math.max(1, Math.round(step))
  const out: number[] = []
  for (let t = now; t > start && out.length < cfg.buckets; t -= step) out.push(t)
  out.push(Math.max(start, now - out.length * step))
  return [...new Set(out)].sort((a, b) => a - b)
}

// ---------------- auction math (mirrors LaunchAuction.sol) ----------------
// Prices are "whole quote tokens per whole launch token" × 1e18 (independent of quote decimals);
// launch tokens have 18 decimals; amounts/demand are quote base units.

const PRICE_SCALE_36 = 10n ** 36n

export interface PriceLevel {
  price: bigint
  /** quote demand placed at exactly this max price (quote base units) */
  demand: bigint
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b

/** Launch-token base units that `quote` (base units) buys at `price` (LaunchAuction._tokensFor, floor). */
export function tokensFor(quote: bigint, price: bigint, quoteDecimals: number): bigint {
  if (price === 0n) return 0n
  return (quote * PRICE_SCALE_36) / (price * 10n ** BigInt(quoteDecimals))
}

/** Quote base units for `tokens` at `price` (LaunchAuction._quoteFor). */
export function quoteFor(tokens: bigint, price: bigint, quoteDecimals: number, roundUp = false): bigint {
  const num = tokens * price * 10n ** BigInt(quoteDecimals)
  return roundUp ? ceilDiv(num, PRICE_SCALE_36) : num / PRICE_SCALE_36
}

/** Human quote-per-token price. */
export function priceToNumber(price: bigint): number {
  return Number(price) / 1e18
}

export interface Clearing {
  /** clearing price */
  c: bigint
  /** quote committed strictly above c */
  full: bigint
  /** quote committed exactly at c (the marginal level) */
  md: bigint
}

/**
 * LaunchAuction._computeClearing: the highest price p at which the quote committed at ≥ p buys at
 * least `supply` tokens at p. Between two levels, the price where the higher bids alone buy the
 * supply (rounded up to the tick). Undersubscribed → the floor.
 */
export function computeClearing(levels: PriceLevel[], supply: bigint, floor: bigint, tick: bigint, quoteDecimals: number): Clearing {
  const asc = [...levels].sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0))
  const demandAt = new Map(asc.map((l) => [l.price, l.demand]))
  const qs = 10n ** BigInt(quoteDecimals)
  if (asc.length === 0) return { c: floor, full: 0n, md: 0n }
  let above = 0n
  for (let i = asc.length; i > 0; i--) {
    const p = asc[i - 1].price
    const d = asc[i - 1].demand
    if (above > 0n && tokensFor(above, p, quoteDecimals) >= supply) {
      const pStar = ceilDiv(above * PRICE_SCALE_36, supply * qs)
      const c = ceilDiv(pStar, tick) * tick
      const next = asc[i].price
      if (c >= next) return { c: next, full: above - demandAt.get(next)!, md: demandAt.get(next)! }
      if (c <= p) return { c: p, full: above, md: d }
      return { c, full: above, md: 0n }
    }
    if (tokensFor(above + d, p, quoteDecimals) >= supply) return { c: p, full: above, md: d }
    above += d
  }
  const md = demandAt.get(floor) ?? 0n
  return { c: floor, full: above - md, md }
}

/** Convenience: just the clearing price. */
export function clearingPrice(levels: PriceLevel[], supply: bigint, floor: bigint, tick: bigint, quoteDecimals: number): bigint {
  return computeClearing(levels, supply, floor, tick, quoteDecimals).c
}

/** LaunchAuction._marginal: tokens and quote spent at the marginal level. */
export function marginal(cl: Clearing, supply: bigint, quoteDecimals: number): { mTokens: bigint; mSpent: bigint } {
  const tFull = tokensFor(cl.full, cl.c, quoteDecimals)
  const remaining = supply > tFull ? supply - tFull : 0n
  const wanted = tokensFor(cl.md, cl.c, quoteDecimals)
  if (wanted <= remaining) return { mTokens: wanted, mSpent: cl.md }
  const q = quoteFor(remaining, cl.c, quoteDecimals, true)
  return { mTokens: remaining, mSpent: cl.md < q ? cl.md : q }
}

/**
 * LaunchAuction._allocation (what previewClaim / claim pay on a successful launch): bids above the
 * clearing price fill fully, bids at it fill pro-rata, bids below are refunded.
 */
export function fillBid(
  bid: { amount: bigint; maxPrice: bigint },
  levels: PriceLevel[],
  supply: bigint,
  floor: bigint,
  tick: bigint,
  quoteDecimals: number,
): { tokens: bigint; refund: bigint; clearing: bigint } {
  const cl = computeClearing(levels, supply, floor, tick, quoteDecimals)
  const { mTokens, mSpent } = marginal(cl, supply, quoteDecimals)
  if (bid.maxPrice > cl.c) return { tokens: tokensFor(bid.amount, cl.c, quoteDecimals), refund: 0n, clearing: cl.c }
  if (bid.maxPrice === cl.c && cl.md > 0n) {
    const tokens = (bid.amount * mTokens) / cl.md
    const spent = ceilDiv(bid.amount * mSpent, cl.md)
    return { tokens, refund: bid.amount - spent, clearing: cl.c }
  }
  return { tokens: 0n, refund: bid.amount, clearing: cl.c }
}
