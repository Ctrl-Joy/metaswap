import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUpDown, Info, CircleCheck } from 'lucide-react'
import { contractAddress, deployment, type Token } from '@metaswap/sdk'
import { Banner, Button, Modal, TokenLogo } from '@/components/ui'
import { cn } from '@/lib/cn'
import { apiGet } from '@/api/client'
import type { XQuoteResponse } from '@/api/types'
import { formatAmount, formatTokenAmount, formatUsd } from '@/lib/format'
import { parseAmount, sanitizeAmountInput, toInputString, toNumber } from '@/lib/amount'
import { parseTxError, type FriendlyError } from '@/lib/errors'
import { DEVNET_CHAIN_ID } from '@/config'
import { useUi } from '@/state/ui'
import { toast } from '@/state/toasts'
import { useWallet, useSwitchToDevnet } from '@/wallet/hooks'
import { CurrencyInputPanel } from '@/features/tokens/CurrencyInputPanel'
import { useTokenList, useTokenPrices } from '@/features/tokens/useTokenList'
import { useTokenBalances } from '@/hooks/useTokenBalances'
import { useDebounced } from '@/features/swap/useSwapQuote'
import { StepList, type StepView } from '@/features/swap/StepList'
import { EXPIRY_OPTIONS, minOutputFromPrice, type ExpiryKey } from './order'
import { placeLimitOrder, type LimitStepId } from './executeLimit'

const erc20Only = (t: Token) => !t.isNative

function sym(symbol: string) {
  return deployment.tokens?.find((t) => t.symbol === symbol)?.address
}

/** Format a price for the input: ~6 significant digits, no grouping. */
export function priceToInput(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1) return String(Number(n.toPrecision(Math.max(6, Math.floor(Math.log10(n)) + 3))))
  return String(Number(n.toPrecision(6)))
}

