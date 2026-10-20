import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, ChevronLeft, Minus, Plus } from 'lucide-react'
import type { Address } from 'viem'
import { Banner, Button, ButtonLink, Card, DoubleLogo, EmptyState, Skeleton, Switch, TokenLogo } from '@/components/ui'
import { useTokenList, useTokenPrices, priceOf } from '@/features/tokens/useTokenList'
import { useWallet } from '@/wallet/hooks'
import { useUi } from '@/state/ui'
import { useSettings, useSlippageBps } from '@/state/settings'
import { formatPercent, formatTokenAmount, formatUsd, shortenAddress } from '@/lib/format'
import { toNumber } from '@/lib/amount'
import { CHAIN_SLUG } from '@/config'
import { contractAddress, feeLabel, isWeth, NATIVE_ETH, wrappedNative, type Token } from '../tokens'
import { usePoolTicks } from '../api'
import { tokenUriImage, useV3Position, type V3PositionState } from '../chain'
import {
  amountsForLiquidity,
  dependentAmount,
  depositSide,
  isFullRange,
  maxUsableTick,
  minUsableTick,
  mintAmountsWithSlippage,
  minusSlippage,
  percentOf,
  tickSpacingForFee,
  tickToDisplayPrice,
} from '../math'
import { buildCollect, buildDecrease, buildIncrease, deadlineFromNow } from '../encode'
import { approvalStep, GAS, txStep, useStepRunner, type PlannedStep, type SentTx } from '../execute'
import { StatusBadge, type PositionStatus } from '../components/StatusBadge'
import { LiquidityChart } from '../components/LiquidityChart'
import { formatDisplayPrice } from '../components/RangeSelector'
import { DepositInputs, useLinkedAmounts, type LinkFn } from '../components/DepositInputs'
import { ReviewRow, TxFlowModal } from '../components/TxFlowModal'
import { PercentPicker } from '../components/PercentPicker'

function useResolvedToken(address: Address | undefined): Token | undefined {
  const { find } = useTokenList()
  return address ? find(address) : undefined
}

export function V3PositionDetail({ tokenIdParam }: { tokenIdParam: string | undefined }) {
  const tokenId = tokenIdParam && /^\d+$/.test(tokenIdParam) ? BigInt(tokenIdParam) : undefined
  const q = useV3Position(tokenId)
  const pos = q.data
  const t0 = useResolvedToken(pos?.token0)
  const t1 = useResolvedToken(pos?.token1)

  if (tokenId === undefined) return <NotFound text="That position id is not valid." />
  if (q.isLoading || (pos && (!t0 || !t1)))
    return (
      <Shell>
        <Skeleton width={320} height={40} rounded="lg" />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Skeleton width="100%" height={260} rounded="lg" />
          <Skeleton width="100%" height={260} rounded="lg" />
        </div>
      </Shell>
    )
  if (q.isError) return <NotFound text="Could not read this position from MetaChain Devnet." />
  if (!pos || !t0 || !t1) return <NotFound text={`Position #${tokenIdParam} does not exist or was closed and burned.`} />
  return <Loaded pos={pos} t0={t0} t1={t1} />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-6 pb-24 md:px-8" data-testid="position-detail">
      <Link to="/positions" className="mb-3 inline-flex items-center gap-1 text-body-3 text-text-2 hover:text-text-1">
        <ChevronLeft size={16} /> Your positions
      </Link>
      {children}
    </div>
  )
}

function NotFound({ text }: { text: string }) {
  return (
    <Shell>
      <Card>
        <EmptyState title="Position not found" action={<ButtonLink to="/positions">Back to positions</ButtonLink>}>
          {text}
        </EmptyState>
      </Card>
    </Shell>
  )
}

