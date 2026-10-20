import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowLeftRight, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { parseEventLogs, type Address, type TransactionReceipt } from 'viem'
import { nonfungiblePositionManagerAbi } from '@metaswap/sdk/abis'
import { v2Math } from '@metaswap/sdk'
import { Banner, Button, ButtonLink, Card, DoubleLogo, SegmentedTabs, Skeleton, TokenLogo } from '@/components/ui'
import { TokenSelector } from '@/features/tokens/TokenSelector'
import { useTokenList, useTokenPrices, priceOf } from '@/features/tokens/useTokenList'
import { SettingsPopover } from '@/features/settings/SettingsPopover'
import { useTokenBalances } from '@/hooks/useTokenBalances'
import { useWallet } from '@/wallet/hooks'
import { useUi } from '@/state/ui'
import { useSettings, useSlippageBps } from '@/state/settings'
import { formatPercent, formatTokenAmount, formatUsd } from '@/lib/format'
import { sanitizeAmountInput, toNumber } from '@/lib/amount'
import { cn } from '@/lib/cn'
import { contractAddress, feeLabel, poolToken, sameToken, type Token } from '../tokens'
import { useAllPools, usePoolTicks, rowTokenAddress } from '../api'
import { useV2Pair, useV3Pools } from '../chain'
import {
  dependentAmount,
  depositSide,
  fullRangeTicks,
  getTickAtSqrtRatio,
  liquidityForAmounts,
  getSqrtRatioAtTick,
  maxUsableTick,
  minUsableTick,
  mintAmountsWithSlippage,
  minusSlippage,
  priceToSqrtPriceX96,
  rangeAround,
  tickSpacingForFee,
  v2LiquidityMinted,
} from '../math'
import { buildMint, buildV2Add, deadlineFromNow } from '../encode'
import { approvalStep, GAS, txStep, useStepRunner, type PlannedStep, type SentTx } from '../execute'
import { FeeTierSelector } from '../components/FeeTierSelector'
import { RangeSelector, formatDisplayPrice } from '../components/RangeSelector'
import { DepositInputs, useLinkedAmounts, type LinkFn } from '../components/DepositInputs'
import { ReviewRow, TxFlowModal } from '../components/TxFlowModal'

type Version = 'v2' | 'v3'

