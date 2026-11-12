import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, CircleCheck, RefreshCw } from 'lucide-react'
import type { Hash } from 'viem'
import type { Token } from '@metaswap/sdk'
import { Banner, Button, CopyButton, Modal, TokenLogo } from '@/components/ui'
import { formatTokenAmount, formatUsd, shortenAddress } from '@/lib/format'
import { toNumber } from '@/lib/amount'
import { parseTxError, type FriendlyError } from '@/lib/errors'
import type { QuoteResponse } from '@/api/types'
import { QUOTE_TTL_MS } from '@/config'
import { useWallet } from '@/wallet/hooks'
import { buildSwapSteps, executeSwap, executeWrap, type StepId, type StepStatus } from './executeSwap'
import { executeXSwap, type XSwapQuote } from './executeXSwap'
import { SwapDetailRows } from './SwapDetails'
import { StepList, type StepView } from './StepList'
import { impactSeverity } from './ctaState'
import type { WrapType } from './swapReducer'
import { t } from '@/i18n'

export interface ReviewModalProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  wrapType: WrapType
  quote?: QuoteResponse
  /** When the frozen quote was fetched (ms). */
  quoteAt: number
  /** Latest quote from the live query — offered as "price updated". */
  liveQuote?: QuoteResponse
  onAcceptLive: () => void
  onRefresh: () => void
  inputToken: Token
  outputToken: Token
  amountIn: bigint
  amountOut: bigint
  exactOut: boolean
  slippageBps: number
  slippageAuto: boolean
  needsApproval: boolean
  priceOf: (t: Token) => number | undefined
  onSuccess: () => void
  /** When set, execute as a gasless MetaSwapX order instead of a classic swap. */
  xQuote?: XSwapQuote
}

type Phase = 'review' | 'executing' | 'success' | 'error'

