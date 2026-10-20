import { useEffect, useMemo, useReducer, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown } from 'lucide-react'
import { deployment, NATIVE_ETH, type Token } from '@metaswap/sdk'
import { Banner, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { maxSpendable, parseAmount, toInputString, toNumber } from '@/lib/amount'
import { parseTxError } from '@/lib/errors'
import { useSettings, useSlippageBps, protocolsParam } from '@/state/settings'
import { useUi } from '@/state/ui'
import { useWallet, useSwitchToDevnet } from '@/wallet/hooks'
import { CurrencyInputPanel } from '@/features/tokens/CurrencyInputPanel'
import { useTokenList, useTokenPrices } from '@/features/tokens/useTokenList'
import { useTokenBalances } from '@/hooks/useTokenBalances'
import { deriveSwapCta, impactSeverity } from './ctaState'
import { getWrapType, swapReducer, type Field } from './swapReducer'
import { useSwapQuote, type QuoteParams } from './useSwapQuote'
import { DetailsSkeleton, SwapDetailsAccordion } from './SwapDetails'
import { ReviewModal } from './ReviewModal'
import { readPermit2Allowance, requiredInputAmount } from './executeSwap'
import { fetchXSwapQuote } from './executeXSwap'
import { Zap } from 'lucide-react'
import { formatTokenAmount } from '@/lib/format'
import type { QuoteResponse } from '@/api/types'

const wethAddress = deployment.tokens?.find((t) => t.symbol === 'WETH')?.address

/** The swap card body (Sell panel, flip, Buy panel, details, CTA) — ui-ux.md §2. */
export function SwapForm({ defaultOutput }: { defaultOutput?: Token } = {}) {
  const { find } = useTokenList()
  const [params, setParams] = useSearchParams()
  const [state, dispatch] = useReducer(swapReducer, undefined, () => ({
    independentField: 'INPUT' as Field,
    typedValue: '',
    inputToken: NATIVE_ETH,
    outputToken: defaultOutput,
  }))

  // Deep links: /swap?inputCurrency=ETH&outputCurrency=0x…&exactAmount=1&exactField=input
  useEffect(() => {
    const inQ = params.get('inputCurrency')
    const outQ = params.get('outputCurrency')
    if (!inQ && !outQ) return
    const input = find(inQ) ?? (inQ ? undefined : NATIVE_ETH)
    const output = find(outQ)
    if (input || output) dispatch({ type: 'setTokens', input: input ?? NATIVE_ETH, output })
    const amt = params.get('exactAmount')
    if (amt) dispatch({ type: 'typeInput', field: params.get('exactField') === 'output' ? 'OUTPUT' : 'INPUT', value: amt })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find])

  const { inputToken, outputToken, independentField, typedValue } = state
  const exactOut = independentField === 'OUTPUT'
  const wallet = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const { switchToDevnet, pending: switching } = useSwitchToDevnet()
  const slippageBps = useSlippageBps()
  const slippageAuto = useSettings((s) => s.slippageMode === 'auto')
  const deadlineMinutes = useSettings((s) => s.deadlineMinutes)
  const routeV2 = useSettings((s) => s.routeV2)
  const routeV3 = useSettings((s) => s.routeV3)
  const xGasless = useSettings((s) => s.xGasless)
  const { prices } = useTokenPrices()
  const priceOf = (t: Token | undefined) => (t ? prices[t.address.toLowerCase()] : undefined)

  const balanceTokens = useMemo(() => [inputToken, outputToken].filter(Boolean) as Token[], [inputToken, outputToken])
  const { balances } = useTokenBalances(balanceTokens, wallet.address)
  const inBal = inputToken ? balances[inputToken.address.toLowerCase()] : undefined
  const outBal = outputToken ? balances[outputToken.address.toLowerCase()] : undefined

  const wrapType = getWrapType(inputToken, outputToken, wethAddress)
  const independentToken = exactOut ? outputToken : inputToken
  const amount = independentToken ? parseAmount(typedValue, independentToken.decimals) : null
  const sameToken = !!inputToken && !!outputToken && inputToken.address === outputToken.address

  const quoteParams: QuoteParams | null =
    inputToken && outputToken && amount && amount > 0n && !wrapType && !sameToken
      ? {
          tokenIn: inputToken,
          tokenOut: outputToken,
          amount,
          type: exactOut ? 'EXACT_OUTPUT' : 'EXACT_INPUT',
          slippageBps,
          recipient: wallet.address,
          deadlineMinutes,
          protocols: protocolsParam(routeV2, routeV3),
        }
      : null

  const [reviewOpen, setReviewOpen] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [frozen, setFrozen] = useState<{ quote: QuoteResponse; at: number } | null>(null)
  const q = useSwapQuote(quoteParams, { paused: reviewOpen })
  const shownQuote = q.quote ?? (q.stale ? q.lastQuote : undefined)

  // Derived amounts for the dependent field.
  let amountIn: bigint | null = null
  let amountOut: bigint | null = null
  if (wrapType) {
    amountIn = amount
    amountOut = amount
  } else if (exactOut) {
    amountOut = amount
    amountIn = q.quote ? BigInt(q.quote.amountIn) : null
  } else {
    amountIn = amount
    amountOut = q.quote ? BigInt(q.quote.amountOut) : null
  }
  const dependentValue = (() => {
    if (wrapType) return typedValue
    const v = exactOut ? amountIn : amountOut
    const t = exactOut ? inputToken : outputToken
    return v !== null && t ? toInputString(v, t.decimals, 6) : ''
  })()
  const inputValue = exactOut ? dependentValue : typedValue
  const outputValue = exactOut ? typedValue : dependentValue

  // MetaSwapX gasless path (settings toggle): ERC20 input, exact-in, when the API can quote an intent.
  const xEligible = xGasless && !!wallet.address && !!inputToken && !inputToken.isNative && !!outputToken && !wrapType && !exactOut && !!q.quote && !!amount
  const xQ = useQuery({
    queryKey: ['api', 'x', 'swap-quote', inputToken?.address, outputToken?.address, amount?.toString(), slippageBps, wallet.address],
    enabled: xEligible && !reviewOpen,
    queryFn: ({ signal }) => fetchXSwapQuote({ tokenIn: inputToken!, tokenOut: outputToken!, amount: amount!, swapper: wallet.address!, slippageBps }, signal),
    retry: 0,
    staleTime: 20_000,
  })
  const xQuote = xEligible && xQ.data?.encodedOrder ? xQ.data : undefined
  const [reviewX, setReviewX] = useState<typeof xQuote>(undefined)

  // On-chain Permit2 allowance (for the CTA label and step list).
  const required = wrapType ? (amount ?? undefined) : requiredInputAmount(q.quote, exactOut)
  const allowanceQ = useQuery({
    queryKey: ['allowance', 'permit2', inputToken?.address, wallet.address],
    enabled: !!wallet.address && !!inputToken && !inputToken.isNative && !wrapType,
    queryFn: () => readPermit2Allowance(inputToken!, wallet.address!),
    refetchInterval: 10_000,
  })
  const needsApproval = !wrapType && !!inputToken && !inputToken.isNative && required !== undefined && allowanceQ.data !== undefined && allowanceQ.data < required

  const cta = deriveSwapCta({
    isConnected: !!wallet.address,
    wrongNetwork: wallet.wrongNetwork,
    hasInputToken: !!inputToken,
    hasOutputToken: !!outputToken,
    sameToken,
    amount,
    wrapType,
    quoteStatus: q.status,
    apiDown: q.apiDown,
    quoteStale: !wrapType && q.stale,
    inputSymbol: inputToken?.symbol,
    inputBalance: inBal,
    requiredInput: required,
    needsApproval,
    priceImpactBps: q.quote?.priceImpactBps,
  })

  const onCta = () => {
    switch (cta.action) {
      case 'connect':
        return openConnect()
      case 'switch-network':
        return void switchToDevnet()
      case 'retry':
        return void q.refetch()
      case 'review':
        if (q.quote) setFrozen({ quote: q.quote, at: q.updatedAt || Date.now() })
        setReviewX(xQuote)
        return setReviewOpen(true)
      case 'wrap':
      case 'unwrap':
        return setReviewOpen(true)
    }
  }

  const setMax = () => {
    if (!inputToken || inBal === undefined) return
    dispatch({ type: 'typeInput', field: 'INPUT', value: toInputString(maxSpendable(inBal, !!inputToken.isNative), inputToken.decimals, inputToken.decimals) })
  }

  const usd = (t: Token | undefined, v: bigint | null) => {
    const p = priceOf(t)
    return t && v !== null && p !== undefined ? toNumber(v, t.decimals) * p : undefined
  }

  const sev = impactSeverity(q.quote?.priceImpactBps)
  const reviewQuote = frozen?.quote
  const reviewAmountIn = wrapType ? amountIn : reviewQuote ? BigInt(reviewQuote.amountIn) : null
  const reviewAmountOut = wrapType ? amountOut : reviewQuote ? BigInt(reviewQuote.amountOut) : null
  const keepGas = !!inputToken?.isNative && inBal !== undefined && amountIn !== null && inBal >= amountIn && inBal - amountIn < 10n ** 15n * 5n
  const bufferShort = exactOut && q.quote?.amountInMax && inBal !== undefined && inBal >= BigInt(q.quote.amountIn) && inBal < BigInt(q.quote.amountInMax)
  const quoteErr = q.status === 'error' ? parseTxError(q.error) : null

  return (
    <div className="flex flex-col">
      <CurrencyInputPanel
        label="Sell"
        testId="swap-input"
        token={inputToken}
        value={inputValue}
        onChange={(v) => dispatch({ type: 'typeInput', field: 'INPUT', value: v })}
        onTokenSelect={(t) => dispatch({ type: 'selectToken', field: 'INPUT', token: t })}
        balance={wallet.address ? inBal : undefined}
        onMax={setMax}
        usdValue={usd(inputToken, amountIn)}
        estimating={exactOut && q.status === 'loading' && !!amount}
        error={cta.label.startsWith('Insufficient')}
        variant="sell"
      />
      <div className="relative z-[1] -my-[18px] flex justify-center">
        <button
          type="button"
          aria-label="Switch tokens"
          data-testid="flip-button"
          onClick={() => dispatch({ type: 'flip' })}
          className="group flex size-12 items-center justify-center rounded-2xl border-4 border-bg bg-surface-2 text-text-1 transition-colors hover:bg-surface-2-hover"
        >
          <ArrowDown size={20} className="transition-transform duration-150 group-hover:rotate-180 motion-reduce:transition-none" />
        </button>
      </div>
      <CurrencyInputPanel
        label="Buy"
        testId="swap-output"
        token={outputToken}
        value={outputValue}
        onChange={(v) => dispatch({ type: 'typeInput', field: 'OUTPUT', value: v })}
        onTokenSelect={(t) => dispatch({ type: 'selectToken', field: 'OUTPUT', token: t })}
        balance={wallet.address ? outBal : undefined}
        usdValue={usd(outputToken, amountOut)}
        estimating={!exactOut && q.status === 'loading' && !!amount}
        variant="buy"
      />

      <div className="mt-2 flex flex-col gap-2">
        {!wrapType && shownQuote && inputToken && outputToken && amount ? (
          <SwapDetailsAccordion
            quote={shownQuote}
            inputToken={inputToken}
            outputToken={outputToken}
            exactOut={exactOut}
            slippageBps={slippageBps}
            slippageAuto={slippageAuto}
            loading={q.stale || q.isFetching}
            usdPrice={priceOf}
          />
        ) : !wrapType && q.status === 'loading' && amount ? (
          <DetailsSkeleton />
        ) : null}

        {xQuote && outputToken && (
          <div className="flex items-center gap-2 rounded-2xl bg-accent-tint px-4 py-3 text-body-3" data-testid="x-gasless">
            <Zap size={16} className="shrink-0 text-accent" />
            <span>
              <span className="font-semibold text-accent">Gasless via MetaSwapX.</span> Up to {formatTokenAmount(BigInt(xQuote.outputs[0]!.startAmount), outputToken.decimals)} {outputToken.symbol}, no network fee.
            </span>
          </div>
        )}
        {wrapType && amount ? (
          <div className="rounded-2xl border border-border px-4 py-3 text-body-3 text-text-2" data-testid="wrap-info">
            {wrapType === 'wrap' ? 'Wrap ETH into WETH 1:1 on the WETH9 contract.' : 'Unwrap WETH back to ETH 1:1.'} No router or fees, just gas.
          </div>
        ) : null}

        {quoteErr && quoteErr.kind !== 'liquidity' && (
          <Banner tone="warning" title={quoteErr.title}>
            {quoteErr.message}
          </Banner>
        )}
        {(sev === 'high' || sev === 'blocked') && q.quote && (
          <Banner tone="critical" title={`Very high price impact (${(q.quote.priceImpactBps / 100).toFixed(2)}%)`}>
            This trade moves the pool price a lot. You may receive much less than the market price.
          </Banner>
        )}
        {sev === 'medium' && q.quote && <Banner tone="warning" title={`High price impact (${(q.quote.priceImpactBps / 100).toFixed(2)}%)`} />}
        {keepGas && <Banner tone="warning" title="Keep some ETH for gas">Swapping almost all of your ETH may leave nothing to pay network fees.</Banner>}
        {bufferShort && <Banner tone="warning" title="Balance is close to the limit">Your balance covers the expected input but not the full slippage buffer.</Banner>}

        <Button
          size="xl"
          fullWidth
          data-testid="swap-cta"
          variant={cta.tone === 'critical' ? 'critical' : cta.tone === 'warning' ? 'warning' : cta.tone === 'tint' ? 'tint' : 'primary'}
          disabled={cta.disabled}
          loading={cta.loading || switching}
          onClick={onCta}
          className={cn(cta.disabled && !cta.loading && cta.tone === 'critical' && 'disabled:bg-critical-tint disabled:text-critical')}
        >
          {cta.label}
        </Button>
      </div>

      {inputToken && outputToken && (reviewOpen || frozen) && (
        <ReviewModal
          open={reviewOpen}
          onOpenChange={(o) => {
            setReviewOpen(o)
            if (!o) {
              setFrozen(null)
              setReviewX(undefined)
              if (succeeded) {
                setSucceeded(false)
                dispatch({ type: 'clearAmount' })
                if (params.size) setParams({}, { replace: true })
              }
            }
          }}
          wrapType={wrapType}
          quote={reviewQuote}
          quoteAt={frozen?.at ?? Date.now()}
          liveQuote={q.quote}
          onAcceptLive={() => q.quote && setFrozen({ quote: q.quote, at: q.updatedAt })}
          onRefresh={async () => {
            const r = await q.refetch()
            if (r.data) setFrozen({ quote: r.data, at: Date.now() })
          }}
          inputToken={inputToken}
          outputToken={outputToken}
          amountIn={reviewAmountIn ?? 0n}
          amountOut={reviewAmountOut ?? 0n}
          exactOut={exactOut}
          slippageBps={slippageBps}
          slippageAuto={slippageAuto}
          needsApproval={needsApproval}
          xQuote={reviewX}
          priceOf={priceOf}
          onSuccess={() => setSucceeded(true)}
        />
      )}
    </div>
  )
}
