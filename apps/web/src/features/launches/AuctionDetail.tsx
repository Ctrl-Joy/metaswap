import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, ChevronLeft, ExternalLink, Gavel } from 'lucide-react'
import { formatUnits, isAddress, type Address } from 'viem'
import { NATIVE_ETH, type Token } from '@metaswap/sdk'
import { Banner, Button, ButtonLink, Card, CopyButton, EmptyState, InfoTip, SegmentedTabs, Skeleton, Switch, UnderlineTabs } from '@/components/ui'
import { CurrencyInputPanel } from '@/features/tokens/CurrencyInputPanel'
import { priceOf, useTokenList, useTokenPrices } from '@/features/tokens/useTokenList'
import { TokenChartPanel } from '@/features/explore/token/TokenChartPanel'
import { useTokenBalance } from '@/hooks/useTokenBalances'
import { useWallet } from '@/wallet/hooks'
import { useUi } from '@/state/ui'
import { CHAIN_SLUG } from '@/config'
import { cn } from '@/lib/cn'
import { formatAmount, formatRelativeTime, formatTokenAmount, formatUsd, shortenAddress } from '@/lib/format'
import { maxSpendable, parseAmount, toInputString, toNumber } from '@/lib/amount'
import { sanitizeAmountInput } from '@/lib/amount'
import { approvalStep, txStep, useStepRunner, type PlannedStep, type SentTx } from '@/features/positions/execute'
import { ReviewRow, TxFlowModal } from '@/features/positions/components/TxFlowModal'
import { feeLabel, isWeth } from '@/features/positions/tokens'
import { useLaunchDetail } from './api'
import { useAuctionState, type AuctionState } from './chain'
import { buildBid, buildClaimAll, buildSettle } from './contracts'
import { bidConcentration, fdvHuman, humanToPrice, pctAboveFloor, priceToHuman, snapPriceToTick, supplySoldBps, tokensForQuote } from './units'
import { launchpadName, type LaunchDetail } from './types'
import { BidDistributionChart } from './components/BidDistributionChart'
import { Countdown, LaunchpadChip, LaunchStatusBadge, LaunchTokenLogo, ProgressBar, VerifiedMark } from './components/LaunchBits'

export function AuctionDetail({ auctionParam }: { auctionParam: string | undefined }) {
  const auction = auctionParam && isAddress(auctionParam) ? (auctionParam as Address) : undefined
  const { address } = useWallet()
  const q = useAuctionState(auction, address)
  const detail = useLaunchDetail(auction)
  if (!auction) return <NotFound text="That is not a valid auction address." />
  if (q.isLoading)
    return (
      <Shell>
        <Skeleton width={360} height={44} rounded="lg" />
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_380px]">
          <Skeleton width="100%" height={320} rounded="lg" />
          <Skeleton width="100%" height={320} rounded="lg" />
        </div>
      </Shell>
    )
  if (q.isError || !q.data) return <NotFound text="No MetaSwap launch auction was found at this address on MetaChain Devnet." />
  return <Loaded s={q.data} detail={detail.data} account={address} />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-24 md:px-8" data-testid="auction-page">
      <Link to="/launches" className="mb-3 inline-flex items-center gap-1 text-body-3 text-text-2 hover:text-text-1">
        <ChevronLeft size={16} /> Launches
      </Link>
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