export function ReviewModal(p: ReviewModalProps) {
  const { address } = useWallet()
  const [phase, setPhase] = useState<Phase>('review')
  const [statuses, setStatuses] = useState<Partial<Record<StepId, StepStatus>>>({})
  const [error, setError] = useState<FriendlyError | null>(null)
  const [hash, setHash] = useState<Hash | null>(null)
  const [ackImpact, setAckImpact] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!p.open) return
    setPhase('review')
    setStatuses({})
    setError(null)
    setHash(null)
    setAckImpact(false)
  }, [p.open])

  useEffect(() => {
    if (!p.open || phase !== 'review') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [p.open, phase])

  const steps = useMemo(
    () =>
      p.xQuote
        ? [
            { id: 'approve' as const, title: t('Approve {symbol} for Permit2', { symbol: p.inputToken.symbol }), description: t('One-time approval transaction') },
            { id: 'permit' as const, title: t('Sign gasless order'), description: t('Signature only — no gas') },
            { id: 'swap' as const, title: t('Submit to MetaSwapX'), description: t('Fillers compete to settle your order') },
          ]
        : buildSwapSteps({ wrapType: p.wrapType, needsApproval: p.needsApproval, needsPermit: !!p.quote?.permit2?.required, inputSymbol: p.inputToken.symbol }),
    [p.wrapType, p.needsApproval, p.quote, p.inputToken.symbol, p.xQuote],
  )
  const stepViews: StepView[] = steps.map((s) => ({ ...s, status: statuses[s.id] ?? 'idle' }))

  const expired = !p.wrapType && !p.xQuote && now - p.quoteAt > QUOTE_TTL_MS
  const priceChanged = !p.wrapType && !p.xQuote && !!p.liveQuote && !!p.quote && phase === 'review' && (p.exactOut ? p.liveQuote.amountIn !== p.quote.amountIn : p.liveQuote.amountOut !== p.quote.amountOut)
  const sev = impactSeverity(p.quote?.priceImpactBps)
  const slippagePct = `${(p.slippageBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`
  const summaryVars = {
    amountIn: formatTokenAmount(p.amountIn, p.inputToken.decimals),
    symbolIn: p.inputToken.symbol,
    amountOut: formatTokenAmount(p.amountOut, p.outputToken.decimals),
    symbolOut: p.outputToken.symbol,
  }
  const summary =
    p.wrapType === 'wrap'
      ? t('Wrapped {amountIn} {symbolIn} for {amountOut} {symbolOut}', summaryVars)
      : p.wrapType === 'unwrap'
        ? t('Unwrapped {amountIn} {symbolIn} for {amountOut} {symbolOut}', summaryVars)
        : t('Swapped {amountIn} {symbolIn} for {amountOut} {symbolOut}', summaryVars)

  async function run() {
    if (!address) return
    setPhase('executing')
    setError(null)
    let current: StepId | undefined
    const onStep = (id: StepId, status: StepStatus) => {
      if (status === 'active') current = id
      setStatuses((s) => ({ ...s, [id]: status }))
    }
    try {
      const h = p.xQuote
        ? await executeXSwap({ account: address, quote: p.xQuote, inputToken: p.inputToken, amountIn: p.amountIn, summary }, { onStep })
        : p.wrapType
        ? await executeWrap({ account: address, wrapType: p.wrapType, amount: p.amountIn, summary }, { onStep })
        : await executeSwap({ account: address, quote: p.quote!, inputToken: p.inputToken, outputToken: p.outputToken, exactOut: p.exactOut, summary }, { onStep })
      setHash(h)
      setPhase('success')
      p.onSuccess()
    } catch (e) {
      const fe = parseTxError(e, { slippagePct })
      if (current) setStatuses((s) => ({ ...s, [current!]: fe.kind === 'rejected' ? 'idle' : 'error' }))
      setError(fe)
      setPhase(fe.kind === 'rejected' ? 'review' : 'error')
    }
  }

  const confirmLabel = p.xQuote
    ? t('Sign gasless order')
    : p.wrapType
    ? p.wrapType === 'wrap'
      ? t('Confirm wrap')
      : t('Confirm unwrap')
    : p.needsApproval
      ? t('Approve and swap')
      : t('Confirm swap')

  const title = phase === 'success' ? '' : p.wrapType ? (p.wrapType === 'wrap' ? t('Review wrap') : t('Review unwrap')) : t('Review swap')

  return (
    <Modal open={p.open} onOpenChange={p.onOpenChange} title={title || t('Done')} width={440} dismissible={phase !== 'executing'} testId="review-modal">
      {phase === 'success' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid="swap-success">
          <CircleCheck size={56} className="text-success" />
          <div className="text-heading-3 font-medium">{p.xQuote ? t('Order submitted!') : p.wrapType ? (p.wrapType === 'wrap' ? t('Wrapped!') : t('Unwrapped!')) : t('Swap success!')}</div>
          <p className="text-body-3 text-text-2">{p.xQuote ? t('Fillers are competing to settle your MetaSwapX order. Track it under Orders in your account.') : summary}</p>
          {hash && (
            <CopyButton value={hash} label={t('Copy transaction hash')} className="font-mono text-body-4">
              {t('Tx {hash}', { hash: shortenAddress(hash, 6) })}
            </CopyButton>
          )}
          <Button fullWidth size="lg" className="mt-2" onClick={() => p.onOpenChange(false)} data-testid="review-close">
            {t('Close')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AmountBlock label={t('You pay')} token={p.inputToken} amount={p.amountIn} price={p.priceOf(p.inputToken)} estimated={p.exactOut && !p.wrapType} />
          <div className="-my-2 flex justify-center text-text-3">
            <ArrowDown size={18} />
          </div>
          <AmountBlock label={t('You receive')} token={p.outputToken} amount={p.amountOut} price={p.priceOf(p.outputToken)} estimated={!p.exactOut && !p.wrapType} />

          {phase === 'review' && p.xQuote && (
            <Banner tone="info" title={t('Gasless via MetaSwapX')}>
              {t('You sign an intent; a filler pays the gas. You receive between the shown amount and your minimum, depending on when it fills.')}
            </Banner>
          )}
          {phase === 'review' && !p.wrapType && p.quote && (
            <div className="border-t border-border pt-2">
              <SwapDetailRows quote={p.quote} inputToken={p.inputToken} outputToken={p.outputToken} exactOut={p.exactOut} slippageBps={p.slippageBps} slippageAuto={p.slippageAuto} />
            </div>
          )}

          {phase !== 'review' && <StepList steps={stepViews} />}

          {phase === 'review' && error?.kind === 'rejected' && <p className="text-center text-body-4 text-text-2">{t('Request rejected in wallet. You can try again.')}</p>}

          {phase === 'error' && error && (
            <Banner tone="critical" title={error.title} className="mt-1" data-testid="swap-error">
              <span data-testid="swap-error-message">{error.message}</span>
            </Banner>
          )}

          {phase === 'review' && expired && (
            <Banner tone="warning" title={t('Quote expired')} action={<Button size="sm" variant="secondary" onClick={p.onRefresh} leftIcon={<RefreshCw size={14} />} data-testid="refresh-quote">{t('Refresh')}</Button>}>
              {t('Prices are only valid for 30 seconds.')}
            </Banner>
          )}
          {phase === 'review' && !expired && priceChanged && (
            <Banner tone="info" title={t('Price updated')} action={<Button size="sm" onClick={p.onAcceptLive} data-testid="accept-price">{t('Accept')}</Button>} />
          )}
          {phase === 'review' && (sev === 'blocked' || sev === 'high') && (
            <label className="flex items-start gap-2 rounded-xl bg-critical-tint p-3 text-body-3">
              <input type="checkbox" checked={ackImpact} onChange={(e) => setAckImpact(e.target.checked)} className="mt-0.5 size-4" data-testid="ack-impact" />
              <span>
                <span className="font-semibold text-critical">{t('Price impact is {pct}%.', { pct: (p.quote!.priceImpactBps / 100).toFixed(2) })}</span>{' '}
                {t('I understand I may receive much less than the market price.')}
              </span>
            </label>
          )}

          {phase === 'review' && (
            <Button
              size="xl"
              fullWidth
              data-testid="confirm-swap"
              disabled={expired || priceChanged || ((sev === 'blocked' || sev === 'high') && !ackImpact)}
              variant={sev === 'blocked' || sev === 'high' ? 'critical' : 'primary'}
              onClick={run}
            >
              {confirmLabel}
            </Button>
          )}
          {phase === 'executing' && <p className="text-center text-body-4 text-text-2">{t('Confirm each step in your wallet. You can close this window after the swap is submitted.')}</p>}
          {phase === 'error' && (
            <div className="flex gap-2">
              {error?.kind === 'quote-expired' || error?.kind === 'slippage' || error?.kind === 'deadline' ? (
                <Button
                  fullWidth
                  size="lg"
                  variant="secondary"
                  leftIcon={<RefreshCw size={16} />}
                  onClick={() => {
                    p.onRefresh()
                    setPhase('review')
                    setStatuses({})
                    setError(null)
                  }}
                >
                  {t('Refresh quote')}
                </Button>
              ) : (
                <Button fullWidth size="lg" onClick={run} data-testid="retry-swap">
                  {t('Try again')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function AmountBlock({ label, token, amount, price, estimated }: { label: string; token: Token; amount: bigint; price?: number; estimated?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-body-3 text-text-2">
          {label}
          {estimated && <span className="text-text-3"> {t('(estimated)')}</span>}
        </div>
        <div className="truncate text-heading-3 font-medium tabular">
          {formatTokenAmount(amount, token.decimals)} {token.symbol}
        </div>
        {price !== undefined && <div className="text-body-3 text-text-2 tabular">{formatUsd(toNumber(amount, token.decimals) * price)}</div>}
      </div>
      <TokenLogo token={token} size={40} chainBadge />
    </div>
  )
}
