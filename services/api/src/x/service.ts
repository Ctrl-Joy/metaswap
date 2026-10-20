import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { bytesToBigInt, getAddress, isAddress, isHex, recoverTypedDataAddress, zeroAddress, type Address, type Hex } from 'viem'
import { erc20Abi, permit2Abi } from '../abis'
import { HttpError, addr, lc, tokenJson, type Context, type TokenInfo } from '../context'
import type { Indexer } from '../indexer/indexer'
import { jsonSafe } from '../lib/json'
import type { QuoteService } from '../routing/quote'
import {
  decodeOrder,
  encodeOrder,
  noncePosition,
  orderHash,
  orderJson,
  orderTypedData,
  resolveOrder,
  type ExclusiveDutchOrder,
} from './order'

export type OrderStatus = 'open' | 'filled' | 'expired' | 'cancelled'

export const DEFAULT_DECAY_SEC = 60
/** fillers are expected to beat the classic route by a little at auction start */
export const START_IMPROVEMENT_BPS = 10
export const DEFAULT_LIMIT_EXPIRY_SEC = 7 * 86400

interface OrderRow {
  hash: string
  swapper: string
  reactor: string
  nonce: string
  deadline: number
  decay_start: number
  decay_end: number
  input_token: string
  input_start: string
  input_end: string
  outputs_json: string
  encoded_order: string
  signature: string
  status: OrderStatus
  created_at: number
  updated_at: number
  fill_tx: string | null
  fill_block: number | null
  filler: string | null
  error: string | null
}

export class XService {
  /** 'order' (orderJson) whenever an order is submitted or changes status (WebSocket topic x:orders) */
  readonly events = new EventEmitter()

  constructor(
    private ctx: Context,
    private indexer: Indexer,
    private quotes: QuoteService,
  ) {}

  private token(a: string | undefined, name: string): TokenInfo {
    if (!a) throw new HttpError(400, `${name} is required`)
    const t = this.indexer.tokens.resolve(a)
    if (!t) throw new HttpError(400, `Unknown ${name} ${a}`)
    return t
  }

  private async chainNow(): Promise<number> {
    const b = await this.ctx.client.getBlock({ blockTag: 'latest' })
    return Number(b.timestamp)
  }

  async isNonceUsed(swapper: Address, nonce: bigint): Promise<boolean> {
    const { wordPos, bitPos } = noncePosition(nonce)
    const word = await this.ctx.client.readContract({ address: addr(this.ctx, 'Permit2'), abi: permit2Abi, functionName: 'nonceBitmap', args: [swapper, wordPos] })
    return ((word >> bitPos) & 1n) === 1n
  }

  async freshNonce(swapper: Address): Promise<bigint> {
    for (let i = 0; i < 5; i++) {
      // random 248-bit word position + bit 0..255 (Permit2 unordered nonces)
      const n = bytesToBigInt(randomBytes(31)) << 8n
      const nonce = n | BigInt(randomBytes(1)[0])
      if (!(await this.isNonceUsed(swapper, nonce))) return nonce
    }
    throw new HttpError(500, 'could not find an unused nonce')
  }

  /**
   * GET /x/quote — indicative Dutch auction. `mode=dutch` (default): start = classic best output
   * + START_IMPROVEMENT_BPS, end = classic output − slippage, decaying over `decaySeconds`.
   * `mode=limit`: fixed output (`limitAmountOut` base units, or `limitPrice` tokenOut per tokenIn),
   * no decay, long deadline (`expirySeconds`, default 7 days).
   * With `swapper`, also returns a ready-to-sign order (encodedOrder + EIP-712 typedData).
   */
  async quote(q: Record<string, string | undefined>) {
    const tokenIn = this.token(q.tokenIn, 'tokenIn')
    const tokenOut = this.token(q.tokenOut, 'tokenOut')
    if (tokenIn.isNative) throw new HttpError(400, 'MetaSwapX orders spend ERC20 via Permit2; wrap ETH to WETH first')
    const type = (q.type ?? 'EXACT_INPUT').toUpperCase()
    if (type !== 'EXACT_INPUT') throw new HttpError(400, 'MetaSwapX quotes support EXACT_INPUT only')
    if (!q.amount || !/^\d+$/.test(q.amount)) throw new HttpError(400, 'amount must be an integer string in base units')
    const amountIn = BigInt(q.amount)
    const mode = (q.mode ?? 'dutch').toLowerCase()
    if (mode !== 'dutch' && mode !== 'limit') throw new HttpError(400, 'mode must be dutch|limit')
    const slippageBps = q.slippageBps ? Number(q.slippageBps) : 50
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5000) throw new HttpError(400, 'slippageBps must be 0..5000')
    const swapper = q.swapper ? (isAddress(q.swapper, { strict: false }) ? getAddress(q.swapper) : null) : undefined
    if (swapper === null) throw new HttpError(400, 'swapper must be an address')
    const now = await this.chainNow()

