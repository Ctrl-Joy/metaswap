import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { waitForTransactionReceipt } from 'wagmi/actions'
import type { Hash, TransactionReceipt } from 'viem'
import { persistStorage } from '@/lib/storage'
import { wagmiConfig } from '@/wallet/wagmi'
import { queryClient } from '@/api/queryClient'
import { toast } from './toasts'
import { t } from '@/i18n'

export type TxType =
  | 'swap'
  | 'wrap'
  | 'unwrap'
  | 'approve'
  | 'send'
  | 'faucet'
  | 'cancel-order'
  | 'add-liquidity'
  | 'remove-liquidity'
  | 'collect-fees'
  | 'earn-deposit'
  | 'earn-withdraw'
  | 'bid'
  | 'other'
export type TxStatus = 'pending' | 'confirmed' | 'reverted' | 'dropped'

export interface TrackedTx {
  hash: Hash
  chainId: number
  type: TxType
  status: TxStatus
  /** One-line human summary, e.g. "Swapped 1 ETH for 3,000 mUSDC". */
  summary: string
  addedAt: number
  confirmedAt?: number
  blockNumber?: number
  /** Free-form extra data (token addresses, amounts as strings). */
  meta?: Record<string, string | number | boolean | undefined>
}

interface TxState {
  /** Transactions keyed by lower-cased account address, newest first. */
  byAccount: Record<string, TrackedTx[]>
  add: (account: string, tx: TrackedTx) => void
  update: (account: string, hash: Hash, patch: Partial<TrackedTx>) => void
  clear: (account: string) => void
}

const MAX_PER_ACCOUNT = 100

export const useTxStore = create<TxState>()(
  persist(
    (set) => ({
      byAccount: {},
      add: (account, tx) =>
        set((s) => {
          const key = account.toLowerCase()
          const list = (s.byAccount[key] ?? []).filter((t) => t.hash !== tx.hash)
          return { byAccount: { ...s.byAccount, [key]: [tx, ...list].slice(0, MAX_PER_ACCOUNT) } }
        }),
      update: (account, hash, patch) =>
        set((s) => {
          const key = account.toLowerCase()
          const list = s.byAccount[key]
          if (!list) return s
          return { byAccount: { ...s.byAccount, [key]: list.map((t) => (t.hash === hash ? { ...t, ...patch } : t)) } }
        }),
      clear: (account) =>
        set((s) => {
          const next = { ...s.byAccount }
          delete next[account.toLowerCase()]
          return { byAccount: next }
        }),
    }),
    { name: 'metaswap.transactions', storage: persistStorage, version: 1 },
  ),
)

const EMPTY: TrackedTx[] = []
export function useAccountTxs(account: string | undefined): TrackedTx[] {
  return useTxStore((s) => (account ? (s.byAccount[account.toLowerCase()] ?? EMPTY) : EMPTY))
}

export function usePendingCount(account: string | undefined): number {
  return useTxStore((s) => (account ? (s.byAccount[account.toLowerCase()] ?? EMPTY).filter((t) => t.status === 'pending').length : 0))
}

const watching = new Set<string>()

/** After any confirmed tx, refresh balances / allowances / account data. */
export function invalidateChainQueries() {
  void queryClient.invalidateQueries({ queryKey: ['balances'] })
  void queryClient.invalidateQueries({ queryKey: ['readContract'] })
  void queryClient.invalidateQueries({ queryKey: ['readContracts'] })
  void queryClient.invalidateQueries({ queryKey: ['balance'] })
  void queryClient.invalidateQueries({ queryKey: ['allowance'] })
  void queryClient.invalidateQueries({ queryKey: ['api', 'accounts'] })
  void queryClient.invalidateQueries({ queryKey: ['api', 'x'] })
  void queryClient.invalidateQueries({ queryKey: ['api', 'earn'] })
  void queryClient.invalidateQueries({ queryKey: ['vault'] })
}

