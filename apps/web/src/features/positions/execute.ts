// Multi-step liquidity transaction runner: ERC20 approvals → (optional signature) → main tx.
// Every tx goes through trackTx; the caller maps thrown errors with parseTxError.
import { useCallback, useRef, useState } from 'react'
import { readContract, sendTransaction, writeContract } from 'wagmi/actions'
import { erc20Abi, maxUint256, type Address, type Hash, type TransactionReceipt } from 'viem'
import { wagmiConfig } from '@/wallet/wagmi'
import { trackTx, type TxType } from '@/state/transactions'
import { parseTxError, type FriendlyError } from '@/lib/errors'
import type { StepView } from '@/features/swap/StepList'
import type { Token } from './tokens'
import type { TxRequest } from './encode'
import { t } from '@/i18n'

export type StepStatus = StepView['status']

export interface PlannedStep {
  id: string
  title: string
  description: string
  run: () => Promise<void>
}

/** Explicit gas limits: wallet estimates can come in low for V3 ops touching the oracle / new ticks. */
export const GAS = {
  mint: 1_500_000n,
  createAndMint: 8_000_000n,
  increase: 1_000_000n,
  decrease: 1_000_000n,
  collect: 600_000n,
  v2Add: 600_000n,
  v2AddNewPair: 5_000_000n,
  v2Remove: 600_000n,
} as const

/** Approval step texts as whole sentences per known spender (the label stays English in code). */
function approvalText(spenderLabel: string, symbol: string): { description: string; summary: string } {
  switch (spenderLabel) {
    case 'position manager':
      return { description: t('Allow the position manager to use your {symbol}', { symbol }), summary: t('Approved {symbol} for the position manager', { symbol }) }
    case 'V2 router':
      return { description: t('Allow the V2 router to use your {symbol}', { symbol }), summary: t('Approved {symbol} for the V2 router', { symbol }) }
    case 'auction':
      return { description: t('Allow the auction to use your {symbol}', { symbol }), summary: t('Approved {symbol} for the auction', { symbol }) }
    default:
      return { description: t('Allow the {spender} to use your {symbol}', { spender: spenderLabel, symbol }), summary: t('Approved {symbol} for the {spender}', { spender: spenderLabel, symbol }) }
  }
}

/** Approve `spender` for `amount` of `token` if the on-chain allowance is too low (null when not needed). */
export async function approvalStep(account: Address, token: Token, spender: Address, spenderLabel: string, amount: bigint): Promise<PlannedStep | null> {
  if (token.isNative || amount === 0n) return null
  const allowance = await readContract(wagmiConfig, { address: token.address, abi: erc20Abi, functionName: 'allowance', args: [account, spender] })
  if (allowance >= amount) return null
  const text = approvalText(spenderLabel, token.symbol)
  return {
    id: `approve-${token.symbol}`,
    title: t('Approve {symbol}', { symbol: token.symbol }),
    description: text.description,
    run: async () => {
      const hash = await writeContract(wagmiConfig, { address: token.address, abi: erc20Abi, functionName: 'approve', args: [spender, maxUint256] })
      const r = await trackTx(account, { hash, type: 'approve', summary: text.summary }, { toast: false })
      if (!r || r.status !== 'success') throw new Error('Approval transaction reverted')
    },
  }
}

export interface SentTx {
  hash?: Hash
  receipt?: TransactionReceipt | null
}

/** Send a prepared request, track it, and throw unless it succeeds. Result lands in `out`. */
export function txStep(
  o: { id: string; title: string; description: string; account: Address; type: TxType; summary: string; gas: bigint; meta?: Record<string, string> },
  build: () => TxRequest | Promise<TxRequest>,
  out: SentTx,
): PlannedStep {
  return {
    id: o.id,
    title: o.title,
    description: o.description,
    run: async () => {
      const req = await build()
      const hash = await sendTransaction(wagmiConfig, { to: req.to, data: req.data, value: req.value, gas: o.gas })
      out.hash = hash
      const receipt = await trackTx(o.account, { hash, type: o.type, summary: o.summary, meta: o.meta })
      out.receipt = receipt
      if (!receipt || receipt.status !== 'success') throw new Error(`${o.title} reverted (status 0)`)
    },
  }
}

export type FlowState = 'idle' | 'running' | 'success' | 'error'

/** React state for a planned step list: statuses, error, run/reset. */
export function useStepRunner() {
  const [steps, setSteps] = useState<StepView[]>([])
  const [state, setState] = useState<FlowState>('idle')
  const [error, setError] = useState<FriendlyError | null>(null)
  const running = useRef(false)

  const run = useCallback(async (plan: () => Promise<PlannedStep[]>) => {
    if (running.current) return false
    running.current = true
    setState('running')
    setError(null)
    let planned: PlannedStep[] = []
    try {
      planned = await plan()
      const views: StepView[] = planned.map((p) => ({ id: p.id, title: p.title, description: p.description, status: 'idle' }))
      setSteps(views)
      for (let i = 0; i < planned.length; i++) {
        setSteps((s) => s.map((v, j) => (j === i ? { ...v, status: 'active' } : v)))
        try {
          await planned[i]!.run()
        } catch (e) {
          setSteps((s) => s.map((v, j) => (j === i ? { ...v, status: 'error' } : v)))
          throw e
        }
        setSteps((s) => s.map((v, j) => (j === i ? { ...v, status: 'done' } : v)))
      }
      setState('success')
      return true
    } catch (e) {
      console.error(e)
      setError(parseTxError(e))
      setState('error')
      return false
    } finally {
      running.current = false
    }
  }, [])

  const reset = useCallback(() => {
    setSteps([])
    setState('idle')
    setError(null)
  }, [])

  return { steps, state, error, run, reset }
}
