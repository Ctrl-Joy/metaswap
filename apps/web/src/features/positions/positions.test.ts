import { describe, expect, it } from 'vitest'
import { decodeFunctionData, getAddress, maxUint256, type Hex } from 'viem'
import { nonfungiblePositionManagerAbi, v2Router02Abi } from '@metaswap/sdk/abis'
import {
  amountsForLiquidity,
  dependentAmount,
  depositSide,
  displayPriceToTick,
  displayRangeToTicks,
  fullRangeTicks,
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  liquidityForAmounts,
  MAX_SQRT_RATIO,
  MAX_UINT128,
  MIN_SQRT_RATIO,
  mintAmountsWithSlippage,
  minusSlippage,
  percentOf,
  priceToSqrtPriceX96,
  rangeAround,
  snapTick,
  stepTick,
  tickToDisplayPrice,
  ticksToDisplayRange,
  v2AmountsForLiquidity,
  v2LiquidityMinted,
} from './math'
import { buildCollect, buildDecrease, buildIncrease, buildMint, buildV2Add, buildV2Remove, v2PermitTypedData } from './encode'

const NPM = getAddress('0x00000000000000000000000000000000000000aa')
const ROUTER = getAddress('0x00000000000000000000000000000000000000bb')
const WETH = getAddress('0x5FbDB2315678afecb367f032d93F642f64180aa3')
const USDC = getAddress('0x8A791620dd6260079BF849Dc5567aDC3F2FdC318')
const USER = getAddress('0x90F79bf6EB2c4f870365E785982E1f101E93b906')

describe('TickMath', () => {
  it('matches known sqrt ratios at the bounds and tick 0', () => {
    expect(getSqrtRatioAtTick(-887272)).toBe(MIN_SQRT_RATIO)
    expect(getSqrtRatioAtTick(887272)).toBe(MAX_SQRT_RATIO)
    expect(getSqrtRatioAtTick(0)).toBe(2n ** 96n)
  })
  it('inverts with getTickAtSqrtRatio', () => {
    for (const t of [-887272, -196251, -60, -1, 0, 1, 59, 120000, 887271]) {
      expect(getTickAtSqrtRatio(getSqrtRatioAtTick(t))).toBe(t)
      expect(getTickAtSqrtRatio(getSqrtRatioAtTick(t) + 1n)).toBe(t)
    }
  })
  it('rejects out-of-range ticks', () => {
    expect(() => getSqrtRatioAtTick(887273)).toThrow()
  })
})

