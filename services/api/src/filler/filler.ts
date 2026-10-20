import {
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { executorAbi, swapRouter02Abi } from '../abis'
import { addr, lc, type Context } from '../context'
import type { Indexer } from '../indexer/indexer'
import { encodeV3Path, segments, type Path } from '../routing/paths'
import { gasInToken, type Router } from '../routing/router'
import { resolveOrder, type ExclusiveDutchOrder } from '../x/order'
import type { XService } from '../x/service'

/** SwapRouter02 sentinels (swap-router-contracts Constants): amountIn 0 = router balance. */
const SR_MSG_SENDER = '0x0000000000000000000000000000000000000001' as Address
const SR_ADDRESS_THIS = '0x0000000000000000000000000000000000000002' as Address

const CALLBACK_PARAMS = parseAbiParameters('address[] approveSwapRouter02, address[] approveReactor, bytes[] multicallData')

/**
 * SwapRouter02 multicall data that swaps `legs` (input → output) and leaves the output with the
 * caller (the executor). Mixed routes chain protocol segments through the router's own balance.
 */
export function buildSwapRouter02Calls(legs: { path: Path; amountIn: bigint }[], opts: { unwrapTo?: Address; unwrapMin?: bigint }): Hex[] {
  const calls: Hex[] = []
  const finalRecipient = opts.unwrapTo ? SR_ADDRESS_THIS : SR_MSG_SENDER
  for (const leg of legs) {
    const segs = segments(leg.path)
    segs.forEach((seg, i) => {
      const last = i === segs.length - 1
      const recipient = last ? finalRecipient : SR_ADDRESS_THIS
      const amountIn = i === 0 ? leg.amountIn : 0n
      if (seg[0].pool.version === 'v3') {
        calls.push(encodeFunctionData({ abi: swapRouter02Abi, functionName: 'exactInput', args: [{ path: encodeV3Path(seg), recipient, amountIn, amountOutMinimum: 0n }] }))
      } else {
        const path = [seg[0].tokenIn, ...seg.map((h) => h.tokenOut)].map((a) => getAddress(a))
        calls.push(encodeFunctionData({ abi: swapRouter02Abi, functionName: 'swapExactTokensForTokens', args: [amountIn, 0n, path, recipient] }))
      }
    })
  }
  if (opts.unwrapTo) calls.push(encodeFunctionData({ abi: swapRouter02Abi, functionName: 'unwrapWETH9', args: [opts.unwrapMin ?? 0n, opts.unwrapTo] }))
  return calls
}

export function encodeCallbackData(approveSwapRouter02: Address[], approveReactor: Address[], calls: Hex[]): Hex {
  return encodeAbiParameters(CALLBACK_PARAMS, [approveSwapRouter02, approveReactor, calls])
}

export interface FillAttempt {
  orderHash: string
  at: number
  status: 'skipped' | 'unprofitable' | 'sent' | 'failed' | 'filled'
  reason?: string
  txHash?: string
}

/**
 * Filler bot: each indexed block, resolves every open order at the next block's timestamp, routes
 * the resolved input through MetaSwap pools, and fills via SwapRouter02Executor when the route's
 * output covers the resolved outputs plus gas. Uses Anvil account #9 (local devnet only).
 */
export class Filler {
  readonly account: PrivateKeyAccount
  private wallet: WalletClient
  enabled = false
  disabledReason: string | null = null
  private inflight = new Set<string>()
  private busy = false
  private pending = false
  attempts: FillAttempt[] = []

  constructor(
    private ctx: Context,
    private indexer: Indexer,
    private router: Router,
    private x: XService,
  ) {
    this.account = privateKeyToAccount(ctx.config.fillerKey)
    this.wallet = createWalletClient({ account: this.account, chain: ctx.chain, transport: http(ctx.config.rpcUrl) })
  }

  async start() {
    if (!this.ctx.config.fillerEnabled) {
      this.disabledReason = 'FILLER_ENABLED=false'
      return
    }
    const executor = this.ctx.deployment.contracts.SwapRouter02Executor
    if (!executor || !this.ctx.deployment.contracts.ExclusiveDutchOrderReactor) {
      this.disabledReason = 'MetaSwapX contracts are not deployed'
      return
    }
    try {
      const caller = await this.ctx.client.readContract({ address: getAddress(executor), abi: executorAbi, functionName: 'whitelistedCaller' })
      if (lc(caller) !== lc(this.account.address)) {
        this.disabledReason = `executor whitelists ${caller}, not the filler ${this.account.address}`
        return
      }
    } catch (e) {
      this.disabledReason = `cannot read executor: ${(e as Error).message.split('\n')[0]}`
      return
    }
    this.enabled = true
    this.indexer.on('indexed', () => void this.onBlock())
  }

  stop() {
    this.enabled = false
  }

  private record(a: FillAttempt) {
    this.attempts.push(a)
    if (this.attempts.length > 200) this.attempts.shift()
  }

  private async onBlock() {
    if (!this.enabled) return
    if (this.busy) {
      this.pending = true
      return
    }
    this.busy = true
    try {
      do {
        this.pending = false
        for (const { row, order } of this.x.openOrders()) {
          if (this.inflight.has(row.hash)) continue
          await this.tryFill(row.hash, order, row.encoded_order as Hex, row.signature as Hex).catch((e) =>
            this.record({ orderHash: row.hash, at: Date.now(), status: 'failed', reason: (e as Error).message.split('\n')[0] }),
          )
        }
      } while (this.pending && this.enabled)
    } finally {
      this.busy = false
    }
  }

  async tryFill(hash: string, order: ExclusiveDutchOrder, encoded: Hex, sig: Hex) {
    const now = BigInt(this.indexer.indexedTimestamp + 1)
    if (order.info.deadline < now) return
    if (order.exclusiveFiller !== zeroAddress && lc(order.exclusiveFiller) !== lc(addr(this.ctx, 'SwapRouter02Executor')) && now <= order.decayStartTime && order.exclusivityOverrideBps === 0n) {
      return this.record({ orderHash: hash, at: Date.now(), status: 'skipped', reason: 'exclusive to another filler' })
    }
    const outTokens = new Set(order.outputs.map((o) => lc(o.token)))
    if (outTokens.size !== 1) return this.record({ orderHash: hash, at: Date.now(), status: 'skipped', reason: 'multi-token outputs unsupported' })
    const resolved = resolveOrder(order, now)
    const outToken = order.outputs[0].token
    const native = outToken === zeroAddress
    const weth = addr(this.ctx, 'WETH9')
    const routeOut = lc(native ? weth : outToken)
    const required = resolved.outputs.reduce((a, o) => a + o.amount, 0n)
    const route = await this.router.route({ tokenIn: lc(order.input.token), tokenOut: routeOut, amount: resolved.input.amount, type: 'EXACT_INPUT', maxSplits: 3 })
    const ethUsd = this.indexer.prices.get(lc(weth))
    const gasCost = gasInToken(route.gasUnits * route.gasPriceWei, ethUsd, this.indexer.prices.get(routeOut), this.indexer.decimals.get(routeOut) ?? 18)
    const minProfit = gasInToken(BigInt(Math.floor(this.ctx.config.fillerMinProfitUsd * 1e6)) * 10n ** 12n, 1, this.indexer.prices.get(routeOut), this.indexer.decimals.get(routeOut) ?? 18)
    if (route.amountOut < required + gasCost + minProfit) {
      return this.record({ orderHash: hash, at: Date.now(), status: 'unprofitable', reason: `route ${route.amountOut} < required ${required} + gas ${gasCost}` })
    }
    const executor = addr(this.ctx, 'SwapRouter02Executor')
    const calls = buildSwapRouter02Calls(
      route.legs.map((l) => ({ path: l.path, amountIn: l.amountIn })),
      native ? { unwrapTo: executor, unwrapMin: required } : {},
    )
    const callbackData = encodeCallbackData([getAddress(order.input.token)], native ? [] : [getAddress(outToken)], calls)
    const args = [{ order: encoded, sig }, callbackData] as const
    // simulate first: reverts when the auction moved or balances changed
    let gas: bigint
    try {
      gas = await this.ctx.client.estimateContractGas({ address: executor, abi: executorAbi, functionName: 'execute', args, account: this.account })
    } catch (e) {
      return this.record({ orderHash: hash, at: Date.now(), status: 'failed', reason: `simulation reverted: ${(e as Error).message.split('\n')[0]}` })
    }
    this.inflight.add(hash)
    try {
      const txHash = await this.wallet.writeContract({ address: executor, abi: executorAbi, functionName: 'execute', args, account: this.account, chain: this.ctx.chain, gas: (gas * 13n) / 10n })
      this.record({ orderHash: hash, at: Date.now(), status: 'sent', txHash })
      const receipt = await this.ctx.client.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 })
      this.record({ orderHash: hash, at: Date.now(), status: receipt.status === 'success' ? 'filled' : 'failed', txHash })
    } finally {
      this.inflight.delete(hash)
    }
  }

  status() {
    return {
      enabled: this.enabled,
      disabledReason: this.disabledReason,
      address: this.account.address,
      recent: this.attempts.slice(-20),
    }
  }
}
