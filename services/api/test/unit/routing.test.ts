import { describe, expect, it } from 'vitest'
import { decodeAbiParameters, decodeFunctionData, parseAbiParameters, type Address, type Hex } from 'viem'
import { universalRouterAbi } from '../../src/abis'
import {
  ADDRESS_THIS,
  ALREADY_PAID,
  COMMAND,
  CONTRACT_BALANCE,
  MSG_SENDER,
  PERMIT_SINGLE_PARAMS,
  buildSwapCall,
  buildWrapCall,
} from '../../src/routing/encode'
import { decodeV3Path, encodeV3Path, enumeratePaths, segments, type RoutePool } from '../../src/routing/paths'
import { gasInToken, hopMid, priceImpactBps, type PoolState } from '../../src/routing/router'
import { STEPS, optimizeSplit, splitAmounts, type SplitCandidate } from '../../src/routing/split'
import { applySlippage, parseProtocols } from '../../src/routing/quote'
import { v2Math } from '@metaswap/sdk'

const T = {
  WETH: '0x' + 'aa'.repeat(20),
  USDC: '0x' + '11'.repeat(20),
  USDT: '0x' + '22'.repeat(20),
  DAI: '0x' + '33'.repeat(20),
  WBTC: '0x' + '44'.repeat(20),
}
const pool = (address: string, version: 'v2' | 'v3', a: string, b: string, fee: number): RoutePool => ({
  address,
  version,
  token0: a < b ? a : b,
  token1: a < b ? b : a,
  fee,
})
const POOLS: RoutePool[] = [
  pool('0x' + '01'.repeat(20), 'v2', T.WETH, T.USDC, 3000),
  pool('0x' + '02'.repeat(20), 'v3', T.WETH, T.USDC, 500),
  pool('0x' + '03'.repeat(20), 'v3', T.WETH, T.USDC, 3000),
  pool('0x' + '04'.repeat(20), 'v3', T.USDC, T.USDT, 100),
  pool('0x' + '05'.repeat(20), 'v2', T.WBTC, T.WETH, 3000),
  pool('0x' + '06'.repeat(20), 'v3', T.DAI, T.USDC, 100),
]

describe('path enumeration', () => {
  it('finds parallel pools and multi-hop paths without repeating tokens', () => {
    const direct = enumeratePaths(POOLS, T.WETH, T.USDC, { maxHops: 1 })
    expect(direct).toHaveLength(3)
    const toUsdt = enumeratePaths(POOLS, T.WETH, T.USDT)
    expect(toUsdt).toHaveLength(3) // WETH -(3 pools)-> USDC -> USDT
    for (const p of toUsdt) {
      const tokens = [p[0].tokenIn, ...p.map((h) => h.tokenOut)]
      expect(new Set(tokens).size).toBe(tokens.length)
    }
    // WBTC -> WETH -> USDC -> DAI is exactly 3 hops
    expect(enumeratePaths(POOLS, T.WBTC, T.DAI)).toHaveLength(3)
    expect(enumeratePaths(POOLS, T.WBTC, T.DAI, { maxHops: 2 })).toHaveLength(0)
  })

  it('respects protocol and mixed filters', () => {
    expect(enumeratePaths(POOLS, T.WETH, T.USDC, { protocols: ['v2'] })).toHaveLength(1)
    const pureOnly = enumeratePaths(POOLS, T.WBTC, T.USDC, { mixed: false })
    expect(pureOnly.map((p) => p.map((h) => h.pool.version).join())).toEqual(['v2,v2'])
    const all = enumeratePaths(POOLS, T.WBTC, T.USDC)
    expect(all).toHaveLength(3)
    expect(segments(all.find((p) => p[1].pool.version === 'v3')!)).toHaveLength(2)
  })

  it('encodes and decodes packed v3 paths (reversed for exact output)', () => {
    const [p] = enumeratePaths(POOLS, T.WETH, T.USDT, { protocols: ['v3'] })
    const enc = encodeV3Path(p)
    expect((enc.length - 2) / 2).toBe(20 + 3 + 20 + 3 + 20)
    expect(decodeV3Path(enc)).toEqual({ tokens: [T.WETH, T.USDC, T.USDT], fees: [p[0].pool.fee, 100] })
    expect(decodeV3Path(encodeV3Path(p, true))).toEqual({ tokens: [T.USDT, T.USDC, T.WETH], fees: [100, p[0].pool.fee] })
  })
})

