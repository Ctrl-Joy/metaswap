// SPDX-License-Identifier: GPL-2.0-or-later
// Exact V3 tick / liquidity math for the positions UI.
// getSqrtRatioAtTick is ported from Uniswap/v3-core/contracts/libraries/TickMath.sol and the
// liquidity helpers from Uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol and
// v3-core SqrtPriceMath.sol (GPL-2.0-or-later). Everything else is MetaSwap code.
import { v3Math } from '@metaswap/sdk'

export const Q96 = 2n ** 96n
export const Q128 = 2n ** 128n
export const MAX_UINT128 = 2n ** 128n - 1n
export const MIN_TICK = -887272
export const MAX_TICK = 887272
export const MIN_SQRT_RATIO = 4295128739n
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n

const MAX_UINT256 = 2n ** 256n - 1n

/** Ported from v3-core TickMath.getSqrtRatioAtTick. */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new Error(`tick ${tick} out of range`)
  const absTick = BigInt(Math.abs(tick))
  let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n
  const mul = (r: bigint, c: bigint) => (r * c) >> 128n
  if ((absTick & 0x2n) !== 0n) ratio = mul(ratio, 0xfff97272373d413259a46990580e213an)
  if ((absTick & 0x4n) !== 0n) ratio = mul(ratio, 0xfff2e50f5f656932ef12357cf3c7fdccn)
  if ((absTick & 0x8n) !== 0n) ratio = mul(ratio, 0xffe5caca7e10e4e61c3624eaa0941cd0n)
  if ((absTick & 0x10n) !== 0n) ratio = mul(ratio, 0xffcb9843d60f6159c9db58835c926644n)
  if ((absTick & 0x20n) !== 0n) ratio = mul(ratio, 0xff973b41fa98c081472e6896dfb254c0n)
  if ((absTick & 0x40n) !== 0n) ratio = mul(ratio, 0xff2ea16466c96a3843ec78b326b52861n)
  if ((absTick & 0x80n) !== 0n) ratio = mul(ratio, 0xfe5dee046a99a2a811c461f1969c3053n)
  if ((absTick & 0x100n) !== 0n) ratio = mul(ratio, 0xfcbe86c7900a88aedcffc83b479aa3a4n)
  if ((absTick & 0x200n) !== 0n) ratio = mul(ratio, 0xf987a7253ac413176f2b074cf7815e54n)
  if ((absTick & 0x400n) !== 0n) ratio = mul(ratio, 0xf3392b0822b70005940c7a398e4b70f3n)
  if ((absTick & 0x800n) !== 0n) ratio = mul(ratio, 0xe7159475a2c29b7443b29c7fa6e889d9n)
  if ((absTick & 0x1000n) !== 0n) ratio = mul(ratio, 0xd097f3bdfd2022b8845ad8f792aa5825n)
  if ((absTick & 0x2000n) !== 0n) ratio = mul(ratio, 0xa9f746462d870fdf8a65dc1f90e061e5n)
  if ((absTick & 0x4000n) !== 0n) ratio = mul(ratio, 0x70d869a156d2a1b890bb3df62baf32f7n)
  if ((absTick & 0x8000n) !== 0n) ratio = mul(ratio, 0x31be135f97d08fd981231505542fcfa6n)
  if ((absTick & 0x10000n) !== 0n) ratio = mul(ratio, 0x9aa508b5b7a84e1c677de54f3e99bc9n)
  if ((absTick & 0x20000n) !== 0n) ratio = mul(ratio, 0x5d6af8dedb81196699c329225ee604n)
  if ((absTick & 0x40000n) !== 0n) ratio = mul(ratio, 0x2216e584f5fa1ea926041bedfe98n)
  if ((absTick & 0x80000n) !== 0n) ratio = mul(ratio, 0x48a170391f7dc42444e8fa2n)
  if (tick > 0) ratio = MAX_UINT256 / ratio
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

/** Greatest tick whose sqrt ratio is <= sqrtPriceX96 (binary search over getSqrtRatioAtTick). */
export function getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) throw new Error('sqrt price out of range')
  let lo = MIN_TICK
  let hi = MAX_TICK
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    if (getSqrtRatioAtTick(mid) <= sqrtPriceX96) lo = mid
    else hi = mid - 1
  }
  return lo
}

/* ------------------------------------------------------------------ liquidity amounts */

