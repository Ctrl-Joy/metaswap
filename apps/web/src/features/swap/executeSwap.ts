import { readContract, sendTransaction, signTypedData, writeContract } from 'wagmi/actions'
import { maxUint256, type Address, type Hash, type Hex } from 'viem'
import { contractAddress, wrappedNative, type Token } from '@metaswap/sdk'
import { wagmiConfig } from '@/wallet/wagmi'
import { erc20Abi, weth9Abi } from '@/lib/abis'
import { apiPost } from '@/api/client'
import type { QuoteResponse, SwapResponse } from '@/api/types'
import { ApiError } from '@/lib/errors'
import { normalizeTypedData } from '@/lib/typedData'
import { trackTx } from '@/state/transactions'
import type { WrapType } from './swapReducer'

// Swap execution engine — docs/analysis/flows.md §4–§6:
//   ERC20 → Permit2 approve (once per token) → sign PermitSingle (if quote.permit2.required)
//   → POST /swap (calldata with PERMIT2_PERMIT prepended) → send tx → wait for receipt.
// Wrap/unwrap go straight to WETH9.

export type StepId = 'approve' | 'permit' | 'swap' | 'wrap'
export type StepStatus = 'idle' | 'active' | 'done' | 'error' | 'skipped'

export interface SwapStep {
  id: StepId
  title: string
  description: string
}

/** Ordered step list shown in the review modal. Pure — unit tested. */
export function buildSwapSteps(o: { wrapType: WrapType; needsApproval: boolean; needsPermit: boolean; inputSymbol: string }): SwapStep[] {
  if (o.wrapType)
    return [{ id: 'wrap', title: o.wrapType === 'wrap' ? 'Wrap ETH' : 'Unwrap WETH', description: 'Confirm in your wallet' }]
  const steps: SwapStep[] = []
  if (o.needsApproval) steps.push({ id: 'approve', title: `Approve ${o.inputSymbol} for Permit2`, description: 'One-time approval so MetaSwap can use your token' })
  if (o.needsPermit) steps.push({ id: 'permit', title: `Sign ${o.inputSymbol} permit`, description: 'Gasless signature, valid for this router' })
  steps.push({ id: 'swap', title: 'Confirm swap', description: 'Send the swap transaction' })
  return steps
}

/** Amount the user must hold / approve: amountInMax for exact-out, amountIn otherwise. */
export function requiredInputAmount(quote: Pick<QuoteResponse, 'amountIn' | 'amountInMax' | 'type'> | undefined, exactOut: boolean): bigint | undefined {
  if (!quote) return undefined
  return BigInt(exactOut && quote.amountInMax ? quote.amountInMax : quote.amountIn)
}

export function permit2Address(): Address | undefined {
  try {
    return contractAddress('Permit2')
  } catch {
    return undefined
  }
}

export async function readPermit2Allowance(token: Token, owner: Address): Promise<bigint> {
  const p2 = permit2Address()
  if (!p2 || token.isNative) return maxUint256
  return readContract(wagmiConfig, { address: token.address, abi: erc20Abi, functionName: 'allowance', args: [owner, p2] })
}

export interface ExecuteCallbacks {
  onStep: (id: StepId, status: StepStatus) => void
}

export interface ExecuteSwapArgs {
  account: Address
  quote: QuoteResponse
  inputToken: Token
  outputToken: Token
  exactOut: boolean
  summary: string
}

/** Run approve → permit → /swap → tx. Resolves with the swap tx hash after a successful receipt. */
export async function executeSwap(a: ExecuteSwapArgs, cb: ExecuteCallbacks): Promise<Hash> {
  const required = requiredInputAmount(a.quote, a.exactOut)!

  // 1. ERC20 approve(Permit2, max) when the allowance is too low.
  if (!a.inputToken.isNative) {
    const p2 = permit2Address()
    if (!p2) throw new Error('Permit2 is not deployed (missing from deployments/31337.json).')
    const allowance = await readPermit2Allowance(a.inputToken, a.account)
    // On-chain allowance is the source of truth (the quote's `approval.required` may be stale).
    if (allowance < required) {
      cb.onStep('approve', 'active')
      const hash = await writeContract(wagmiConfig, { address: a.inputToken.address, abi: erc20Abi, functionName: 'approve', args: [p2, maxUint256] })
      const receipt = await trackTx(a.account, { hash, type: 'approve', summary: `Approved ${a.inputToken.symbol} for Permit2` }, { toast: false })
      if (!receipt || receipt.status !== 'success') throw new Error('Approval transaction reverted')
      cb.onStep('approve', 'done')
    } else cb.onStep('approve', 'skipped')
  }

  // 2. PermitSingle signature (Permit2 AllowanceTransfer → UniversalRouter).
  let permitSignature: Hex | undefined
  if (a.quote.permit2?.required && a.quote.permitData) {
    cb.onStep('permit', 'active')
    const td = normalizeTypedData(a.quote.permitData)
    permitSignature = await signTypedData(wagmiConfig, td as Parameters<typeof signTypedData>[1])
    cb.onStep('permit', 'done')
  } else cb.onStep('permit', 'skipped')

  // 3. Build final calldata server-side, then send.
  cb.onStep('swap', 'active')
  let params = a.quote.methodParameters
  try {
    const built = await apiPost<SwapResponse>('/swap', { quote: a.quote, permitSignature })
    params = { ...built.methodParameters, gasLimit: built.methodParameters.gasLimit ?? built.gasLimit }
  } catch (e) {
    // Only fall back to the quote's own calldata if /swap is missing and no permit is needed.
    if (!(e instanceof ApiError && e.status === 404 && !permitSignature)) throw e
  }
  const hash = await sendTransaction(wagmiConfig, {
    to: params.to,
    data: params.calldata,
    value: BigInt(params.value || '0'),
    // API-simulated limit (+30%); wallet estimates have run V3 swaps out of gas.
    ...(params.gasLimit ? { gas: BigInt(params.gasLimit) } : {}),
  })
  const receipt = await trackTx(a.account, {
    hash,
    type: 'swap',
    summary: a.summary,
    meta: { tokenIn: a.inputToken.address, tokenOut: a.outputToken.address, amountIn: a.quote.amountIn, amountOut: a.quote.amountOut },
  })
  if (!receipt || receipt.status !== 'success') throw new Error('Swap transaction reverted (status 0)')
  cb.onStep('swap', 'done')
  return hash
}

/** ETH ⇄ WETH directly on WETH9. */
export async function executeWrap(a: { account: Address; wrapType: Exclude<WrapType, null>; amount: bigint; summary: string }, cb: ExecuteCallbacks): Promise<Hash> {
  cb.onStep('wrap', 'active')
  const weth = wrappedNative().address
  const hash =
    a.wrapType === 'wrap'
      ? await writeContract(wagmiConfig, { address: weth, abi: weth9Abi, functionName: 'deposit', value: a.amount })
      : await writeContract(wagmiConfig, { address: weth, abi: weth9Abi, functionName: 'withdraw', args: [a.amount] })
  const receipt = await trackTx(a.account, { hash, type: a.wrapType, summary: a.summary })
  if (!receipt || receipt.status !== 'success') throw new Error(`${a.wrapType === 'wrap' ? 'Wrap' : 'Unwrap'} transaction reverted`)
  cb.onStep('wrap', 'done')
  return hash
}
