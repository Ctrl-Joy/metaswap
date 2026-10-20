import { useEffect, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { NATIVE_ETH } from '@metaswap/sdk'
import { Banner, Button, Modal, SegmentedTabs, TokenLogo } from '@/components/ui'
import type { EarnVault } from '@/api/types'
import { cn } from '@/lib/cn'
import { maxSpendable, parseAmount, sanitizeAmountInput, toInputString, toNumber } from '@/lib/amount'
import { formatTokenAmount, formatUsd } from '@/lib/format'
import { parseTxError, type FriendlyError } from '@/lib/errors'
import { useWallet } from '@/wallet/hooks'
import { useUi } from '@/state/ui'
import { useTokenPrices } from '@/features/tokens/useTokenList'
import { StepList, type StepView } from '@/features/swap/StepList'
import { depositToVault, withdrawFromVault, type EarnStep } from './executeEarn'
import { isEthVault, useVaultAssetToken, useVaultChain } from './useVault'

export type EarnMode = 'deposit' | 'withdraw'

/** Deposit / withdraw for a MetaSwap savings vault. The ETH vault takes native ETH (depositETH/withdrawETH) or WETH. */
export function EarnModal({ vault, open, onOpenChange, initialMode = 'deposit' }: { vault: EarnVault; open: boolean; onOpenChange: (o: boolean) => void; initialMode?: EarnMode }) {
  const { address, wrongNetwork } = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const { asset } = useVaultAssetToken(vault)
  const ethVault = isEthVault(vault)
  const [mode, setMode] = useState<EarnMode>(initialMode)
  const [useEth, setUseEth] = useState(ethVault)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'form' | 'running' | 'done' | 'error'>('form')
  const [steps, setSteps] = useState<Partial<Record<EarnStep, StepView['status']>>>({})
  const [err, setErr] = useState<FriendlyError | null>(null)
  const [maxed, setMaxed] = useState(false)
  const chain = useVaultChain(vault.address, vault.asset.address, address)
  const { prices } = useTokenPrices()

  useEffect(() => {
    if (open) {
      setMode(initialMode)
      setText('')
      setPhase('form')
      setSteps({})
      setErr(null)
      setMaxed(false)
      setUseEth(ethVault)
    }
  }, [open, initialMode, ethVault])

  const token = useEth ? NATIVE_ETH : asset
  const decimals = vault.asset.decimals
  const amount = parseAmount(text, decimals)
  const s = chain.data
  const walletBal = s ? (useEth ? maxSpendable(s.ethBalance, true) : s.assetBalance) : undefined
  const limit = mode === 'deposit' ? walletBal : s?.maxWithdraw
  const price = prices[vault.asset.address.toLowerCase()]
  const sym = token?.symbol ?? vault.asset.symbol
  const label = amount ? `${formatTokenAmount(amount, decimals)} ${sym}` : ''

  let cta: { text: string; disabled: boolean; onClick?: () => void }
  if (!address) cta = { text: 'Connect wallet', disabled: false, onClick: openConnect }
  else if (wrongNetwork) cta = { text: 'Switch to MetaChain Devnet', disabled: true }
  else if (!amount) cta = { text: 'Enter an amount', disabled: true }
  else if (limit !== undefined && amount > limit && !(mode === 'withdraw' && maxed)) cta = { text: mode === 'deposit' ? `Insufficient ${sym} balance` : 'Exceeds your deposit', disabled: true }
  else cta = { text: mode === 'deposit' ? (!useEth && s && s.allowance < amount ? `Approve and deposit` : 'Deposit') : 'Withdraw', disabled: false, onClick: () => void run() }

  async function run() {
    if (!address || !amount) return
    setPhase('running')
    setErr(null)
    let current: EarnStep | undefined
    const onStep = (id: EarnStep, st: 'active' | 'done' | 'skipped') => {
      if (st === 'active') current = id
      setSteps((x) => ({ ...x, [id]: st }))
    }
    try {
      if (mode === 'deposit') await depositToVault({ account: address, vault: vault.address, asset: vault.asset.address, amount, native: useEth, label: `${label} into ${vault.symbol}` }, onStep)
      else await withdrawFromVault({ account: address, vault: vault.address, amount, all: maxed, shares: s?.shares ?? 0n, native: useEth, label: `${label} from ${vault.symbol}` }, onStep)
      setPhase('done')
      void chain.refetch()
    } catch (e) {
      const fe = parseTxError(e)
      if (current) setSteps((x) => ({ ...x, [current!]: fe.kind === 'rejected' ? 'idle' : 'error' }))
      setErr(fe)
      setPhase(fe.kind === 'rejected' ? 'form' : 'error')
    }
  }

  const stepViews: StepView[] =
    mode === 'deposit'
      ? [
          { id: 'approve', title: `Approve ${vault.asset.symbol}`, description: 'One-time approval for this vault', status: steps.approve ?? 'idle' },
          { id: 'deposit', title: `Deposit ${sym}`, description: 'Confirm in your wallet', status: steps.deposit ?? 'idle' },
        ]
      : [{ id: 'withdraw', title: `Withdraw ${sym}`, description: 'Confirm in your wallet', status: steps.withdraw ?? 'idle' }]

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={vault.name ?? vault.symbol} width={440} dismissible={phase !== 'running'} testId="earn-modal">
      {phase === 'done' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid="earn-success">
          <CircleCheck size={56} className="text-success" />
          <div className="text-heading-3 font-semibold">{mode === 'deposit' ? 'Deposited!' : 'Withdrawn!'}</div>
          <p className="text-body-3 text-text-2">{mode === 'deposit' ? `${label} is now earning ${vault.apyPct.toFixed(2)}% APY.` : `${label} is back in your wallet.`}</p>
          <Button fullWidth size="lg" onClick={() => onOpenChange(false)} data-testid="earn-close">
            Close
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <SegmentedTabs
            value={mode}
            onChange={(m) => {
              setMode(m)
              setText('')
              setMaxed(false)
            }}
            items={[
              { value: 'deposit', label: 'Deposit', testId: 'earn-tab-deposit' },
              { value: 'withdraw', label: 'Withdraw', testId: 'earn-tab-withdraw' },
            ]}
          />
          {ethVault && (
            <div className="flex items-center gap-2 text-body-3 text-text-2">
              {mode === 'deposit' ? 'Pay with' : 'Receive as'}
              {(['ETH', 'WETH'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setUseEth(k === 'ETH')}
                  data-testid={`earn-asset-${k}`}
                  className={cn('rounded-full px-3 py-1 font-semibold transition-colors', (k === 'ETH') === useEth ? 'bg-surface-3 text-text-1' : 'hover:text-text-1')}
                >
                  {k}
                </button>
              ))}
            </div>
          )}
          <div className="rounded-2xl border border-border bg-surface-1 p-4">
            <div className="text-body-3 text-text-2">{mode === 'deposit' ? 'You deposit' : 'You withdraw'}</div>
            <div className="mt-2 flex items-center gap-3">
              <input
                inputMode="decimal"
                placeholder="0"
                aria-label="Amount"
                data-testid="earn-amount"
                value={text}
                onChange={(e) => {
                  const v = sanitizeAmountInput(e.target.value, decimals)
                  if (v !== null) {
                    setText(v)
                    setMaxed(false)
                  }
                }}
                className="h-11 min-w-0 flex-1 bg-transparent text-[36px] leading-[44px] font-medium outline-none tabular"
              />
              <span className="flex shrink-0 items-center gap-2 font-semibold">
                <TokenLogo token={token} size={28} /> {sym}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-body-3 text-text-2">
              <span className="tabular">{amount && price !== undefined ? formatUsd(toNumber(amount, decimals) * price) : ''}</span>
              {limit !== undefined && (
                <span className="flex items-center gap-2">
                  <span className="tabular">
                    {mode === 'deposit' ? 'Balance' : 'Deposited'}: {formatTokenAmount(limit, decimals)}
                  </span>
                  {limit > 0n && (
                    <button
                      type="button"
                      data-testid="earn-max"
                      onClick={() => {
                        setText(toInputString(limit, decimals, decimals))
                        setMaxed(mode === 'withdraw')
                      }}
                      className="rounded-full bg-accent-tint px-2 py-0.5 text-body-4 font-semibold text-accent hover:bg-accent-tint-hover"
                    >
                      Max
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 px-1 text-body-3">
            <div className="flex justify-between">
              <span className="text-text-2">APY</span>
              <span className="font-semibold text-success">{vault.apyPct.toFixed(2)}%</span>
            </div>
            {mode === 'deposit' && amount && (
              <div className="flex justify-between">
                <span className="text-text-2">Projected yearly earnings</span>
                <span className="tabular">
                  {formatTokenAmount((amount * BigInt(Math.round(vault.apyPct * 100))) / 10_000n, decimals)} {sym}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-text-2">Lockup</span>
              <span>None, withdraw any time</span>
            </div>
          </div>
          {phase !== 'form' && <StepList steps={stepViews} />}
          {err && phase === 'error' && (
            <Banner tone="critical" title={err.title}>
              {err.message}
            </Banner>
          )}
          {phase !== 'running' && (
            <Button size="xl" fullWidth disabled={cta.disabled} onClick={cta.onClick} data-testid="earn-confirm">
              {phase === 'error' ? 'Try again' : cta.text}
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}