/** MetaSwapX limit order form (ui-ux.md §5): price, sell/buy, expiry → gasless signed order. */
export function LimitForm() {
  const { find } = useTokenList()
  const wallet = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const { switchToDevnet } = useSwitchToDevnet()
  const { prices } = useTokenPrices()
  const [inputToken, setInputToken] = useState<Token | undefined>(() => find(sym('WETH') ?? '') )
  const [outputToken, setOutputToken] = useState<Token | undefined>(() => find(sym('mUSDC') ?? ''))
  const [amountText, setAmountText] = useState('')
  const [priceText, setPriceText] = useState('')
  const [inverted, setInverted] = useState(false)
  const [expiry, setExpiry] = useState<ExpiryKey>('1w')
  const [priceTouched, setPriceTouched] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [placed, setPlaced] = useState(false)

  useEffect(() => {
    // Token list may arrive after first render (API).
    if (!inputToken) setInputToken(find(sym('WETH') ?? ''))
    if (!outputToken) setOutputToken(find(sym('mUSDC') ?? ''))
  }, [find, inputToken, outputToken])

  const amountIn = inputToken ? parseAmount(amountText, inputToken.decimals) : null
  const balanceTokens = useMemo(() => [inputToken, outputToken].filter(Boolean) as Token[], [inputToken, outputToken])
  const { balances } = useTokenBalances(balanceTokens, wallet.address)
  const inBal = inputToken ? balances[inputToken.address.toLowerCase()] : undefined

  // Market price from the classic router via GET /x/quote (1 unit if no amount yet).
  const probe = amountIn && amountIn > 0n ? amountIn : inputToken ? 10n ** BigInt(inputToken.decimals) : 0n
  const marketKey = useDebounced(`${inputToken?.address}|${outputToken?.address}|${probe}`, 300)
  const market = useQuery({
    queryKey: ['api', 'x', 'quote', marketKey],
    enabled: !!inputToken && !!outputToken && inputToken.address !== outputToken.address && probe > 0n,
    queryFn: ({ signal }) => apiGet<XQuoteResponse>('/x/quote', { tokenIn: inputToken!.address, tokenOut: outputToken!.address, amount: probe.toString(), type: 'EXACT_INPUT', mode: 'dutch' }, { signal }),
    refetchInterval: 15_000,
    retry: 0,
  })
  const classicOut = market.data?.classicAmountOut as string | undefined
  const marketPrice = classicOut && inputToken && outputToken ? toNumber(BigInt(classicOut), outputToken.decimals) / toNumber(probe, inputToken.decimals) : undefined

  // Price shown is "1 base = X quote"; stored canonical price is output per input.
  const base = inverted ? outputToken : inputToken
  const quote = inverted ? inputToken : outputToken
  const typedPrice = Number(priceText)
  const canonicalPrice = priceText && typedPrice > 0 ? (inverted ? 1 / typedPrice : typedPrice) : undefined

  useEffect(() => {
    if (!priceTouched && marketPrice) setPriceText(priceToInput(inverted ? 1 / marketPrice : marketPrice))
  }, [marketPrice, priceTouched, inverted])

  const minOut = amountIn && inputToken && outputToken && canonicalPrice ? minOutputFromPrice(amountIn, inputToken.decimals, priceToInput(canonicalPrice), outputToken.decimals) : null
  const outputText = minOut && outputToken ? toInputString(minOut, outputToken.decimals, 6) : ''
  const deltaPct = canonicalPrice && marketPrice ? (canonicalPrice / marketPrice - 1) * 100 : undefined

  const setPreset = (pct: number) => {
    if (!marketPrice) return
    const p = marketPrice * (1 + pct / 100)
    setPriceTouched(true)
    setPriceText(priceToInput(inverted ? 1 / p : p))
  }

  const reactor = (() => {
    try {
      return contractAddress('ExclusiveDutchOrderReactor')
    } catch {
      return undefined
    }
  })()

  let cta: { label: string; disabled: boolean; onClick?: () => void; tone?: 'primary' | 'tint' | 'critical' | 'warning' }
  if (!wallet.address) cta = { label: 'Connect wallet', disabled: false, onClick: openConnect, tone: 'tint' }
  else if (wallet.wrongNetwork) cta = { label: 'Switch to MetaChain Devnet', disabled: false, onClick: () => void switchToDevnet(), tone: 'warning' }
  else if (!reactor) cta = { label: 'MetaSwapX not deployed', disabled: true }
  else if (!inputToken || !outputToken) cta = { label: 'Select a token', disabled: true }
  else if (inputToken.address === outputToken.address) cta = { label: 'Select different tokens', disabled: true }
  else if (!amountIn) cta = { label: 'Enter an amount', disabled: true }
  else if (!canonicalPrice || !minOut) cta = { label: 'Enter a limit price', disabled: true }
  else if (inBal !== undefined && inBal < amountIn) cta = { label: `Insufficient ${inputToken.symbol} balance`, disabled: true, tone: 'critical' }
  else cta = { label: 'Review limit', disabled: false, onClick: () => setReviewOpen(true) }

  const expiryOpt = EXPIRY_OPTIONS.find((e) => e.key === expiry)!

  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-2xl border border-border bg-surface-1 p-4" data-testid="limit-price-panel">
        <div className="flex items-center justify-between text-body-3 text-text-2">
          <span className="flex items-center gap-1.5">
            When 1 {base && <TokenLogo token={base} size={16} />} <span className="font-semibold text-text-1">{base?.symbol ?? '…'}</span> is worth
          </span>
          <button
            type="button"
            aria-label="Invert price"
            onClick={() => {
              setInverted((v) => !v)
              if (typedPrice > 0) setPriceText(priceToInput(1 / typedPrice))
            }}
            className="inline-flex size-8 items-center justify-center rounded-full hover:bg-surface-3 hover:text-text-1"
            data-testid="limit-invert"
          >
            <ArrowUpDown size={16} />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            inputMode="decimal"
            placeholder="0"
            aria-label="Limit price"
            data-testid="limit-price-input"
            value={priceText}
            onChange={(e) => {
              const v = sanitizeAmountInput(e.target.value, 18)
              if (v !== null) {
                setPriceTouched(true)
                setPriceText(v)
              }
            }}
            className="h-11 min-w-0 flex-1 bg-transparent text-[36px] leading-[44px] font-medium tracking-[-0.01em] outline-none tabular"
          />
          {quote && (
            <span className="flex shrink-0 items-center gap-1.5 text-body-1 font-semibold">
              <TokenLogo token={quote} size={24} /> {quote.symbol}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {[0, 1, 5, 10].map((pct) => {
            const target = marketPrice ? marketPrice * (1 + pct / 100) : undefined
            const active = !!target && !!canonicalPrice && Math.abs(canonicalPrice / target - 1) < 0.0005
            return (
              <button
                key={pct}
                type="button"
                disabled={!marketPrice}
                onClick={() => setPreset(pct)}
                data-testid={`limit-preset-${pct}`}
                className={cn(
                  'h-8 rounded-full border px-3 text-body-3 font-semibold transition-colors disabled:opacity-40',
                  active ? 'border-accent bg-accent-tint text-accent' : 'border-border text-text-2 hover:bg-surface-2 hover:text-text-1',
                )}
              >
                {pct === 0 ? 'Market' : `${inverted ? '-' : '+'}${pct}%`}
              </button>
            )
          })}
          {deltaPct !== undefined && Math.abs(deltaPct) >= 0.01 && (
            <span className={cn('ml-auto text-body-4 tabular', deltaPct < 0 ? 'text-warning' : 'text-success')} data-testid="limit-delta">
              {deltaPct > 0 ? '+' : ''}
              {deltaPct.toFixed(2)}% vs market
            </span>
          )}
          {market.isError && <span className="ml-auto text-body-4 text-text-3">Market price unavailable</span>}
        </div>
      </div>

      <CurrencyInputPanel
        label="Sell"
        testId="limit-input"
        token={inputToken}
        value={amountText}
        onChange={setAmountText}
        onTokenSelect={(t) => {
          if (outputToken && t.address === outputToken.address) setOutputToken(inputToken)
          setInputToken(t)
          setPriceTouched(false)
        }}
        tokenFilter={erc20Only}
        balance={wallet.address ? inBal : undefined}
        onMax={() => inBal !== undefined && inputToken && setAmountText(toInputString(inBal, inputToken.decimals, inputToken.decimals))}
        usdValue={inputToken && amountIn && prices[inputToken.address.toLowerCase()] !== undefined ? toNumber(amountIn, inputToken.decimals) * prices[inputToken.address.toLowerCase()]! : undefined}
        variant="sell"
      />
      <div className="relative z-[1] -my-[18px] flex justify-center">
        <button
          type="button"
          aria-label="Switch tokens"
          onClick={() => {
            setInputToken(outputToken)
            setOutputToken(inputToken)
            setPriceTouched(false)
          }}
          className="flex size-12 items-center justify-center rounded-2xl border-4 border-bg bg-surface-2 hover:bg-surface-2-hover"
        >
          <ArrowDown size={20} />
        </button>
      </div>
      <CurrencyInputPanel
        label="Buy (at least)"
        testId="limit-output"
        token={outputToken}
        value={outputText}
        readOnly
        onTokenSelect={(t) => {
          if (inputToken && t.address === inputToken.address) setInputToken(outputToken)
          setOutputToken(t)
          setPriceTouched(false)
        }}
        tokenFilter={erc20Only}
        usdValue={outputToken && minOut && prices[outputToken.address.toLowerCase()] !== undefined ? toNumber(minOut, outputToken.decimals) * prices[outputToken.address.toLowerCase()]! : undefined}
        variant="buy"
      />

      <div className="mt-1 flex items-center justify-between gap-2 rounded-2xl border border-border px-4 py-2.5">
        <span className="text-body-3 text-text-2">Expiry</span>
        <div className="flex flex-wrap justify-end gap-1" role="radiogroup" aria-label="Expiry">
          {EXPIRY_OPTIONS.map((e) => (
            <button
              key={e.key}
              type="button"
              role="radio"
              aria-checked={expiry === e.key}
              onClick={() => setExpiry(e.key)}
              data-testid={`expiry-${e.key}`}
              className={cn('h-8 rounded-full px-3 text-body-3 font-semibold transition-colors', expiry === e.key ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:text-text-1')}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {deltaPct !== undefined && deltaPct < -0.5 && (
        <Banner tone="warning" className="mt-1" title="Limit price is below market">
          Your order will likely fill right away at about the market price, not at your limit.
        </Banner>
      )}

      <Button size="xl" fullWidth className="mt-1" data-testid="limit-cta" disabled={cta.disabled} onClick={cta.onClick} variant={cta.tone === 'critical' ? 'critical' : cta.tone === 'warning' ? 'warning' : cta.tone === 'tint' ? 'tint' : 'primary'}>
        {cta.label}
      </Button>

      <div className="mt-1 flex items-start gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-body-4 text-text-2">
        <Info size={16} className="mt-px shrink-0" />
        <span>
          Limit orders are gasless MetaSwapX intents. Fillers execute them when it is profitable, so they may not fill exactly when the market touches your price.{' '}
          <Link to="/metaswapx" className="font-semibold text-accent hover:underline">
            How it works
          </Link>
        </span>
      </div>

      {reviewOpen && inputToken && outputToken && amountIn && minOut && reactor && wallet.address && (
        <LimitReviewModal
          open={reviewOpen}
          onOpenChange={(o) => {
            setReviewOpen(o)
            if (!o && placed) {
              setPlaced(false)
              setAmountText('')
              setPriceTouched(false)
            }
          }}
          account={wallet.address}
          reactor={reactor}
          inputToken={inputToken}
          outputToken={outputToken}
          amountIn={amountIn}
          minOut={minOut}
          expiryLabel={expiryOpt.label}
          expirySeconds={expiryOpt.seconds}
          priceLabel={`1 ${inputToken.symbol} = ${formatAmount(toNumber(minOut, outputToken.decimals) / toNumber(amountIn, inputToken.decimals))} ${outputToken.symbol}`}
          usdIn={prices[inputToken.address.toLowerCase()] !== undefined ? toNumber(amountIn, inputToken.decimals) * prices[inputToken.address.toLowerCase()]! : undefined}
          onDone={() => setPlaced(true)}
        />
      )}
    </div>
  )
}

function LimitReviewModal(p: {
  open: boolean
  onOpenChange: (o: boolean) => void
  account: `0x${string}`
  reactor: `0x${string}`
  inputToken: Token
  outputToken: Token
  amountIn: bigint
  minOut: bigint
  expiryLabel: string
  expirySeconds: number
  priceLabel: string
  usdIn?: number
  onDone: () => void
}) {
  const [phase, setPhase] = useState<'review' | 'running' | 'done' | 'error'>('review')
  const [st, setSt] = useState<Partial<Record<LimitStepId, StepView['status']>>>({})
  const [err, setErr] = useState<FriendlyError | null>(null)
  const steps: StepView[] = [
    { id: 'approve', title: `Approve ${p.inputToken.symbol} for Permit2`, description: 'One-time approval transaction', status: st.approve ?? 'idle' },
    { id: 'sign', title: 'Sign limit order', description: 'Gasless signature in your wallet', status: st.sign ?? 'idle' },
    { id: 'submit', title: 'Submit to MetaSwapX', description: 'Sending your signed order to the order book', status: st.submit ?? 'idle' },
  ]
  const run = async () => {
    setPhase('running')
    setErr(null)
    let current: LimitStepId | undefined
    try {
      await placeLimitOrder(
        {
          account: p.account,
          reactor: p.reactor,
          permit2: contractAddress('Permit2'),
          chainId: DEVNET_CHAIN_ID,
          inputToken: p.inputToken,
          outputToken: p.outputToken,
          amountIn: p.amountIn,
          minAmountOut: p.minOut,
          expirySeconds: p.expirySeconds,
        },
        (id, s) => {
          if (s === 'active') current = id
          setSt((x) => ({ ...x, [id]: s }))
        },
      )
      setPhase('done')
      toast.success('Limit order placed', `${formatTokenAmount(p.amountIn, p.inputToken.decimals)} ${p.inputToken.symbol} → ${p.outputToken.symbol}`)
      p.onDone()
    } catch (e) {
      const fe = parseTxError(e)
      if (current) setSt((x) => ({ ...x, [current!]: fe.kind === 'rejected' ? 'idle' : 'error' }))
      setErr(fe)
      setPhase(fe.kind === 'rejected' ? 'review' : 'error')
    }
  }
  return (
    <Modal open={p.open} onOpenChange={p.onOpenChange} title={phase === 'done' ? 'Order placed' : 'Review limit order'} dismissible={phase !== 'running'} testId="limit-review">
      {phase === 'done' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid="limit-success">
          <CircleCheck size={56} className="text-success" />
          <div className="text-heading-3 font-semibold">Order placed</div>
          <p className="text-body-3 text-text-2">Your order is open for {p.expiryLabel}. It fills when a filler can pay at least your limit price.</p>
          <Button fullWidth size="lg" onClick={() => p.onOpenChange(false)}>
            Close
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-body-3 text-text-2">You sell</div>
              <div className="text-heading-3 font-semibold tabular">
                {formatTokenAmount(p.amountIn, p.inputToken.decimals)} {p.inputToken.symbol}
              </div>
              {p.usdIn !== undefined && <div className="text-body-3 text-text-2">{formatUsd(p.usdIn)}</div>}
            </div>
            <TokenLogo token={p.inputToken} size={40} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-body-3 text-text-2">You receive at least</div>
              <div className="text-heading-3 font-semibold tabular">
                {formatTokenAmount(p.minOut, p.outputToken.decimals)} {p.outputToken.symbol}
              </div>
            </div>
            <TokenLogo token={p.outputToken} size={40} />
          </div>
          <div className="flex flex-col gap-1 border-t border-border pt-3 text-body-3">
            <div className="flex justify-between"><span className="text-text-2">Limit price</span><span className="tabular">{p.priceLabel}</span></div>
            <div className="flex justify-between"><span className="text-text-2">Expiry</span><span>{p.expiryLabel}</span></div>
            <div className="flex justify-between"><span className="text-text-2">Network cost</span><span className="text-success">Free (gasless)</span></div>
          </div>
          {phase !== 'review' && <StepList steps={steps} />}
          {err && phase === 'error' && <Banner tone="critical" title={err.title}>{err.message}</Banner>}
          {phase !== 'running' && (
            <Button size="xl" fullWidth onClick={run} data-testid="confirm-limit">
              {phase === 'error' ? 'Try again' : 'Confirm'}
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}
