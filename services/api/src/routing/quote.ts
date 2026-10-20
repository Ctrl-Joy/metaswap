import { randomUUID } from 'node:crypto'
import { erc20Abi, permit2Abi } from '../abis'
import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem'
import { HttpError, addr, isNativeAddress, lc, tokenJson, type Context, type TokenInfo } from '../context'
import type { Indexer } from '../indexer/indexer'
import { buildSwapCall, buildWrapCall, type PermitSingle, type RouterCall } from './encode'
import { pathVersion, type Protocol } from './paths'
import { buildPermitSingle, permitRequired, permitTypedData, PERMIT_SIG_DEADLINE_SEC } from './permit2'
import { GAS, Router, type RouteResult } from './router'

export interface QuoteParams {
  tokenIn: string
  tokenOut: string
  amount: string
  type?: string
  slippageBps?: string | number
  recipient?: string
  swapper?: string
  deadline?: string | number
  protocols?: string
  maxHops?: string | number
  maxSplits?: string | number
}

interface CachedQuote {
  id: string
  expiresAt: number
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT'
  tokenIn: TokenInfo
  tokenOut: TokenInfo
  route: RouteResult | null
  amountIn: bigint
  amountOut: bigint
  limit: bigint
  slippageBps: number
  recipient?: Address
  swapper?: Address
  deadline: bigint
  permit: PermitSingle | null
  wrap: 'wrap' | 'unwrap' | null
  response: Record<string, unknown>
}

export const DEFAULT_SLIPPAGE_BPS = 50
export const DEFAULT_DEADLINE_SEC = 30 * 60

export function applySlippage(type: 'EXACT_INPUT' | 'EXACT_OUTPUT', amount: bigint, bps: number): bigint {
  const b = BigInt(bps)
  if (type === 'EXACT_INPUT') return (amount * (10_000n - b)) / 10_000n
  return (amount * (10_000n + b) + 9_999n) / 10_000n
}

export function parseProtocols(s?: string): { protocols: Protocol[]; mixed: boolean } {
  if (!s) return { protocols: ['v2', 'v3'], mixed: true }
  const parts = s.toLowerCase().split(',').map((x) => x.trim())
  const protocols = (['v2', 'v3'] as const).filter((p) => parts.includes(p))
  const mixed = parts.includes('mixed')
  if (mixed && protocols.length === 0) return { protocols: ['v2', 'v3'], mixed: true }
  if (protocols.length === 0) throw new HttpError(400, 'protocols must be a list of v2,v3,mixed')
  return { protocols: [...protocols], mixed: mixed && protocols.length === 2 }
}

export class QuoteService {
  readonly router: Router
  private cache = new Map<string, CachedQuote>()

  constructor(
    private ctx: Context,
    private indexer: Indexer,
  ) {
    this.router = new Router(ctx, indexer)
  }

  private token(a: string, name: string): TokenInfo {
    if (!a) throw new HttpError(400, `${name} is required`)
    const t = this.indexer.tokens.resolve(a)
    if (!t) throw new HttpError(400, `Unknown ${name} ${a}`)
    return t
  }

  private poolToken(t: TokenInfo): string {
    return t.isNative ? lc(addr(this.ctx, 'WETH9')) : lc(t.address)
  }

  private gc() {
    const now = Date.now()
    for (const [k, v] of this.cache) if (v.expiresAt < now) this.cache.delete(k)
  }