const mulDiv = (a: bigint, b: bigint, d: bigint) => (a * b) / d
const mulDivUp = (a: bigint, b: bigint, d: bigint) => {
  const p = a * b
  return p / d + (p % d === 0n ? 0n : 1n)
}
const sorted = (a: bigint, b: bigint): [bigint, bigint] => (a > b ? [b, a] : [a, b])

export function liquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  ;[sqrtA, sqrtB] = sorted(sqrtA, sqrtB)
  if (sqrtA === sqrtB) return 0n
  const intermediate = mulDiv(sqrtA, sqrtB, Q96)
  return mulDiv(amount0, intermediate, sqrtB - sqrtA)
}

export function liquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  ;[sqrtA, sqrtB] = sorted(sqrtA, sqrtB)
  if (sqrtA === sqrtB) return 0n
  return mulDiv(amount1, Q96, sqrtB - sqrtA)
}

/** LiquidityAmounts.getLiquidityForAmounts: max liquidity for the given desired amounts. */
export function liquidityForAmounts(sqrtP: bigint, sqrtA: bigint, sqrtB: bigint, amount0: bigint, amount1: bigint): bigint {
  ;[sqrtA, sqrtB] = sorted(sqrtA, sqrtB)
  if (sqrtP <= sqrtA) return liquidityForAmount0(sqrtA, sqrtB, amount0)
  if (sqrtP < sqrtB) {
    const l0 = liquidityForAmount0(sqrtP, sqrtB, amount0)
    const l1 = liquidityForAmount1(sqrtA, sqrtP, amount1)
    return l0 < l1 ? l0 : l1
  }
  return liquidityForAmount1(sqrtA, sqrtB, amount1)
}

/** SqrtPriceMath.getAmount0Delta. */
export function amount0Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  ;[sqrtA, sqrtB] = sorted(sqrtA, sqrtB)
  if (sqrtA === 0n) return 0n
  const n1 = liquidity << 96n
  const n2 = sqrtB - sqrtA
  if (roundUp) {
    const x = mulDivUp(n1, n2, sqrtB)
    return x / sqrtA + (x % sqrtA === 0n ? 0n : 1n)
  }
  return mulDiv(n1, n2, sqrtB) / sqrtA
}

/** SqrtPriceMath.getAmount1Delta. */
export function amount1Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  ;[sqrtA, sqrtB] = sorted(sqrtA, sqrtB)
  return roundUp ? mulDivUp(liquidity, sqrtB - sqrtA, Q96) : mulDiv(liquidity, sqrtB - sqrtA, Q96)
}

/** Token amounts held by `liquidity` in [tickLower, tickUpper) at sqrtP. */
export function amountsForLiquidity(sqrtP: bigint, tickLower: number, tickUpper: number, liquidity: bigint, roundUp = false): { amount0: bigint; amount1: bigint } {
  const sqrtA = getSqrtRatioAtTick(tickLower)
  const sqrtB = getSqrtRatioAtTick(tickUpper)
  if (sqrtP <= sqrtA) return { amount0: amount0Delta(sqrtA, sqrtB, liquidity, roundUp), amount1: 0n }
  if (sqrtP < sqrtB) return { amount0: amount0Delta(sqrtP, sqrtB, liquidity, roundUp), amount1: amount1Delta(sqrtA, sqrtP, liquidity, roundUp) }
  return { amount0: 0n, amount1: amount1Delta(sqrtA, sqrtB, liquidity, roundUp) }
}

export type DepositSide = 'both' | 'token0' | 'token1'

/** Which tokens a position at [tickLower, tickUpper) needs at sqrtP. */
export function depositSide(sqrtP: bigint, tickLower: number, tickUpper: number): DepositSide {
  if (sqrtP <= getSqrtRatioAtTick(tickLower)) return 'token0'
  if (sqrtP >= getSqrtRatioAtTick(tickUpper)) return 'token1'
  return 'both'
}

/**
 * Linked deposit inputs: given an exact amount of one pool token, the other amount (rounded up,
 * as the pool would require) for the range. Returns 0 for the unused side of a one-sided range.
 */
export function dependentAmount(sqrtP: bigint, tickLower: number, tickUpper: number, independent: 'token0' | 'token1', amount: bigint): bigint {
  const sqrtA = getSqrtRatioAtTick(tickLower)
  const sqrtB = getSqrtRatioAtTick(tickUpper)
  const side = depositSide(sqrtP, tickLower, tickUpper)
  if (side !== 'both' || amount === 0n) return 0n
  if (independent === 'token0') {
    const L = liquidityForAmount0(sqrtP, sqrtB, amount)
    return amount1Delta(sqrtA, sqrtP, L, true)
  }
  const L = liquidityForAmount1(sqrtA, sqrtP, amount)
  return amount0Delta(sqrtP, sqrtB, L, true)
}

