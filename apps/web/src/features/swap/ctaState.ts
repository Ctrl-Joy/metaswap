import type { WrapType } from './swapReducer'

// Primary swap button state machine (docs/analysis/ui-ux.md §2.7, flows.md §4.2).
// Pure: the SwapForm feeds it facts, it returns what the button says and does.

export type QuoteStatus = 'idle' | 'loading' | 'success' | 'no-route' | 'error'
export type CtaAction = 'connect' | 'switch-network' | 'review' | 'wrap' | 'unwrap' | 'retry' | 'none'
export type CtaTone = 'primary' | 'tint' | 'critical' | 'warning' | 'disabled'

export interface CtaInput {
  isConnected: boolean
  wrongNetwork: boolean
  hasInputToken: boolean
  hasOutputToken: boolean
  sameToken?: boolean
  /** Parsed independent amount; null when empty/invalid/zero. */
  amount: bigint | null
  wrapType: WrapType
  quoteStatus: QuoteStatus
  /** Quote error is the API being unreachable (vs. a bad request). */
  apiDown?: boolean
  /** Quote params don't match the form yet (debouncing / refetching for new input). */
  quoteStale?: boolean
  inputSymbol?: string
  /** User's balance of the input token (undefined while loading). */
  inputBalance?: bigint
  /** Input the trade needs: wrap amount, quote amountIn (exact-in) or amountInMax (exact-out). */
  requiredInput?: bigint
  needsApproval?: boolean
  priceImpactBps?: number
  submitting?: boolean
}

export interface CtaState {
  label: string
  action: CtaAction
  disabled: boolean
  tone: CtaTone
  loading?: boolean
}

export type ImpactSeverity = 'none' | 'low' | 'medium' | 'high' | 'blocked'

/** Price-impact bands: <1% none, 1–3% low, 3–5% medium (warning), 5–15% high (critical), ≥15% blocked-without-confirm. */
export function impactSeverity(bps: number | undefined | null): ImpactSeverity {
  if (bps === undefined || bps === null || !Number.isFinite(bps)) return 'none'
  if (bps >= 1500) return 'blocked'
  if (bps >= 500) return 'high'
  if (bps >= 300) return 'medium'
  if (bps >= 100) return 'low'
  return 'none'
}

export const IMPACT_TEXT_CLASS: Record<ImpactSeverity, string> = {
  none: 'text-text-2',
  low: 'text-text-1',
  medium: 'text-warning',
  high: 'text-critical',
  blocked: 'text-critical',
}

const disabled = (label: string, tone: CtaTone = 'disabled', loading = false): CtaState => ({ label, action: 'none', disabled: true, tone, loading })

export function deriveSwapCta(i: CtaInput): CtaState {
  if (!i.isConnected) return { label: 'Connect wallet', action: 'connect', disabled: false, tone: 'tint' }
  if (i.wrongNetwork) return { label: 'Switch to MetaChain Devnet', action: 'switch-network', disabled: false, tone: 'warning' }
  if (i.submitting) return disabled('Submitting…', 'disabled', true)
  if (!i.hasInputToken || !i.hasOutputToken) return disabled('Select a token')
  if (i.sameToken) return disabled('Select different tokens')
  if (i.amount === null || i.amount === 0n) return disabled('Enter an amount')

  if (i.wrapType) {
    if (i.inputBalance !== undefined && i.requiredInput !== undefined && i.inputBalance < i.requiredInput)
      return disabled(`Insufficient ${i.inputSymbol ?? ''} balance`.replace('  ', ' '), 'critical')
    return { label: i.wrapType === 'wrap' ? 'Wrap' : 'Unwrap', action: i.wrapType, disabled: false, tone: 'primary' }
  }

  if (i.quoteStatus === 'error') {
    return i.apiDown
      ? { label: 'Quote service unavailable · Retry', action: 'retry', disabled: false, tone: 'warning' }
      : { label: 'Could not get a quote · Retry', action: 'retry', disabled: false, tone: 'warning' }
  }
  if (i.quoteStatus === 'no-route') return disabled('Insufficient liquidity for this trade', 'critical')
  if (i.quoteStatus === 'loading' || i.quoteStatus === 'idle' || i.quoteStale) return disabled('Finding best price…', 'disabled', true)

  if (i.inputBalance !== undefined && i.requiredInput !== undefined && i.inputBalance < i.requiredInput)
    return disabled(`Insufficient ${i.inputSymbol ?? ''} balance`.replace('  ', ' '), 'critical')

  const sev = impactSeverity(i.priceImpactBps)
  if (sev === 'blocked') return { label: 'Swap anyway (very high price impact)', action: 'review', disabled: false, tone: 'critical' }
  if (i.needsApproval) return { label: `Approve ${i.inputSymbol ?? 'token'} and swap`, action: 'review', disabled: false, tone: 'primary' }
  if (sev === 'high') return { label: 'Review (high price impact)', action: 'review', disabled: false, tone: 'critical' }
  return { label: 'Review', action: 'review', disabled: false, tone: 'primary' }
}