function Loaded({ pos, t0, t1 }: { pos: V3PositionState; t0: Token; t1: Token }) {
  const { address } = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const { prices } = useTokenPrices()
  const [invert, setInvert] = useState(!!t0.tags?.includes('stablecoin') && !t1.tags?.includes('stablecoin'))
  const [modal, setModal] = useState<'add' | 'remove' | 'collect' | null>(null)
  const ticksQ = usePoolTicks(pos.pool)

  const spacing = tickSpacingForFee(pos.fee)
  const closed = pos.liquidity === 0n
  const inRange = pos.tick >= pos.tickLower && pos.tick < pos.tickUpper
  const status: PositionStatus = closed ? 'closed' : inRange ? 'in-range' : 'out-of-range'
  const { amount0, amount1 } = amountsForLiquidity(pos.sqrtPriceX96, pos.tickLower, pos.tickUpper, pos.liquidity)
  const p0 = priceOf(prices, t0) ?? 0
  const p1 = priceOf(prices, t1) ?? 0
  const usd0 = toNumber(amount0, t0.decimals) * p0
  const usd1 = toNumber(amount1, t1.decimals) * p1
  const fees0Usd = toNumber(pos.fees0, t0.decimals) * p0
  const fees1Usd = toNumber(pos.fees1, t1.decimals) * p1
  const isOwner = !!address && address.toLowerCase() === pos.owner.toLowerCase()
  const image = tokenUriImage(pos.tokenURI)
  const full = isFullRange(pos.tickLower, pos.tickUpper, spacing)

  const base = invert ? t1 : t0
  const quote = invert ? t0 : t1
  const unit = `${quote.symbol} per ${base.symbol}`
  const lo = pos.tickLower <= minUsableTick(spacing) ? (invert ? Infinity : 0) : tickToDisplayPrice(pos.tickLower, t0.decimals, t1.decimals, invert)
  const hi = pos.tickUpper >= maxUsableTick(spacing) ? (invert ? 0 : Infinity) : tickToDisplayPrice(pos.tickUpper, t0.decimals, t1.decimals, invert)
  const minP = Math.min(lo, hi)
  const maxP = Math.max(lo, hi)
  const current = tickToDisplayPrice(pos.tick, t0.decimals, t1.decimals, invert)

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <DoubleLogo token0={t0} token1={t1} size={40} />
          <div>
            <h1 className="text-heading-3 font-medium" data-testid="position-title">
              {t0.symbol} / {t1.symbol}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-body-4">
              <span className="rounded-full bg-surface-3 px-2 py-0.5 font-semibold text-text-2">v3</span>
              <span className="rounded-full bg-surface-3 px-2 py-0.5 font-semibold text-text-2">{feeLabel(pos.fee)}</span>
              <StatusBadge status={status} testId="position-status" />
              <span className="text-text-3">#{pos.tokenId.toString()}</span>
            </div>
          </div>
        </div>
        {isOwner ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={() => setModal('add')} data-testid="action-add">
              Add liquidity
            </Button>
            <Button variant="secondary" leftIcon={<Minus size={16} />} onClick={() => setModal('remove')} disabled={closed} data-testid="action-remove">
              Remove liquidity
            </Button>
          </div>
        ) : !address ? (
          <Button onClick={openConnect}>Connect wallet</Button>
        ) : null}
      </div>
      {address && !isOwner && (
        <Banner tone="info" className="mt-4" title="View only">
          This position is owned by {shortenAddress(pos.owner)}. Only the owner can manage it.
        </Banner>
      )}
      {status === 'out-of-range' && (
        <Banner tone="warning" className="mt-4" title="Out of range">
          The current price is outside this position's range, so it is not earning fees. Remove liquidity and open a new range to rebalance.
        </Banner>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-4">
          {image && (
            <Card className="flex justify-center overflow-hidden p-4">
              <img src={image} alt={`MetaSwap V3 position NFT #${pos.tokenId}`} className="max-h-[360px] w-auto rounded-xl" data-testid="position-nft" />
            </Card>
          )}
          <Card className="p-5">
            <div className="text-body-3 text-text-2">Liquidity</div>
            <div className="mt-1 text-heading-2 font-medium tabular" data-testid="position-value">
              {formatUsd(usd0 + usd1)}
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <TokenRow token={t0} amount={amount0} usd={usd0} pct={usd0 + usd1 > 0 ? (usd0 / (usd0 + usd1)) * 100 : undefined} testId="liquidity-token0" />
              <TokenRow token={t1} amount={amount1} usd={usd1} pct={usd0 + usd1 > 0 ? (usd1 / (usd0 + usd1)) * 100 : undefined} testId="liquidity-token1" />
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-body-3 text-text-2">Unclaimed fees</div>
                <div className="mt-1 text-heading-3 font-medium tabular" data-testid="fees-value">
                  {formatUsd(fees0Usd + fees1Usd)}
                </div>
              </div>
              {isOwner && (
                <Button onClick={() => setModal('collect')} disabled={pos.fees0 === 0n && pos.fees1 === 0n} data-testid="action-collect">
                  Collect fees
                </Button>
              )}
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <TokenRow token={t0} amount={pos.fees0} usd={fees0Usd} testId="fees-token0" />
              <TokenRow token={t1} amount={pos.fees1} usd={fees1Usd} testId="fees-token1" />
            </div>
          </Card>
        </div>
        <Card className="flex h-fit flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <div className="text-body-1 font-medium">Price range</div>
            <button type="button" onClick={() => setInvert((v) => !v)} data-testid="detail-invert" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-body-4 font-semibold text-text-2 hover:text-text-1">
              <ArrowLeftRight size={14} /> {base.symbol} / {quote.symbol}
            </button>
          </div>
          {!full && (
            <LiquidityChart ticks={ticksQ.data?.ticks} loading={ticksQ.isLoading} currentTick={pos.tick} decimals0={t0.decimals} decimals1={t1.decimals} invert={invert} minPrice={minP} maxPrice={maxP} testId="detail-chart" />
          )}
          <div className="grid grid-cols-2 gap-3">
            <PriceBox label="Min price" value={minP} unit={unit} testId="detail-min" />
            <PriceBox label="Max price" value={maxP} unit={unit} testId="detail-max" />
          </div>
          <PriceBox label="Current price" value={current} unit={unit} testId="detail-current" />
          {full && <p className="text-body-4 text-text-2">This is a full range position.</p>}
          <Link to={`/explore/pools/${CHAIN_SLUG}/${pos.pool}`} className="text-body-3 font-semibold text-accent hover:underline">
            View pool
          </Link>
        </Card>
      </div>

      {isOwner && address && (
        <>
          <CollectModal open={modal === 'collect'} onOpenChange={(o) => setModal(o ? 'collect' : null)} pos={pos} t0={t0} t1={t1} account={address} usd={fees0Usd + fees1Usd} />
          <IncreaseModal open={modal === 'add'} onOpenChange={(o) => setModal(o ? 'add' : null)} pos={pos} t0={t0} t1={t1} account={address} />
          <RemoveModal open={modal === 'remove'} onOpenChange={(o) => setModal(o ? 'remove' : null)} pos={pos} t0={t0} t1={t1} account={address} />
        </>
      )}
    </Shell>
  )
}