/** Integer square root (Newton). */
export function sqrtBig(n: bigint): bigint {
  if (n < 0n) throw new Error('negative')
  if (n < 2n) return n
  let x = n
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + n / x) / 2n
  }
  return x
}

/**
 * Slippage-protected mins for mint/increase (same approach as the Uniswap v3-sdk
 * `mintAmountsWithSlippage`): the liquidity that will be created, valued at the price moved
 * down / up by the tolerance. amount0 is smallest at the upper price, amount1 at the lower one.
 */
export function mintAmountsWithSlippage(
  sqrtP: bigint,
  tickLower: number,
  tickUpper: number,
  amount0Desired: bigint,
  amount1Desired: bigint,
  slippageBps: number,
): { liquidity: bigint; amount0Min: bigint; amount1Min: bigint } {
  const sqrtA = getSqrtRatioAtTick(tickLower)
  const sqrtB = getSqrtRatioAtTick(tickUpper)
  const liquidity = liquidityForAmounts(sqrtP, sqrtA, sqrtB, amount0Desired, amount1Desired)
  const bps = BigInt(Math.max(0, Math.min(9_999, Math.round(slippageBps))))
  // price = sqrtP^2, so sqrt price moves by sqrt(1 ± s)
  let lower = sqrtBig(((sqrtP * sqrtP) * (10_000n - bps)) / 10_000n)
  let upper = sqrtBig(((sqrtP * sqrtP) * (10_000n + bps)) / 10_000n)
  if (lower < MIN_SQRT_RATIO) lower = MIN_SQRT_RATIO
  if (upper >= MAX_SQRT_RATIO) upper = MAX_SQRT_RATIO - 1n
  const atUpper = amountsForLiquidity(upper, tickLower, tickUpper, liquidity, true)
  const atLower = amountsForLiquidity(lower, tickLower, tickUpper, liquidity, true)
  const cap = (x: bigint, max: bigint) => (x > max ? max : x)
  return { liquidity, amount0Min: cap(atUpper.amount0, amount0Desired), amount1Min: cap(atLower.amount1, amount1Desired) }
}

/** amount * (10000 - bps) / 10000 */
export function minusSlippage(amount: bigint, slippageBps: number): bigint {
  const b = BigInt(Math.max(0, Math.min(10_000, Math.round(slippageBps))))
  return (amount * (10_000n - b)) / 10_000n
}

/* ------------------------------------------------------------------ ticks & prices */

export const tickSpacingForFee = v3Math.tickSpacingForFee

export function minUsableTick(spacing: number): number {
  return Math.ceil(MIN_TICK / spacing) * spacing
}
export function maxUsableTick(spacing: number): number {
  return Math.floor(MAX_TICK / spacing) * spacing
}

export function snapTick(tick: number, spacing: number): number {
  return v3Math.nearestUsableTick(tick, spacing)
}

export function isFullRange(tickLower: number, tickUpper: number, spacing: number): boolean {
  return tickLower <= minUsableTick(spacing) && tickUpper >= maxUsableTick(spacing)
}

/**
 * Human price at a tick, as "quote per base". `invert=false` → token1 per token0 (pool order);
 * `invert=true` → token0 per token1.
 */
export function tickToDisplayPrice(tick: number, decimals0: number, decimals1: number, invert: boolean): number {
  const p = v3Math.tickToPrice(tick, decimals0, decimals1)
  return invert ? 1 / p : p
}

/** Nearest usable tick for a displayed price (handles inversion). Returns null for bad input. */
export function displayPriceToTick(price: number, decimals0: number, decimals1: number, invert: boolean, spacing: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null
  const p = invert ? 1 / price : price
  const raw = Math.log(p / 10 ** (decimals0 - decimals1)) / Math.log(1.0001)
  if (!Number.isFinite(raw)) return null
  return snapTick(Math.round(raw), spacing)
}

/**
 * Convert a range typed in display order into pool ticks: with an inverted display the min
 * displayed price maps to the upper tick. Returns [tickLower, tickUpper] (sorted).
 */
export function displayRangeToTicks(
  minPrice: number,
  maxPrice: number,
  decimals0: number,
  decimals1: number,
  invert: boolean,
  spacing: number,
): [number, number] | null {
  const a = displayPriceToTick(minPrice, decimals0, decimals1, invert, spacing)
  const b = displayPriceToTick(maxPrice, decimals0, decimals1, invert, spacing)
  if (a === null || b === null) return null
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (lo === hi) return null
  return [lo, hi]
}

