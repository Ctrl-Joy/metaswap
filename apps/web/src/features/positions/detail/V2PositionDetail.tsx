import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronLeft, Minus, Plus } from 'lucide-react'
import { isAddress, parseSignature, type Address, type Hex } from 'viem'
import { readContract, signTypedData } from 'wagmi/actions'
import { v2PairAbi } from '@metaswap/sdk/abis'
import { Banner, Button, ButtonLink, Card, DoubleLogo, EmptyState, Skeleton, Switch, TokenLogo } from '@/components/ui'
import { useTokenList, useTokenPrices, priceOf } from '@/features/tokens/useTokenList'
import { useWallet } from '@/wallet/hooks'
import { useUi } from '@/state/ui'
import { useSettings, useSlippageBps } from '@/state/settings'
import { wagmiConfig } from '@/wallet/wagmi'
import { formatPercent, formatTokenAmount, formatUsd } from '@/lib/format'
import { toNumber } from '@/lib/amount'
import { CHAIN_SLUG, DEVNET_CHAIN_ID } from '@/config'
import { contractAddress, isWeth, type Token } from '../tokens'
import { useV2PairByAddress, type V2PairState } from '../chain'
import { minusSlippage, percentOf, v2AmountsForLiquidity } from '../math'
import { buildV2Remove, deadlineFromNow, v2PermitTypedData, type PermitSig } from '../encode'
import { approvalStep, GAS, txStep, useStepRunner, type PlannedStep, type SentTx } from '../execute'
import { StatusBadge } from '../components/StatusBadge'
import { ReviewRow, TxFlowModal } from '../components/TxFlowModal'
import { PercentPicker } from '../components/PercentPicker'
import { MigrateV2Modal } from './MigrateV2Modal'

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

export function V2PositionDetail({ pairParam }: { pairParam: string | undefined }) {
  const pair = pairParam && isAddress(pairParam) ? (pairParam as Address) : undefined
  const { address } = useWallet()
  const q = useV2PairByAddress(pair, address)
  const { find } = useTokenList()
  const t0 = q.data ? find(q.data.token0) : undefined
  const t1 = q.data ? find(q.data.token1) : undefined
  if (!pair)
    return (
      <Shell>
        <Card>
          <EmptyState title="Invalid pair address" action={<ButtonLink to="/positions">Back to positions</ButtonLink>} />
        </Card>
      </Shell>
    )
  if (q.isLoading || (q.data && (!t0 || !t1)))
    return (
      <Shell>
        <Skeleton width={320} height={40} rounded="lg" />
        <Skeleton className="mt-6" width="100%" height={260} rounded="lg" />
      </Shell>
    )
  if (q.isError || !q.data || !t0 || !t1)
    return (
      <Shell>
        <Card>
          <EmptyState title="Pair not found" action={<ButtonLink to="/positions">Back to positions</ButtonLink>}>
            {pair} is not a MetaSwap V2 pair on MetaChain Devnet.
          </EmptyState>
        </Card>
      </Shell>
    )
  return <Loaded state={q.data} t0={t0} t1={t1} account={address} />
}

