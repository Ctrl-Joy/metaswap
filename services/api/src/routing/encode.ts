// UniversalRouter calldata builder (MetaSwapUniversalRouter = Uniswap command bytes, classic
// input layouts without minHopPriceX36 — see packages/contracts/README.md "UniversalRouter").
import { concatHex, encodeAbiParameters, encodeFunctionData, getAddress, numberToHex, parseAbiParameters, type Address, type Hex } from 'viem'
import { universalRouterAbi } from '../abis'
import { encodeV3Path, segments, type Path } from './paths'

export const COMMAND = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  PERMIT2_TRANSFER_FROM: 0x02,
  SWEEP: 0x04,
  TRANSFER: 0x05,
  PAY_PORTION: 0x06,
  V2_SWAP_EXACT_IN: 0x08,
  V2_SWAP_EXACT_OUT: 0x09,
  PERMIT2_PERMIT: 0x0a,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
} as const

export const MSG_SENDER = '0x0000000000000000000000000000000000000001' as Address
export const ADDRESS_THIS = '0x0000000000000000000000000000000000000002' as Address
export const CONTRACT_BALANCE = 1n << 255n
export const ALREADY_PAID = 0n

const SWAP_V3 = parseAbiParameters('address recipient, uint256 amount, uint256 limit, bytes path, bool payerIsUser')
const SWAP_V2 = parseAbiParameters('address recipient, uint256 amount, uint256 limit, address[] path, bool payerIsUser')
const WRAP = parseAbiParameters('address recipient, uint256 amount')
const TRANSFER_FROM = parseAbiParameters('address token, address recipient, uint160 amount')
const SWEEP = parseAbiParameters('address token, address recipient, uint256 amountMin')
export const PERMIT_SINGLE_PARAMS = parseAbiParameters(
  '((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature',
)

export interface PermitSingle {
  details: { token: Address; amount: bigint; expiration: number; nonce: number }
  spender: Address
  sigDeadline: bigint
}

export interface PlannedRoute {
  path: Path
  /** exact input: amount in; exact output: amount out */
  amount: bigint
  /** exact input: min out; exact output: max in */
  limit: bigint
}

export interface SwapPlanInput {
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT'
  routes: PlannedRoute[]
  /** user pays native ETH (wrapped by the router) */
  inputIsNative: boolean
  /** user receives native ETH (router unwraps) */
  outputIsNative: boolean
  /** recipient of the output; undefined = msg.sender */
  recipient?: Address
  /** exact input: total amount in; exact output: total amount out */
  totalAmount: bigint
  /** exact input: total min out; exact output: total max in */
  totalLimit: bigint
  deadline: bigint
  permit?: { permit: PermitSingle; signature: Hex }
}

export interface RouterCall {
  commands: Hex
  inputs: Hex[]
  value: bigint
  calldata: Hex
}

class Plan {
  commands: number[] = []
  inputs: Hex[] = []
  add(cmd: number, input: Hex) {
    this.commands.push(cmd)
    this.inputs.push(input)
  }
}

function v2PathTokens(hops: Path): Address[] {
  return [hops[0].tokenIn, ...hops.map((h) => h.tokenOut)].map((a) => getAddress(a))
}

export function encodePermit(permit: PermitSingle, signature: Hex): Hex {
  return encodeAbiParameters(PERMIT_SINGLE_PARAMS, [
    {
      details: { token: permit.details.token, amount: permit.details.amount, expiration: permit.details.expiration, nonce: permit.details.nonce },
      spender: permit.spender,
      sigDeadline: permit.sigDeadline,
    },
    signature,
  ])
}

/**
 * Build `execute(commands, inputs, deadline)` for a (possibly split, possibly mixed v2/v3) trade.
 *
 * Exact input, per route: ERC20 input is paid by the user through Permit2 (`payerIsUser`); native
 * input is wrapped first (`WRAP_ETH` to the router) and swaps pay from the router. Mixed routes
 * are encoded as consecutive protocol segments: a segment feeding a V2 segment sends straight to
 * the next pair (V2 `amountIn = 0` = already paid); one feeding a V3 segment sends to the router
 * and the V3 segment spends `CONTRACT_BALANCE`. Native output swaps to the router and finishes
 * with `UNWRAP_WETH(recipient, totalMinOut)`.
 *
 * Exact output (pure v2 or v3 routes): native input wraps `amountInMax` and refunds the unused WETH
 * as ETH at the end (`UNWRAP_WETH(msg.sender, 0)`).
 */