describe('range & tick snapping', () => {
  // WETH (18) / mUSDC (6): pool price ≈ 3000 mUSDC per WETH at tick ≈ -196256
  const d0 = 18
  const d1 = 6
  it('snaps a typed price to the nearest usable tick for the fee tier', () => {
    const t = displayPriceToTick(3000, d0, d1, false, 60)!
    expect(Math.abs(t % 60)).toBe(0)
    expect(Math.abs(tickToDisplayPrice(t, d0, d1, false) - 3000) / 3000).toBeLessThan(0.004)
  })
  it('handles the inverted (token0 per token1) display', () => {
    const t = displayPriceToTick(1 / 3000, d0, d1, true, 60)!
    expect(t).toBe(displayPriceToTick(3000, d0, d1, false, 60))
    // displayed min with inversion maps to the upper tick
    const ticks = displayRangeToTicks(1 / 3300, 1 / 2700, d0, d1, true, 60)!
    expect(ticks[0]).toBeLessThan(ticks[1])
    const [lo, hi] = ticksToDisplayRange(ticks[0], ticks[1], d0, d1, false)
    expect(lo).toBeGreaterThan(2650)
    expect(hi).toBeLessThan(3350)
  })
  it('steps one spacing in the direction of the displayed price', () => {
    expect(stepTick(-196200, 60, 'up', false)).toBe(-196140)
    expect(stepTick(-196200, 60, 'up', true)).toBe(-196260)
    expect(stepTick(fullRangeTicks(60)[1], 60, 'up', false)).toBe(fullRangeTicks(60)[1])
  })
  it('full range ticks are usable multiples', () => {
    expect(fullRangeTicks(60)).toEqual([-887220, 887220])
    expect(fullRangeTicks(200)).toEqual([-887200, 887200])
    expect(snapTick(-887272, 10)).toBe(-887270)
  })
  it('rangeAround brackets the current tick on spacing multiples', () => {
    const [lo, hi] = rangeAround(-196251, 60, 10)
    expect(Math.abs(lo % 60)).toBe(0)
    expect(Math.abs(hi % 60)).toBe(0)
    expect(lo).toBeLessThan(-196251)
    expect(hi).toBeGreaterThan(-196251)
  })
  it('rejects garbage prices', () => {
    expect(displayPriceToTick(0, 18, 6, false, 60)).toBeNull()
    expect(displayPriceToTick(Number.NaN, 18, 6, false, 60)).toBeNull()
  })
  it('priceToSqrtPriceX96 round-trips through the tick', () => {
    const sqrt = priceToSqrtPriceX96(3000, 18, 6)!
    const tick = getTickAtSqrtRatio(sqrt)
    expect(Math.abs(tickToDisplayPrice(tick, 18, 6, false) - 3000)).toBeLessThan(1)
    expect(priceToSqrtPriceX96(0, 18, 6)).toBeNull()
    // mLINK/mARB, both 18 decimals: 18.75
    const s2 = priceToSqrtPriceX96(18.75, 18, 18)!
    expect(Math.abs(tickToDisplayPrice(getTickAtSqrtRatio(s2), 18, 18, false) - 18.75) / 18.75).toBeLessThan(0.0002)
  })
})

describe('deposit ratio math', () => {
  const sqrtP = getSqrtRatioAtTick(-196251)
  const lower = -196800
  const upper = -195720
  it('linked amounts reproduce the same liquidity from either side', () => {
    const a0 = 10n ** 18n
    const a1 = dependentAmount(sqrtP, lower, upper, 'token0', a0)
    expect(a1).toBeGreaterThan(0n)
    const back = dependentAmount(sqrtP, lower, upper, 'token1', a1)
    // within rounding of 1e-9
    expect(Number(back - a0 < 0n ? a0 - back : back - a0)).toBeLessThan(1e9)
    const L = liquidityForAmounts(sqrtP, getSqrtRatioAtTick(lower), getSqrtRatioAtTick(upper), a0, a1)
    const { amount0, amount1 } = amountsForLiquidity(sqrtP, lower, upper, L, true)
    expect(amount0 <= a0 + 1n).toBe(true)
    expect(amount1 <= a1 + 1n).toBe(true)
    expect(Number(a0 - amount0)).toBeLessThan(1e10)
  })
  it('single-sided when the range is out of the current price', () => {
    expect(depositSide(sqrtP, -196000, -195000)).toBe('token0') // range above price → only token0
    expect(depositSide(sqrtP, -198000, -197000)).toBe('token1')
    expect(depositSide(sqrtP, lower, upper)).toBe('both')
    expect(dependentAmount(sqrtP, -196000, -195000, 'token0', 10n ** 18n)).toBe(0n)
  })
  it('mins with slippage are <= desired and shrink as slippage grows', () => {
    const a0 = 10n ** 18n
    const a1 = dependentAmount(sqrtP, lower, upper, 'token0', a0)
    const tight = mintAmountsWithSlippage(sqrtP, lower, upper, a0, a1, 10)
    const loose = mintAmountsWithSlippage(sqrtP, lower, upper, a0, a1, 500)
    expect(tight.amount0Min).toBeLessThanOrEqual(a0)
    expect(tight.amount1Min).toBeLessThanOrEqual(a1)
    expect(loose.amount0Min).toBeLessThan(tight.amount0Min)
    expect(loose.amount1Min).toBeLessThan(tight.amount1Min)
    expect(tight.amount0Min).toBeGreaterThan((a0 * 95n) / 100n)
    expect(minusSlippage(10_000n, 50)).toBe(9_950n)
  })
  it('V2 liquidity and amounts', () => {
    expect(v2LiquidityMinted(10n ** 18n, 4n * 10n ** 18n, 0n, 0n, 0n)).toBe(2n * 10n ** 18n - 1000n)
    expect(v2LiquidityMinted(100n, 300n, 1000n, 2000n, 500n)).toBe(50n)
    expect(v2AmountsForLiquidity(50n, 1000n, 2000n, 500n)).toEqual({ amount0: 100n, amount1: 200n })
    expect(percentOf(1000n, 50)).toBe(500n)
    expect(percentOf(999n, 100)).toBe(999n)
  })
})

