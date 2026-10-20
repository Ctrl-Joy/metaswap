import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, ArrowRight, ChevronRight, ChevronsUpDown, ExternalLink, Gavel } from 'lucide-react'
import { formatUnits, isAddress, type Address } from 'viem'
import { NATIVE_ETH, type Token } from '@metaswap/sdk'
import { Banner, Button, ButtonLink, Card, CopyButton, EmptyState, Identicon, Skeleton, Switch, TokenLogo } from '@/components/ui'
import { TokenSelector } from '@/features/tokens/TokenSelector'
import { priceOf, useTokenList, useTokenPrices } from '@/features/tokens/useTokenList'
import { TokenChartPanel } from '@/features/explore/token/TokenChartPanel'
import { TimeChart } from '@/features/explore/charts/TimeChart'
import { useTokenBalance } from '@/hooks/useTokenBalances'
import { useWallet } from '@/wallet/hooks'
import { useUi } from '@/state/ui'
import { CHAIN_SLUG } from '@/config'
import { cn } from '@/lib/cn'
import { formatAmount, formatPrice, formatRelativeTime, formatTokenAmount, shortenAddress } from '@/lib/format'
import { maxSpendable, parseAmount, sanitizeAmountInput, toInputString, toNumber } from '@/lib/amount'
import { approvalStep, txStep, useStepRunner, type PlannedStep, type SentTx } from '@/features/positions/execute'
import { ReviewRow, TxFlowModal } from '@/features/positions/components/TxFlowModal'
import { feeLabel, isWeth } from '@/features/positions/tokens'
import { useLaunchDetail } from './api'
import { useAuctionState, type AuctionState } from './chain'
import { buildBid, buildClaimAll, buildSettle } from './contracts'
import { bidConcentration, clearingHistory, fdvHuman, humanToPrice, priceToHuman, snapPriceToTick, supplySoldBps, tokensForQuote } from './units'
import { launchpadName, type LaunchDetail } from './types'
import { BidDistributionChart } from './components/BidDistributionChart'
import { Countdown, LaunchStatusBadge, ProgressBar, VerifiedMark } from './components/LaunchBits'
import { LaunchLogo, LaunchpadChip, usdCompact } from './components/LaunchVisuals'

/** True at Tailwind's lg breakpoint and up (the bid panel moves into the right column). */
function useIsDesktop(): boolean {
  const query = '(min-width: 1024px)'
  const [m, setM] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

/** USD for per-token prices: significant digits below $1 ($0.002), compact above. */
function usdPrice(v: number): string {
  return Math.abs(v) < 1 ? formatPrice(v) : usdCompact(v)
}

// /launches/:auction — layout and sizes measured from Uniswap's auction page
// (docs/analysis/measured/auction-detail.png + .styles.txt, dark, 1440).

export function AuctionDetail({ auctionParam }: { auctionParam: string | undefined }) {
  const auction = auctionParam && isAddress(auctionParam) ? (auctionParam as Address) : undefined
  const { address } = useWallet()
  const q = useAuctionState(auction, address)
  const detail = useLaunchDetail(auction)
  if (!auction) return <NotFound text="That is not a valid auction address." />
  if (q.isLoading)
    return (
      <Shell>
        <Skeleton width="100%" height={72} rounded="lg" />
        <div className="mt-6 flex items-center gap-4">
          <Skeleton width={56} height={56} />
          <Skeleton width={260} height={28} rounded="lg" />
        </div>
        <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_390px]">
          <Skeleton width="100%" height={420} rounded="lg" />
          <Skeleton width="100%" height={420} rounded="lg" />
        </div>
      </Shell>
    )
  if (q.isError || !q.data) return <NotFound text="No MetaSwap launch auction was found at this address on MetaChain Devnet." />
  return <Loaded s={q.data} detail={detail.data} account={address} />
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 pb-24 md:px-0" data-testid="auction-page">
      {children}
    </div>
  )
}

function NotFound({ text }: { text: string }) {
  return (
    <Shell>
      <Card>
        <EmptyState icon={<Gavel size={20} />} title="Auction not found" action={<ButtonLink to="/launches">Back to launches</ButtonLink>}>
          {text}
        </EmptyState>
      </Card>
    </Shell>
  )
}

/** Section heading: 24/28 medium (Uniswap h3). */
function H3({ children, muted, onClick, active, testId }: { children: ReactNode; muted?: boolean; onClick?: () => void; active?: boolean; testId?: string }) {
  const cls = cn('text-heading-3 font-medium', muted && !active ? 'text-text-2 hover:text-text-1' : 'text-text-1')
  return onClick ? (
    <button type="button" role="tab" aria-selected={!!active} onClick={onClick} className={cls} data-testid={testId}>
      {children}
    </button>
  ) : (
    <h3 className={cls}>{children}</h3>
  )
}

function useQuoteUsd(s: AuctionState) {
  const { prices } = useTokenPrices()
  const { find } = useTokenList()
  const quoteToken = find(s.quoteToken)
  return { quoteToken, quoteUsd: priceOf(prices, quoteToken) ?? 0 }
}

