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

type RangeChoice = 'full' | RangeStrategy

const RANGE_ITEMS: Array<{ value: RangeChoice; label: string }> = [
  { value: 'full', label: 'Full range' },
  { value: 'wide', label: 'Wide' },
  { value: 'stable', label: 'Stable' },
  { value: 'lower', label: 'Lower' },
  { value: 'upper', label: 'Upper' },
]

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
            title: 'Withdraw V2 liquidity',
            description: 'Remove the LP tokens from the V2 pair',
            account,
            type: 'remove-liquidity',
            summary: `Withdrew ${formatTokenAmount(plan.amount0, t0.decimals)} ${t0.symbol} and ${formatTokenAmount(plan.amount1, t1.decimals)} ${t1.symbol} to migrate`,
            gas: GAS.v2Remove,
          },
          () => buildV2Remove({ router, tokenA: t0.address, tokenB: t1.address, liquidity, amountAMin: plan.removeMin0, amountBMin: plan.removeMin1, to: account, deadline }),
          removeOut,
        ),
      )
      // Approvals for the mint are checked after the withdrawal so they never block it.
      steps.push({
        id: 'migrate-approve',
        title: 'Approve tokens for V3',
        description: `Allow the position manager to use ${t0.symbol} and ${t1.symbol}`,
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
            title: exists ? 'Create V3 position' : 'Create V3 pool and position',
            description: `${feeLabel(fee)} tier, ${range === 'full' ? 'full range' : 'custom range'}`,
            account,
            type: 'add-liquidity',
            summary: `Migrated ${t0.symbol}/${t1.symbol} liquidity to V3 (${feeLabel(fee)})`,
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
      title="Migrate to V3"
      runner={runner}
      confirmLabel={liquidity === 0n ? 'Nothing to migrate' : 'Migrate'}
      confirmDisabled={!plan || liquidity === 0n || pools.isLoading}
      onConfirm={confirm}
      testId="migrate-modal"
      success={
        <Link to="/positions?status=all" className="text-body-3 font-semibold text-accent hover:underline" data-testid="migrate-view-positions">
          View your positions
        </Link>
      }
    >
      <PercentPicker value={pct} onChange={setPct} />
      <section className="flex flex-col gap-2">
        <span className="text-body-3 font-semibold">Fee tier</span>
        <SegmentedTabs
          size="sm"
          ariaLabel="V3 fee tier"
          value={String(fee)}
          onChange={(v) => setFee(Number(v))}
          items={FEE_TIER_LIST.map((t) => ({ value: String(t.fee), label: `${feeLabel(t.fee)}${pools.data?.[t.fee]?.initialized ? '' : ' · new'}`, testId: `migrate-fee-${t.fee}` }))}
        />
      </section>
      <section className="flex flex-col gap-2">
        <span className="text-body-3 font-semibold">Price range</span>
        <SegmentedTabs size="sm" ariaLabel="Price range" value={range} onChange={setRange} items={RANGE_ITEMS.map((r) => ({ ...r, testId: `migrate-range-${r.value}` }))} />
        <div className="text-body-4 text-text-2 tabular" data-testid="migrate-range-prices">
          {priceText(tickLower)} – {priceText(tickUpper)} {t1.symbol} per {t0.symbol}
        </div>
      </section>
      {!exists && !pools.isLoading && (
        <Banner tone="info" title="New V3 pool">
          No {feeLabel(fee)} V3 pool exists for this pair yet. It is created at the V2 price.
        </Banner>
      )}
      {gapPct > 2 && (
        <Banner tone="warning" title="Price difference">
          The V3 pool price is {gapPct.toFixed(1)}% away from the V2 price. Migrating moves value at the V3 price.
        </Banner>
      )}
      {plan && (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4" data-testid="migrate-summary">
          <ReviewRow label={`${t0.symbol} from V2`} testId="migrate-amount0">
            {formatTokenAmount(plan.amount0, t0.decimals)}
          </ReviewRow>
          <ReviewRow label={`${t1.symbol} from V2`} testId="migrate-amount1">
            {formatTokenAmount(plan.amount1, t1.decimals)}
          </ReviewRow>
          <ReviewRow label="Into V3 (est.)">
            {formatTokenAmount(plan.used0, t0.decimals)} {t0.symbol} · {formatTokenAmount(plan.used1, t1.decimals)} {t1.symbol}
          </ReviewRow>
          <ReviewRow label="Stays in wallet (est.)" testId="migrate-left">
            {formatTokenAmount(plan.left0, t0.decimals)} {t0.symbol} · {formatTokenAmount(plan.left1, t1.decimals)} {t1.symbol}
          </ReviewRow>
        </div>
      )}
    </TxFlowModal>
  )
}