describe('calldata builders', () => {
  const decodeNpm = (data: Hex) => decodeFunctionData({ abi: nonfungiblePositionManagerAbi, data })
  it('mint for a new pool: multicall(createAndInitialize, mint, refundETH)', () => {
    const tx = buildMint({
      npm: NPM,
      token0: WETH,
      token1: USDC,
      fee: 3000,
      tickLower: -196800,
      tickUpper: -195720,
      amount0Desired: 1n,
      amount1Desired: 2n,
      amount0Min: 0n,
      amount1Min: 1n,
      recipient: USER,
      deadline: 99n,
      createPoolSqrtPriceX96: 123n,
      ethValue: 1n,
    })
    expect(tx.to).toBe(NPM)
    expect(tx.value).toBe(1n)
    const outer = decodeNpm(tx.data)
    expect(outer.functionName).toBe('multicall')
    const calls = (outer.args![0] as Hex[]).map(decodeNpm)
    expect(calls.map((c) => c.functionName)).toEqual(['createAndInitializePoolIfNecessary', 'mint', 'refundETH'])
    expect(calls[0]!.args).toEqual([WETH, USDC, 3000, 123n])
    expect(calls[1]!.args![0]).toMatchObject({ token0: WETH, token1: USDC, fee: 3000, tickLower: -196800, tickUpper: -195720, recipient: USER, deadline: 99n, amount1Min: 1n })
  })
  it('plain mint for an existing pool is a single call', () => {
    const tx = buildMint({ npm: NPM, token0: WETH, token1: USDC, fee: 500, tickLower: -10, tickUpper: 10, amount0Desired: 1n, amount1Desired: 1n, amount0Min: 0n, amount1Min: 0n, recipient: USER, deadline: 1n })
    expect(decodeNpm(tx.data).functionName).toBe('mint')
    expect(tx.value).toBe(0n)
  })
  it('increase with ETH appends refundETH', () => {
    const tx = buildIncrease({ npm: NPM, tokenId: 7n, amount0Desired: 5n, amount1Desired: 6n, amount0Min: 4n, amount1Min: 5n, deadline: 9n, ethValue: 5n })
    const calls = (decodeNpm(tx.data).args![0] as Hex[]).map(decodeNpm)
    expect(calls.map((c) => c.functionName)).toEqual(['increaseLiquidity', 'refundETH'])
    expect(calls[0]!.args![0]).toMatchObject({ tokenId: 7n, amount0Desired: 5n, amount1Min: 5n })
  })
  it('collect as ERC20 vs as ETH (unwrapWETH9 + sweepToken)', () => {
    const plain = buildCollect({ npm: NPM, tokenId: 3n, recipient: USER, token0: WETH, token1: USDC, weth: WETH, receiveEth: false })
    const p = decodeNpm(plain.data)
    expect(p.functionName).toBe('collect')
    expect(p.args![0]).toEqual({ tokenId: 3n, recipient: USER, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 })
    const eth = buildCollect({ npm: NPM, tokenId: 3n, recipient: USER, token0: WETH, token1: USDC, weth: WETH, receiveEth: true })
    const calls = (decodeNpm(eth.data).args![0] as Hex[]).map(decodeNpm)
    expect(calls.map((c) => c.functionName)).toEqual(['collect', 'unwrapWETH9', 'sweepToken'])
    expect((calls[0]!.args![0] as { recipient: string }).recipient).toBe('0x0000000000000000000000000000000000000000')
    expect(calls[1]!.args).toEqual([0n, USER])
    expect(calls[2]!.args).toEqual([USDC, 0n, USER])
  })
  it('decrease bundles decrease + collect (+ burn)', () => {
    const tx = buildDecrease({ npm: NPM, tokenId: 3n, liquidity: 10n, amount0Min: 1n, amount1Min: 2n, deadline: 5n, recipient: USER, token0: WETH, token1: USDC, weth: WETH, receiveEth: false, burn: true })
    const calls = (decodeNpm(tx.data).args![0] as Hex[]).map(decodeNpm)
    expect(calls.map((c) => c.functionName)).toEqual(['decreaseLiquidity', 'collect', 'burn'])
    expect(calls[0]!.args![0]).toEqual({ tokenId: 3n, liquidity: 10n, amount0Min: 1n, amount1Min: 2n, deadline: 5n })
    expect(calls[2]!.args).toEqual([3n])
  })
  it('V2 add: ERC20 pair vs ETH variant', () => {
    const decodeR = (data: Hex) => decodeFunctionData({ abi: v2Router02Abi, data })
    const a = buildV2Add({ router: ROUTER, tokenA: WETH, tokenB: USDC, amountADesired: 10n, amountBDesired: 20n, amountAMin: 9n, amountBMin: 19n, to: USER, deadline: 7n })
    expect(decodeR(a.data)).toMatchObject({ functionName: 'addLiquidity', args: [WETH, USDC, 10n, 20n, 9n, 19n, USER, 7n] })
    const e = buildV2Add({ router: ROUTER, tokenA: WETH, tokenB: USDC, amountADesired: 10n, amountBDesired: 20n, amountAMin: 9n, amountBMin: 19n, to: USER, deadline: 7n, nativeSide: 'A' })
    expect(e.value).toBe(10n)
    expect(decodeR(e.data)).toMatchObject({ functionName: 'addLiquidityETH', args: [USDC, 20n, 19n, 9n, USER, 7n] })
  })
  it('V2 remove with permit (ERC20 and ETH)', () => {
    const decodeR = (data: Hex) => decodeFunctionData({ abi: v2Router02Abi, data })
    const permit = { v: 27, r: `0x${'11'.repeat(32)}` as Hex, s: `0x${'22'.repeat(32)}` as Hex, approveMax: false }
    const r = buildV2Remove({ router: ROUTER, tokenA: WETH, tokenB: USDC, liquidity: 5n, amountAMin: 1n, amountBMin: 2n, to: USER, deadline: 3n, permit })
    expect(decodeR(r.data)).toMatchObject({ functionName: 'removeLiquidityWithPermit', args: [WETH, USDC, 5n, 1n, 2n, USER, 3n, false, 27, permit.r, permit.s] })
    const e = buildV2Remove({ router: ROUTER, tokenA: WETH, tokenB: USDC, liquidity: 5n, amountAMin: 1n, amountBMin: 2n, to: USER, deadline: 3n, permit, nativeSide: 'A' })
    expect(decodeR(e.data)).toMatchObject({ functionName: 'removeLiquidityETHWithPermit', args: [USDC, 5n, 2n, 1n, USER, 3n, false, 27, permit.r, permit.s] })
    const plain = buildV2Remove({ router: ROUTER, tokenA: WETH, tokenB: USDC, liquidity: 5n, amountAMin: 1n, amountBMin: 2n, to: USER, deadline: 3n })
    expect(decodeR(plain.data).functionName).toBe('removeLiquidity')
  })
  it('V2 permit typed data uses the pair domain', () => {
    const td = v2PermitTypedData({ pair: ROUTER, chainId: 31337, owner: USER, spender: ROUTER, value: maxUint256, nonce: 0n, deadline: 1n })
    expect(td.domain).toEqual({ name: 'MetaSwap V2', version: '1', chainId: 31337, verifyingContract: ROUTER })
    expect(td.primaryType).toBe('Permit')
  })
})