    let classicOut: bigint | null = null
    let routeString: string | null = null
    try {
      const classic = (await this.quotes.quote({ tokenIn: tokenIn.address, tokenOut: tokenOut.address, amount: q.amount, type: 'EXACT_INPUT', slippageBps })) as Record<string, unknown>
      classicOut = BigInt(classic.amountOut as string)
      routeString = classic.routeString as string
    } catch (e) {
      if (mode === 'dutch') throw e
    }

    let startAmount: bigint
    let endAmount: bigint
    let decayStartTime: number
    let decayEndTime: number
    let deadline: number
    if (mode === 'dutch') {
      const decaySec = q.decaySeconds ? Number(q.decaySeconds) : DEFAULT_DECAY_SEC
      if (!(decaySec > 0 && decaySec <= 3600)) throw new HttpError(400, 'decaySeconds must be 1..3600')
      startAmount = (classicOut! * BigInt(10_000 + START_IMPROVEMENT_BPS)) / 10_000n
      endAmount = (classicOut! * BigInt(10_000 - slippageBps)) / 10_000n
      // a short delay before decay gives the wallet time to sign
      const startDelay = q.startDelaySeconds ? Number(q.startDelaySeconds) : 5
      decayStartTime = now + startDelay
      decayEndTime = decayStartTime + decaySec
      deadline = decayEndTime + (q.deadlineBufferSeconds ? Number(q.deadlineBufferSeconds) : 120)
    } else {
      let out: bigint
      if (q.limitAmountOut && /^\d+$/.test(q.limitAmountOut)) out = BigInt(q.limitAmountOut)
      else if (q.limitPrice && Number(q.limitPrice) > 0) {
        const human = (Number(amountIn) / 10 ** tokenIn.decimals) * Number(q.limitPrice)
        out = BigInt(Math.floor(human * 10 ** tokenOut.decimals))
      } else throw new HttpError(400, 'limit mode needs limitAmountOut or limitPrice')
      startAmount = endAmount = out
      decayStartTime = decayEndTime = now
      deadline = now + (q.expirySeconds ? Number(q.expirySeconds) : DEFAULT_LIMIT_EXPIRY_SEC)
    }
    const reactor = addr(this.ctx, 'ExclusiveDutchOrderReactor')
    const outToken = tokenOut.isNative ? zeroAddress : tokenOut.address
    const res: Record<string, unknown> = {
      mode,
      chainId: this.ctx.deployment.chainId,
      reactor,
      permit2: addr(this.ctx, 'Permit2'),
      tokenIn: tokenJson(this.ctx, tokenIn),
      tokenOut: tokenJson(this.ctx, tokenOut),
      input: { token: tokenIn.address, startAmount: amountIn.toString(), endAmount: amountIn.toString() },
      outputs: [{ token: outToken, startAmount: startAmount.toString(), endAmount: endAmount.toString(), recipient: swapper ?? null }],
      decayStartTime,
      decayEndTime,
      deadline,
      classicAmountOut: classicOut?.toString() ?? null,
      classicRouteString: routeString,
      improvementBps: mode === 'dutch' ? START_IMPROVEMENT_BPS : null,
      slippageBps,
    }
    if (swapper) {
      const order: ExclusiveDutchOrder = {
        info: { reactor, swapper, nonce: await this.freshNonce(swapper), deadline: BigInt(deadline), additionalValidationContract: zeroAddress, additionalValidationData: '0x' },
        decayStartTime: BigInt(decayStartTime),
        decayEndTime: BigInt(decayEndTime),
        exclusiveFiller: zeroAddress,
        exclusivityOverrideBps: 0n,
        input: { token: tokenIn.address, startAmount: amountIn, endAmount: amountIn },
        outputs: [{ token: outToken, startAmount, endAmount, recipient: swapper }],
      }
      res.order = orderJson(order)
      res.encodedOrder = encodeOrder(order)
      res.orderHash = orderHash(order)
      res.typedData = jsonSafe(orderTypedData(order, this.ctx.deployment.chainId, addr(this.ctx, 'Permit2')))
      const [bal, allowance] = await Promise.all([
        this.ctx.client.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: 'balanceOf', args: [swapper] }),
        this.ctx.client.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: 'allowance', args: [swapper, addr(this.ctx, 'Permit2')] }),
      ])
      res.approval = { required: allowance < amountIn, token: tokenIn.address, spender: addr(this.ctx, 'Permit2') }
      res.balanceSufficient = bal >= amountIn
    }
    return res
  }

  /** POST /x/orders — validate a signed order and add it to the book. */
  async submit(body: { encodedOrder?: string; order?: string; signature?: string; sig?: string }) {
    const encoded = body.encodedOrder ?? body.order
    const signature = body.signature ?? body.sig
    if (!encoded || !isHex(encoded)) throw new HttpError(400, 'encodedOrder (abi-encoded ExclusiveDutchOrder) is required')
    if (!signature || !isHex(signature)) throw new HttpError(400, 'signature is required')
    let order: ExclusiveDutchOrder
    try {
      order = decodeOrder(encoded)
    } catch {
      throw new HttpError(400, 'encodedOrder is not a valid ExclusiveDutchOrder encoding')
    }
    const hash = orderHash(order)
    if (await this.ctx.db.get('SELECT hash FROM x_orders WHERE hash = ?', lc(hash))) throw new HttpError(409, 'Order already submitted', { orderHash: hash })
    const reactor = addr(this.ctx, 'ExclusiveDutchOrderReactor')
    const permit2 = addr(this.ctx, 'Permit2')
    const errors: string[] = []
    if (lc(order.info.reactor) !== lc(reactor)) errors.push(`info.reactor must be ${reactor}`)
    if (order.info.additionalValidationContract !== zeroAddress) errors.push('additionalValidationContract is not supported')
    if (order.outputs.length === 0) errors.push('order has no outputs')
    if (order.info.deadline < order.decayEndTime) errors.push('deadline must be >= decayEndTime')
    if (order.decayEndTime < order.decayStartTime) errors.push('decayEndTime must be >= decayStartTime')
    if (order.input.startAmount > order.input.endAmount) errors.push('input must not decay downwards')
    if (order.input.startAmount !== order.input.endAmount && order.outputs.some((o) => o.startAmount !== o.endAmount)) errors.push('input and outputs cannot both decay')
    for (const o of order.outputs) if (o.endAmount > o.startAmount) errors.push('outputs must decay downwards (start >= end)')
    if (order.input.endAmount === 0n) errors.push('input amount must be > 0')
    const now = await this.chainNow()
    if (order.info.deadline <= BigInt(now)) errors.push('order deadline has passed')
    if (errors.length) throw new HttpError(400, 'Invalid order', { errors })

    const recovered = await recoverTypedDataAddress({ ...orderTypedData(order, this.ctx.deployment.chainId, permit2), signature: signature as Hex }).catch(() => null)
    if (!recovered || lc(recovered) !== lc(order.info.swapper)) throw new HttpError(400, 'Signature does not recover to info.swapper', { recovered })
    if (await this.isNonceUsed(order.info.swapper, order.info.nonce)) throw new HttpError(400, 'Order nonce is already used or cancelled')
    const [bal, allowance] = await Promise.all([
      this.ctx.client.readContract({ address: order.input.token, abi: erc20Abi, functionName: 'balanceOf', args: [order.info.swapper] }),
      this.ctx.client.readContract({ address: order.input.token, abi: erc20Abi, functionName: 'allowance', args: [order.info.swapper, permit2] }),
    ])
    if (bal < order.input.endAmount) throw new HttpError(400, 'Swapper balance is below the order input')
    if (allowance < order.input.endAmount) throw new HttpError(400, 'Swapper has not approved Permit2 for the input token')

    await this.ctx.db.insert('x_orders', {
      hash: lc(hash),
      swapper: lc(order.info.swapper),
      reactor: lc(order.info.reactor),
      nonce: order.info.nonce.toString(),
      deadline: Number(order.info.deadline),
      decay_start: Number(order.decayStartTime),
      decay_end: Number(order.decayEndTime),
      exclusive_filler: lc(order.exclusiveFiller),
      exclusivity_override_bps: order.exclusivityOverrideBps.toString(),
      input_token: lc(order.input.token),
      input_start: order.input.startAmount.toString(),
      input_end: order.input.endAmount.toString(),
      outputs_json: JSON.stringify(orderJson(order).outputs),
      encoded_order: encoded,
      signature,
      status: 'open',
      created_at: now,
      updated_at: now,
    })
    const out = await this.get(hash)
    this.events.emit('order', out)
    return out
  }

  async openOrders(): Promise<{ row: OrderRow; order: ExclusiveDutchOrder }[]> {
    return (await this.ctx.db.all<OrderRow>("SELECT * FROM x_orders WHERE status = 'open' ORDER BY created_at")).map((row) => ({ row, order: decodeOrder(row.encoded_order as Hex) }))
  }

  private refreshing = false
  /** Keep order statuses current as blocks are indexed. */
  watch() {
    this.indexer.on('indexed', async (_b: number, ts: number) => {
      if (this.refreshing) return
      this.refreshing = true
      try {
        await this.refreshStatuses(ts)
      } catch (e) {
        console.error('[x] status refresh', (e as Error).message)
      } finally {
        this.refreshing = false
      }
    })
  }

  /** Move open orders to filled / cancelled (nonce used without a fill) / expired. */
  async refreshStatuses(now?: number) {
    const ts = now ?? (await this.chainNow())
    const changed: string[] = []
    for (const { row, order } of await this.openOrders()) {
      const fill = await this.ctx.db.get<{ tx_hash: string; block: number; filler: string }>('SELECT tx_hash, block, filler FROM fills WHERE order_hash = ?', row.hash)
      if (fill) {
        await this.ctx.db.run("UPDATE x_orders SET status = 'filled', fill_tx = ?, fill_block = ?, filler = ?, updated_at = ? WHERE hash = ?", fill.tx_hash, fill.block, fill.filler, ts, row.hash)
        changed.push(row.hash)
        continue
      }
      if (await this.isNonceUsed(order.info.swapper, order.info.nonce).catch(() => false)) {
        // re-check fills: the indexer may not have seen the fill block yet
        if (this.indexer.indexedBlock < this.indexer.headBlock) continue
        await this.ctx.db.run("UPDATE x_orders SET status = 'cancelled', updated_at = ? WHERE hash = ?", ts, row.hash)
        changed.push(row.hash)
        continue
      }
      if (row.deadline < ts) {
        await this.ctx.db.run("UPDATE x_orders SET status = 'expired', updated_at = ? WHERE hash = ?", ts, row.hash)
        changed.push(row.hash)
      }
    }
    for (const h of changed) this.events.emit('order', await this.get(h))
  }

  rowJson(row: OrderRow, now: number) {
    const order = decodeOrder(row.encoded_order as Hex)
    const resolved = resolveOrder(order, BigInt(now))
    const tIn = this.indexer.tokens.getSync(order.input.token)
    return {
      orderHash: row.hash,
      status: row.status,
      swapper: getAddress(row.swapper),
      reactor: getAddress(row.reactor),
      nonce: row.nonce,
      deadline: row.deadline,
      decayStartTime: row.decay_start,
      decayEndTime: row.decay_end,
      inputToken: tIn ? tokenJson(this.ctx, tIn) : order.input.token,
      order: orderJson(order),
      resolved: {
        at: now,
        input: { token: resolved.input.token, amount: resolved.input.amount.toString() },
        outputs: resolved.outputs.map((o) => {
          const t = o.token === zeroAddress ? this.indexer.tokens.native() : this.indexer.tokens.getSync(o.token)
          return { token: o.token, symbol: t?.symbol ?? null, decimals: t?.decimals ?? null, recipient: o.recipient, amount: o.amount.toString() }
        }),
      },
      encodedOrder: row.encoded_order,
      signature: row.signature,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      fillTx: row.fill_tx,
      fillBlock: row.fill_block,
      filler: row.filler ? getAddress(row.filler) : null,
    }
  }

  async get(hash: string) {
    const row = await this.ctx.db.get<OrderRow>('SELECT * FROM x_orders WHERE hash = ?', lc(hash))
    if (!row) throw new HttpError(404, 'Order not found')
    return this.rowJson(row, this.indexer.indexedTimestamp || Math.floor(Date.now() / 1000))
  }

  async list(q: { swapper?: string; status?: string; limit?: string }) {
    const where: string[] = []
    const params: string[] = []
    if (q.swapper) {
      where.push('swapper = ?')
      params.push(lc(q.swapper))
    }
    if (q.status) {
      const statuses = q.status.split(',')
      for (const s of statuses) if (!['open', 'filled', 'expired', 'cancelled'].includes(s)) throw new HttpError(400, 'status must be open|filled|expired|cancelled')
      where.push(`status IN (${statuses.map(() => '?').join(',')})`)
      params.push(...statuses)
    }
    const limit = Math.min(Number(q.limit ?? 100) || 100, 500)
    const rows = await this.ctx.db.all<OrderRow>(`SELECT * FROM x_orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${limit}`, ...params)
    const now = this.indexer.indexedTimestamp || Math.floor(Date.now() / 1000)
    return rows.map((r) => this.rowJson(r, now))
  }
}