export function buildSwapCall(p: SwapPlanInput): RouterCall {
  const plan = new Plan()
  const finalRecipient = p.recipient ? getAddress(p.recipient) : MSG_SENDER
  const swapRecipient = p.outputIsNative ? ADDRESS_THIS : finalRecipient
  const payerIsUser = !p.inputIsNative
  let value = 0n

  if (p.permit) plan.add(COMMAND.PERMIT2_PERMIT, encodePermit(p.permit.permit, p.permit.signature))

  if (p.type === 'EXACT_INPUT') {
    if (p.inputIsNative) {
      plan.add(COMMAND.WRAP_ETH, encodeAbiParameters(WRAP, [ADDRESS_THIS, p.totalAmount]))
      value = p.totalAmount
    }
    for (const r of p.routes) {
      const segs = segments(r.path)
      segs.forEach((seg, i) => {
        const first = i === 0
        const last = i === segs.length - 1
        const next = segs[i + 1]
        const recipient = last ? swapRecipient : next[0].pool.version === 'v2' ? getAddress(next[0].pool.address) : ADDRESS_THIS
        const prev = segs[i - 1]
        let amountIn: bigint
        if (first) amountIn = r.amount
        else if (seg[0].pool.version === 'v2') amountIn = prev[0].pool.version === 'v2' ? CONTRACT_BALANCE : ALREADY_PAID
        else amountIn = CONTRACT_BALANCE
        const minOut = last ? (p.outputIsNative ? 0n : r.limit) : 0n
        const payer = first ? payerIsUser : false
        if (seg[0].pool.version === 'v3') {
          plan.add(COMMAND.V3_SWAP_EXACT_IN, encodeAbiParameters(SWAP_V3, [recipient, amountIn, minOut, encodeV3Path(seg), payer]))
        } else {
          plan.add(COMMAND.V2_SWAP_EXACT_IN, encodeAbiParameters(SWAP_V2, [recipient, amountIn, minOut, v2PathTokens(seg), payer]))
        }
      })
    }
    if (p.outputIsNative) plan.add(COMMAND.UNWRAP_WETH, encodeAbiParameters(WRAP, [finalRecipient, p.totalLimit]))
  } else {
    if (p.inputIsNative) {
      plan.add(COMMAND.WRAP_ETH, encodeAbiParameters(WRAP, [ADDRESS_THIS, p.totalLimit]))
      value = p.totalLimit
    }
    for (const r of p.routes) {
      const version = r.path[0].pool.version
      if (r.path.some((h) => h.pool.version !== version)) throw new Error('mixed routes are not supported for exact output')
      if (version === 'v3') {
        plan.add(COMMAND.V3_SWAP_EXACT_OUT, encodeAbiParameters(SWAP_V3, [swapRecipient, r.amount, r.limit, encodeV3Path(r.path, true), payerIsUser]))
      } else {
        plan.add(COMMAND.V2_SWAP_EXACT_OUT, encodeAbiParameters(SWAP_V2, [swapRecipient, r.amount, r.limit, v2PathTokens(r.path), payerIsUser]))
      }
    }
    if (p.outputIsNative) plan.add(COMMAND.UNWRAP_WETH, encodeAbiParameters(WRAP, [finalRecipient, p.totalAmount]))
    // refund unspent wrapped ETH
    if (p.inputIsNative) plan.add(COMMAND.UNWRAP_WETH, encodeAbiParameters(WRAP, [MSG_SENDER, 0n]))
  }
  return finish(plan, value, p.deadline)
}

/** ETH ↔ WETH through the router (no pools). */
export function buildWrapCall(opts: { wrap: boolean; amount: bigint; weth: Address; recipient?: Address; deadline: bigint; permit?: { permit: PermitSingle; signature: Hex } }): RouterCall {
  const plan = new Plan()
  const recipient = opts.recipient ? getAddress(opts.recipient) : MSG_SENDER
  if (opts.permit) plan.add(COMMAND.PERMIT2_PERMIT, encodePermit(opts.permit.permit, opts.permit.signature))
  if (opts.wrap) {
    plan.add(COMMAND.WRAP_ETH, encodeAbiParameters(WRAP, [recipient, opts.amount]))
    return finish(plan, opts.amount, opts.deadline)
  }
  plan.add(COMMAND.PERMIT2_TRANSFER_FROM, encodeAbiParameters(TRANSFER_FROM, [opts.weth, ADDRESS_THIS, opts.amount]))
  plan.add(COMMAND.UNWRAP_WETH, encodeAbiParameters(WRAP, [recipient, opts.amount]))
  return finish(plan, 0n, opts.deadline)
}

export function sweepInput(token: Address, recipient: Address, amountMin: bigint): Hex {
  return encodeAbiParameters(SWEEP, [token, recipient, amountMin])
}

function finish(plan: Plan, value: bigint, deadline: bigint): RouterCall {
  const commands = (plan.commands.length ? concatHex(plan.commands.map((c) => numberToHex(c, { size: 1 }))) : '0x') as Hex
  const calldata = encodeFunctionData({ abi: universalRouterAbi, functionName: 'execute', args: [commands, plan.inputs, deadline] })
  return { commands, inputs: plan.inputs, value, calldata }
}