function Loaded({ state, t0, t1, account }: { state: V2PairState; t0: Token; t1: Token; account?: Address }) {
  const openConnect = useUi((s) => s.openConnect)
  const { prices } = useTokenPrices()
  const [removeOpen, setRemoveOpen] = useState(false)
  const [migrateOpen, setMigrateOpen] = useState(false)
  const { amount0, amount1 } = v2AmountsForLiquidity(state.balance, state.reserve0, state.reserve1, state.totalSupply)
  const share = state.totalSupply > 0n ? Number(state.balance) / Number(state.totalSupply) : 0
  const usd0 = toNumber(amount0, t0.decimals) * (priceOf(prices, t0) ?? 0)
  const usd1 = toNumber(amount1, t1.decimals) * (priceOf(prices, t1) ?? 0)
  const closed = state.balance === 0n
  const addHref = `/positions/create?currencyA=${isWeth(t0.address) ? 'ETH' : t0.address}&currencyB=${isWeth(t1.address) ? 'ETH' : t1.address}&version=v2`

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
              <span className="rounded-full bg-surface-3 px-2 py-0.5 font-semibold text-text-2">v2</span>
              <span className="rounded-full bg-surface-3 px-2 py-0.5 font-semibold text-text-2">0.3%</span>
              <StatusBadge status={closed ? 'closed' : 'in-range'} testId="position-status" />
            </div>
          </div>
        </div>
        {account ? (
          <div className="flex flex-wrap gap-2">
            <ButtonLink to={addHref} variant="secondary" data-testid="action-add">
              <Plus size={16} /> Add liquidity
            </ButtonLink>
            <Button variant="secondary" leftIcon={<Minus size={16} />} disabled={closed} onClick={() => setRemoveOpen(true)} data-testid="action-remove">
              Remove liquidity
            </Button>
            <Button variant="tint" leftIcon={<ArrowUpRight size={16} />} disabled={closed} onClick={() => setMigrateOpen(true)} data-testid="action-migrate">
              Migrate to V3
            </Button>
          </div>
        ) : (
          <Button onClick={openConnect}>Connect wallet</Button>
        )}
      </div>
      {account && closed && (
        <Banner tone="info" className="mt-4" title="No liquidity">
          This wallet has no LP tokens in this pair.
        </Banner>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <div className="text-body-3 text-text-2">Liquidity</div>
          <div className="mt-1 text-heading-2 font-medium tabular" data-testid="position-value">
            {formatUsd(usd0 + usd1)}
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <Row token={t0} amount={amount0} usd={usd0} testId="pooled-token0" />
            <Row token={t1} amount={amount1} usd={usd1} testId="pooled-token1" />
          </div>
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <ReviewRow label="LP tokens" testId="lp-balance">
            {formatTokenAmount(state.balance, 18)} MS-V2
          </ReviewRow>
          <ReviewRow label="Pool share" testId="pool-share">
            {formatPercent(share * 100, { digits: share < 0.0001 && share > 0 ? 4 : 2 })}
          </ReviewRow>
          <ReviewRow label="Pool reserves">
            {formatTokenAmount(state.reserve0, t0.decimals)} {t0.symbol} · {formatTokenAmount(state.reserve1, t1.decimals)} {t1.symbol}
          </ReviewRow>
          <ReviewRow label="Fees">Earned fees are added to the pool and included in your share.</ReviewRow>
          <Link to={`/explore/pools/${CHAIN_SLUG}/${state.address}`} className="text-body-3 font-semibold text-accent hover:underline">
            View pool
          </Link>
        </Card>
      </div>
      {account && <RemoveV2Modal open={removeOpen} onOpenChange={setRemoveOpen} state={state} t0={t0} t1={t1} account={account} />}
      {account && (!closed || migrateOpen) && <MigrateV2Modal open={migrateOpen} onOpenChange={setMigrateOpen} state={state} t0={t0} t1={t1} account={account} />}
    </Shell>
  )
}

function Row({ token, amount, usd, testId }: { token: Token; amount: bigint; usd: number; testId: string }) {
  return (
    <div className="flex items-center gap-3" data-testid={testId} data-amount={amount.toString()}>
      <TokenLogo token={token} size={24} />
      <span className="flex-1 text-body-2">{token.symbol}</span>
      <span className="text-right">
        <span className="block text-body-2 font-medium tabular">{formatTokenAmount(amount, token.decimals)}</span>
        <span className="block text-body-4 text-text-2 tabular">{formatUsd(usd)}</span>
      </span>
    </div>
  )
}

function RemoveV2Modal({ open, onOpenChange, state, t0, t1, account }: { open: boolean; onOpenChange: (o: boolean) => void; state: V2PairState; t0: Token; t1: Token; account: Address }) {
  const runner = useStepRunner()
  const slippageBps = useSlippageBps()
  const deadlineMinutes = useSettings((s) => s.deadlineMinutes)
  const [pct, setPct] = useState(50)
  const [usePermit, setUsePermit] = useState(true)
  const wethSide = isWeth(t0.address) ? 'A' : isWeth(t1.address) ? 'B' : undefined
  const [receiveEth, setReceiveEth] = useState(true)
  const liquidity = percentOf(state.balance, pct)
  const { amount0, amount1 } = v2AmountsForLiquidity(liquidity, state.reserve0, state.reserve1, state.totalSupply)
  const sym = (t: Token, side: 'A' | 'B') => (receiveEth && wethSide === side ? 'ETH' : t.symbol)
  const pairAddr = state.address!

  const confirm = () => {
    const router = contractAddress('V2Router02')
    const deadline = deadlineFromNow(deadlineMinutes)
    const out: SentTx = {}
    let permit: PermitSig | undefined
    void runner.run(async () => {
      const steps: PlannedStep[] = []
      if (usePermit) {
        const allowance = await readContract(wagmiConfig, { address: pairAddr, abi: v2PairAbi, functionName: 'allowance', args: [account, router] })
        if (allowance < liquidity)
          steps.push({
            id: 'permit',
            title: 'Sign LP token permit',
            description: 'Gasless signature allowing the router to use your LP tokens',
            run: async () => {
              const [nonce, name] = await Promise.all([
                readContract(wagmiConfig, { address: pairAddr, abi: v2PairAbi, functionName: 'nonces', args: [account] }),
                readContract(wagmiConfig, { address: pairAddr, abi: v2PairAbi, functionName: 'name' }),
              ])
              const td = v2PermitTypedData({ pair: pairAddr, chainId: DEVNET_CHAIN_ID, owner: account, spender: router, value: liquidity, nonce, deadline, name })
              const sig: Hex = await signTypedData(wagmiConfig, td)
              const p = parseSignature(sig)
              permit = { v: Number(p.v ?? BigInt((p.yParity ?? 0) + 27)), r: p.r, s: p.s, approveMax: false }
            },
          })
      } else {
        const lpToken: Token = { chainId: DEVNET_CHAIN_ID, address: pairAddr, symbol: 'MS-V2', name: 'MetaSwap V2', decimals: 18, logoURI: '' }
        const a = await approvalStep(account, lpToken, router, 'V2 router', liquidity)
        if (a) steps.push(a)
      }
      steps.push(
        txStep(
          {
            id: 'remove',
            title: 'Remove liquidity',
            description: 'Confirm in your wallet',
            account,
            type: 'remove-liquidity',
            summary: `Removed ${formatTokenAmount(amount0, t0.decimals)} ${sym(t0, 'A')} and ${formatTokenAmount(amount1, t1.decimals)} ${sym(t1, 'B')} (V2)`,
            gas: GAS.v2Remove,
          },
          () =>
            buildV2Remove({
              router,
              tokenA: t0.address,
              tokenB: t1.address,
              liquidity,
              amountAMin: minusSlippage(amount0, slippageBps),
              amountBMin: minusSlippage(amount1, slippageBps),
              to: account,
              deadline,
              nativeSide: receiveEth ? wethSide : undefined,
              permit,
            }),
          out,
        ),
      )
      return steps
    })
  }

  return (
    <TxFlowModal open={open} onOpenChange={onOpenChange} title="Remove V2 liquidity" runner={runner} confirmLabel="Remove" confirmDisabled={liquidity === 0n} onConfirm={confirm} testId="remove-modal">
      <PercentPicker value={pct} onChange={setPct} />
      <div className="flex flex-col gap-2 rounded-[20px] bg-surface-2 p-4">
        <ReviewRow label={sym(t0, 'A')} testId="remove-amount0">
          {formatTokenAmount(amount0, t0.decimals)}
        </ReviewRow>
        <ReviewRow label={sym(t1, 'B')} testId="remove-amount1">
          {formatTokenAmount(amount1, t1.decimals)}
        </ReviewRow>
        <ReviewRow label="LP tokens burned">{formatTokenAmount(liquidity, 18)}</ReviewRow>
      </div>
      {wethSide && (
        <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-body-3">
          <span>Receive ETH (unwrap WETH)</span>
          <Switch checked={receiveEth} onChange={setReceiveEth} label="Receive ETH" testId="eth-toggle" />
        </label>
      )}
      <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-body-3">
        <span>Approve with a signature (permit)</span>
        <Switch checked={usePermit} onChange={setUsePermit} label="Use permit signature" testId="permit-toggle" />
      </label>
    </TxFlowModal>
  )
}