function Loaded({ s, detail, account }: { s: AuctionState; detail?: LaunchDetail; account?: Address }) {
  const { prices } = useTokenPrices()
  const { find } = useTokenList()
  const quoteToken = find(s.quoteToken)
  const quoteUsd = priceOf(prices, quoteToken) ?? 0
  const fmtQuote = (raw: bigint) => `${formatTokenAmount(raw, s.quoteDecimals)} ${s.quoteSymbol}`
  const raisedUsd = toNumber(s.raised, s.quoteDecimals) * quoteUsd
  const thresholdUsd = toNumber(s.launchThreshold, s.quoteDecimals) * quoteUsd
  const clearingHuman = priceToHuman(s.clearingPrice)
  const fdvFloor = fdvHuman(s.floorPrice, s.totalSupply) * quoteUsd
  const fdvClearing = fdvHuman(s.clearingPrice, s.totalSupply) * quoteUsd
  const pct = s.thresholdProgressBps / 100
  const bars = useMemo(() => s.levels.map((l) => ({ price: priceToHuman(l.price), demand: toNumber(l.demand, s.quoteDecimals) })), [s.levels, s.quoteDecimals])
  const row = { symbol: s.symbol, token: s.token, logoURI: detail?.logoURI }
  const padName = detail ? launchpadName(detail) : ''
  const aboveFloor = pctAboveFloor(s.clearingPrice, s.floorPrice)
  const band = bidConcentration(s.levels)
  const soldBps = supplySoldBps(s.levels, s.clearingPrice, s.auctionSupply, s.quoteDecimals)

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <LaunchTokenLogo row={row} size={48} />
          <div>
            <h1 className="flex items-center gap-2 text-heading-3 font-semibold" data-testid="auction-title">
              {s.name} <span className="text-text-2">{s.symbol}</span> <VerifiedMark verified={!!detail?.verified} />
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <LaunchStatusBadge status={s.status} testId="auction-status" />
              <LaunchpadChip name={padName} />
              {(s.status === 'active' || s.status === 'upcoming') && (
                <span className="text-body-3 text-text-2">
                  {s.status === 'active' ? 'Ends in ' : 'Starts in '}
                  <Countdown to={s.status === 'active' ? s.endTime : s.startTime} testId="auction-countdown" className="font-semibold text-text-1" />
                </span>
              )}
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
      </div>

      {(s.status === 'active' || s.status === 'upcoming') && <TimeBanner s={s} />}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="auction-stats">
        <Stat label="FDV at floor" value={formatUsd(fdvFloor, { compact: true })} sub={`${formatAmount(priceToHuman(s.floorPrice))} ${s.quoteSymbol} / token`} />
        <Stat label="Bid volume" value={formatUsd(raisedUsd, { compact: true })} sub={`${fmtQuote(s.raised)} · ${s.totalBids.toString()} bids`} testId="stat-raised" />
        <Stat
          label={s.status === 'launched' ? 'Clearing price' : 'Live clearing price'}
          value={`${formatAmount(clearingHuman)} ${s.quoteSymbol}`}
          sub={`${aboveFloor > 0.005 ? `+${formatPercentLoose(aboveFloor)} vs floor · ` : 'At floor · '}FDV ${formatUsd(fdvClearing, { compact: true })}`}
          testId="stat-clearing"
        />
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="flex items-center gap-1 text-body-4 text-text-2">
            Launch threshold <InfoTip content="If bids don't reach this raise by the end, the auction fails and everyone is refunded." />
          </div>
          <div className="mt-1 text-body-1 font-semibold tabular">{formatUsd(thresholdUsd, { compact: true })}</div>
          <ProgressBar value={pct} tone={pct >= 100 ? 'success' : 'text'} className="mt-2" />
          <div className="mt-1 text-body-4 text-text-2 tabular" data-testid="stat-threshold">
            {Math.min(pct, 999).toFixed(2)}% met
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          {s.status === 'launched' && (
            <Card className="p-5" data-testid="launched-chart">
              <TokenChartPanel address={s.token} symbol={s.symbol} latestPriceUsd={detail?.fdvUsd && s.totalSupply ? detail.fdvUsd / (Number(s.totalSupply) / 1e18) : null} apiChange24h={detail?.change1d ?? null} />
            </Card>
          )}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-body-1 font-semibold">Bid distribution</h2>
              <span className="text-body-4 text-text-2">Demand by max price ({s.quoteSymbol})</span>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-body-3" data-testid="bid-insights">
              <span className="text-text-2">
                Bids concentrated at{' '}
                <span className="font-semibold text-text-1 tabular" data-testid="bid-concentration">
                  {band ? `${formatAmount(priceToHuman(band[0]))} – ${formatAmount(priceToHuman(band[1]))} ${s.quoteSymbol}` : '-'}
                </span>
              </span>
              <span className="text-text-2">
                <span className="font-semibold text-text-1 tabular" data-testid="supply-sold">
                  {(soldBps / 100).toFixed(2)}%
                </span>{' '}
                of supply sold
              </span>
            </div>
            <ProgressBar value={soldBps / 100} tone={soldBps >= 10_000 ? 'success' : 'text'} className="mb-4" />
            <BidDistributionChart bars={bars} clearing={clearingHuman} floor={priceToHuman(s.floorPrice)} quoteSymbol={s.quoteSymbol} />
          </Card>
          <RecentBids detail={detail} s={s} />
          <AboutCard s={s} />
        </div>
        <div className="flex flex-col gap-4">
          <ActionsCard s={s} account={account} quoteToken={quoteToken} quoteUsd={quoteUsd} />
          <MyBids s={s} account={account} />
        </div>
      </div>
    </Shell>
  )
}

