import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Address } from 'viem'
import { Banner, SegmentedTabs } from '@/components/ui'
import { useSettings, useSlippageBps } from '@/state/settings'
import { formatTokenAmount } from '@/lib/format'
import { DEVNET_CHAIN_ID } from '@/config'
import { contractAddress, FEE_TIER_LIST, feeLabel, type Token } from '../tokens'
import { useV3Pools, type V2PairState } from '../chain'
import { fullRangeTicks, getTickAtSqrtRatio, percentOf, strategyTicks, tickSpacingForFee, tickToDisplayPrice, type RangeStrategy } from '../math'
import { buildMint, buildV2Remove, deadlineFromNow } from '../encode'
import { approvalStep, GAS, txStep, useStepRunner, type PlannedStep, type SentTx } from '../execute'
import { planMigration, v2SqrtPrice } from '../migrate'
import { PercentPicker } from '../components/PercentPicker'
import { ReviewRow, TxFlowModal } from '../components/TxFlowModal'
import { formatDisplayPrice } from '../components/RangeSelector'
import { t } from '@/i18n'

type RangeChoice = 'full' | RangeStrategy

const RANGE_CHOICES: RangeChoice[] = ['full', 'wide', 'stable', 'lower', 'upper']

function rangeLabel(r: RangeChoice): string {
  switch (r) {
    case 'full':
      return t('Full range')
    case 'wide':
      return t('Wide')
    case 'stable':
      return t('Stable')
    case 'lower':
      return t('Lower')
    case 'upper':
      return t('Upper')
  }
}

/**
 * Migrate V2 liquidity to a V3 position (Uniswap's "Migrate" on v2 positions): remove the chosen share of
 * LP tokens through the V2 router, then mint a V3 position (creating the pool at the V2 price if needed)
 * through NonfungiblePositionManager.multicall. Tokens the new range does not use stay in the wallet.
 */