function TokenRow({ token, amount, usd, pct, testId }: { token: Token; amount: bigint; usd: number; pct?: number; testId: string }) {
  return (
    <div className="flex items-center gap-3" data-testid={testId} data-amount={amount.toString()}>
      <TokenLogo token={token} size={24} />
      <span className="flex-1 text-body-2">{token.symbol}</span>
      <span className="text-right">
        <span className="block text-body-2 font-medium tabular">{formatTokenAmount(amount, token.decimals)}</span>
        <span className="block text-body-4 text-text-2 tabular">
          {formatUsd(usd)}
          {pct !== undefined && ` · ${formatPercent(pct, { digits: 0 })}`}
        </span>
      </span>
    </div>
  )
}

function PriceBox({ label, value, unit, testId }: { label: string; value: number; unit: string; testId: string }) {
  return (
    <div className="rounded-[20px] bg-surface-2 p-4 text-center" data-testid={testId}>
      <div className="text-body-4 text-text-2">{label}</div>
      <div className="mt-1 text-heading-3 font-medium tabular">{formatDisplayPrice(value)}</div>
      <div className="text-body-4 text-text-3">{unit}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ modals */

function useEthOption(t0: Token, t1: Token) {
  const wethSide = isWeth(t0.address) ? 0 : isWeth(t1.address) ? 1 : -1
  const [useEth, setUseEth] = useState(true)
  return { wethSide, useEth: wethSide >= 0 && useEth, setUseEth }
}

function EthToggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-body-3">
      <span>{label}</span>
      <Switch checked={checked} onChange={onChange} label={label} testId="eth-toggle" />
    </label>
  )
}