function Loaded({ s, detail, account }: { s: AuctionState; detail?: LaunchDetail; account?: Address }) {
  const { quoteToken, quoteUsd } = useQuoteUsd(s)
  const usd = (quote: number) => quote * quoteUsd
  const clearingHuman = priceToHuman(s.clearingPrice)
  const fdvClearingQuote = fdvHuman(s.clearingPrice, s.totalSupply)
  const raisedQuote = toNumber(s.raised, s.quoteDecimals)
  const pct = s.thresholdProgressBps / 100
  const bars = useMemo(() => s.levels.map((l) => ({ price: priceToHuman(l.price), demand: toNumber(l.demand, s.quoteDecimals) })), [s.levels, s.quoteDecimals])
  const padName = detail ? launchpadName(detail) : ''
  const row = { symbol: s.symbol, token: s.token, logoURI: detail?.logoURI, launchpad: detail?.launchpad ?? padName }
  const [chartMode, setChartMode] = useState<'price' | 'demand'>('price')
  // Clearing price over time, replayed from the bid list + current levels (no extra API).
  const priceSeries = useMemo(() => {
    const bids = (detail?.bids ?? [])
      .map((b) => ({ time: b.timestamp ?? b.time ?? 0, amount: BigInt(b.amount), maxPrice: BigInt(b.maxPrice) }))
      .filter((b) => b.time > 0)
    if (!bids.length) return []
    const h = clearingHistory(s.levels, bids, s.auctionSupply, s.floorPrice, s.quoteDecimals, s.tickSize, s.startTime)
    const pts = h.map((p) => ({ time: p.time, value: priceToHuman(p.price) }))
    if (s.status === 'active') pts.push({ time: Math.max(s.blockTime, pts.at(-1)!.time + 1), value: clearingHuman })
    // strictly increasing times for the chart
    return pts.filter((p, i) => i === 0 || p.time > pts[i - 1]!.time)
  }, [detail?.bids, s.levels, s.auctionSupply, s.floorPrice, s.quoteDecimals, s.tickSize, s.startTime, s.status, s.blockTime, clearingHuman])
  const hourAgo = useMemo(() => {
    const t = s.blockTime - 3600
    const before = priceSeries.filter((p) => p.time <= t).at(-1)
    return before?.value ?? (priceSeries[0]?.value ?? clearingHuman)
  }, [priceSeries, s.blockTime, clearingHuman])
  const pastHourPct = hourAgo > 0 ? ((clearingHuman - hourAgo) / hourAgo) * 100 : 0
  const band = bidConcentration(s.levels)
  const soldBps = supplySoldBps(s.levels, s.clearingPrice, s.auctionSupply, s.quoteDecimals)
  const q = s.quoteSymbol
  const desktop = useIsDesktop()
  const panel = (
    <>
      <ActionsCard s={s} account={account} quoteToken={quoteToken} quoteUsd={quoteUsd} />
      <MyBids s={s} account={account} />
    </>
  )

  return (
    <Shell>
      {(s.status === 'active' || s.status === 'upcoming') && <TimeBanner s={s} />}

      <nav aria-label="Breadcrumb" className="mt-6 flex flex-wrap items-center gap-1.5 text-body-2 text-text-2">
        <Link to="/launches" className="hover:text-text-1">
          Launches
        </Link>
        <ChevronRight size={16} />
        <Link to="/launches#auctions" className="hover:text-text-1">
          Auctions
        </Link>
        <ChevronRight size={16} />
        <span className="font-medium text-text-1">{s.symbol}</span>
        <span>{shortenAddress(s.token)}</span>
      </nav>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div className="flex min-w-0 items-center gap-3">
          <LaunchLogo row={row as never} size={56} badge={18} />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2" data-testid="auction-title">
              <span className="text-heading-3 font-medium">{s.name}</span>
              <span className="text-body-1 text-text-2">{s.symbol}</span>
              <VerifiedMark verified={!!detail?.verified} />
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-body-3 text-text-2">
              <LaunchStatusBadge status={s.status} testId="auction-status" />
              <span className="inline-flex items-center gap-1.5">
                <TokenLogo token={{ symbol: 'ETH', logoURI: '/tokens/ETH.svg' }} size={16} chainBadge={false} />
                MetaChain Devnet
              </span>
              <span className="h-3.5 w-px bg-border" aria-hidden />
              <CopyButton value={s.token} label="Copy token address">
                <span>{shortenAddress(s.token)}</span>
              </CopyButton>
              {padName && <LaunchpadChip name={padName} />}
            </div>
          </div>
        </div>
        {s.status === 'launched' && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink to={`/swap?inputCurrency=${isWeth(s.quoteToken) ? 'ETH' : s.quoteToken}&outputCurrency=${s.token}`} data-testid="auction-swap">
              <ArrowLeftRight size={16} /> Swap
            </ButtonLink>
            <ButtonLink to={`/explore/tokens/${CHAIN_SLUG}/${s.token}`} variant="secondary" data-testid="auction-token-page">
              Token page
            </ButtonLink>
          </div>
        )}
      </header>

      {/* headline stats: label 16 text-2, value 24/28, sub 14 text-2, divided columns */}
      <div className="grid grid-cols-2 gap-y-6 py-6 md:grid-cols-4" data-testid="auction-stats">
        <HeadStat label={s.status === 'launched' ? 'Clearing price' : 'Current clearing price'} testId="stat-clearing" first>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span>
              {formatAmount(clearingHuman)} {q}
            </span>
            {s.status !== 'launched' && <span className="text-body-3 text-text-2">{`${pastHourPct >= 0 ? '' : '-'}${Math.abs(pastHourPct).toFixed(0)}% past hour`}</span>}
          </span>
          <Sub>{usdPrice(usd(clearingHuman))}</Sub>
        </HeadStat>
        <HeadStat label="Current FDV">
          {formatAmount(fdvClearingQuote)} {q}
          <Sub>{usdCompact(usd(fdvClearingQuote))}</Sub>
        </HeadStat>
        <HeadStat label="Bid volume" testId="stat-raised">
          {usdCompact(usd(raisedQuote))}
          <Sub>
            {formatTokenAmount(s.raised, s.quoteDecimals)} {q} · {s.totalBids.toString()} {s.totalBids === 1n ? 'bid' : 'bids'}
          </Sub>
          <span className="mt-2 flex flex-col gap-1">
            <ProgressBar value={pct} tone={pct >= 100 ? 'success' : 'text'} className="max-w-[180px]" />
            <span className="text-body-4 font-normal text-text-2 tabular" data-testid="stat-threshold">
              {Math.min(pct, 999).toFixed(2)}% of {usdCompact(usd(toNumber(s.launchThreshold, s.quoteDecimals)))} threshold
            </span>
          </span>
        </HeadStat>
        <HeadStat label="Bids concentrated at">
          <span data-testid="bid-concentration">{band ? `${formatAmount(priceToHuman(band[0]))} – ${formatAmount(priceToHuman(band[1]))} ${q}` : '-'}</span>
          <Sub>{band ? `${usdPrice(usd(priceToHuman(band[0])))} – ${usdPrice(usd(priceToHuman(band[1])))}` : 'No bids yet'}</Sub>
        </HeadStat>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,744px)_390px] lg:justify-between">
        <div className="flex min-w-0 flex-col gap-12">
          {s.status === 'launched' && (
            <section data-testid="launched-chart">
              <TokenChartPanel address={s.token} symbol={s.symbol} latestPriceUsd={detail?.fdvUsd && s.totalSupply ? detail.fdvUsd / (Number(s.totalSupply) / 1e18) : null} apiChange24h={detail?.change1d ?? null} />
            </section>
          )}
          <section>
            <div role="tablist" aria-label="Auction chart" className="mb-4 flex items-center gap-4">
              <H3 onClick={() => setChartMode('price')} active={chartMode === 'price'} muted testId="auction-chart-price">
                Price
              </H3>
              <H3 onClick={() => setChartMode('demand')} active={chartMode === 'demand'} muted testId="auction-chart-demand">
                Demand
              </H3>
            </div>
            <div
              className="relative h-[370px] rounded-xl p-4"
              style={{ backgroundImage: 'radial-gradient(circle, color-mix(in srgb, var(--ms-text-1) 16%, transparent) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
            >
              {chartMode === 'demand' ? (
                <BidDistributionChart bars={bars} clearing={clearingHuman} floor={priceToHuman(s.floorPrice)} quoteSymbol={q} />
              ) : priceSeries.length < 2 ? (
                <div className="flex h-full items-center justify-center text-body-3 text-text-2" data-testid="auction-price-empty">
                  The clearing price chart starts with the first bid.
                </div>
              ) : (
                <TimeChart kind="area" data={priceSeries} formatValue={(v) => formatAmount(v)} testId="auction-price-chart" ariaLabel="Clearing price over time" className="size-full" />
              )}
            </div>
            <div className="mt-3 flex items-center gap-4 text-body-4 text-text-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-warning" /> Clearing price
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full border border-warning" /> Floor {formatAmount(priceToHuman(s.floorPrice))} {q}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-text-3" /> Bids
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2" data-testid="bid-insights">
              <span className="size-2 rounded-full bg-text-2" aria-hidden />
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${soldBps / 100}%`, background: 'repeating-linear-gradient(135deg, var(--ms-warning) 0 4px, color-mix(in srgb, var(--ms-warning) 55%, transparent) 4px 8px)' }}
                />
              </span>
              <span className="size-2 rounded-full bg-surface-3" aria-hidden />
            </div>
            <div className="mt-2 text-body-4 text-text-2">
              <span className="tabular" data-testid="supply-sold">
                {(soldBps / 100).toFixed(2)}%
              </span>{' '}
              of supply sold
            </div>
          </section>

          {/* phones: the bid panel follows the chart */}
          {!desktop && <div className="flex flex-col gap-4">{panel}</div>}
          <StatsSection s={s} usd={usd} />
          <ActivitySection detail={detail} s={s} quoteUsd={quoteUsd} />
          <InfoSection s={s} />
        </div>

        {desktop && <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">{panel}</aside>}
      </div>
    </Shell>
  )
}

function HeadStat({ label, children, testId, first }: { label: string; children: ReactNode; testId?: string; first?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col px-0 md:px-6', !first && 'md:border-l md:border-border', first && 'md:pl-0')} data-testid={testId}>
      <span className="text-body-2 text-text-2">{label}</span>
      <span className="mt-0.5 text-heading-3 font-medium tabular">{children}</span>
    </div>
  )
}

function Sub({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-body-3 font-normal text-text-2 tabular">{children}</span>
}

/* ------------------------------------------------------------------ banner */

/** "Auction ends in …" strip: 72px, radius 12, warm gradient from the right, status dot. */
function TimeBanner({ s }: { s: AuctionState }) {
  const active = s.status === 'active'
  return (
    <div
      className="flex h-[72px] items-center gap-3 rounded-xl px-6 py-4"
      style={{ backgroundImage: 'linear-gradient(270deg, color-mix(in srgb, var(--ms-warning) 24%, transparent) 0%, transparent 100%), linear-gradient(0deg, color-mix(in srgb, var(--ms-warning) 6%, transparent), color-mix(in srgb, var(--ms-warning) 6%, transparent))' }}
      data-testid="auction-time-banner"
    >
      <span className="relative flex size-5 shrink-0 items-center justify-center" aria-hidden>
        <span className="absolute size-5 animate-ping rounded-full bg-warning opacity-30 motion-reduce:hidden" />
        <span className="size-2.5 rounded-full bg-warning" />
      </span>
      <span className="flex flex-col">
        <span className="text-body-4 text-text-2">{active ? 'Auction ends in' : 'Auction starts in'}</span>
        <Countdown to={active ? s.endTime : s.startTime} className="text-body-1 font-medium" testId="auction-countdown" />
      </span>
      <a href="#auction-info" className="ml-auto inline-flex items-center gap-1.5 text-body-2 font-semibold text-text-1 hover:opacity-80" data-testid="auction-see-details">
        See full details <ChevronsUpDown size={16} />
      </a>
    </div>
  )
}

/* ------------------------------------------------------------------ actions */

function ActionsCard({ s, account, quoteToken, quoteUsd }: { s: AuctionState; account?: Address; quoteToken?: Token; quoteUsd: number }) {
  const openConnect = useUi((st) => st.openConnect)
  const settle = useStepRunner()
  const claim = useStepRunner()
  const [modal, setModal] = useState<'settle' | 'claim' | null>(null)
  const unclaimed = s.myBids.filter((b) => !b.claimed)
  const ended = s.blockTime >= s.endTime

  if (s.status === 'upcoming')
    return (
      <div className="rounded-[20px] bg-surface-2 p-4 text-center">
        <div className="text-body-1 font-medium">Bidding opens soon</div>
        <div className="mt-1 text-body-3 text-text-2">
          Starts in <Countdown to={s.startTime} />
        </div>
      </div>
    )
  if (s.status === 'active' && !ended) return <BidForm s={s} account={account} quoteToken={quoteToken} quoteUsd={quoteUsd} />

  return (
    <div className="flex flex-col gap-3 rounded-[20px] bg-surface-2 p-4" data-testid="auction-actions">
      {(s.status === 'ended' || (s.status === 'active' && ended)) && (
        <>
          <div className="text-body-1 font-medium">Auction ended</div>
          <p className="text-body-3 text-text-2">Anyone can settle it. Settling computes the clearing price, seeds the pool when the threshold is met, and opens claims.</p>
          {account ? (
            <Button size="lg" fullWidth onClick={() => setModal('settle')} data-testid="auction-settle">
              Settle auction
            </Button>
          ) : (
            <Button size="lg" fullWidth onClick={openConnect}>
              Connect wallet
            </Button>
          )}
        </>
      )}
      {(s.status === 'launched' || s.status === 'failed') && (
        <>
          <div className="text-body-1 font-medium">{s.status === 'launched' ? 'Launched' : 'Launch failed'}</div>
          <p className="text-body-3 text-text-2">
            {s.status === 'launched'
              ? `Cleared at ${formatAmount(priceToHuman(s.clearingPrice))} ${s.quoteSymbol}. Winning bids receive tokens; any unfilled part is refunded.`
              : 'The threshold was not reached. Every bid can be refunded in full.'}
          </p>
          {s.pool && (
            <Link to={`/explore/pools/${CHAIN_SLUG}/${s.pool}`} className="inline-flex items-center gap-1 text-body-3 font-semibold text-accent hover:underline">
              {s.symbol}/{s.quoteSymbol} {feeLabel(s.poolFee)} pool <ExternalLink size={14} />
            </Link>
          )}
          {account && unclaimed.length > 0 ? (
            <Button size="lg" fullWidth onClick={() => setModal('claim')} data-testid="auction-claim">
              {s.status === 'launched' ? 'Claim tokens and refund' : 'Claim refund'}
            </Button>
          ) : account ? (
            <div className="rounded-xl bg-surface-1 px-4 py-3 text-body-3 text-text-2" data-testid="auction-nothing-to-claim">
              {s.myBids.length ? 'All your bids are claimed.' : 'You have no bids in this auction.'}
              {s.myTokenBalance > 0n && ` You hold ${formatTokenAmount(s.myTokenBalance, 18)} ${s.symbol}.`}
            </div>
          ) : (
            <Button size="lg" fullWidth onClick={openConnect}>
              Connect wallet
            </Button>
          )}
        </>
      )}
      {account && (
        <>
          <TxFlowModal
            open={modal === 'settle'}
            onOpenChange={(o) => setModal(o ? 'settle' : null)}
            title="Settle auction"
            runner={settle}
            confirmLabel="Settle"
            testId="settle-modal"
            onConfirm={() => {
              const out: SentTx = {}
              void settle.run(async () => [txStep({ id: 'settle', title: 'Settle auction', description: 'Confirm in your wallet', account, type: 'other', summary: `Settled the ${s.symbol} auction`, gas: 8_000_000n }, () => buildSettle(s.auction), out)])
            }}
          >
            <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
              <ReviewRow label="Raised">
                {formatTokenAmount(s.raised, s.quoteDecimals)} {s.quoteSymbol}
              </ReviewRow>
              <ReviewRow label="Threshold">
                {formatTokenAmount(s.launchThreshold, s.quoteDecimals)} {s.quoteSymbol}
              </ReviewRow>
              <ReviewRow label="Expected outcome">{s.raised >= s.launchThreshold ? 'Launch + pool' : 'Failed, refunds'}</ReviewRow>
            </div>
          </TxFlowModal>
          <TxFlowModal
            open={modal === 'claim'}
            onOpenChange={(o) => setModal(o ? 'claim' : null)}
            title="Claim"
            runner={claim}
            confirmLabel="Claim all"
            testId="claim-modal"
            onConfirm={() => {
              const out: SentTx = {}
              void claim.run(async () => [txStep({ id: 'claim', title: 'Claim', description: 'Confirm in your wallet', account, type: 'other', summary: `Claimed from the ${s.symbol} auction`, gas: 1_500_000n }, () => buildClaimAll(s.auction), out)])
            }}
          >
            <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
              <ReviewRow label="Bids to claim">{unclaimed.length}</ReviewRow>
              <ReviewRow label="Committed">
                {formatTokenAmount(unclaimed.reduce((a, b) => a + b.amount, 0n), s.quoteDecimals)} {s.quoteSymbol}
              </ReviewRow>
            </div>
          </TxFlowModal>
        </>
      )}
    </div>
  )
}

/** Bid form: "Max budget" and "Max FDV / Max price" cards (radius 20, surface-2, p16), Receive row, 46px CTA. */
function BidForm({ s, account, quoteToken, quoteUsd }: { s: AuctionState; account?: Address; quoteToken?: Token; quoteUsd: number }) {
  const openConnect = useUi((st) => st.openConnect)
  const runner = useStepRunner()
  const canEth = isWeth(s.quoteToken)
  const [useEth, setUseEth] = useState(canEth)
  const payToken: Token | undefined = useEth && canEth ? NATIVE_ETH : quoteToken
  const balance = useTokenBalance(payToken, account)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'price' | 'fdv'>('price')
  const [limit, setLimit] = useState('')
  const [open, setOpen] = useState(false)
  const [selector, setSelector] = useState(false)

  const amountRaw = parseAmount(amount, s.quoteDecimals) ?? 0n
  const supplyWhole = Number(s.totalSupply) / 1e18
  // the limit input is either a price (quote per token) or an FDV (in the quote token)
  const priceFromInput = (): bigint | null => {
    if (!limit) return null
    if (mode === 'price') return humanToPrice(limit)
    const fdv = Number(limit)
    if (!Number.isFinite(fdv) || fdv <= 0) return null
    return humanToPrice((fdv / supplyWhole).toFixed(18))
  }
  const rawPrice = priceFromInput()
  const maxPrice = rawPrice !== null ? snapPriceToTick(rawPrice, s.floorPrice, s.tickSize) : null
  const effective = maxPrice !== null && maxPrice > s.clearingPrice ? s.clearingPrice : maxPrice
  const estTokens = maxPrice !== null && maxPrice >= s.clearingPrice && amountRaw > 0n ? tokensForQuote(amountRaw, effective ?? s.clearingPrice, s.quoteDecimals) : 0n
  const tooLow = maxPrice !== null && rawPrice !== null && rawPrice < s.floorPrice
  const insufficient = balance !== undefined && amountRaw > balance
  const shownPrice = maxPrice ?? s.clearingPrice
  const q = s.quoteSymbol

  // slider over max price: floor … 10× the current clearing price, in tick steps
  const sliderMax = Number(snapPriceToTick(s.clearingPrice * 10n, s.floorPrice, s.tickSize))
  const sliderMin = Number(s.floorPrice)
  const sliderVal = Number(maxPrice ?? s.clearingPrice)

  const cta = !account
    ? { label: 'Connect wallet', action: openConnect, disabled: false }
    : amountRaw === 0n
      ? { label: 'Enter a bid amount', disabled: true }
      : maxPrice === null
        ? { label: mode === 'price' ? 'Enter a max price' : 'Enter a max FDV', disabled: true }
        : tooLow
          ? { label: 'Max price is below the floor', disabled: true }
          : insufficient
            ? { label: `Insufficient ${payToken?.symbol} balance`, disabled: true }
            : { label: 'Review bid', action: () => setOpen(true), disabled: false }

  const confirm = () => {
    if (!account || !payToken || maxPrice === null) return
    const out: SentTx = {}
    void runner
      .run(async () => {
        const steps: PlannedStep[] = []
        const ap = await approvalStep(account, payToken, s.auction, 'auction', amountRaw)
        if (ap) steps.push(ap)
        steps.push(
          txStep(
            { id: 'bid', title: 'Place bid', description: 'Confirm in your wallet', account, type: 'other', summary: `Bid ${formatTokenAmount(amountRaw, s.quoteDecimals)} ${payToken.symbol} on ${s.symbol}`, gas: 800_000n },
            () => buildBid(s.auction, amountRaw, maxPrice, !!payToken.isNative),
            out,
          ),
        )
        return steps
      })
      .then((ok) => ok && setAmount(''))
  }

  const quick = [1, 1.5, 2, 5].map((m) => ({ m, price: snapPriceToTick((s.clearingPrice * BigInt(Math.round(m * 100))) / 100n, s.floorPrice, s.tickSize) }))
  const fdvOf = (p: bigint) => fdvHuman(p, s.totalSupply)
  return (
    <section className="flex flex-col gap-3" data-testid="bid-form">
      <div className="flex items-center justify-between">
        <h2 className="text-body-2 text-text-2">Place a bid</h2>
        {canEth && (
          <label className="flex items-center gap-2 text-body-4 text-text-2">
            Pay with ETH <Switch checked={useEth} onChange={setUseEth} label="Pay with ETH" testId="bid-eth-toggle" />
          </label>
        )}
      </div>

      <div className={cn('rounded-[20px] bg-surface-2 p-4', insufficient && 'ring-1 ring-critical')} data-testid="bid-amount">
        <div className="flex items-center justify-between text-body-2 text-text-2">
          <span>Max budget</span>
          {balance !== undefined && payToken && (
            <button type="button" className="text-body-4 hover:text-text-1" onClick={() => setAmount(toInputString(maxSpendable(balance, !!payToken.isNative), s.quoteDecimals, s.quoteDecimals))} data-testid="bid-amount-max">
              Balance {formatTokenAmount(balance, s.quoteDecimals)} · Max
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              const v = sanitizeAmountInput(e.target.value, s.quoteDecimals)
              if (v !== null) setAmount(v)
            }}
            aria-label="Max budget"
            data-testid="bid-amount-input"
            className={cn('min-w-0 flex-1 bg-transparent text-body-1 outline-none tabular placeholder:text-text-3', insufficient && 'text-critical')}
          />
          <button type="button" onClick={() => canEth && setSelector(true)} className="inline-flex items-center gap-1.5 text-body-1 font-semibold" aria-label="Bid token">
            <TokenLogo token={payToken} size={28} />
            {payToken?.symbol}
          </button>
        </div>
        <div className="mt-1 text-body-4 text-text-2 tabular">{usdCompact(toNumber(amountRaw, s.quoteDecimals) * quoteUsd)}</div>
      </div>

      <div className="rounded-[20px] bg-surface-2 p-4">
        <div className="flex items-center justify-between text-body-2 text-text-2">
          <span>{mode === 'price' ? `Max price (${q} per ${s.symbol})` : 'Max FDV'}</span>
          <span className="flex gap-1">
            {(['price', 'fdv'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m)
                  setLimit('')
                }}
                data-testid={`bid-mode-${m}`}
                className={cn('h-7 rounded-full px-2.5 text-body-4 font-semibold', mode === m ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:text-text-1')}
              >
                {m === 'price' ? 'Price' : 'FDV'}
              </button>
            ))}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            inputMode="decimal"
            placeholder={mode === 'price' ? formatAmount(priceToHuman(s.clearingPrice)) : formatAmount(fdvOf(s.clearingPrice))}
            value={limit}
            onChange={(e) => {
              const v = sanitizeAmountInput(e.target.value, 18)
              if (v !== null) setLimit(v)
            }}
            aria-label={mode === 'price' ? 'Max price' : 'Max FDV'}
            data-testid="bid-max-price"
            className="min-w-0 flex-1 bg-transparent text-body-1 outline-none tabular placeholder:text-text-3"
          />
          <span className="text-body-1 text-text-2">{q}</span>
        </div>
        <div className="mt-1 text-body-4 text-text-2 tabular">{usdCompact(fdvOf(shownPrice) * quoteUsd)} FDV</div>
        <input
          type="range"
          min={sliderMin}
          max={Math.max(sliderMax, sliderMin + 1)}
          step={Number(s.tickSize) || 1}
          value={Math.min(Math.max(sliderVal, sliderMin), sliderMax)}
          onChange={(e) => {
            const p = snapPriceToTick(BigInt(Math.round(Number(e.target.value))), s.floorPrice, s.tickSize)
            setMode('price')
            setLimit(formatUnits(p, 18))
          }}
          aria-label="Max price slider"
          className="mt-3 h-3 w-full cursor-pointer accent-[var(--ms-text-1)]"
        />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex h-[34px] items-center gap-1 rounded-md border-[0.8px] border-border bg-surface-1 px-2 text-body-4 text-text-2 tabular">
            Price: <span className="text-text-1">{formatAmount(priceToHuman(shownPrice))} {q}</span>
          </span>
          {quick.map((x) => (
            <button
              key={x.m}
              type="button"
              data-testid={`bid-quick-${x.m}`}
              onClick={() => {
                setMode('price')
                setLimit(formatUnits(x.price, 18))
              }}
              className="h-7 rounded-full px-2 text-body-4 font-semibold text-text-2 hover:bg-surface-3 hover:text-text-1"
            >
              {x.m === 1 ? 'Clearing' : `${x.m}×`}
            </button>
          ))}
        </div>
        {maxPrice !== null && rawPrice !== maxPrice && !tooLow && (
          <div className="mt-2 text-body-4 text-text-3">
            Rounded to the tick: {formatUnits(maxPrice, 18)} {q}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl border-[0.8px] border-border px-4 py-3 text-body-4">
        <span className="text-text-2">Receive</span>
        <span className={cn('tabular', estTokens > 0n ? 'text-text-1' : 'text-text-3')} data-testid="bid-est-tokens">
          {estTokens > 0n ? `${formatTokenAmount(estTokens, 18)} ${s.symbol}` : '-'}
        </span>
      </div>
      {estTokens === 0n && <span className="-mt-2 px-1 text-body-4 text-text-3">Enter a budget and a max price to see the tokens you would receive at the current clearing price.</span>}
      {maxPrice !== null && maxPrice < s.clearingPrice && !tooLow && <Banner tone="warning">Your max price is below the current clearing price. Unless demand drops, this bid will be refunded.</Banner>}
      <Button size="lg" fullWidth disabled={cta.disabled} onClick={cta.action} data-testid="bid-review" className="h-[46px] rounded-2xl">
        {cta.label}
      </Button>
      <p className="text-[10px] leading-3 text-text-3">
        Everyone pays the same clearing price. Bids above it fill fully, bids at it fill pro-rata, and the unused part of every bid is refunded at settlement. Floor {formatAmount(priceToHuman(s.floorPrice))} {q}.
      </p>
      {canEth && quoteToken && (
        <TokenSelector
          open={selector}
          onOpenChange={setSelector}
          onSelect={(t) => setUseEth(!!t.isNative)}
          selected={payToken}
          filter={(t) => !!t.isNative || t.address.toLowerCase() === quoteToken.address.toLowerCase()}
        />
      )}
      {account && (
        <TxFlowModal open={open} onOpenChange={setOpen} title="Review bid" runner={runner} confirmLabel="Place bid" onConfirm={confirm} testId="bid-modal">
          <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
            <ReviewRow label="Bid">
              {amount} {payToken?.symbol}
            </ReviewRow>
            <ReviewRow label="Max price">{maxPrice !== null ? `${formatUnits(maxPrice, 18)} ${q}` : '-'}</ReviewRow>
            <ReviewRow label="Max FDV">{maxPrice !== null ? usdCompact(fdvOf(maxPrice) * quoteUsd) : '-'}</ReviewRow>
            <ReviewRow label="Est. tokens">{estTokens > 0n ? `${formatTokenAmount(estTokens, 18)} ${s.symbol}` : '-'}</ReviewRow>
          </div>
        </TxFlowModal>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ your bids */

function bidOutcome(s: AuctionState, b: AuctionState['myBids'][number]): { label: string; tone: string } {
  if (s.status === 'failed') return { label: 'Refund', tone: 'text-text-2' }
  const done = s.status === 'launched'
  if (b.previewTokens !== undefined) {
    if (b.previewTokens === 0n) return { label: done ? 'Refunded' : 'Outbid', tone: 'text-critical' }
    if (b.previewRefund && b.previewRefund > 0n) return { label: 'Partial', tone: 'text-warning' }
    return { label: done ? 'Filled' : 'Winning', tone: 'text-success' }
  }
  if (b.maxPrice > s.clearingPrice) return { label: done ? 'Filled' : 'Winning', tone: 'text-success' }
  if (b.maxPrice === s.clearingPrice) return { label: 'Partial', tone: 'text-warning' }
  return { label: done ? 'Refunded' : 'Outbid', tone: 'text-critical' }
}

function MyBids({ s, account }: { s: AuctionState; account?: Address }) {
  if (!account) return null
  return (
    <section className="rounded-[20px] bg-surface-2 p-4" data-testid="my-bids">
      <h2 className="mb-3 text-body-2 text-text-2">Your bids</h2>
      {s.myBids.length === 0 ? (
        <p className="text-body-3 text-text-2">You have not bid in this auction.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {s.myBids.map((b) => {
            const o = bidOutcome(s, b)
            return (
              <li key={b.id.toString()} className="flex items-center justify-between gap-3 rounded-xl bg-surface-1 px-3 py-2 text-body-3" data-testid={`my-bid-${b.id}`}>
                <span>
                  <span className="block font-medium tabular">
                    {formatTokenAmount(b.amount, s.quoteDecimals)} {b.native ? 'ETH' : s.quoteSymbol}
                  </span>
                  <span className="block text-body-4 text-text-2 tabular">
                    max {formatAmount(priceToHuman(b.maxPrice))} {s.quoteSymbol}
                  </span>
                </span>
                <span className="text-right">
                  <span className={`block font-medium ${o.tone}`}>{o.label}</span>
                  <span className="block text-body-4 text-text-3 tabular" data-testid={`my-bid-${b.id}-preview`}>
                    {b.claimed
                      ? 'Claimed'
                      : b.previewTokens !== undefined
                        ? `${formatTokenAmount(b.previewTokens, 18)} ${s.symbol}${b.previewRefund ? ` + ${formatTokenAmount(b.previewRefund, s.quoteDecimals)} back` : ''}`
                        : `#${b.id}`}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ stats / activity / info */

function DividedStat({ label, children, first }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 md:px-4', !first && 'md:border-l md:border-border', first && 'md:pl-0')}>
      <span className="text-body-3 text-text-2">{label}</span>
      <span className="text-body-1 tabular">{children}</span>
    </div>
  )
}

function StatsSection({ s, usd }: { s: AuctionState; usd: (q: number) => number }) {
  const floor = priceToHuman(s.floorPrice)
  const clearing = priceToHuman(s.clearingPrice > s.floorPrice ? s.clearingPrice : s.floorPrice)
  return (
    <section data-testid="auction-stats-section">
      <div className="mb-6 flex items-center justify-between">
        <H3>Stats</H3>
        <a href="#auction-info" className="inline-flex items-center gap-1 text-body-3 text-text-2 hover:text-text-1">
          View all stats <ArrowRight size={14} />
        </a>
      </div>
      <div className="grid grid-cols-2 gap-y-6 md:grid-cols-4">
        <DividedStat label="Implied token price" first>
          <span data-testid="auction-implied-price">
            {formatAmount(floor)} – {formatAmount(clearing)} {s.quoteSymbol}
          </span>
          <span className="block text-body-4 text-text-2">{`${usdPrice(usd(floor))} – ${usdPrice(usd(clearing))}`}</span>
        </DividedStat>
        <DividedStat label="Auction supply">
          {formatTokenAmount(s.auctionSupply, 18)} {s.symbol}
        </DividedStat>
        <DividedStat label="% Committed to LP">{(Number(s.liquidityBps) / 100).toFixed(1)}%</DividedStat>
        <DividedStat label="Total supply">
          {formatTokenAmount(s.totalSupply, 18)} {s.symbol}
        </DividedStat>
      </div>
    </section>
  )
}

type ActivityTab = 'activity' | 'timeline'

function ActivitySection({ detail, s, quoteUsd }: { detail?: LaunchDetail; s: AuctionState; quoteUsd: number }) {
  const bids = detail?.bids ?? []
  const [tab, setTab] = useState<ActivityTab>('activity')
  return (
    <section data-testid="recent-bids">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Auction activity" className="flex items-center gap-4">
          <H3 onClick={() => setTab('activity')} active={tab === 'activity'} muted testId="auction-tab-activity">
            Activity
          </H3>
          <H3 onClick={() => setTab('timeline')} active={tab === 'timeline'} muted testId="auction-tab-timeline">
            Timeline
          </H3>
        </div>
        <span
          className="inline-flex h-8 items-center gap-1.5 rounded-full border-[0.8px] border-border px-3 text-body-3 tabular"
          style={{ backgroundImage: 'linear-gradient(90deg, color-mix(in srgb, var(--ms-success) 8%, transparent) 0%, transparent 100%)' }}
          data-testid="auction-bid-count"
        >
          <span className="size-2 rounded-full bg-success" aria-hidden />
          {s.totalBids.toString()} {s.totalBids === 1n ? 'bid' : 'bids'}
        </span>
      </div>
      {tab === 'timeline' ? (
        <Timeline s={s} />
      ) : bids.length === 0 ? (
        <p className="rounded-xl bg-surface-2 px-5 py-4 text-body-3 text-text-2">{detail ? 'No bids yet.' : 'Bid history is unavailable.'}</p>
      ) : (
        <div className="overflow-x-auto [scrollbar-width:thin]">
          <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left text-body-2">
            <thead>
              <tr className="h-[46px] bg-surface-2 text-text-2">
                <th className="rounded-l-xl px-5 font-normal">Wallet</th>
                <th className="px-3 font-normal">Bid</th>
                <th className="px-3 font-normal">Max price</th>
                <th className="rounded-r-xl px-5 text-right text-body-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {bids.slice(0, 20).map((b) => {
                const t = b.timestamp ?? b.time
                const amount = toNumber(BigInt(b.amount), s.quoteDecimals)
                const price = priceToHuman(BigInt(b.maxPrice))
                return (
                  <tr key={String(b.bidId)} className="h-12 whitespace-nowrap" data-testid="auction-bid-row">
                    <td className="px-5">
                      <span className="inline-flex items-center gap-2">
                        <Identicon address={b.bidder} size={16} />
                        {shortenAddress(b.bidder)}
                      </span>
                    </td>
                    <td className="px-3 tabular">
                      {usdCompact(amount * quoteUsd)} <span className="text-text-2">{formatAmount(amount)} {s.quoteSymbol}</span>
                    </td>
                    <td className="px-3 tabular">
                      {usdPrice(price * quoteUsd)} <span className="text-text-2">{formatAmount(price)} {s.quoteSymbol}</span>
                    </td>
                    <td className="px-5 text-right text-text-2">{t ? formatRelativeTime(t * 1000) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Milestones of the auction lifecycle, with the completed ones marked. */
function Timeline({ s }: { s: AuctionState }) {
  const now = s.blockTime
  const items: Array<{ key: string; label: string; time: number | null; done: boolean }> = [
    { key: 'start', label: 'Bidding opens', time: s.startTime, done: now >= s.startTime },
    { key: 'end', label: 'Bidding closes', time: s.endTime, done: now >= s.endTime },
    {
      key: 'settle',
      label: s.status === 'failed' ? 'Failed: threshold not met, bids refunded' : s.status === 'launched' ? 'Settled: pool created, tokens claimable' : 'Settlement: pool created at the clearing price',
      time: null,
      done: s.status === 'launched' || s.status === 'failed',
    },
  ]
  return (
    <ol className="flex flex-col gap-3" data-testid="auction-timeline">
      {items.map((it) => (
        <li key={it.key} className="flex items-start gap-3" data-done={it.done ? 'true' : 'false'}>
          <span className={cn('mt-1 size-2.5 shrink-0 rounded-full', it.done ? 'bg-success' : 'bg-surface-3')} aria-hidden />
          <span className="flex flex-col">
            <span className="text-body-3 font-medium">{it.label}</span>
            {it.time !== null && <span className="text-body-4 text-text-2">{new Date(it.time * 1000).toLocaleString()}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

function InfoItem({ label, children, first }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-1 pr-4', !first && 'border-l border-border pl-4')}>
      <span className="text-body-3 text-text-2">{label}</span>
      <span className="text-body-1 tabular">{children}</span>
    </div>
  )
}

function InfoSection({ s }: { s: AuctionState }) {
  return (
    <section id="auction-info" className="scroll-mt-24" data-testid="auction-info">
      <div className="mb-4">
        <H3>Info</H3>
      </div>
      {s.description && <p className="mb-4 text-body-2 text-text-2">{s.description}</p>}
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-y-4">
          <InfoItem label="Launched on" first>
            {s.status === 'launched' ? new Date(s.endTime * 1000).toLocaleDateString() : '--'}
          </InfoItem>
          <InfoItem label="Contract address">
            <CopyButton value={s.auction} label="Copy auction address" className="text-text-1">
              {shortenAddress(s.auction)}
            </CopyButton>
          </InfoItem>
          <InfoItem label="Token">
            <CopyButton value={s.token} label="Copy token address" className="text-text-1">
              {shortenAddress(s.token)}
            </CopyButton>
          </InfoItem>
        </div>
        <div className="flex flex-wrap gap-y-4">
          <InfoItem label="% Committed to LP" first>
            {(Number(s.liquidityBps) / 100).toFixed(1)}%
          </InfoItem>
          <InfoItem label="LP owner">{s.pool ? 'Locked in the auction' : '--'}</InfoItem>
          <InfoItem label="Pool fee">{feeLabel(s.poolFee)}</InfoItem>
          <InfoItem label="Ends">{new Date(s.endTime * 1000).toLocaleString()}</InfoItem>
          {s.website && (
            <InfoItem label="Website">
              <a href={s.website} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                {s.website.replace(/^https?:\/\//, '')}
              </a>
            </InfoItem>
          )}
        </div>
      </div>
      <p className="mt-6 text-body-4 text-text-2" data-testid="auction-disclaimer">
        Disclaimer: MetaSwap does not provide a valuation, recommendation or endorsement of any token or token project. Devnet tokens have no real value.
      </p>
    </section>
  )
}