export function MigrateV2Modal({ open, onOpenChange, state, t0, t1, account }: { open: boolean; onOpenChange: (o: boolean) => void; state: V2PairState; t0: Token; t1: Token; account: Address }) {
  const runner = useStepRunner()
  const slippageBps = useSlippageBps()
  const deadlineMinutes = useSettings((s) => s.deadlineMinutes)
  const [pct, setPct] = useState(100)
  const [fee, setFee] = useState(3000)
  const [range, setRange] = useState<RangeChoice>('full')
  const pools = useV3Pools(t0.address, t1.address)
  const target = pools.data?.[fee]
  const exists = !!target?.initialized
  const spacing = tickSpacingForFee(fee)
  const liquidity = percentOf(state.balance, pct)

  const v2Sqrt = v2SqrtPrice(state.reserve0, state.reserve1, t0.decimals, t1.decimals)
  const currentTick = exists ? target!.tick : v2Sqrt ? getTickAtSqrtRatio(v2Sqrt) : undefined
  const [tickLower, tickUpper] = useMemo<[number, number]>(() => {
    if (range === 'full' || currentTick === undefined) return fullRangeTicks(spacing)
    return strategyTicks(range, currentTick, spacing)
  }, [range, currentTick, spacing])

  const plan = useMemo(
    () =>
      planMigration({
        liquidity,
        reserve0: state.reserve0,
        reserve1: state.reserve1,
        totalSupply: state.totalSupply,
        decimals0: t0.decimals,
        decimals1: t1.decimals,
        poolSqrtPriceX96: exists ? target!.sqrtPriceX96 : undefined,
        tickLower,
        tickUpper,
        slippageBps,
      }),
    [liquidity, state, t0.decimals, t1.decimals, exists, target, tickLower, tickUpper, slippageBps],
  )

  // Price gap between the V2 pair and an existing V3 pool: migrating into a pool far from the V2 price loses value.
  const v2Price = currentTick !== undefined && v2Sqrt ? tickToDisplayPrice(getTickAtSqrtRatio(v2Sqrt), t0.decimals, t1.decimals, false) : undefined
  const v3Price = exists ? tickToDisplayPrice(target!.tick, t0.decimals, t1.decimals, false) : undefined
  const gapPct = v2Price && v3Price ? Math.abs(v3Price / v2Price - 1) * 100 : 0

  const confirm = () => {
    if (!plan) return
    const router = contractAddress('V2Router02')
    const npm = contractAddress('NonfungiblePositionManager')
    const deadline = deadlineFromNow(deadlineMinutes)
    const removeOut: SentTx = {}
    const mintOut: SentTx = {}
    void runner.run(async () => {
      const steps: PlannedStep[] = []
      const lpToken: Token = { chainId: DEVNET_CHAIN_ID, address: state.address!, symbol: 'MS-V2', name: 'MetaSwap V2', decimals: 18, logoURI: '' }
      const a = await approvalStep(account, lpToken, router, 'V2 router', liquidity)
      if (a) steps.push(a)
      steps.push(
        txStep(
          {
            id: 'migrate-remove',
            title: t('Withdraw V2 liquidity'),
            description: t('Remove the LP tokens from the V2 pair'),
            account,
            type: 'remove-liquidity',
            summary: t('Withdrew {amount0} {symbol0} and {amount1} {symbol1} to migrate', { amount0: formatTokenAmount(plan.amount0, t0.decimals), symbol0: t0.symbol, amount1: formatTokenAmount(plan.amount1, t1.decimals), symbol1: t1.symbol }),
            gas: GAS.v2Remove,
          },
          () => buildV2Remove({ router, tokenA: t0.address, tokenB: t1.address, liquidity, amountAMin: plan.removeMin0, amountBMin: plan.removeMin1, to: account, deadline }),
          removeOut,
        ),
      )
      // Approvals for the mint are checked after the withdrawal so they never block it.
      steps.push({
        id: 'migrate-approve',
        title: t('Approve tokens for V3'),
        description: t('Allow the position manager to use {symbol0} and {symbol1}', { symbol0: t0.symbol, symbol1: t1.symbol }),
        run: async () => {
          for (const [t, amt] of [
            [t0, plan.amount0Desired],
            [t1, plan.amount1Desired],
          ] as const) {
            const s = await approvalStep(account, t, npm, 'position manager', amt)
            if (s) await s.run()
          }
        },
      })
      steps.push(
        txStep(
          {
            id: 'migrate-mint',
            title: exists ? t('Create V3 position') : t('Create V3 pool and position'),
            description: range === 'full' ? t('{fee} tier, full range', { fee: feeLabel(fee) }) : t('{fee} tier, custom range', { fee: feeLabel(fee) }),
            account,
            type: 'add-liquidity',
            summary: t('Migrated {symbol0}/{symbol1} liquidity to V3 ({fee})', { symbol0: t0.symbol, symbol1: t1.symbol, fee: feeLabel(fee) }),
            gas: exists ? GAS.mint : GAS.createAndMint,
          },
          () =>
            buildMint({
              npm,
              token0: t0.address,
              token1: t1.address,
              fee,
              tickLower,
              tickUpper,
              amount0Desired: plan.amount0Desired,
              amount1Desired: plan.amount1Desired,
              amount0Min: plan.amount0Min,
              amount1Min: plan.amount1Min,
              recipient: account,
              deadline,
              createPoolSqrtPriceX96: plan.createPoolSqrtPriceX96,
            }),
          mintOut,
        ),
      )
      return steps
    })
  }

  const priceText = (t: number) => (t <= -887_000 ? '0' : t >= 887_000 ? '∞' : formatDisplayPrice(tickToDisplayPrice(t, t0.decimals, t1.decimals, false)))

  return (
    <TxFlowModal
      open={open}
      onOpenChange={onOpenChange}
      title={t('Migrate to V3')}
      runner={runner}
      confirmLabel={liquidity === 0n ? t('Nothing to migrate') : t('Migrate')}
      confirmDisabled={!plan || liquidity === 0n || pools.isLoading}
      onConfirm={confirm}
      testId="migrate-modal"
      success={
        <Link to="/positions?status=all" className="text-body-3 font-semibold text-accent hover:underline" data-testid="migrate-view-positions">
          {t('View your positions')}
        </Link>
      }
    >
      <PercentPicker value={pct} onChange={setPct} />
      <section className="flex flex-col gap-2">
        <span className="text-body-3 font-semibold">{t('Fee tier')}</span>
        <SegmentedTabs
          size="sm"
          ariaLabel={t('V3 fee tier')}
          value={String(fee)}
          onChange={(v) => setFee(Number(v))}
          items={FEE_TIER_LIST.map((tier) => ({ value: String(tier.fee), label: pools.data?.[tier.fee]?.initialized ? feeLabel(tier.fee) : t('{fee} · new', { fee: feeLabel(tier.fee) }), testId: `migrate-fee-${tier.fee}` }))}
        />
      </section>
      <section className="flex flex-col gap-2">
        <span className="text-body-3 font-semibold">{t('Price range')}</span>
        <SegmentedTabs size="sm" ariaLabel={t('Price range')} value={range} onChange={setRange} items={RANGE_CHOICES.map((r) => ({ value: r, label: rangeLabel(r), testId: `migrate-range-${r}` }))} />
        <div className="text-body-4 text-text-2 tabular" data-testid="migrate-range-prices">
          {priceText(tickLower)} – {priceText(tickUpper)} {t('{quote} per {base}', { quote: t1.symbol, base: t0.symbol })}
        </div>
      </section>
      {!exists && !pools.isLoading && (
        <Banner tone="info" title={t('New V3 pool')}>
          {t('No {fee} V3 pool exists for this pair yet. It is created at the V2 price.', { fee: feeLabel(fee) })}
        </Banner>
      )}
      {gapPct > 2 && (
        <Banner tone="warning" title={t('Price difference')}>
          {t('The V3 pool price is {pct}% away from the V2 price. Migrating moves value at the V3 price.', { pct: gapPct.toFixed(1) })}
        </Banner>
      )}
      {plan && (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4" data-testid="migrate-summary">
          <ReviewRow label={t('{symbol} from V2', { symbol: t0.symbol })} testId="migrate-amount0">
            {formatTokenAmount(plan.amount0, t0.decimals)}
          </ReviewRow>
          <ReviewRow label={t('{symbol} from V2', { symbol: t1.symbol })} testId="migrate-amount1">
            {formatTokenAmount(plan.amount1, t1.decimals)}
          </ReviewRow>
          <ReviewRow label={t('Into V3 (est.)')}>
            {formatTokenAmount(plan.used0, t0.decimals)} {t0.symbol} · {formatTokenAmount(plan.used1, t1.decimals)} {t1.symbol}
          </ReviewRow>
          <ReviewRow label={t('Stays in wallet (est.)')} testId="migrate-left">
            {formatTokenAmount(plan.left0, t0.decimals)} {t0.symbol} · {formatTokenAmount(plan.left1, t1.decimals)} {t1.symbol}
          </ReviewRow>
        </div>
      )}
    </TxFlowModal>
  )
}