/** /positions/create — choose pair + version + fee, set range (V3), deposit, review. */
export function CreatePosition() {
  const [params, setParams] = useSearchParams()
  const { find } = useTokenList()
  const { address } = useWallet()
  const openConnect = useUi((s) => s.openConnect)

  const tokenA = find(params.get('currencyA')) ?? find('ETH')
  const tokenB = find(params.get('currencyB'))
  const version: Version = params.get('version') === 'v2' ? 'v2' : 'v3'
  const feeParam = Number(params.get('fee'))
  const fee = [100, 500, 3000, 10000].includes(feeParam) ? feeParam : 3000
  const [step, setStep] = useState<1 | 2>(1)

  const setParam = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }
  const tokenParam = (t: Token) => (t.isNative ? 'ETH' : t.address)
  const selectA = (t: Token) => (sameToken(t, tokenB) ? setParam({ currencyA: tokenParam(t), currencyB: tokenA ? tokenParam(tokenA) : undefined }) : setParam({ currencyA: tokenParam(t) }))
  const selectB = (t: Token) => (sameToken(t, tokenA) ? setParam({ currencyB: tokenParam(t), currencyA: tokenB ? tokenParam(tokenB) : undefined }) : setParam({ currencyB: tokenParam(t) }))

  const pairReady = !!tokenA && !!tokenB && !sameToken(tokenA, tokenB)

  return (
    <div className="mx-auto w-full max-w-[1264px] px-4 pt-6 pb-24 md:px-8" data-testid="create-position">
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1 text-body-2 leading-[22px] text-text-2">
        <Link to="/positions" className="hover:text-text-1">
          Your positions
        </Link>
        <ChevronRight size={16} />
        <span className="text-text-1">New position</span>
      </nav>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 text-heading-3 font-medium">
          <Link to="/positions" aria-label="Back to your positions" className="text-text-1 hover:text-text-2">
            <ArrowLeft size={24} />
          </Link>
          New position
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setParams({ ...(version === 'v2' ? { version: 'v2' } : {}) }, { replace: true })
              setStep(1)
            }}
            className="inline-flex h-[38px] items-center gap-2 rounded-xl bg-surface-2 px-3 text-body-3 font-semibold text-text-2 transition-colors hover:text-text-1"
            data-testid="create-reset"
          >
            <RotateCcw size={16} /> Reset
          </button>
          <SegmentedTabs
            ariaLabel="Protocol version"
            size="sm"
            className="h-[38px] rounded-xl border border-border"
            value={version}
            onChange={(v) => {
              setParam({ version: v === 'v3' ? undefined : v })
              setStep(1)
            }}
            items={[
              { value: 'v3', label: 'v3', testId: 'version-v3' },
              { value: 'v2', label: 'v2', testId: 'version-v2' },
            ]}
          />
          <span className="inline-flex h-[38px] items-center rounded-xl border border-border px-2">
            <SettingsPopover />
          </span>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <StepsRail version={version} step={step} onStep={(s) => pairReady && setStep(s)} />
        <div className="min-w-0">
          {step === 1 ? (
            <div className="flex flex-col gap-8 rounded-[20px] border border-border p-6">
              <section>
                <h2 className="text-body-1 font-medium">Select pair</h2>
                <p className="mb-4 text-body-3 text-text-2">Choose the tokens you want to provide liquidity for.</p>
                <PairPicker tokenA={tokenA} tokenB={tokenB} onA={selectA} onB={selectB} onFlip={() => setParam({ currencyA: tokenB ? tokenParam(tokenB) : undefined, currencyB: tokenA ? tokenParam(tokenA) : undefined })} />
              </section>
              {version === 'v3' && (
                <section>
                  <h2 className="text-body-1 font-medium">Fee tier</h2>
                  <p className="mb-4 text-body-3 text-text-2">The amount earned providing liquidity. Choose an amount that suits your risk tolerance and strategy.</p>
                  <FeeTierSection tokenA={tokenA} tokenB={tokenB} fee={fee} onFee={(f) => setParam({ fee: String(f) })} />
                </section>
              )}
              {version === 'v2' && (
                <Banner tone="info" title="V2 positions">
                  V2 pools charge a fixed 0.3% fee and spread your liquidity over the full price range.
                </Banner>
              )}
              <Button size="xl" fullWidth style={{ height: 54, borderRadius: 20 }} disabled={!pairReady} onClick={() => setStep(2)} data-testid="create-continue">
                {pairReady ? 'Continue' : 'Select a pair'}
              </Button>
            </div>
          ) : tokenA && tokenB && version === 'v3' ? (
            <V3Deposit key={`${tokenA.address}-${tokenB.address}-${fee}`} tokenA={tokenA} tokenB={tokenB} fee={fee} account={address} onConnect={openConnect} onEdit={() => setStep(1)} />
          ) : tokenA && tokenB ? (
            <V2Deposit key={`${tokenA.address}-${tokenB.address}`} tokenA={tokenA} tokenB={tokenB} account={address} onConnect={openConnect} onEdit={() => setStep(1)} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function StepsRail({ version, step, onStep }: { version: Version; step: 1 | 2; onStep: (s: 1 | 2) => void }) {
  const items =
    version === 'v3'
      ? [
          { n: 1 as const, title: 'Select token pair and fees' },
          { n: 2 as const, title: 'Set price range and deposit amounts' },
        ]
      : [
          { n: 1 as const, title: 'Select token pair' },
          { n: 2 as const, title: 'Enter deposit amounts' },
        ]
  return (
    <div className="hidden h-fit flex-col rounded-3xl border border-border px-4 py-5 lg:flex" data-testid="create-steps">
      {items.map((it, i) => (
        <div key={it.n}>
          {i > 0 && <span className="ml-4 block h-12 w-px bg-border" aria-hidden />}
          <button type="button" onClick={() => onStep(it.n)} className="flex items-center gap-3 text-left">
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-body-2 font-medium', step === it.n ? 'bg-text-1 text-bg' : 'bg-surface-3 text-text-2')}>{it.n}</span>
            <span>
              <span className={cn('block text-body-3', step === it.n ? 'text-text-2' : 'text-text-3')}>Step {it.n}</span>
              <span className={cn('block text-body-2 leading-5', step === it.n ? 'text-text-1' : 'text-text-2')}>{it.title}</span>
            </span>
          </button>
        </div>
      ))}
    </div>
  )
}

function PairPicker({ tokenA, tokenB, onA, onB, onFlip }: { tokenA?: Token; tokenB?: Token; onA: (t: Token) => void; onB: (t: Token) => void; onFlip: () => void }) {
  const [open, setOpen] = useState<'A' | 'B' | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
      <PairButton token={tokenA} onClick={() => setOpen('A')} testId="pair-token-a" />
      <button type="button" aria-label="Swap token order" onClick={onFlip} className="flex size-8 shrink-0 items-center justify-center rounded-full text-text-2 hover:bg-surface-3 hover:text-text-1">
        <ArrowLeftRight size={16} />
      </button>
      <PairButton token={tokenB} onClick={() => setOpen('B')} testId="pair-token-b" />
      <TokenSelector open={open !== null} onOpenChange={(o) => !o && setOpen(null)} onSelect={(t) => (open === 'A' ? onA(t) : onB(t))} selected={open === 'A' ? tokenA : tokenB} />
    </div>
  )
}

function PairButton({ token, onClick, testId }: { token?: Token; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'flex h-[50px] w-full min-w-0 flex-1 items-center gap-2 rounded-2xl px-4 text-body-2 font-semibold transition-colors',
        token ? 'bg-surface-3 text-text-1 hover:bg-surface-3-hover' : 'bg-text-1 text-bg hover:opacity-90',
      )}
    >
      {token && <TokenLogo token={token} size={24} chainBadge />}
      <span className="min-w-0 flex-1 truncate text-left">{token ? token.symbol : 'Choose token'}</span>
      <ChevronDown size={20} />
    </button>
  )
}