  async quote(q: QuoteParams) {
    this.gc()
    const tokenIn = this.token(q.tokenIn, 'tokenIn')
    const tokenOut = this.token(q.tokenOut, 'tokenOut')
    const type = (q.type ?? 'EXACT_INPUT').toUpperCase()
    if (type !== 'EXACT_INPUT' && type !== 'EXACT_OUTPUT') throw new HttpError(400, 'type must be EXACT_INPUT or EXACT_OUTPUT')
    if (!q.amount || !/^\d+$/.test(String(q.amount))) throw new HttpError(400, 'amount must be an integer string in base units')
    const amount = BigInt(q.amount)
    if (amount <= 0n) throw new HttpError(400, 'amount must be > 0')
    const slippageBps = q.slippageBps === undefined || q.slippageBps === '' || q.slippageBps === 'auto' ? DEFAULT_SLIPPAGE_BPS : Number(q.slippageBps)
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5000) throw new HttpError(400, 'slippageBps must be an integer 0..5000')
    for (const [k, v] of [['recipient', q.recipient], ['swapper', q.swapper]] as const) {
      if (v && !isAddress(v, { strict: false })) throw new HttpError(400, `${k} must be an address`)
    }
    const recipient = q.recipient ? getAddress(q.recipient) : undefined
    const swapper = q.swapper ? getAddress(q.swapper) : undefined
    const head = await this.ctx.client.getBlock({ blockTag: 'latest' })
    const chainNow = Number(head.timestamp)
    let deadline: bigint
    if (q.deadline === undefined || q.deadline === '') deadline = BigInt(chainNow + DEFAULT_DEADLINE_SEC)
    else {
      const d = Number(q.deadline)
      if (!Number.isFinite(d) || d <= 0) throw new HttpError(400, 'deadline must be unix seconds or seconds-from-now')
      deadline = BigInt(d < 1e9 ? chainNow + d : d)
    }
    const { protocols, mixed } = parseProtocols(q.protocols)
    const tin = this.poolToken(tokenIn)
    const tout = this.poolToken(tokenOut)
    if (lc(tokenIn.address) === lc(tokenOut.address)) throw new HttpError(400, 'tokenIn and tokenOut must differ')

    const exactIn = type === 'EXACT_INPUT'
    let route: RouteResult | null = null
    let wrap: 'wrap' | 'unwrap' | null = null
    let amountIn: bigint
    let amountOut: bigint
    let gasUnits: bigint
    let priceImpactBps = 0
    const gasPriceWei = await this.ctx.client.getGasPrice()
    if (tin === tout) {
      // ETH <-> WETH: 1:1 through the router
      wrap = tokenIn.isNative ? 'wrap' : 'unwrap'
      amountIn = amountOut = amount
      gasUnits = GAS.base + (wrap === 'wrap' ? GAS.wrap : GAS.unwrap)
    } else {
      const extraGas = (tokenIn.isNative ? GAS.wrap : 0n) + (tokenOut.isNative ? GAS.unwrap : 0n)
      route = await this.router.route({
        tokenIn: tin,
        tokenOut: tout,
        amount,
        type,
        protocols,
        mixed,
        maxHops: q.maxHops ? Number(q.maxHops) : undefined,
        maxSplits: q.maxSplits ? Number(q.maxSplits) : undefined,
        extraGas,
      })
      amountIn = route.amountIn
      amountOut = route.amountOut
      gasUnits = route.gasUnits
      priceImpactBps = route.priceImpactBps
    }
    const limit = wrap ? amount : applySlippage(type, exactIn ? amountOut : amountIn, slippageBps)
    const neededIn = exactIn ? amountIn : limit