describe('v2 reserve math', () => {
  it('matches the constant-product formula and round-trips via getAmountIn', () => {
    const rIn = 1_000n * 10n ** 18n
    const rOut = 3_000_000n * 10n ** 6n
    const out = v2Math.getAmountOut(10n ** 18n, rIn, rOut)
    expect(out).toBe((10n ** 18n * 997n * rOut) / (rIn * 1000n + 10n ** 18n * 997n))
    const back = v2Math.getAmountIn(out, rIn, rOut)
    expect(back).toBeLessThanOrEqual(10n ** 18n)
    expect(v2Math.getAmountOut(back, rIn, rOut)).toBeGreaterThanOrEqual(out)
  })

  it('mid price and price impact', () => {
    const st: PoolState = { address: 'p', version: 'v2', token0: T.USDC, token1: T.WETH, fee: 3000, reserve0: 3_000_000n * 10n ** 6n, reserve1: 1000n * 10n ** 18n, sqrtPriceX96: 0n, liquidity: 0n }
    const mid = hopMid(st, T.WETH) // USDC raw per WETH raw, fee-adjusted
    expect(mid).toBeCloseTo((3000 * 1e6 * 0.997) / 1e18, 12)
    const amountIn = 10n ** 18n
    const out = v2Math.getAmountOut(amountIn, st.reserve1, st.reserve0)
    const bps = priceImpactBps('EXACT_INPUT', out, Number(amountIn) * mid)
    expect(bps).toBe(10) // 1 ETH in a 1000 ETH pool ≈ 0.1%
    expect(priceImpactBps('EXACT_INPUT', 2n, 1)).toBe(0) // clamped
  })

  it('converts gas to output token units', () => {
    // 200k gas * 1 gwei = 0.0002 ETH = $0.6 at $3000 → 0.6 USDC
    expect(gasInToken(200_000n * 10n ** 9n, 3000, 1, 6)).toBe(600_000n)
    expect(gasInToken(1n, undefined, 1, 6)).toBe(0n)
  })

  it('applies slippage bounds', () => {
    expect(applySlippage('EXACT_INPUT', 10_000n, 50)).toBe(9_950n)
    expect(applySlippage('EXACT_OUTPUT', 10_000n, 50)).toBe(10_050n)
    expect(applySlippage('EXACT_OUTPUT', 1n, 50)).toBe(2n) // rounds up
    expect(parseProtocols('v2')).toEqual({ protocols: ['v2'], mixed: false })
    expect(parseProtocols('v2,v3,mixed')).toEqual({ protocols: ['v2', 'v3'], mixed: true })
  })
})

describe('split optimizer', () => {
  // two independent constant-product pools: splitting a large trade beats either alone
  const cp = (rIn: bigint, rOut: bigint, total: bigint) =>
    Array.from({ length: STEPS + 1 }, (_, i) => (i === 0 ? 0n : v2Math.getAmountOut((total * BigInt(i * 5)) / 100n, rIn, rOut)))

  it('splits a large trade across disjoint pools', () => {
    const total = 500n * 10n ** 18n
    const a: SplitCandidate = { pools: ['a'], quotes: cp(1000n * 10n ** 18n, 3_000_000n * 10n ** 6n, total), gasCost: 1_000_000n }
    const b: SplitCandidate = { pools: ['b'], quotes: cp(1000n * 10n ** 18n, 3_000_000n * 10n ** 6n, total), gasCost: 1_000_000n }
    const r = optimizeSplit([a, b], 'EXACT_INPUT')!
    expect(r.parts.map((p) => p.pct).sort()).toEqual([50, 50])
    expect(r.amount).toBeGreaterThan(a.quotes[20]!)
  })

  it('keeps a small trade on one route when gas outweighs the split gain', () => {
    const total = 10n ** 15n
    const a: SplitCandidate = { pools: ['a'], quotes: cp(1000n * 10n ** 18n, 3_000_000n * 10n ** 6n, total), gasCost: 500_000n }
    const b: SplitCandidate = { pools: ['b'], quotes: cp(1000n * 10n ** 18n, 3_000_000n * 10n ** 6n, total), gasCost: 500_000n }
    const r = optimizeSplit([a, b], 'EXACT_INPUT')!
    expect(r.parts).toEqual([{ route: 0, pct: 100 }])
  })

  it('never combines routes sharing a pool, and supports 3-way splits', () => {
    const total = 900n * 10n ** 18n
    const mk = (pools: string[]): SplitCandidate => ({ pools, quotes: cp(1000n * 10n ** 18n, 3_000_000n * 10n ** 6n, total), gasCost: 0n })
    const r = optimizeSplit([mk(['a']), mk(['a', 'x']), mk(['b']), mk(['c'])], 'EXACT_INPUT')!
    expect(r.parts).toHaveLength(3)
    const routes = r.parts.map((p) => p.route)
    expect(routes.includes(0) && routes.includes(1)).toBe(false)
    expect(r.parts.reduce((s, p) => s + p.pct, 0)).toBe(100)
  })

  it('minimises input for exact output', () => {
    const total = 300_000n * 10n ** 6n
    const quotes = Array.from({ length: STEPS + 1 }, (_, i) => (i === 0 ? 0n : v2Math.getAmountIn((total * BigInt(i * 5)) / 100n, 1000n * 10n ** 18n, 3_000_000n * 10n ** 6n)))
    const r = optimizeSplit([{ pools: ['a'], quotes, gasCost: 0n }, { pools: ['b'], quotes, gasCost: 0n }], 'EXACT_OUTPUT')!
    expect(r.parts.map((p) => p.pct)).toEqual([50, 50])
    expect(r.amount).toBeLessThan(quotes[20]!)
  })

  it('splitAmounts sums exactly', () => {
    const parts = splitAmounts(1_000_003n, [35, 35, 30])
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(1_000_003n)
  })
})