/** Display [min, max] for pool ticks, in display orientation. */
export function ticksToDisplayRange(tickLower: number, tickUpper: number, decimals0: number, decimals1: number, invert: boolean): [number, number] {
  const a = tickToDisplayPrice(tickLower, decimals0, decimals1, invert)
  const b = tickToDisplayPrice(tickUpper, decimals0, decimals1, invert)
  return a < b ? [a, b] : [b, a]
}

/** Human price of token0 in token1 from sqrtPriceX96 (display only). */
export function sqrtToPrice(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  return v3Math.sqrtPriceX96ToPrice(sqrtPriceX96, decimals0, decimals1)
}

/** sqrtPriceX96 for a starting price typed as "token1 per token0" (pool order), clamped to valid range. */
export function priceToSqrtPriceX96(price: number, decimals0: number, decimals1: number): bigint | null {
  if (!Number.isFinite(price) || price <= 0) return null
  const raw = price / 10 ** (decimals0 - decimals1)
  if (!Number.isFinite(raw) || raw <= 0) return null
  // sqrt(raw) * 2^96 using a float mantissa split to keep ~15 significant digits
  const s = Math.sqrt(raw)
  const exp = Math.floor(Math.log2(s))
  const mantissa = s / 2 ** exp // [1, 2)
  const m = BigInt(Math.round(mantissa * 2 ** 52))
  const shift = 96 + exp - 52
  const out = shift >= 0 ? m << BigInt(shift) : m >> BigInt(-shift)
  if (out < MIN_SQRT_RATIO || out >= MAX_SQRT_RATIO) return null
  return out
}

/** Pool-ordered tokens. */
export function sortTokens<T extends { address: string }>(a: T, b: T): [T, T] {
  return a.address.toLowerCase() < b.address.toLowerCase() ? [a, b] : [b, a]
}

/** Step size helper for +/- buttons: move one tick spacing in the direction of the displayed price. */
export function stepTick(tick: number, spacing: number, direction: 'up' | 'down', invert: boolean): number {
  // displayed price rises with tick unless inverted
  const sign = (direction === 'up' ? 1 : -1) * (invert ? -1 : 1)
  const next = snapTick(tick, spacing) + sign * spacing
  return Math.min(maxUsableTick(spacing), Math.max(minUsableTick(spacing), next))
}

/* ------------------------------------------------------------------ V2 */

/** Exact V2 liquidity minted for amounts (MetaSwapV2Pair.mint). */
export function v2LiquidityMinted(amount0: bigint, amount1: bigint, reserve0: bigint, reserve1: bigint, totalSupply: bigint): bigint {
  if (totalSupply === 0n) {
    const l = sqrtBig(amount0 * amount1) - 1000n
    return l > 0n ? l : 0n
  }
  const l0 = (amount0 * totalSupply) / reserve0
  const l1 = (amount1 * totalSupply) / reserve1
  return l0 < l1 ? l0 : l1
}

/** Underlying amounts for `liquidity` LP tokens. */
export function v2AmountsForLiquidity(liquidity: bigint, reserve0: bigint, reserve1: bigint, totalSupply: bigint): { amount0: bigint; amount1: bigint } {
  if (totalSupply === 0n) return { amount0: 0n, amount1: 0n }
  return { amount0: (liquidity * reserve0) / totalSupply, amount1: (liquidity * reserve1) / totalSupply }
}

/** Liquidity for a percentage (1..100) of a position. 100 → everything. */
export function percentOf(amount: bigint, percent: number): bigint {
  if (percent >= 100) return amount
  return (amount * BigInt(Math.max(0, Math.round(percent * 100)))) / 10_000n
}

export function fullRangeTicks(spacing: number): [number, number] {
  return [minUsableTick(spacing), maxUsableTick(spacing)]
}

/** Default custom range: ±pct around the current tick, snapped outward to usable ticks. */
export function rangeAround(currentTick: number, spacing: number, pct: number): [number, number] {
  const delta = Math.round(Math.log(1 + pct / 100) / Math.log(1.0001))
  const lo = Math.max(minUsableTick(spacing), Math.floor((currentTick - delta) / spacing) * spacing)
  let hi = Math.min(maxUsableTick(spacing), Math.ceil((currentTick + delta) / spacing) * spacing)
  if (hi <= lo) hi = lo + spacing
  return [lo, hi]
}
