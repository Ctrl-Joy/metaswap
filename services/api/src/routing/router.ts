import { decodeFunctionResult, encodeFunctionData, getAddress, type Address, type Hex } from 'viem'
import { v2Math } from '@metaswap/sdk'
import { multicall3Abi, quoterV2Abi, v2PairAbi, v3PoolAbi } from '../abis'
import { HttpError, addr, lc, type Context } from '../context'
import type { Indexer } from '../indexer/indexer'
import { enumeratePaths, pathPools, pathVersion, type Path, type Protocol, type RoutePool } from './paths'
import { STEPS, STEP_PCT, optimizeSplit, splitAmounts, type SplitCandidate } from './split'

export const GAS = {
  base: 110_000n,
  v2Hop: 75_000n,
  v3Hop: 95_000n,
  v3Tick: 30_000n,
  wrap: 30_000n,
  unwrap: 40_000n,
  permit: 50_000n,
}

export interface PoolState {
  address: string
  version: Protocol
  token0: string
  token1: string
  fee: number
  reserve0: bigint
  reserve1: bigint
  sqrtPriceX96: bigint
  liquidity: bigint
}

export interface HopQuote {
  /** amounts at hop boundaries: [in, afterHop1, ..., out] */
  amounts: bigint[]
  ticksCrossed: number
}

export interface RouteLeg {
  path: Path
  pct: number
  amountIn: bigint
  amountOut: bigint
  hopAmounts: bigint[]
  gasUnits: bigint
  /** fee-adjusted mid-price output for this leg's input (exact-in) or input for its output (exact-out), float */
  midAmount: number
}

export interface RouteResult {
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT'
  tokenIn: string
  tokenOut: string
  amountIn: bigint
  amountOut: bigint
  legs: RouteLeg[]
  gasUnits: bigint
  gasPriceWei: bigint
  gasUsd: number | null
  priceImpactBps: number
  blockNumber: bigint
}

export interface RouteRequest {
  tokenIn: string // pool token (lower-case, WETH for ETH)
  tokenOut: string
  amount: bigint
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT'
  protocols?: Protocol[]
  mixed?: boolean
  maxHops?: number
  maxSplits?: number
  /** extra gas for wrap/unwrap/permit around the swaps */
  extraGas?: bigint
}

/** Gas cost (wei) converted into a token's base units via USD prices; 0 when prices are unknown. */
export function gasInToken(gasWei: bigint, ethUsd: number | undefined, tokenUsd: number | undefined, decimals: number): bigint {
  if (!ethUsd || !tokenUsd) return 0n
  const usd = (Number(gasWei) / 1e18) * ethUsd
  const amount = (usd / tokenUsd) * 10 ** decimals
  return Number.isFinite(amount) ? BigInt(Math.floor(amount)) : 0n
}

/** Fee-adjusted mid price (tokenOut per tokenIn, raw units) for one hop. */
export function hopMid(state: PoolState, tokenIn: string): number {
  const zeroForOne = state.token0 === tokenIn
  let p: number // token1 per token0 (raw)
  if (state.version === 'v2') p = Number(state.reserve1) / Number(state.reserve0)
  else {
    const r = Number(state.sqrtPriceX96) / 2 ** 96
    p = r * r
  }
  const mid = zeroForOne ? p : 1 / p
  return mid * (1 - state.fee / 1e6)
}

export function routeMid(path: Path, states: Map<string, PoolState>): number {
  let m = 1
  for (const h of path) m *= hopMid(states.get(h.pool.address)!, h.tokenIn)
  return m
}

/** Price impact (bps) of the whole trade vs the fee-adjusted mid price, clamped at 0. */
export function priceImpactBps(type: 'EXACT_INPUT' | 'EXACT_OUTPUT', actual: bigint, ideal: number): number {
  if (ideal <= 0) return 0
  const a = Number(actual)
  const impact = type === 'EXACT_INPUT' ? 1 - a / ideal : 1 - ideal / a
  return Math.max(0, Math.round(impact * 10_000))
}

export class Router {
  constructor(
    private ctx: Context,
    private indexer: Indexer,
  ) {}

  /** All indexed pools as route pools. */
  routePools(): RoutePool[] {
    return [...this.indexer.pools.values()].map((p) => ({ address: p.address, version: p.version, token0: p.token0, token1: p.token1, fee: p.fee }))
  }

