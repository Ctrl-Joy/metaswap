import { useState, type ReactNode } from 'react'
import { ArrowLeftRight, ChevronDown, Fuel } from 'lucide-react'
import type { Token } from '@metaswap/sdk'
import { InfoTip, TokenLogo, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatAmount, formatImpact, formatTokenAmount, formatUsd } from '@/lib/format'
import { toNumber } from '@/lib/amount'
import type { QuoteResponse, RouteHop, ApiToken } from '@/api/types'
import { useTokenList } from '@/features/tokens/useTokenList'
import { IMPACT_TEXT_CLASS, impactSeverity } from './ctaState'

/** "1 ETH = 3,000 mUSDC" with an invert toggle. */
export function RateLine({ inputToken, outputToken, amountIn, amountOut, usdPrice, loading }: {
  inputToken: Token
  outputToken: Token
  amountIn: bigint
  amountOut: bigint
  /** USD price of the base token, shown in parentheses. */
  usdPrice?: (t: Token) => number | undefined
  loading?: boolean
}) {
  const [inverted, setInverted] = useState(false)
  if (amountIn === 0n || amountOut === 0n) return null
  const inN = toNumber(amountIn, inputToken.decimals)
  const outN = toNumber(amountOut, outputToken.decimals)
  const base = inverted ? outputToken : inputToken
  const quote = inverted ? inputToken : outputToken
  const rate = inverted ? inN / outN : outN / inN
  const basePrice = usdPrice?.(base)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setInverted((v) => !v)
      }}
      className={cn('inline-flex min-w-0 items-center gap-1.5 text-body-3 text-text-1 hover:text-text-2', loading && 'opacity-50')}
      aria-label="Invert price"
      data-testid="rate-line"
    >
      <span className="truncate tabular">
        1 {base.symbol} = {formatAmount(rate)} {quote.symbol}
      </span>
      {basePrice !== undefined && <span className="hidden text-text-2 tabular sm:inline">({formatUsd(basePrice)})</span>}
      <ArrowLeftRight size={12} className="shrink-0 text-text-3" />
    </button>
  )
}

function Row({ label, tip, children, testId }: { label: ReactNode; tip?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-body-3" data-testid={testId}>
      <span className="flex items-center gap-1 text-text-2">
        {label}
        {tip && <InfoTip content={tip} />}
      </span>
      <span className="text-right text-text-1 tabular">{children}</span>
    </div>
  )
}

export interface DetailsProps {
  quote: QuoteResponse
  inputToken: Token
  outputToken: Token
  exactOut: boolean
  slippageBps: number
  slippageAuto: boolean
}

export function SwapDetailRows({ quote, inputToken, outputToken, exactOut, slippageBps, slippageAuto }: DetailsProps) {
  const sev = impactSeverity(quote.priceImpactBps)
  const minOut = quote.amountOutMin ? BigInt(quote.amountOutMin) : undefined
  const maxIn = quote.amountInMax ? BigInt(quote.amountInMax) : undefined
  return (
    <div className="flex flex-col">
      <Row label="Fee" tip="MetaSwap charges no interface fee on devnet. Pool LP fees are already included in the quoted price." testId="detail-fee">
        {quote.feeUsd ? formatUsd(quote.feeUsd) : <span className="text-success">Free</span>}
      </Row>
      <Row label="Network cost" tip="Estimated gas for this swap at the current base fee." testId="detail-gas">
        <span className="inline-flex items-center gap-1">
          <Fuel size={13} className="text-text-3" />
          {formatUsd(quote.gasUsd)}
        </span>
      </Row>
      <Row label="Price impact" tip="How much your trade moves the pool price. Large trades in thin pools move it more." testId="detail-impact">
        <span className={IMPACT_TEXT_CLASS[sev]}>{formatImpact(quote.priceImpactBps)}</span>
      </Row>
      <Row label="Max slippage" tip="Your transaction reverts if the price moves more than this before it is mined." testId="detail-slippage">
        {slippageAuto && <span className="mr-1.5 rounded-md bg-surface-3 px-1.5 py-0.5 text-body-4 text-text-2">Auto</span>}
        {(slippageBps / 100).toFixed(2).replace(/\.?0+$/, '')}%
      </Row>
      {exactOut ? (
        <Row label="Max sent" tip="The most you will pay; the rest is refunded if the price is better." testId="detail-max-in">
          {maxIn !== undefined ? `${formatTokenAmount(maxIn, inputToken.decimals)} ${inputToken.symbol}` : '-'}
        </Row>
      ) : (
        <Row label="Min received" tip="The least you will receive after slippage, or the swap reverts." testId="detail-min-out">
          {minOut !== undefined ? `${formatTokenAmount(minOut, outputToken.decimals)} ${outputToken.symbol}` : '-'}
        </Row>
      )}
      <Row label="Order routing" tip="MetaSwap's router searched every V2 and V3 pool (up to 3 hops, optional split) for the best price net of gas.">
        MetaSwap API
      </Row>
      <RouteDiagram quote={quote} />
    </div>
  )
}