function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-4" data-testid={testId}>
      <div className="text-body-4 text-text-2">{label}</div>
      <div className="mt-1 truncate text-body-1 font-semibold tabular">{value}</div>
      {sub && <div className="mt-0.5 truncate text-body-4 text-text-3 tabular">{sub}</div>}
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
      <Card className="p-5 text-center">
        <div className="text-body-1 font-semibold">Bidding opens soon</div>
        <div className="mt-1 text-body-3 text-text-2">
          Starts in <Countdown to={s.startTime} />
        </div>
      </Card>
    )
  if (s.status === 'active' && !ended) return <BidForm s={s} account={account} quoteToken={quoteToken} quoteUsd={quoteUsd} />

  return (
    <Card className="flex flex-col gap-3 p-5" data-testid="auction-actions">
      {(s.status === 'ended' || (s.status === 'active' && ended)) && (
        <>
          <div className="text-body-1 font-semibold">Auction ended</div>
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
          <div className="text-body-1 font-semibold">{s.status === 'launched' ? 'Launched' : 'Launch failed'}</div>
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
            <div className="rounded-xl bg-surface-2 px-4 py-3 text-body-3 text-text-2" data-testid="auction-nothing-to-claim">
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
              <ReviewRow label="Raised">{formatTokenAmount(s.raised, s.quoteDecimals)} {s.quoteSymbol}</ReviewRow>
              <ReviewRow label="Threshold">{formatTokenAmount(s.launchThreshold, s.quoteDecimals)} {s.quoteSymbol}</ReviewRow>
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
    </Card>
  )
}

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

  const amountRaw = parseAmount(amount, s.quoteDecimals) ?? 0n
  const supplyWhole = Number(s.totalSupply) / 1e18
  // the limit input is either a price (quote per token) or an FDV in USD
  const priceFromInput = (): bigint | null => {
    if (!limit) return null
    if (mode === 'price') return humanToPrice(limit)
    const fdv = Number(limit)
    if (!Number.isFinite(fdv) || fdv <= 0 || !quoteUsd) return null
    return humanToPrice((fdv / quoteUsd / supplyWhole).toFixed(18))
  }
  const rawPrice = priceFromInput()
  const maxPrice = rawPrice !== null ? snapPriceToTick(rawPrice, s.floorPrice, s.tickSize) : null
  const effective = maxPrice !== null && maxPrice > s.clearingPrice ? s.clearingPrice : maxPrice
  const estTokens = maxPrice !== null && maxPrice >= s.clearingPrice && amountRaw > 0n ? tokensForQuote(amountRaw, effective ?? s.clearingPrice, s.quoteDecimals) : 0n
  const tooLow = maxPrice !== null && rawPrice !== null && rawPrice < s.floorPrice
  const insufficient = balance !== undefined && amountRaw > balance

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
  return (
    <Card className="flex flex-col gap-3 p-5" data-testid="bid-form">
      <div className="flex items-center justify-between">
        <h2 className="text-body-1 font-semibold">Place a bid</h2>
        {canEth && (
          <label className="flex items-center gap-2 text-body-4 text-text-2">
            Pay with ETH <Switch checked={useEth} onChange={setUseEth} label="Pay with ETH" testId="bid-eth-toggle" />
          </label>
        )}
      </div>
      <CurrencyInputPanel
        label="Bid amount"
        token={payToken}
        value={amount}
        onChange={setAmount}
        balance={balance}
        onMax={balance !== undefined && payToken ? () => setAmount(toInputString(maxSpendable(balance, !!payToken.isNative), s.quoteDecimals, s.quoteDecimals)) : undefined}
        usdValue={toNumber(amountRaw, s.quoteDecimals) * quoteUsd}
        error={insufficient}
        testId="bid-amount"
      />
      <div className="rounded-2xl border border-border p-4">
        <div className="flex items-center justify-between">
          <span className="text-body-3 text-text-2">{mode === 'price' ? `Max price (${s.quoteSymbol} per ${s.symbol})` : 'Max FDV (USD)'}</span>
          <SegmentedTabs size="sm" ariaLabel="Limit type" value={mode} onChange={(m) => { setMode(m); setLimit('') }} items={[{ value: 'price', label: 'Price', testId: 'bid-mode-price' }, { value: 'fdv', label: 'FDV', testId: 'bid-mode-fdv' }]} />
        </div>
        <input
          inputMode="decimal"
          placeholder={mode === 'price' ? formatUnits(s.clearingPrice, 18) : String(Math.round(fdvHuman(s.clearingPrice, s.totalSupply) * quoteUsd))}
          value={limit}
          onChange={(e) => {
            const v = sanitizeAmountInput(e.target.value, 18)
            if (v !== null) setLimit(v)
          }}
          data-testid="bid-max-price"
          className="mt-2 h-11 w-full bg-transparent text-[28px] font-medium outline-none tabular"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button key={q.m} type="button" data-testid={`bid-quick-${q.m}`} onClick={() => { setMode('price'); setLimit(formatUnits(q.price, 18)) }} className="h-7 rounded-full bg-surface-2 px-2.5 text-body-4 font-semibold text-text-2 hover:text-text-1">
              {q.m === 1 ? 'Clearing' : `${q.m}×`}
            </button>
          ))}
        </div>
        {maxPrice !== null && rawPrice !== maxPrice && !tooLow && <div className="mt-2 text-body-4 text-text-3">Rounded to the tick: {formatUnits(maxPrice, 18)} {s.quoteSymbol}</div>}
      </div>
      <div className="flex flex-col gap-1.5 text-body-3">
        <ReviewRow label="Floor price">
          {formatAmount(priceToHuman(s.floorPrice))} {s.quoteSymbol}
        </ReviewRow>
        <ReviewRow label="Est. tokens at current clearing">
          <span data-testid="bid-est-tokens">{estTokens > 0n ? `${formatTokenAmount(estTokens, 18)} ${s.symbol}` : '-'}</span>
        </ReviewRow>
      </div>
      {maxPrice !== null && maxPrice < s.clearingPrice && !tooLow && (
        <Banner tone="warning">Your max price is below the current clearing price. Unless demand drops, this bid will be refunded.</Banner>
      )}
      <Button size="xl" fullWidth disabled={cta.disabled} onClick={cta.action} data-testid="bid-review">
        {cta.label}
      </Button>
      <p className="text-body-4 text-text-3">Everyone pays the same clearing price. Bids above it fill fully, bids at it fill pro-rata, and the unused part of every bid is refunded at settlement.</p>
      {account && (
        <TxFlowModal open={open} onOpenChange={setOpen} title="Review bid" runner={runner} confirmLabel="Place bid" onConfirm={confirm} testId="bid-modal">
          <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
            <ReviewRow label="Bid">
              {amount} {payToken?.symbol}
            </ReviewRow>
            <ReviewRow label="Max price">{maxPrice !== null ? `${formatUnits(maxPrice, 18)} ${s.quoteSymbol}` : '-'}</ReviewRow>
            <ReviewRow label="Max FDV">{maxPrice !== null ? formatUsd(fdvHuman(maxPrice, s.totalSupply) * quoteUsd, { compact: true }) : '-'}</ReviewRow>
            <ReviewRow label="Est. tokens">{estTokens > 0n ? `${formatTokenAmount(estTokens, 18)} ${s.symbol}` : '-'}</ReviewRow>
          </div>
        </TxFlowModal>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ bids */

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
    <Card className="p-5" data-testid="my-bids">
      <h2 className="mb-3 text-body-1 font-semibold">Your bids</h2>
      {s.myBids.length === 0 ? (
        <p className="text-body-3 text-text-2">You have not bid in this auction.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {s.myBids.map((b) => {
            const o = bidOutcome(s, b)
            return (
              <li key={b.id.toString()} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-body-3" data-testid={`my-bid-${b.id}`}>
                <span>
                  <span className="block font-semibold tabular">
                    {formatTokenAmount(b.amount, s.quoteDecimals)} {b.native ? 'ETH' : s.quoteSymbol}
                  </span>
                  <span className="block text-body-4 text-text-2 tabular">
                    max {formatAmount(priceToHuman(b.maxPrice))} {s.quoteSymbol}
                  </span>
                </span>
                <span className="text-right">
                  <span className={`block font-semibold ${o.tone}`}>{o.label}</span>
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
    </Card>
  )
}

type ActivityTab = 'activity' | 'timeline'

function RecentBids({ detail, s }: { detail?: LaunchDetail; s: AuctionState }) {
  const bids = detail?.bids ?? []
  const [tab, setTab] = useState<ActivityTab>('activity')
  return (
    <Card className="p-5" data-testid="recent-bids">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <UnderlineTabs<ActivityTab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'activity', label: 'Activity', testId: 'auction-tab-activity' },
            { value: 'timeline', label: 'Timeline', testId: 'auction-tab-timeline' },
          ]}
        />
        <span className="text-body-3 text-text-2 tabular" data-testid="auction-bid-count">
          {s.totalBids.toString()} bids
        </span>
      </div>
      {tab === 'timeline' ? (
        <Timeline s={s} />
      ) : bids.length === 0 ? (
        <p className="text-body-3 text-text-2">{detail ? 'No bids yet.' : 'Bid history is unavailable.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-body-3">
            <thead className="text-body-4 text-text-2">
              <tr className="h-8 text-left">
                <th className="font-medium">Wallet</th>
                <th className="text-right font-medium">Bid</th>
                <th className="text-right font-medium">Max price</th>
                <th className="text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {bids.slice(0, 20).map((b) => {
                const t = b.timestamp ?? b.time
                return (
                  <tr key={String(b.bidId)} className="h-10 border-t border-border" data-testid="auction-bid-row">
                    <td className="font-mono text-text-2">{shortenAddress(b.bidder)}</td>
                    <td className="text-right tabular">
                      {formatTokenAmount(BigInt(b.amount), s.quoteDecimals)} {s.quoteSymbol}
                    </td>
                    <td className="text-right tabular">
                      {formatAmount(priceToHuman(BigInt(b.maxPrice)))} {s.quoteSymbol}
                    </td>
                    <td className="text-right text-text-2">{t ? formatRelativeTime(t * 1000) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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
      label:
        s.status === 'failed'
          ? 'Failed: threshold not met, bids refunded'
          : s.status === 'launched'
            ? 'Settled: pool created, tokens claimable'
            : 'Settlement: pool created at the clearing price',
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
            <span className="text-body-3 font-semibold">{it.label}</span>
            {it.time !== null && <span className="text-body-4 text-text-2">{new Date(it.time * 1000).toLocaleString()}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** "Auction ends in …" banner with elapsed-time progress and a jump to the details. */
function TimeBanner({ s }: { s: AuctionState }) {
  const active = s.status === 'active'
  const span = Math.max(1, s.endTime - s.startTime)
  const elapsed = Math.min(100, Math.max(0, ((s.blockTime - s.startTime) / span) * 100))
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-accent-tint px-4 py-3" data-testid="auction-time-banner">
      <span className="text-body-2 font-semibold text-text-1">
        {active ? 'Auction ends in ' : 'Auction starts in '}
        <Countdown to={active ? s.endTime : s.startTime} className="tabular" />
      </span>
      {active && <ProgressBar value={elapsed} tone="accent" className="min-w-[120px] flex-1" />}
      <a href="#auction-info" className="text-body-3 font-semibold text-accent hover:underline" data-testid="auction-see-details">
        See full details
      </a>
    </div>
  )
}

function formatPercentLoose(p: number): string {
  if (p >= 1000) return `${(p / 1000).toFixed(1)}K%`
  return `${p.toFixed(p >= 100 ? 0 : 2)}%`
}

function AboutCard({ s }: { s: AuctionState }) {
  return (
    <Card className="flex flex-col gap-2 p-5" id="auction-info" data-testid="auction-info">
      <h2 className="text-body-1 font-semibold">About {s.name}</h2>
      {s.description && <p className="text-body-3 text-text-2">{s.description}</p>}
      <div className="grid gap-x-8 gap-y-1.5 text-body-3 sm:grid-cols-2">
        <ReviewRow label="Total supply">{formatTokenAmount(s.totalSupply, 18)}</ReviewRow>
        <ReviewRow label="Auction supply">
          {formatTokenAmount(s.auctionSupply, 18)} {s.symbol}
        </ReviewRow>
        <ReviewRow label="Implied token price" testId="auction-implied-price">
          {formatAmount(priceToHuman(s.floorPrice))} – {formatAmount(priceToHuman(s.clearingPrice > s.floorPrice ? s.clearingPrice : s.floorPrice))} {s.quoteSymbol}
        </ReviewRow>
        <ReviewRow label="% committed to LP">{(Number(s.liquidityBps) / 100).toFixed(1)}%</ReviewRow>
        <ReviewRow label="Sold in auction">{(Number(s.auctionSupplyBps) / 100).toFixed(0)}%</ReviewRow>
        <ReviewRow label="Liquidity">{(Number(s.liquidityBps) / 100).toFixed(0)}% of raise</ReviewRow>
        <ReviewRow label="Pool fee">{feeLabel(s.poolFee)}</ReviewRow>
        <ReviewRow label="Starts">{new Date(s.startTime * 1000).toLocaleString()}</ReviewRow>
        <ReviewRow label="Ends">{new Date(s.endTime * 1000).toLocaleString()}</ReviewRow>
        <ReviewRow label="Token">
          <CopyButton value={s.token} label="Copy token address">
            <span className="font-mono">{shortenAddress(s.token)}</span>
          </CopyButton>
        </ReviewRow>
        <ReviewRow label="Contract address">
          <CopyButton value={s.auction} label="Copy auction address">
            <span className="font-mono">{shortenAddress(s.auction)}</span>
          </CopyButton>
        </ReviewRow>
        <ReviewRow label="Launched on">{s.status === 'launched' ? new Date(s.endTime * 1000).toLocaleDateString() : '--'}</ReviewRow>
        <ReviewRow label="LP owner">{s.pool ? 'Locked in the auction contract' : '--'}</ReviewRow>
        {s.website && (
          <ReviewRow label="Website">
            <a href={s.website} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
              {s.website.replace(/^https?:\/\//, '')}
            </a>
          </ReviewRow>
        )}
      </div>
      <p className="mt-2 text-body-4 text-text-3" data-testid="auction-disclaimer">
        Disclaimer: MetaSwap does not provide a valuation, recommendation or endorsement of any token or token project. Devnet tokens have no real value.
      </p>
    </Card>
  )
}