    // Permit2 / approval state for ERC20 input
    let permit: PermitSingle | null = null
    let permit2: Record<string, unknown> = { required: false, spender: addr(this.ctx, 'UniversalRouter'), permit2Address: addr(this.ctx, 'Permit2') }
    let approval: Record<string, unknown> = { required: false }
    if (!tokenIn.isNative && swapper) {
      const permit2Addr = addr(this.ctx, 'Permit2')
      const ur = addr(this.ctx, 'UniversalRouter')
      const [erc20Allowance, p2] = await Promise.all([
        this.ctx.client.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: 'allowance', args: [swapper, permit2Addr] }),
        this.ctx.client.readContract({ address: permit2Addr, abi: permit2Abi, functionName: 'allowance', args: [swapper, tokenIn.address, ur] }),
      ])
      const allowance = { amount: p2[0], expiration: Number(p2[1]), nonce: Number(p2[2]) }
      approval = { required: erc20Allowance < neededIn, token: tokenIn.address, spender: permit2Addr, currentAllowance: erc20Allowance.toString(), amount: neededIn.toString() }
      // the permit must stay valid until the swap's deadline
      if (permitRequired(allowance, neededIn, Number(deadline))) {
        permit = buildPermitSingle({ token: tokenIn.address, spender: ur, nonce: allowance.nonce, now: chainNow })
        permit2 = {
          required: true,
          spender: ur,
          permit2Address: permit2Addr,
          token: tokenIn.address,
          allowance: allowance.amount.toString(),
          expiration: allowance.expiration,
          nonce: allowance.nonce,
        }
      } else {
        permit2 = { required: false, spender: ur, permit2Address: permit2Addr, token: tokenIn.address, allowance: allowance.amount.toString(), expiration: allowance.expiration, nonce: allowance.nonce }
      }
    } else if (!tokenIn.isNative) {
      permit2 = { required: null, spender: addr(this.ctx, 'UniversalRouter'), permit2Address: addr(this.ctx, 'Permit2'), note: 'pass swapper=<address> to check allowances' }
    }

    const id = randomUUID()
    const cached: CachedQuote = {
      id,
      expiresAt: Date.now() + this.ctx.config.quoteTtlMs,
      type,
      tokenIn,
      tokenOut,
      route,
      amountIn,
      amountOut,
      limit,
      slippageBps,
      recipient,
      swapper,
      deadline,
      permit,
      wrap,
      response: {},
    }
    const call = this.buildCall(cached)
    // with a swapper whose allowances are in place, simulate the real call for an accurate gas limit
    let gasLimit: bigint | null = null
    if (swapper && !permit && !approval.required) {
      try {
        const est = await this.ctx.client.estimateGas({ account: swapper, to: addr(this.ctx, 'UniversalRouter'), data: call.calldata, value: call.value })
        gasUnits = est
        gasLimit = (est * 13n) / 10n
      } catch {
        /* insufficient balance etc.: keep the heuristic */
      }
    }
    const ethUsd = this.indexer.prices.get(lc(addr(this.ctx, 'WETH9')))
    const gasUsd = ethUsd ? (Number(gasUnits * gasPriceWei) / 1e18) * ethUsd : null
    const routeJson = route ? this.routeJson(route) : []
    const response = {
      id,
      quoteId: id,
      expiresAt: Math.floor(cached.expiresAt / 1000),
      chainId: this.ctx.deployment.chainId,
      blockNumber: (route?.blockNumber ?? head.number).toString(),
      type,
      tokenIn: tokenJson(this.ctx, tokenIn),
      tokenOut: tokenJson(this.ctx, tokenOut),
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      ...(exactIn ? { amountOutMin: limit.toString() } : { amountInMax: limit.toString() }),
      amountInFormatted: Number(amountIn) / 10 ** tokenIn.decimals,
      amountOutFormatted: Number(amountOut) / 10 ** tokenOut.decimals,
      executionPrice: Number(amountOut) / 10 ** tokenOut.decimals / (Number(amountIn) / 10 ** tokenIn.decimals),
      slippageBps,
      deadline: deadline.toString(),
      recipient: recipient ?? null,
      swapper: swapper ?? null,
      priceImpactBps,
      gasEstimate: gasUnits.toString(),
      gasPriceWei: gasPriceWei.toString(),
      gasUsd,
      route: routeJson,
      routes: route
        ? route.legs.map((l, i) => ({ percent: l.pct, amountIn: l.amountIn.toString(), amountOut: l.amountOut.toString(), protocol: pathVersion(l.path), routeString: this.legString(l.path), hops: routeJson[i] }))
        : [],
      routeString: route ? route.legs.map((l) => `[${l.pct}%] ${this.legString(l.path)}`).join(' + ') : `${tokenIn.symbol} --[wrap]--> ${tokenOut.symbol}`,
      wrap,
      methodParameters: { to: addr(this.ctx, 'UniversalRouter'), calldata: call.calldata, value: call.value.toString(), ...(gasLimit ? { gasLimit: gasLimit.toString() } : {}) },
      permit2,
      ...(permit ? { permitData: permitTypedData(this.ctx.deployment.chainId, addr(this.ctx, 'Permit2'), permit) } : {}),
      approval,
    }
    cached.response = response
    this.cache.set(id, cached)
    return response
  }

  private buildCall(c: CachedQuote, permitSig?: Hex): RouterCall {
    const permit = permitSig && c.permit ? { permit: c.permit, signature: permitSig } : undefined
    if (c.wrap) return buildWrapCall({ wrap: c.wrap === 'wrap', amount: c.amountIn, weth: addr(this.ctx, 'WETH9'), recipient: c.recipient, deadline: c.deadline, permit })
    const exactIn = c.type === 'EXACT_INPUT'
    const legs = c.route!.legs
    // per-leg limits: exact-in → min out per leg; exact-out → max in per leg (Σ ≤ total limit)
    const limits = legs.map((l) => applySlippage(c.type, exactIn ? l.amountOut : l.amountIn, c.slippageBps))
    return buildSwapCall({
      type: c.type,
      routes: legs.map((l, i) => ({ path: l.path, amount: exactIn ? l.amountIn : l.amountOut, limit: limits[i] })),
      inputIsNative: Boolean(c.tokenIn.isNative),
      outputIsNative: Boolean(c.tokenOut.isNative),
      recipient: c.recipient,
      totalAmount: exactIn ? c.amountIn : c.amountOut,
      totalLimit: exactIn ? limits.reduce((a, b) => a + b, 0n) : limits.reduce((a, b) => a + b, 0n),
      deadline: c.deadline,
      permit,
    })
  }

  legString(path: RouteResult['legs'][number]['path']): string {
    const sym = (a: string) => this.indexer.tokens.getSync(a)?.symbol ?? a.slice(0, 8)
    let s = sym(path[0].tokenIn)
    for (const h of path) s += ` --[${h.pool.version.toUpperCase()} ${h.pool.fee / 10000}%]--> ${sym(h.tokenOut)}`
    return s
  }

  routeJson(route: RouteResult) {
    return route.legs.map((l) =>
      l.path.map((h, i) => ({
        type: h.pool.version,
        pool: getAddress(h.pool.address),
        tokenIn: tokenJson(this.ctx, this.indexer.tokens.getSync(h.tokenIn)!),
        tokenOut: tokenJson(this.ctx, this.indexer.tokens.getSync(h.tokenOut)!),
        fee: h.pool.fee,
        amountIn: l.hopAmounts[i].toString(),
        amountOut: l.hopAmounts[i + 1].toString(),
      })),
    )
  }

  getCached(id: string): CachedQuote | undefined {
    const c = this.cache.get(id)
    if (!c || c.expiresAt < Date.now()) return undefined
    return c
  }

  /** POST /swap: rebuild calldata for a cached quote, prepending PERMIT2_PERMIT when signed. */
  async swap(body: { quote?: { id?: string; quoteId?: string } | string; quoteId?: string; permitSignature?: string; signature?: string }) {
    const id = typeof body.quote === 'string' ? body.quote : (body.quote?.id ?? body.quote?.quoteId ?? body.quoteId)
    if (!id) throw new HttpError(400, 'body.quote (the /quote response or its id) is required')
    const c = this.getCached(id)
    if (!c) throw new HttpError(410, 'Quote expired or unknown; request a new quote')
    const sig = body.permitSignature ?? body.signature
    if (sig !== undefined && (!isHex(sig) || (sig.length !== 132 && sig.length !== 130))) throw new HttpError(400, 'permitSignature must be a 65-byte hex signature')
    if (sig && !c.permit) throw new HttpError(400, 'This quote does not need a Permit2 signature')
    const call = this.buildCall(c, sig as Hex | undefined)
    const ur = addr(this.ctx, 'UniversalRouter')
    let gasEstimate = BigInt((c.response.gasEstimate as string) ?? '0') + (sig ? GAS.permit : 0n)
    let simulation: { ok: boolean; error?: string } | null = null
    if (c.swapper) {
      try {
        const est = await this.ctx.client.estimateGas({ account: c.swapper, to: ur, data: call.calldata, value: call.value })
        gasEstimate = (est * 13n) / 10n
        simulation = { ok: true }
      } catch (e) {
        simulation = { ok: false, error: ((e as Error).message ?? '').split('\n')[0] }
      }
    }
    return {
      quoteId: c.id,
      methodParameters: { to: ur, calldata: call.calldata, value: call.value.toString(), ...(simulation?.ok ? { gasLimit: gasEstimate.toString() } : {}) },
      gasEstimate: gasEstimate.toString(),
      permitIncluded: Boolean(sig),
      deadline: c.deadline.toString(),
      simulation,
    }
  }

  static sigDeadline() {
    return PERMIT_SIG_DEADLINE_SEC
  }
}