/** Expandable details under the swap card (rate line header + rows). */
export function SwapDetailsAccordion(props: DetailsProps & { loading?: boolean; usdPrice: (t: Token) => number | undefined }) {
  const [open, setOpen] = useState(false)
  const { quote, inputToken, outputToken } = props
  return (
    <div className="rounded-2xl border border-border px-4" data-testid="swap-details">
      <div className="flex h-11 w-full items-center justify-between gap-3">
        <RateLine inputToken={inputToken} outputToken={outputToken} amountIn={BigInt(quote.amountIn)} amountOut={BigInt(quote.amountOut)} usdPrice={props.usdPrice} loading={props.loading} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="swap-details-body"
          data-testid="swap-details-toggle"
          className="flex shrink-0 items-center gap-1.5 text-body-3 text-text-2 hover:text-text-1"
        >
          {!open && (
            <span className="inline-flex items-center gap-1 tabular">
              <Fuel size={13} /> {formatUsd(quote.gasUsd)}
            </span>
          )}
          <ChevronDown size={18} className={cn('transition-transform duration-150', open && 'rotate-180')} />
          <span className="sr-only">{open ? 'Hide details' : 'Show details'}</span>
        </button>
      </div>
      {open && (
        <div id="swap-details-body" className="border-t border-border pt-2 pb-3 animate-fade-in">
          <SwapDetailRows {...props} />
        </div>
      )}
    </div>
  )
}

export function DetailsSkeleton() {
  return (
    <div className="flex h-11 items-center justify-between rounded-2xl border border-border px-4">
      <Skeleton width={160} height={14} />
      <Skeleton width={60} height={14} />
    </div>
  )
}

function tokenAddr(t: RouteHop['tokenIn']): string {
  return typeof t === 'string' ? t : (t as ApiToken).address
}

/** Route visualisation: one row per (split) route, token → [v3 0.05%] → token. */
export function RouteDiagram({ quote }: { quote: QuoteResponse }) {
  const { find } = useTokenList()
  const routes = quote.route ?? []
  if (!routes.length) return null
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl bg-surface-2 p-3" data-testid="route-diagram" aria-label="Route">
      {routes.map((hops, ri) => {
        if (!hops.length) return null
        const pct = quote.routes?.[ri]?.percent ?? hops[0]?.percent ?? (routes.length === 1 ? 100 : undefined)
        const tokens = [tokenAddr(hops[0]!.tokenIn), ...hops.map((h) => tokenAddr(h.tokenOut))]
        return (
          <div key={ri} className="flex items-center gap-1">
            {pct !== undefined && <span className="mr-1 w-10 shrink-0 text-body-4 text-text-2 tabular">{Math.round(pct)}%</span>}
            {tokens.map((addr, ti) => {
              const t = find(addr)
              return (
                <span key={`${addr}-${ti}`} className="flex min-w-0 items-center gap-1">
                  <span title={t?.symbol ?? addr}>
                    <TokenLogo token={t ?? { symbol: '?', address: addr }} size={20} />
                  </span>
                  {ti < hops.length && (
                    <span className="flex min-w-0 flex-1 items-center gap-1">
                      <span className="hidden h-px w-3 border-t border-dashed border-text-3 sm:block" />
                      <span className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold text-text-2 uppercase">
                        {hops[ti]!.type} {hops[ti]!.fee ? `${hops[ti]!.fee! / 10_000}%` : ''}
                      </span>
                      <span className="hidden h-px w-3 border-t border-dashed border-text-3 sm:block" />
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        )
      })}
      {quote.routeString && <div className="text-body-4 text-text-3">{quote.routeString}</div>}
    </div>
  )
}