function CollectModal({ open, onOpenChange, pos, t0, t1, account, usd }: { open: boolean; onOpenChange: (o: boolean) => void; pos: V3PositionState; t0: Token; t1: Token; account: Address; usd: number }) {
  const runner = useStepRunner()
  const eth = useEthOption(t0, t1)
  const sym = (t: Token, i: 0 | 1) => (eth.useEth && eth.wethSide === i ? 'ETH' : t.symbol)
  const confirm = () => {
    const out: SentTx = {}
    void runner.run(async () => [
      txStep(
        {
          id: 'collect',
          title: 'Collect fees',
          description: 'Confirm in your wallet',
          account,
          type: 'collect-fees',
          summary: `Collected ${formatTokenAmount(pos.fees0, t0.decimals)} ${sym(t0, 0)} and ${formatTokenAmount(pos.fees1, t1.decimals)} ${sym(t1, 1)} in fees`,
          gas: GAS.collect,
        },
        () =>
          buildCollect({
            npm: contractAddress('NonfungiblePositionManager'),
            tokenId: pos.tokenId,
            recipient: account,
            token0: pos.token0,
            token1: pos.token1,
            weth: wrappedNative().address,
            receiveEth: eth.useEth,
          }),
        out,
      ),
    ])
  }
  return (
    <TxFlowModal open={open} onOpenChange={onOpenChange} title="Collect fees" runner={runner} confirmLabel="Collect" onConfirm={confirm} testId="collect-modal">
      <div className="flex flex-col gap-2 rounded-[20px] bg-surface-2 p-4">
        <ReviewRow label={sym(t0, 0)}>{formatTokenAmount(pos.fees0, t0.decimals)}</ReviewRow>
        <ReviewRow label={sym(t1, 1)}>{formatTokenAmount(pos.fees1, t1.decimals)}</ReviewRow>
        <ReviewRow label="Value">{formatUsd(usd)}</ReviewRow>
      </div>
      {eth.wethSide >= 0 && <EthToggle checked={eth.useEth} onChange={eth.setUseEth} label="Collect as ETH (unwrap WETH)" />}
    </TxFlowModal>
  )
}

function IncreaseModal({ open, onOpenChange, pos, t0, t1, account }: { open: boolean; onOpenChange: (o: boolean) => void; pos: V3PositionState; t0: Token; t1: Token; account: Address }) {
  const runner = useStepRunner()
  const slippageBps = useSlippageBps()
  const deadlineMinutes = useSettings((s) => s.deadlineMinutes)
  const eth = useEthOption(t0, t1)
  const tokenA = eth.useEth && eth.wethSide === 0 ? NATIVE_ETH : t0
  const tokenB = eth.useEth && eth.wethSide === 1 ? NATIVE_ETH : t1
  const side = depositSide(pos.sqrtPriceX96, pos.tickLower, pos.tickUpper)
  const disabled = useMemo(() => ({ A: side === 'token1', B: side === 'token0' }), [side])
  const link: LinkFn = useCallback((s, amount) => dependentAmount(pos.sqrtPriceX96, pos.tickLower, pos.tickUpper, s === 'A' ? 'token0' : 'token1', amount), [pos.sqrtPriceX96, pos.tickLower, pos.tickUpper])
  const amounts = useLinkedAmounts(tokenA, tokenB, link, disabled)

  const confirm = () => {
    const npm = contractAddress('NonfungiblePositionManager')
    const out: SentTx = {}
    void runner
      .run(async () => {
        const steps: PlannedStep[] = []
        const a = await approvalStep(account, tokenA, npm, 'position manager', amounts.amountA)
        const b = await approvalStep(account, tokenB, npm, 'position manager', amounts.amountB)
        if (a) steps.push(a)
        if (b) steps.push(b)
        const mins = mintAmountsWithSlippage(pos.sqrtPriceX96, pos.tickLower, pos.tickUpper, amounts.amountA, amounts.amountB, slippageBps)
        steps.push(
          txStep(
            {
              id: 'increase',
              title: 'Add liquidity',
              description: 'Confirm in your wallet',
              account,
              type: 'add-liquidity',
              summary: `Added ${formatTokenAmount(amounts.amountA, t0.decimals)} ${tokenA.symbol} and ${formatTokenAmount(amounts.amountB, t1.decimals)} ${tokenB.symbol} to position #${pos.tokenId}`,
              gas: GAS.increase,
            },
            () =>
              buildIncrease({
                npm,
                tokenId: pos.tokenId,
                amount0Desired: amounts.amountA,
                amount1Desired: amounts.amountB,
                amount0Min: mins.amount0Min,
                amount1Min: mins.amount1Min,
                deadline: deadlineFromNow(deadlineMinutes),
                ethValue: tokenA.isNative ? amounts.amountA : tokenB.isNative ? amounts.amountB : 0n,
              }),
            out,
          ),
        )
        return steps
      })
      .then((ok) => ok && amounts.reset())
  }
  const empty = amounts.amountA === 0n && amounts.amountB === 0n
  return (
    <TxFlowModal open={open} onOpenChange={onOpenChange} title="Add liquidity" runner={runner} confirmLabel={empty ? 'Enter an amount' : 'Add liquidity'} confirmDisabled={empty} onConfirm={confirm} testId="increase-modal">
      {eth.wethSide >= 0 && <EthToggle checked={eth.useEth} onChange={eth.setUseEth} label="Deposit ETH instead of WETH" />}
      <DepositInputs tokenA={tokenA} tokenB={tokenB} amounts={amounts} account={account} disabled={disabled} testIdPrefix="increase" />
    </TxFlowModal>
  )
}