describe('UniversalRouter calldata', () => {
  const V3_IN = parseAbiParameters('address, uint256, uint256, bytes, bool')
  const V2_IN = parseAbiParameters('address, uint256, uint256, address[], bool')
  const WRAP = parseAbiParameters('address, uint256')
  const decode = (calldata: Hex) => {
    const { args, functionName } = decodeFunctionData({ abi: universalRouterAbi, data: calldata })
    expect(functionName).toBe('execute')
    const [commands, inputs, deadline] = args as readonly [Hex, readonly Hex[], bigint]
    const bytes = commands.slice(2).match(/../g)!.map((b) => parseInt(b, 16))
    return { bytes, inputs, deadline }
  }
  const p = enumeratePaths(POOLS, T.WETH, T.USDT, { protocols: ['v3'] })[0]
  const mixed = enumeratePaths(POOLS, T.WBTC, T.USDC).find((x) => x[1].pool.version === 'v3')!

  it('ERC20 exact-in split with permit, decoded back', () => {
    const v2Direct = enumeratePaths(POOLS, T.WETH, T.USDC, { protocols: ['v2'] })[0]
    const v3Direct = enumeratePaths(POOLS, T.WETH, T.USDC, { protocols: ['v3'] })[0]
    const call = buildSwapCall({
      type: 'EXACT_INPUT',
      routes: [
        { path: v3Direct, amount: 600n, limit: 590n },
        { path: v2Direct, amount: 400n, limit: 390n },
      ],
      inputIsNative: false,
      outputIsNative: false,
      totalAmount: 1000n,
      totalLimit: 980n,
      deadline: 123n,
      permit: { permit: { details: { token: T.WETH as Address, amount: 5n, expiration: 99, nonce: 1 }, spender: '0x' + '77'.repeat(20) as Address, sigDeadline: 77n }, signature: ('0x' + '00'.repeat(65)) as Hex },
    })
    const d = decode(call.calldata)
    expect(d.deadline).toBe(123n)
    expect(d.bytes).toEqual([COMMAND.PERMIT2_PERMIT, COMMAND.V3_SWAP_EXACT_IN, COMMAND.V2_SWAP_EXACT_IN])
    const [permit, sig] = decodeAbiParameters(PERMIT_SINGLE_PARAMS, d.inputs[0])
    expect(permit.details.nonce).toBe(1)
    expect(permit.sigDeadline).toBe(77n)
    expect(sig).toBe('0x' + '00'.repeat(65))
    const v3 = decodeAbiParameters(V3_IN, d.inputs[1])
    expect(v3).toEqual([MSG_SENDER, 600n, 590n, encodeV3Path(v3Direct), true])
    const v2 = decodeAbiParameters(V2_IN, d.inputs[2])
    expect(v2[0]).toBe(MSG_SENDER)
    expect(v2[1]).toBe(400n)
    expect(v2[3].map((a) => a.toLowerCase())).toEqual([T.WETH, T.USDC])
    expect(v2[4]).toBe(true)
    expect(call.value).toBe(0n)
  })

  it('ETH in → WRAP_ETH + router-paid swap with value', () => {
    const call = buildSwapCall({ type: 'EXACT_INPUT', routes: [{ path: p, amount: 10n ** 18n, limit: 1n }], inputIsNative: true, outputIsNative: false, totalAmount: 10n ** 18n, totalLimit: 1n, deadline: 1n })
    const d = decode(call.calldata)
    expect(d.bytes).toEqual([COMMAND.WRAP_ETH, COMMAND.V3_SWAP_EXACT_IN])
    expect(decodeAbiParameters(WRAP, d.inputs[0])).toEqual([ADDRESS_THIS, 10n ** 18n])
    expect(decodeAbiParameters(V3_IN, d.inputs[1])[4]).toBe(false)
    expect(call.value).toBe(10n ** 18n)
  })

  it('ETH out → swap to router then UNWRAP_WETH to recipient with total min', () => {
    const rev = enumeratePaths(POOLS, T.USDT, T.WETH, { protocols: ['v3'] })[0]
    const recipient = ('0x' + '99'.repeat(20)) as Address
    const call = buildSwapCall({ type: 'EXACT_INPUT', routes: [{ path: rev, amount: 1000n, limit: 900n }], inputIsNative: false, outputIsNative: true, recipient, totalAmount: 1000n, totalLimit: 900n, deadline: 1n })
    const d = decode(call.calldata)
    expect(d.bytes).toEqual([COMMAND.V3_SWAP_EXACT_IN, COMMAND.UNWRAP_WETH])
    expect(decodeAbiParameters(V3_IN, d.inputs[0])[0]).toBe(ADDRESS_THIS)
    const [to, min] = decodeAbiParameters(WRAP, d.inputs[1])
    expect(to.toLowerCase()).toBe(recipient)
    expect(min).toBe(900n)
  })

  it('mixed v2→v3 route chains through the router balance', () => {
    const call = buildSwapCall({ type: 'EXACT_INPUT', routes: [{ path: mixed, amount: 100n, limit: 50n }], inputIsNative: false, outputIsNative: false, totalAmount: 100n, totalLimit: 50n, deadline: 1n })
    const d = decode(call.calldata)
    expect(d.bytes).toEqual([COMMAND.V2_SWAP_EXACT_IN, COMMAND.V3_SWAP_EXACT_IN])
    const a = decodeAbiParameters(V2_IN, d.inputs[0])
    expect(a[0]).toBe(ADDRESS_THIS)
    expect(a[2]).toBe(0n)
    expect(a[4]).toBe(true)
    const b = decodeAbiParameters(V3_IN, d.inputs[1])
    expect(b[1]).toBe(CONTRACT_BALANCE)
    expect(b[2]).toBe(50n)
    expect(b[4]).toBe(false)
  })

  it('mixed v3→v2 route pays the next pair directly (ALREADY_PAID)', () => {
    const rev = enumeratePaths(POOLS, T.USDC, T.WBTC).find((x) => x[0].pool.version === 'v3')!
    const d = decode(buildSwapCall({ type: 'EXACT_INPUT', routes: [{ path: rev, amount: 100n, limit: 1n }], inputIsNative: false, outputIsNative: false, totalAmount: 100n, totalLimit: 1n, deadline: 1n }).calldata)
    expect(d.bytes).toEqual([COMMAND.V3_SWAP_EXACT_IN, COMMAND.V2_SWAP_EXACT_IN])
    expect(decodeAbiParameters(V3_IN, d.inputs[0])[0].toLowerCase()).toBe(rev[1].pool.address)
    expect(decodeAbiParameters(V2_IN, d.inputs[1])[1]).toBe(ALREADY_PAID)
  })

  it('exact output with ETH in wraps max-in and refunds', () => {
    const call = buildSwapCall({ type: 'EXACT_OUTPUT', routes: [{ path: p, amount: 500n, limit: 1000n }], inputIsNative: true, outputIsNative: false, totalAmount: 500n, totalLimit: 1000n, deadline: 1n })
    const d = decode(call.calldata)
    expect(d.bytes).toEqual([COMMAND.WRAP_ETH, COMMAND.V3_SWAP_EXACT_OUT, COMMAND.UNWRAP_WETH])
    const out = decodeAbiParameters(V3_IN, d.inputs[1])
    expect(out[1]).toBe(500n)
    expect(out[2]).toBe(1000n)
    expect(out[3]).toBe(encodeV3Path(p, true))
    expect(decodeAbiParameters(WRAP, d.inputs[2])).toEqual([MSG_SENDER, 0n])
    expect(call.value).toBe(1000n)
  })

  it('wrap / unwrap without pools', () => {
    const w = decode(buildWrapCall({ wrap: true, amount: 5n, weth: T.WETH as Address, deadline: 1n }).calldata)
    expect(w.bytes).toEqual([COMMAND.WRAP_ETH])
    const u = decode(buildWrapCall({ wrap: false, amount: 5n, weth: T.WETH as Address, deadline: 1n }).calldata)
    expect(u.bytes).toEqual([COMMAND.PERMIT2_TRANSFER_FROM, COMMAND.UNWRAP_WETH])
  })
})