/** Wait for a receipt, updating the store and toasts. Safe to call twice for the same hash. */
export async function watchTx(account: string, tx: Pick<TrackedTx, 'hash' | 'summary' | 'type'>, opts: { toast?: boolean } = {}): Promise<TransactionReceipt | null> {
  const showToast = opts.toast ?? true
  if (watching.has(tx.hash)) {
    try {
      return await waitForTransactionReceipt(wagmiConfig, { hash: tx.hash, timeout: 120_000 })
    } catch {
      return null
    }
  }
  watching.add(tx.hash)
  const toastId = showToast ? toast.pending(pendingTitle(tx.type), tx.summary, { hash: tx.hash, id: `tx-${tx.hash}` }) : undefined
  try {
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: tx.hash, timeout: 120_000, pollingInterval: 500 })
    const ok = receipt.status === 'success'
    useTxStore.getState().update(account, tx.hash, {
      status: ok ? 'confirmed' : 'reverted',
      confirmedAt: Date.now(),
      blockNumber: Number(receipt.blockNumber),
    })
    if (toastId)
      toast.update(toastId, ok
        ? { kind: 'success', title: doneTitle(tx.type), message: tx.summary, duration: 5000 }
        : { kind: 'error', title: t('Transaction failed'), message: t('{summary} reverted on-chain.', { summary: tx.summary }), duration: 8000 })
    invalidateChainQueries()
    return receipt
  } catch (err) {
    useTxStore.getState().update(account, tx.hash, { status: 'dropped' })
    if (toastId) toast.update(toastId, { kind: 'error', title: t('Transaction not found'), message: t('It may have been dropped or replaced.'), duration: 8000 })
    void err
    return null
  } finally {
    watching.delete(tx.hash)
  }
}

/** Record a freshly-sent transaction and start watching it. */
export function trackTx(
  account: string,
  tx: { hash: Hash; type: TxType; summary: string; meta?: TrackedTx['meta'] },
  opts: { toast?: boolean } = {},
): Promise<TransactionReceipt | null> {
  useTxStore.getState().add(account, {
    ...tx,
    chainId: wagmiConfig.chains[0].id,
    status: 'pending',
    addedAt: Date.now(),
  })
  return watchTx(account, tx, opts)
}

function pendingTitle(type: TxType): string {
  switch (type) {
    case 'swap': return t('Swapping')
    case 'wrap': return t('Wrapping')
    case 'unwrap': return t('Unwrapping')
    case 'approve': return t('Approving')
    case 'send': return t('Sending')
    case 'faucet': return t('Minting test tokens')
    case 'cancel-order': return t('Cancelling order')
    case 'earn-deposit': return t('Depositing')
    case 'earn-withdraw': return t('Withdrawing')
    case 'add-liquidity': return t('Adding liquidity')
    case 'remove-liquidity': return t('Removing liquidity')
    case 'collect-fees': return t('Collecting fees')
    default: return t('Transaction pending')
  }
}

function doneTitle(type: TxType): string {
  switch (type) {
    case 'swap': return t('Swapped')
    case 'wrap': return t('Wrapped')
    case 'unwrap': return t('Unwrapped')
    case 'approve': return t('Approved')
    case 'send': return t('Sent')
    case 'faucet': return t('Test tokens received')
    case 'cancel-order': return t('Order cancelled')
    case 'earn-deposit': return t('Deposited')
    case 'earn-withdraw': return t('Withdrawn')
    case 'add-liquidity': return t('Liquidity added')
    case 'remove-liquidity': return t('Liquidity removed')
    case 'collect-fees': return t('Fees collected')
    default: return t('Transaction confirmed')
  }
}

export const TX_TYPE_LABEL: Record<TxType, string> = {
  swap: 'Swap',
  wrap: 'Wrap',
  unwrap: 'Unwrap',
  approve: 'Approve',
  send: 'Send',
  faucet: 'Faucet',
  'cancel-order': 'Cancel order',
  'add-liquidity': 'Add liquidity',
  'remove-liquidity': 'Remove liquidity',
  'collect-fees': 'Collect fees',
  'earn-deposit': 'Earn deposit',
  'earn-withdraw': 'Earn withdrawal',
  bid: 'Auction bid',
  other: 'Transaction',
}