function RemoveModal({ open, onOpenChange, pos, t0, t1, account }: { open: boolean; onOpenChange: (o: boolean) => void; pos: V3PositionState; t0: Token; t1: Token; account: Address }) {
  const runner = useStepRunner()
  const slippageBps = useSlippageBps()
  const deadlineMinutes = useSettings((s) => s.deadlineMinutes)
  const eth = useEthOption(t0, t1)
  const [pct, setPct] = useState(50)
  const [burn, setBurn] = useState(true)
  const liquidity = percentOf(pos.liquidity, pct)
  const { amount0, amount1 } = amountsForLiquidity(pos.sqrtPriceX96, pos.tickLower, pos.tickUpper, liquidity)
  const sym = (t: Token, i: 0 | 1) => (eth.useEth && eth.wethSide === i ? 'ETH' : t.symbol)
  const willBurn = pct === 100 && burn

  const confirm = () => {
    const out: SentTx = {}
    void runner.run(async () => [
      txStep(
        {
          id: 'decrease',
          title: willBurn ? 'Remove liquidity and close position' : 'Remove liquidity',
          description: 'Confirm in your wallet',
          account,
          type: 'remove-liquidity',
          summary: `Removed ${formatTokenAmount(amount0, t0.decimals)} ${sym(t0, 0)} and ${formatTokenAmount(amount1, t1.decimals)} ${sym(t1, 1)} from position #${pos.tokenId}`,
          gas: GAS.decrease,
        },
        () =>
          buildDecrease({
            npm: contractAddress('NonfungiblePositionManager'),
            tokenId: pos.tokenId,
            liquidity,
            amount0Min: minusSlippage(amount0, slippageBps),
            amount1Min: minusSlippage(amount1, slippageBps),
            deadline: deadlineFromNow(deadlineMinutes),
            recipient: account,
            token0: pos.token0,
            token1: pos.token1,
            weth: wrappedNative().address,
            receiveEth: eth.useEth,
            burn: willBurn,
          }),
        out,
      ),
    ])
  }
  return (
    <TxFlowModal open={open} onOpenChange={onOpenChange} title="Remove liquidity" runner={runner} confirmLabel="Remove" confirmDisabled={liquidity === 0n} onConfirm={confirm} testId="remove-modal">
      <PercentPicker value={pct} onChange={setPct} />
      <div className="flex flex-col gap-2 rounded-[20px] bg-surface-2 p-4">
        <ReviewRow label={`Pooled ${sym(t0, 0)}`} testId="remove-amount0">
          {formatTokenAmount(amount0, t0.decimals)}
        </ReviewRow>
        <ReviewRow label={`Pooled ${sym(t1, 1)}`} testId="remove-amount1">
          {formatTokenAmount(amount1, t1.decimals)}
        </ReviewRow>
        <ReviewRow label={`${sym(t0, 0)} fees`}>{formatTokenAmount(pos.fees0, t0.decimals)}</ReviewRow>
        <ReviewRow label={`${sym(t1, 1)} fees`}>{formatTokenAmount(pos.fees1, t1.decimals)}</ReviewRow>
      </div>
      {eth.wethSide >= 0 && <EthToggle checked={eth.useEth} onChange={eth.setUseEth} label="Receive ETH (unwrap WETH)" />}
      {pct === 100 && (
        <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-body-3">
          <span>Close position and burn the NFT</span>
          <Switch checked={burn} onChange={setBurn} label="Burn position NFT" testId="burn-toggle" />
        </label>
      )}
      <p className="text-body-4 text-text-2">Uncollected fees are collected in the same transaction.</p>
    </TxFlowModal>
  )
}
