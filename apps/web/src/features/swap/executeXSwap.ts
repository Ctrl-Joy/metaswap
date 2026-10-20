import { readContract, signTypedData, writeContract } from 'wagmi/actions'
import { maxUint256, type Address, type Hex } from 'viem'
import { contractAddress, type Token } from '@metaswap/sdk'
import { wagmiConfig } from '@/wallet/wagmi'
import { erc20Abi } from '@/lib/abis'
import { apiGet, apiPost } from '@/api/client'
import type { XOrder } from '@/api/types'
import { trackTx, invalidateChainQueries } from '@/state/transactions'
import { decodeOrder, orderHash, orderTypedData } from '@/features/limit/order'
import { DEVNET_CHAIN_ID } from '@/config'
import type { StepId, StepStatus } from './executeSwap'

/** GET /x/quote (mode=dutch) with a swapper: indicative Dutch auction + ready-to-sign order. */
export interface XSwapQuote {
  encodedOrder: Hex
  orderHash?: Hex
  outputs: Array<{ token: Address; startAmount: string; endAmount: string }>
  classicAmountOut?: string | null
  decayStartTime: number
  decayEndTime: number
  deadline: number
  approval?: { required: boolean }
}

export function fetchXSwapQuote(p: { tokenIn: Token; tokenOut: Token; amount: bigint; swapper: Address; slippageBps: number }, signal?: AbortSignal) {
  return apiGet<XSwapQuote>(
    '/x/quote',
    { tokenIn: p.tokenIn.address, tokenOut: p.tokenOut.address, amount: p.amount.toString(), type: 'EXACT_INPUT', mode: 'dutch', swapper: p.swapper, slippageBps: p.slippageBps },
    { signal },
  )
}

/**
 * Gasless swap through MetaSwapX: approve Permit2 if needed → sign the Permit2 witness order
 * (typed data rebuilt locally from the decoded order and checked against the swapper) →
 * POST /x/orders. A filler settles it on-chain; no swap gas for the user.
 */
export async function executeXSwap(a: { account: Address; quote: XSwapQuote; inputToken: Token; amountIn: bigint; summary: string }, cb: { onStep: (id: StepId, s: StepStatus) => void }): Promise<Hex> {
  const permit2 = contractAddress('Permit2')
  const order = decodeOrder(a.quote.encodedOrder)
  if (order.info.swapper.toLowerCase() !== a.account.toLowerCase()) throw new Error('Order swapper does not match the connected account')
  if (order.input.token.toLowerCase() !== a.inputToken.address.toLowerCase() || order.input.startAmount !== a.amountIn)
    throw new Error('Order input does not match the trade')
  if (order.info.reactor.toLowerCase() !== contractAddress('ExclusiveDutchOrderReactor').toLowerCase()) throw new Error('Order targets an unknown reactor')

  const allowance = await readContract(wagmiConfig, { address: a.inputToken.address, abi: erc20Abi, functionName: 'allowance', args: [a.account, permit2] })
  if (allowance < order.input.endAmount) {
    cb.onStep('approve', 'active')
    const hash = await writeContract(wagmiConfig, { address: a.inputToken.address, abi: erc20Abi, functionName: 'approve', args: [permit2, maxUint256] })
    const r = await trackTx(a.account, { hash, type: 'approve', summary: `Approved ${a.inputToken.symbol} for Permit2` }, { toast: false })
    if (!r || r.status !== 'success') throw new Error('Approval transaction reverted')
    cb.onStep('approve', 'done')
  } else cb.onStep('approve', 'skipped')

  cb.onStep('permit', 'active')
  const signature = await signTypedData(wagmiConfig, orderTypedData(order, permit2, DEVNET_CHAIN_ID))
  cb.onStep('permit', 'done')

  cb.onStep('swap', 'active')
  await apiPost<XOrder>('/x/orders', { encodedOrder: a.quote.encodedOrder, signature, chainId: DEVNET_CHAIN_ID })
  invalidateChainQueries()
  cb.onStep('swap', 'done')
  return orderHash(order)
}