function usePoolTokens(tokenA: Token | undefined, tokenB: Token | undefined) {
  return useMemo(() => {
    if (!tokenA || !tokenB) return { token0: undefined, token1: undefined, aIs0: true }
    const pa = poolToken(tokenA)
    const pb = poolToken(tokenB)
    const aIs0 = pa.address.toLowerCase() < pb.address.toLowerCase()
    return { token0: aIs0 ? pa : pb, token1: aIs0 ? pb : pa, aIs0 }
  }, [tokenA, tokenB])
}

function FeeTierSection({ tokenA, tokenB, fee, onFee }: { tokenA?: Token; tokenB?: Token; fee: number; onFee: (f: number) => void }) {
  const { token0, token1 } = usePoolTokens(tokenA, tokenB)
  const pools = useV3Pools(token0?.address, token1?.address)
  const all = useAllPools()
  const tvlShare = useMemo(() => {
    const out: Record<number, number> = {}
    if (!token0 || !token1) return out
    const rows = (all.data ?? []).filter(
      (r) => r.version === 'v3' && rowTokenAddress(r.token0) === token0.address.toLowerCase() && rowTokenAddress(r.token1) === token1.address.toLowerCase(),
    )
    const total = rows.reduce((s, r) => s + (r.tvlUsd || 0), 0)
    if (total > 0) for (const r of rows) if (r.fee) out[r.fee] = (r.tvlUsd || 0) / total
    return out
  }, [all.data, token0, token1])
  // Like Uniswap, the tiers show before the pair is complete (every tier reads "Not created").
  if (!token0 || !token1) return <FeeTierSelector value={fee} onChange={onFee} pools={{}} tvlShare={{}} />

  return <FeeTierSelector value={fee} onChange={onFee} pools={pools.data} tvlShare={tvlShare} loading={pools.isLoading} />
}

/* ======================================================================================= V3 */

