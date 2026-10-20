import { getBlock, readContract, signTypedData, writeContract } from 'wagmi/actions'
import { maxUint256, type Address, type Hex } from 'viem'
import type { Token } from '@metaswap/sdk'
import { wagmiConfig } from '@/wallet/wagmi'
import { erc20Abi, permit2Abi } from '@/lib/abis'
import { apiPost } from '@/api/client'
import type { XOrder } from '@/api/types'
import { trackTx, invalidateChainQueries } from '@/state/transactions'
import { formatTokenAmount } from '@/lib/format'
import { buildLimitOrder, cancelArgs, encodeOrder, orderHash, orderTypedData, randomNonce, type ExclusiveDutchOrder } from './order'

export type LimitStepId = 'approve' | 'sign' | 'submit'

export interface PlaceLimitArgs {
  account: Address
  reactor: Address
  permit2: Address
  chainId: number
  inputToken: Token
  outputToken: Token
  amountIn: bigint
  minAmountOut: bigint
  expirySeconds: number
}

/** Chain time (Anvil's clock), used for order timestamps so validity matches the reactor. */
export async function chainNow(): Promise<number> {
  const b = await getBlock(wagmiConfig, { blockTag: 'latest' })
  return Number(b.timestamp)
}

/** approve Permit2 (if needed) → sign Permit2 witness order → POST /x/orders. No gas for the order itself. */
export async function placeLimitOrder(a: PlaceLimitArgs, onStep: (id: LimitStepId, s: 'active' | 'done' | 'skipped') => void): Promise<{ order: ExclusiveDutchOrder; hash: Hex; response: XOrder }> {
  const allowance = await readContract(wagmiConfig, { address: a.inputToken.address, abi: erc20Abi, functionName: 'allowance', args: [a.account, a.permit2] })
  if (allowance < a.amountIn) {
    onStep('approve', 'active')
    const hash = await writeContract(wagmiConfig, { address: a.inputToken.address, abi: erc20Abi, functionName: 'approve', args: [a.permit2, maxUint256] })
    const receipt = await trackTx(a.account, { hash, type: 'approve', summary: `Approved ${a.inputToken.symbol} for Permit2` }, { toast: false })
    if (!receipt || receipt.status !== 'success') throw new Error('Approval transaction reverted')
    onStep('approve', 'done')
  } else onStep('approve', 'skipped')

  onStep('sign', 'active')
  let nonce = randomNonce()
  // Extremely unlikely, but never reuse a consumed Permit2 nonce.
  for (let i = 0; i < 3; i++) {
    const word = await readContract(wagmiConfig, { address: a.permit2, abi: permit2Abi, functionName: 'nonceBitmap', args: [a.account, nonce >> 8n] })
    if (((word >> (nonce & 0xffn)) & 1n) === 0n) break
    nonce = randomNonce()
  }
  const order = buildLimitOrder({
    reactor: a.reactor,
    swapper: a.account,
    inputToken: a.inputToken.address,
    outputToken: a.outputToken.address,
    amountIn: a.amountIn,
    minAmountOut: a.minAmountOut,
    nowSec: await chainNow(),
    expirySeconds: a.expirySeconds,
    nonce,
  })
  const td = orderTypedData(order, a.permit2, a.chainId)
  const signature = await signTypedData(wagmiConfig, td)
  onStep('sign', 'done')

  onStep('submit', 'active')
  const encodedOrder = encodeOrder(order)
  const response = await apiPost<XOrder>('/x/orders', { encodedOrder, signature, chainId: a.chainId })
  onStep('submit', 'done')
  invalidateChainQueries()
  return { order, hash: orderHash(order), response }
}

/** Cancel = burn the order's Permit2 nonce: invalidateUnorderedNonces(nonce >> 8, 1 << (nonce & 0xff)). */
export async function cancelLimitOrder(a: { account: Address; permit2: Address; nonce: bigint; label: string }) {
  const hash = await writeContract(wagmiConfig, { address: a.permit2, abi: permit2Abi, functionName: 'invalidateUnorderedNonces', args: cancelArgs(a.nonce) })
  return trackTx(a.account, { hash, type: 'cancel-order', summary: `Cancelled ${a.label}` })
}

export function orderLabel(order: ExclusiveDutchOrder, tIn?: Token, tOut?: Token): string {
  const out = order.outputs[0]
  return `${tIn ? formatTokenAmount(order.input.startAmount, tIn.decimals) : ''} ${tIn?.symbol ?? 'token'} → ${tOut && out ? formatTokenAmount(out.endAmount, tOut.decimals) : ''} ${tOut?.symbol ?? 'token'} limit`
}