  /** Fresh on-chain pool state at `blockNumber` (reserves / slot0 / liquidity) via one multicall. */
  async poolStates(pools: RoutePool[], blockNumber: bigint): Promise<Map<string, PoolState>> {
    const calls: { target: Address; callData: Hex; kind: 'reserves' | 'slot0' | 'liq'; pool: RoutePool }[] = []
    for (const p of pools) {
      const target = getAddress(p.address)
      if (p.version === 'v2') calls.push({ target, kind: 'reserves', pool: p, callData: encodeFunctionData({ abi: v2PairAbi, functionName: 'getReserves' }) })
      else {
        calls.push({ target, kind: 'slot0', pool: p, callData: encodeFunctionData({ abi: v3PoolAbi, functionName: 'slot0' }) })
        calls.push({ target, kind: 'liq', pool: p, callData: encodeFunctionData({ abi: v3PoolAbi, functionName: 'liquidity' }) })
      }
    }
    const results = await this.multicall(calls, blockNumber)
    const out = new Map<string, PoolState>()
    calls.forEach((c, i) => {
      const r = results[i]
      if (!r.success) return
      let s = out.get(c.pool.address)
      if (!s) out.set(c.pool.address, (s = { ...c.pool, reserve0: 0n, reserve1: 0n, sqrtPriceX96: 0n, liquidity: 0n }))
      if (c.kind === 'reserves') {
        const [r0, r1] = decodeFunctionResult({ abi: v2PairAbi, functionName: 'getReserves', data: r.returnData })
        s.reserve0 = r0
        s.reserve1 = r1
      } else if (c.kind === 'slot0') {
        s.sqrtPriceX96 = decodeFunctionResult({ abi: v3PoolAbi, functionName: 'slot0', data: r.returnData })[0]
      } else {
        s.liquidity = decodeFunctionResult({ abi: v3PoolAbi, functionName: 'liquidity', data: r.returnData })
      }
    })
    for (const [k, s] of out) {
      const dead = s.version === 'v2' ? s.reserve0 === 0n || s.reserve1 === 0n : s.sqrtPriceX96 === 0n || s.liquidity === 0n
      if (dead) out.delete(k)
    }
    return out
  }

  /** Multicall3.aggregate3 via eth_call, chunked to stay under the eth_call gas cap. */
  async multicall(calls: { target: Address; callData: Hex }[], blockNumber: bigint): Promise<{ success: boolean; returnData: Hex }[]> {
    if (calls.length === 0) return []
    const mc = addr(this.ctx, 'Multicall3')
    const CHUNK = 60
    const chunks: (typeof calls)[] = []
    for (let i = 0; i < calls.length; i += CHUNK) chunks.push(calls.slice(i, i + CHUNK))
    const res = await Promise.all(
      chunks.map(async (chunk) => {
        const data = encodeFunctionData({
          abi: multicall3Abi,
          functionName: 'aggregate3',
          args: [chunk.map((c) => ({ target: c.target, allowFailure: true, callData: c.callData }))],
        })
        const r = await this.ctx.client.call({ to: mc, data, blockNumber, gas: 1_000_000_000n })
        return decodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', data: r.data! }) as readonly { success: boolean; returnData: Hex }[]
      }),
    )
    return res.flat()
  }