function V3Deposit({ tokenA, tokenB, fee, account, onConnect, onEdit }: { tokenA: Token; tokenB: Token; fee: number; account?: Address; onConnect: () => void; onEdit: () => void }) {
  const { token0, token1, aIs0 } = usePoolTokens(tokenA, tokenB)
  const spacing = tickSpacingForFee(fee)
  const poolsQ = useV3Pools(token0!.address, token1!.address)
  const pool = poolsQ.data?.[fee]
  const exists = !!pool?.initialized
  const ticksQ = usePoolTicks(exists ? (pool!.address as Address) : undefined)
  const slippageBps = useSlippageBps()
  const deadlineMinutes = useSettings((s) => s.deadlineMinutes)
  const { prices } = useTokenPrices()

  // display orientation: price of tokenA in tokenB by default
  const [invert, setInvert] = useState(!aIs0)
  const [startPrice, setStartPrice] = useState('')
  const startSqrt = useMemo(() => {
    const p = Number(startPrice)
    if (!startPrice || !Number.isFinite(p) || p <= 0) return undefined
    const poolPrice = invert ? 1 / p : p
    return priceToSqrtPriceX96(poolPrice, token0!.decimals, token1!.decimals) ?? undefined
  }, [startPrice, invert, token0, token1])

  const sqrtP = exists ? pool!.sqrtPriceX96 : startSqrt
  const currentTick = exists ? pool!.tick : startSqrt ? getTickAtSqrtRatio(startSqrt) : undefined

  const [range, setRange] = useState<[number, number] | null>(null)
  useEffect(() => {
    if (range || poolsQ.isLoading) return
    if (exists) setRange(rangeAround(pool!.tick, spacing, 10))
    else setRange(fullRangeTicks(spacing))
  }, [range, exists, pool, spacing, poolsQ.isLoading])
  const [tickLower, tickUpper] = range ?? fullRangeTicks(spacing)

  const side = sqrtP ? depositSide(sqrtP, tickLower, tickUpper) : 'both'
  const disabled = useMemo(
    () => ({ A: side === (aIs0 ? 'token1' : 'token0'), B: side === (aIs0 ? 'token0' : 'token1') }),
    [side, aIs0],
  )
  const link: LinkFn = useCallback(
    (s, amount) => {
      if (!sqrtP) return 0n
      const independent = (s === 'A') === aIs0 ? 'token0' : 'token1'
      return dependentAmount(sqrtP, tickLower, tickUpper, independent, amount)
    },
    [sqrtP, tickLower, tickUpper, aIs0],
  )
  const amounts = useLinkedAmounts(tokenA, tokenB, link, disabled)
  const amount0 = aIs0 ? amounts.amountA : amounts.amountB
  const amount1 = aIs0 ? amounts.amountB : amounts.amountA

  const tokens = useMemo(() => [tokenA, tokenB], [tokenA, tokenB])
  const { balances } = useTokenBalances(tokens, account)
  const balA = balances[tokenA.address.toLowerCase()]
  const balB = balances[tokenB.address.toLowerCase()]
  const insufficientA = balA !== undefined && amounts.amountA > balA
  const insufficientB = balB !== undefined && amounts.amountB > balB

  const liquidity = sqrtP ? liquidityForAmounts(sqrtP, getSqrtRatioAtTick(tickLower), getSqrtRatioAtTick(tickUpper), amount0, amount1) : 0n
  const inRange = currentTick !== undefined && currentTick >= tickLower && currentTick < tickUpper
  const poolShare = exists && inRange && liquidity > 0n ? Number(liquidity) / (Number(pool!.liquidity) + Number(liquidity)) : exists ? 0 : 1
  const usd = (priceOf(prices, tokenA) ?? 0) * toNumber(amounts.amountA, tokenA.decimals) + (priceOf(prices, tokenB) ?? 0) * toNumber(amounts.amountB, tokenB.decimals)

  const [review, setReview] = useState(false)
  const runner = useStepRunner()
  const [minted, setMinted] = useState<string | null>(null)

  const cta = !account
    ? { label: 'Connect wallet', action: onConnect, disabled: false }
    : !sqrtP
      ? { label: 'Enter a starting price', disabled: true }
      : amount0 === 0n && amount1 === 0n
        ? { label: 'Enter an amount', disabled: true }
        : insufficientA
          ? { label: `Insufficient ${tokenA.symbol} balance`, disabled: true }
          : insufficientB
            ? { label: `Insufficient ${tokenB.symbol} balance`, disabled: true }
            : liquidity === 0n
              ? { label: 'Amount too small', disabled: true }
              : { label: 'Review', action: () => setReview(true), disabled: false }

  const confirm = () => {
    if (!account || !sqrtP) return
    const npm = contractAddress('NonfungiblePositionManager')
    const out: SentTx = {}
    void runner
      .run(async () => {
        const steps: PlannedStep[] = []
        const pa = await approvalStep(account, tokenA, npm, 'position manager', amounts.amountA)
        const pb = await approvalStep(account, tokenB, npm, 'position manager', amounts.amountB)
        if (pa) steps.push(pa)
        if (pb) steps.push(pb)
        const { amount0Min, amount1Min } = mintAmountsWithSlippage(sqrtP, tickLower, tickUpper, amount0, amount1, slippageBps)
        const ethValue = tokenA.isNative ? amounts.amountA : tokenB.isNative ? amounts.amountB : 0n
        steps.push(
          txStep(
            {
              id: 'mint',
              title: exists ? 'Create position' : 'Create pool and position',
              description: 'Confirm in your wallet',
              account,
              type: 'add-liquidity',
              summary: `Added ${formatTokenAmount(amounts.amountA, tokenA.decimals)} ${tokenA.symbol} and ${formatTokenAmount(amounts.amountB, tokenB.decimals)} ${tokenB.symbol} (V3 ${feeLabel(fee)})`,
              gas: exists ? GAS.mint : GAS.createAndMint,
            },
            () =>
              buildMint({
                npm,
                token0: token0!.address,
                token1: token1!.address,
                fee,
                tickLower,
                tickUpper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min,
                amount1Min,
                recipient: account,
                deadline: deadlineFromNow(deadlineMinutes),
                createPoolSqrtPriceX96: exists ? undefined : sqrtP,
                ethValue,
              }),
            out,
          ),
        )
        return steps
      })
      .then((ok) => {
        if (ok) {
          setMinted(mintedTokenId(out.receipt, npm))
          amounts.reset()
        }
      })
  }

  const base = invert ? token1! : token0!
  const quote = invert ? token0! : token1!

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-3 p-4">
        <DoubleLogo token0={tokenA} token1={tokenB} size={32} />
        <div className="min-w-0 flex-1">
          <div className="text-body-1 font-medium">
            {tokenA.symbol} / {tokenB.symbol}
          </div>
          <div className="flex gap-1.5 text-body-4 text-text-2">
            <span className="rounded-full bg-surface-3 px-2 py-0.5">v3</span>
            <span className="rounded-full bg-surface-3 px-2 py-0.5">{feeLabel(fee)}</span>
            {!poolsQ.isLoading && !exists && <span className="rounded-full bg-warning-tint px-2 py-0.5 text-warning">New pool</span>}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-body-1 font-medium">Set price range</h2>
        {poolsQ.isLoading ? (
          <Skeleton width="100%" height={200} rounded="lg" />
        ) : (
          <>
            {!exists && (
              <div className="flex flex-col gap-2" data-testid="start-price">
                <Banner tone="info" title="Creating a new pool">
                  This pool does not exist yet. Set the starting exchange rate; your deposit then sets the pool price. Check the rate carefully.
                </Banner>
                <label className="flex items-center gap-3 rounded-2xl border border-border p-3">
                  <span className="text-body-3 text-text-2">Starting price</span>
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    value={startPrice}
                    onChange={(e) => {
                      const v = sanitizeAmountInput(e.target.value, 18)
                      if (v !== null) setStartPrice(v)
                    }}
                    data-testid="start-price-input"
                    className="min-w-0 flex-1 bg-transparent text-right text-heading-3 font-medium outline-none tabular"
                  />
                  <span className="shrink-0 text-body-3 text-text-2">
                    {quote.symbol} per {base.symbol}
                  </span>
                </label>
              </div>
            )}
            <RangeSelector
              token0={token0!}
              token1={token1!}
              spacing={spacing}
              currentTick={currentTick}
              tickLower={tickLower}
              tickUpper={tickUpper}
              onChange={(lo, hi) => setRange([lo, hi])}
              invert={invert}
              onInvert={() => setInvert((v) => !v)}
              ticks={ticksQ.data?.ticks}
              ticksLoading={exists && ticksQ.isLoading}
              poolAddress={exists ? (pool!.address ?? undefined) : undefined}
            />
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-body-1 font-medium">Deposit tokens</h2>
        <p className="-mt-2 text-body-3 text-text-2">Specify the token amounts for your liquidity contribution.</p>
        {sqrtP ? (
          <DepositInputs tokenA={tokenA} tokenB={tokenB} amounts={amounts} account={account} disabled={disabled} />
        ) : (
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-body-3 text-text-2">Enter a starting price first.</p>
        )}
        <Button size="xl" fullWidth disabled={cta.disabled} onClick={cta.action} data-testid="create-review">
          {cta.label}
        </Button>
      </Card>

      <TxFlowModal
        open={review}
        onOpenChange={(o) => {
          setReview(o)
          if (!o) setMinted(null)
        }}
        title="Add liquidity"
        runner={runner}
        confirmLabel={exists ? 'Create position' : 'Create pool and position'}
        onConfirm={confirm}
        testId="create-modal"
        success={
          minted ? (
            <ButtonLink to={`/positions/v3/${minted}`} fullWidth data-testid="view-new-position">
              View position #{minted}
            </ButtonLink>
          ) : (
            <ButtonLink to="/positions" fullWidth>
              View positions
            </ButtonLink>
          )
        }
      >
        <div className="flex items-center gap-3">
          <DoubleLogo token0={tokenA} token1={tokenB} size={36} />
          <div>
            <div className="text-body-1 font-medium">
              {tokenA.symbol} / {tokenB.symbol}
            </div>
            <div className="text-body-4 text-text-2">
              v3 · {feeLabel(fee)} · {inRange ? 'In range' : 'Out of range'}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
          <ReviewRow label={tokenA.symbol} testId="review-amount-a">
            {formatTokenAmount(amounts.amountA, tokenA.decimals)}
          </ReviewRow>
          <ReviewRow label={tokenB.symbol} testId="review-amount-b">
            {formatTokenAmount(amounts.amountB, tokenB.decimals)}
          </ReviewRow>
          <ReviewRow label="Value">{formatUsd(usd)}</ReviewRow>
          <ReviewRow label="Min price">
            {formatDisplayPrice(Math.min(...rangeDisplay(tickLower, tickUpper, spacing, token0!, token1!, invert)))} {quote.symbol}/{base.symbol}
          </ReviewRow>
          <ReviewRow label="Max price">
            {formatDisplayPrice(Math.max(...rangeDisplay(tickLower, tickUpper, spacing, token0!, token1!, invert)))} {quote.symbol}/{base.symbol}
          </ReviewRow>
          {currentTick !== undefined && (
            <ReviewRow label={exists ? 'Current price' : 'Starting price'}>
              {formatDisplayPrice(displayAt(currentTick, token0!, token1!, invert))} {quote.symbol}/{base.symbol}
            </ReviewRow>
          )}
          <ReviewRow label="Fee tier">{feeLabel(fee)}</ReviewRow>
          <ReviewRow label="Pool share">{formatPercent(poolShare * 100)}</ReviewRow>
          <ReviewRow label="Slippage">{formatPercent(slippageBps / 100)}</ReviewRow>
        </div>
      </TxFlowModal>
    </div>
  )
}

function displayAt(tick: number, t0: Token, t1: Token, invert: boolean) {
  const p = 1.0001 ** tick * 10 ** (t0.decimals - t1.decimals)
  return invert ? 1 / p : p
}

function rangeDisplay(lo: number, hi: number, spacing: number, t0: Token, t1: Token, invert: boolean): [number, number] {
  const a = lo <= minUsableTick(spacing) ? (invert ? Infinity : 0) : displayAt(lo, t0, t1, invert)
  const b = hi >= maxUsableTick(spacing) ? (invert ? 0 : Infinity) : displayAt(hi, t0, t1, invert)
  return [a, b]
}

/** tokenId of the NFT minted in a receipt (Transfer from 0x0 on the NPM). */
export function mintedTokenId(receipt: TransactionReceipt | null | undefined, npm: Address): string | null {
  if (!receipt) return null
  const logs = parseEventLogs({ abi: nonfungiblePositionManagerAbi, logs: receipt.logs.filter((l) => l.address.toLowerCase() === npm.toLowerCase()), eventName: 'Transfer', strict: false })
  for (const l of logs) {
    const args = l.args as { from?: string; tokenId?: bigint }
    if (args.from && /^0x0+$/.test(args.from) && args.tokenId !== undefined) return args.tokenId.toString()
  }
  return null
}

/* ======================================================================================= V2 */

function V2Deposit({ tokenA, tokenB, account, onConnect, onEdit }: { tokenA: Token; tokenB: Token; account?: Address; onConnect: () => void; onEdit: () => void }) {
  const pa = poolToken(tokenA)
  const pb = poolToken(tokenB)
  const pairQ = useV2Pair(pa.address, pb.address, account)
  const pair = pairQ.data
  const hasReserves = !!pair?.address && pair.reserve0 > 0n && pair.reserve1 > 0n
  const aIs0 = pa.address.toLowerCase() < pb.address.toLowerCase()
  const rA = pair ? (aIs0 ? pair.reserve0 : pair.reserve1) : 0n
  const rB = pair ? (aIs0 ? pair.reserve1 : pair.reserve0) : 0n
  const slippageBps = useSlippageBps()
  const deadlineMinutes = useSettings((s) => s.deadlineMinutes)
  const { prices } = useTokenPrices()

  const link: LinkFn = useCallback(
    (s, amount) => {
      if (!hasReserves) return null
      return s === 'A' ? v2Math.quote(amount, rA, rB) : v2Math.quote(amount, rB, rA)
    },
    [hasReserves, rA, rB],
  )
  const noneDisabled = useMemo(() => ({ A: false, B: false }), [])
  const amounts = useLinkedAmounts(tokenA, tokenB, link, noneDisabled)
  const tokens = useMemo(() => [tokenA, tokenB], [tokenA, tokenB])
  const { balances } = useTokenBalances(tokens, account)
  const balA = balances[tokenA.address.toLowerCase()]
  const balB = balances[tokenB.address.toLowerCase()]

  const a0 = aIs0 ? amounts.amountA : amounts.amountB
  const a1 = aIs0 ? amounts.amountB : amounts.amountA
  const minted = pair && a0 > 0n && a1 > 0n ? v2LiquidityMinted(a0, a1, pair.reserve0, pair.reserve1, hasReserves ? pair.totalSupply : 0n) : 0n
  const share = pair && minted > 0n ? (hasReserves ? Number(minted) / Number(pair.totalSupply + minted) : 1) : 0
  const usd = (priceOf(prices, tokenA) ?? 0) * toNumber(amounts.amountA, tokenA.decimals) + (priceOf(prices, tokenB) ?? 0) * toNumber(amounts.amountB, tokenB.decimals)

  const [review, setReview] = useState(false)
  const runner = useStepRunner()
  const [pairAddr, setPairAddr] = useState<string | null>(null)

  const cta = !account
    ? { label: 'Connect wallet', action: onConnect, disabled: false }
    : amounts.amountA === 0n || amounts.amountB === 0n
      ? { label: 'Enter an amount', disabled: true }
      : balA !== undefined && amounts.amountA > balA
        ? { label: `Insufficient ${tokenA.symbol} balance`, disabled: true }
        : balB !== undefined && amounts.amountB > balB
          ? { label: `Insufficient ${tokenB.symbol} balance`, disabled: true }
          : { label: 'Review', action: () => setReview(true), disabled: false }

  const confirm = () => {
    if (!account) return
    const router = contractAddress('V2Router02')
    const out: SentTx = {}
    void runner
      .run(async () => {
        const steps: PlannedStep[] = []
        const s1 = await approvalStep(account, tokenA, router, 'V2 router', amounts.amountA)
        const s2 = await approvalStep(account, tokenB, router, 'V2 router', amounts.amountB)
        if (s1) steps.push(s1)
        if (s2) steps.push(s2)
        const bps = hasReserves ? slippageBps : 0
        steps.push(
          txStep(
            {
              id: 'add',
              title: hasReserves ? 'Add liquidity' : 'Create pair and add liquidity',
              description: 'Confirm in your wallet',
              account,
              type: 'add-liquidity',
              summary: `Added ${formatTokenAmount(amounts.amountA, tokenA.decimals)} ${tokenA.symbol} and ${formatTokenAmount(amounts.amountB, tokenB.decimals)} ${tokenB.symbol} (V2)`,
              gas: pair?.address ? GAS.v2Add : GAS.v2AddNewPair,
            },
            () =>
              buildV2Add({
                router,
                tokenA: pa.address,
                tokenB: pb.address,
                amountADesired: amounts.amountA,
                amountBDesired: amounts.amountB,
                amountAMin: minusSlippage(amounts.amountA, bps),
                amountBMin: minusSlippage(amounts.amountB, bps),
                to: account,
                deadline: deadlineFromNow(deadlineMinutes),
                nativeSide: tokenA.isNative ? 'A' : tokenB.isNative ? 'B' : undefined,
              }),
            out,
          ),
        )
        return steps
      })
      .then(async (ok) => {
        if (ok) {
          const r = await pairQ.refetch()
          setPairAddr(r.data?.address ?? null)
          amounts.reset()
        }
      })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-3 p-4">
        <DoubleLogo token0={tokenA} token1={tokenB} size={32} />
        <div className="min-w-0 flex-1">
          <div className="text-body-1 font-medium">
            {tokenA.symbol} / {tokenB.symbol}
          </div>
          <div className="flex gap-1.5 text-body-4 text-text-2">
            <span className="rounded-full bg-surface-3 px-2 py-0.5">v2</span>
            <span className="rounded-full bg-surface-3 px-2 py-0.5">0.3%</span>
            {!pairQ.isLoading && !hasReserves && <span className="rounded-full bg-warning-tint px-2 py-0.5 text-warning">New pair</span>}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </Card>
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-body-1 font-medium">Deposit tokens</h2>
        {!pairQ.isLoading && !hasReserves && (
          <Banner tone="info" title="You are the first liquidity provider">
            The ratio of tokens you add sets the price of this pool.
          </Banner>
        )}
        {hasReserves && (
          <div className="flex justify-between text-body-3 text-text-2">
            <span>Pool price</span>
            <span className="tabular">
              1 {tokenA.symbol} = {formatDisplayPrice(toNumber(rB, tokenB.decimals) / toNumber(rA, tokenA.decimals))} {tokenB.symbol}
            </span>
          </div>
        )}
        <DepositInputs tokenA={tokenA} tokenB={tokenB} amounts={amounts} account={account} disabled={noneDisabled} />
        <Button size="xl" fullWidth disabled={cta.disabled} onClick={cta.action} data-testid="create-review">
          {cta.label}
        </Button>
      </Card>
      <TxFlowModal
        open={review}
        onOpenChange={setReview}
        title="Add V2 liquidity"
        runner={runner}
        confirmLabel={hasReserves ? 'Add liquidity' : 'Create pair'}
        onConfirm={confirm}
        testId="create-modal"
        success={
          <ButtonLink to={pairAddr ? `/positions/v2/${pairAddr}` : '/positions'} fullWidth data-testid="view-new-position">
            View position
          </ButtonLink>
        }
      >
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
          <ReviewRow label={tokenA.symbol} testId="review-amount-a">
            {formatTokenAmount(amounts.amountA, tokenA.decimals)}
          </ReviewRow>
          <ReviewRow label={tokenB.symbol} testId="review-amount-b">
            {formatTokenAmount(amounts.amountB, tokenB.decimals)}
          </ReviewRow>
          <ReviewRow label="Value">{formatUsd(usd)}</ReviewRow>
          <ReviewRow label="LP tokens (est.)">{formatTokenAmount(minted, 18)}</ReviewRow>
          <ReviewRow label="Pool share">{formatPercent(share * 100)}</ReviewRow>
          <ReviewRow label="Slippage">{formatPercent((hasReserves ? slippageBps : 0) / 100)}</ReviewRow>
        </div>
      </TxFlowModal>
    </div>
  )
}