  /**
   * Quote many (path, amount) pairs hop by hop: V2 hops with exact reserve math, V3 hops with
   * QuoterV2 quoteExact{Input,Output}Single, all V3 hops of one level batched in a multicall.
   */
  async quotePaths(
    jobs: { path: Path; amount: bigint }[],
    type: 'EXACT_INPUT' | 'EXACT_OUTPUT',
    states: Map<string, PoolState>,
    blockNumber: bigint,
  ): Promise<(HopQuote | null)[]> {
    const quoter = addr(this.ctx, 'QuoterV2')
    const exactIn = type === 'EXACT_INPUT'
    const amounts: (bigint[] | null)[] = jobs.map((j) => [j.amount])
    const ticks = jobs.map(() => 0)
    const maxHops = Math.max(0, ...jobs.map((j) => j.path.length))
    for (let level = 0; level < maxHops; level++) {
      const v3Calls: { job: number; target: Address; callData: Hex }[] = []
      jobs.forEach((job, j) => {
        const acc = amounts[j]
        if (!acc || level >= job.path.length) return
        const hop = exactIn ? job.path[level] : job.path[job.path.length - 1 - level]
        const amt = acc[acc.length - 1]
        const st = states.get(hop.pool.address)
        if (!st || amt <= 0n) {
          amounts[j] = null
          return
        }
        if (hop.pool.version === 'v2') {
          const zf1 = st.token0 === hop.tokenIn
          const [rin, rout] = zf1 ? [st.reserve0, st.reserve1] : [st.reserve1, st.reserve0]
          try {
            acc.push(exactIn ? v2Math.getAmountOut(amt, rin, rout) : v2Math.getAmountIn(amt, rin, rout))
          } catch {
            amounts[j] = null
          }
        } else {
          const callData = exactIn
            ? encodeFunctionData({ abi: quoterV2Abi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: getAddress(hop.tokenIn), tokenOut: getAddress(hop.tokenOut), amountIn: amt, fee: hop.pool.fee, sqrtPriceLimitX96: 0n }] })
            : encodeFunctionData({ abi: quoterV2Abi, functionName: 'quoteExactOutputSingle', args: [{ tokenIn: getAddress(hop.tokenIn), tokenOut: getAddress(hop.tokenOut), amount: amt, fee: hop.pool.fee, sqrtPriceLimitX96: 0n }] })
          v3Calls.push({ job: j, target: quoter, callData })
        }
      })
      const results = await this.multicall(v3Calls, blockNumber)
      v3Calls.forEach((c, i) => {
        const r = results[i]
        const acc = amounts[c.job]
        if (!acc) return
        if (!r.success || r.returnData === '0x') {
          amounts[c.job] = null
          return
        }
        try {
          const dec = decodeFunctionResult({
            abi: quoterV2Abi,
            functionName: exactIn ? 'quoteExactInputSingle' : 'quoteExactOutputSingle',
            data: r.returnData,
          }) as readonly [bigint, bigint, number, bigint]
          // V3 exact-output fills partially when liquidity runs out; QuoterV2 reverts in that case
          if (dec[0] === 0n) amounts[c.job] = null
          else {
            acc.push(dec[0])
            ticks[c.job] += Number(dec[2])
          }
        } catch {
          amounts[c.job] = null
        }
      })
    }
    return amounts.map((a, j) => {
      if (!a || a.length !== jobs[j].path.length + 1) return null
      return { amounts: exactIn ? a : [...a].reverse(), ticksCrossed: ticks[j] }
    })
  }

  gasForPath(path: Path, ticksCrossed: number): bigint {
    let g = 0n
    for (const h of path) g += h.pool.version === 'v2' ? GAS.v2Hop : GAS.v3Hop
    return g + BigInt(ticksCrossed) * GAS.v3Tick
  }

  async route(req: RouteRequest): Promise<RouteResult> {
    if (req.amount <= 0n) throw new HttpError(400, 'amount must be > 0')
    const exactIn = req.type === 'EXACT_INPUT'
    const allowMixed = exactIn && (req.mixed ?? true)
    const paths = enumeratePaths(this.routePools(), req.tokenIn, req.tokenOut, {
      maxHops: req.maxHops ?? 3,
      protocols: req.protocols ?? ['v2', 'v3'],
      mixed: allowMixed,
    }).filter((p) => allowMixed || pathVersion(p) !== 'mixed')
    if (paths.length === 0) throw new HttpError(404, 'No route found between these tokens')

    const blockNumber = await this.ctx.client.getBlockNumber({ cacheTime: 0 })
    const usedPools = new Map<string, RoutePool>()
    for (const p of paths) for (const h of p) usedPools.set(h.pool.address, h.pool)
    const [states, gasPriceWei] = await Promise.all([this.poolStates([...usedPools.values()], blockNumber), this.ctx.client.getGasPrice()])
    const live = paths.filter((p) => p.every((h) => states.has(h.pool.address)))
    if (live.length === 0) throw new HttpError(404, 'No route with liquidity found')

    // phase 1: every path at 100%
    const full = await this.quotePaths(live.map((path) => ({ path, amount: req.amount })), req.type, states, blockNumber)
    const ranked = live
      .map((path, i) => ({ path, q: full[i] }))
      .filter((x) => x.q !== null)
      .sort((a, b) => {
        const va = exactIn ? a.q!.amounts[a.q!.amounts.length - 1] : a.q!.amounts[0]
        const vb = exactIn ? b.q!.amounts[b.q!.amounts.length - 1] : b.q!.amounts[0]
        return exactIn ? (vb > va ? 1 : vb < va ? -1 : 0) : va > vb ? 1 : va < vb ? -1 : 0
      })
    if (ranked.length === 0) throw new HttpError(404, 'Insufficient liquidity for this trade')
    const top = ranked.slice(0, 8)

    // phase 2: 5% increments for the best candidates
    const maxSplits = req.maxSplits ?? 3
    const pctQuotes: (HopQuote | null)[][] = top.map((t) => {
      const arr: (HopQuote | null)[] = new Array(STEPS + 1).fill(null)
      arr[STEPS] = t.q
      return arr
    })
    if (maxSplits > 1 && top.length > 1) {
      const jobs: { path: Path; amount: bigint; r: number; i: number }[] = []
      top.forEach((t, r) => {
        for (let i = 1; i < STEPS; i++) {
          const amount = (req.amount * BigInt(i * STEP_PCT)) / 100n
          if (amount > 0n) jobs.push({ path: t.path, amount, r, i })
        }
      })
      const qs = await this.quotePaths(jobs, req.type, states, blockNumber)
      jobs.forEach((j, k) => (pctQuotes[j.r][j.i] = qs[k]))
    }

    const prices = this.indexer.prices
    const weth = lc(addr(this.ctx, 'WETH9'))
    const scoreToken = exactIn ? req.tokenOut : req.tokenIn
    const scoreDecimals = this.indexer.decimals.get(scoreToken) ?? 18
    const candidates: SplitCandidate[] = top.map((t, r) => ({
      pools: pathPools(t.path),
      quotes: pctQuotes[r].map((q) => (q ? (exactIn ? q.amounts[q.amounts.length - 1] : q.amounts[0]) : null)),
      gasCost: gasInToken(this.gasForPath(t.path, t.q!.ticksCrossed) * gasPriceWei, prices.get(weth), prices.get(scoreToken), scoreDecimals),
    }))
    const split = optimizeSplit(candidates, req.type, maxSplits)
    if (!split) throw new HttpError(404, 'Insufficient liquidity for this trade')

    // re-quote the chosen legs with their exact amounts (parts sum exactly to the trade amount)
    const legAmounts = splitAmounts(req.amount, split.parts.map((p) => p.pct))
    const legQuotes = await this.quotePaths(split.parts.map((p, i) => ({ path: top[p.route].path, amount: legAmounts[i] })), req.type, states, blockNumber)
    const legs: RouteLeg[] = split.parts.map((p, i) => {
      const q = legQuotes[i]
      if (!q) throw new HttpError(409, 'Route quote changed while routing; retry')
      const path = top[p.route].path
      const mid = routeMid(path, states)
      const amountIn = q.amounts[0]
      const amountOut = q.amounts[q.amounts.length - 1]
      return {
        path,
        pct: p.pct,
        amountIn,
        amountOut,
        hopAmounts: q.amounts,
        gasUnits: this.gasForPath(path, q.ticksCrossed),
        midAmount: exactIn ? Number(amountIn) * mid : Number(amountOut) / mid,
      }
    })
    const amountIn = legs.reduce((a, l) => a + l.amountIn, 0n)
    const amountOut = legs.reduce((a, l) => a + l.amountOut, 0n)
    const gasUnits = GAS.base + (req.extraGas ?? 0n) + legs.reduce((a, l) => a + l.gasUnits, 0n)
    const ethUsd = prices.get(weth)
    const ideal = legs.reduce((a, l) => a + l.midAmount, 0)
    return {
      type: req.type,
      tokenIn: req.tokenIn,
      tokenOut: req.tokenOut,
      amountIn,
      amountOut,
      legs,
      gasUnits,
      gasPriceWei,
      gasUsd: ethUsd ? (Number(gasUnits * gasPriceWei) / 1e18) * ethUsd : null,
      priceImpactBps: priceImpactBps(req.type, exactIn ? amountOut : amountIn, ideal),
      blockNumber,
    }
  }
}
