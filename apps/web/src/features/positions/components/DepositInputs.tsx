import { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import type { Address } from 'viem'
import { CurrencyInputPanel } from '@/features/tokens/CurrencyInputPanel'
import { priceOf, useTokenPrices } from '@/features/tokens/useTokenList'
import { useTokenBalances } from '@/hooks/useTokenBalances'
import { maxSpendable, parseAmount, toInputString, toNumber } from '@/lib/amount'
import type { Token } from '../tokens'

/**
 * Linking rule between the two deposit amounts. Returns the other side's amount for an exact
 * amount on one side, or null when the ratio is free (new V2 pair / new pool with no price).
 */
export type LinkFn = (side: 'A' | 'B', amount: bigint) => bigint | null

export interface LinkedAmounts {
  typed: 'A' | 'B'
  valueA: string
  valueB: string
  amountA: bigint
  amountB: bigint
  setA: (v: string) => void
  setB: (v: string) => void
  reset: () => void
}

/** Two amount fields kept in ratio by `link`. Disabled sides are forced to empty. */
export function useLinkedAmounts(tokenA: Token | undefined, tokenB: Token | undefined, link: LinkFn, disabled: { A: boolean; B: boolean }): LinkedAmounts {
  const [typed, setTyped] = useState<'A' | 'B'>('A')
  const [vA, setVA] = useState('')
  const [vB, setVB] = useState('')

  return useMemo(() => {
    const dA = tokenA?.decimals ?? 18
    const dB = tokenB?.decimals ?? 18
    const free = link('A', 1n) === null
    let valueA = vA
    let valueB = vB
    // if the typed side became disabled (range moved), the other side drives
    const ind: 'A' | 'B' = disabled[typed] ? (typed === 'A' ? 'B' : 'A') : typed
    if (!free) {
      const indValue = ind === 'A' ? vA : vB
      const parsed = parseAmount(indValue, ind === 'A' ? dA : dB)
      const dep = parsed !== null && parsed > 0n ? link(ind, parsed) : null
      const other = ind === 'A' ? 'B' : 'A'
      const depStr = dep !== null && dep > 0n ? toInputString(dep, other === 'A' ? dA : dB, other === 'A' ? dA : dB) : ''
      if (ind === 'A') valueB = depStr
      else valueA = depStr
    }
    if (disabled.A) valueA = ''
    if (disabled.B) valueB = ''
    return {
      typed: ind,
      valueA,
      valueB,
      amountA: parseAmount(valueA, dA) ?? 0n,
      amountB: parseAmount(valueB, dB) ?? 0n,
      setA: (v: string) => {
        setTyped('A')
        setVA(v)
      },
      setB: (v: string) => {
        setTyped('B')
        setVB(v)
      },
      reset: () => {
        setVA('')
        setVB('')
      },
    }
  }, [tokenA, tokenB, link, disabled, typed, vA, vB])
}

export function DepositInputs({
  tokenA,
  tokenB,
  amounts,
  account,
  disabled,
  testIdPrefix = 'deposit',
}: {
  tokenA: Token
  tokenB: Token
  amounts: LinkedAmounts
  account: Address | undefined
  disabled: { A: boolean; B: boolean }
  testIdPrefix?: string
}) {
  const tokens = useMemo(() => [tokenA, tokenB], [tokenA, tokenB])
  const { balances } = useTokenBalances(tokens, account)
  const { prices } = useTokenPrices()
  const balA = account ? balances[tokenA.address.toLowerCase()] : undefined
  const balB = account ? balances[tokenB.address.toLowerCase()] : undefined

  const panel = (side: 'A' | 'B') => {
    const token = side === 'A' ? tokenA : tokenB
    const bal = side === 'A' ? balA : balB
    const value = side === 'A' ? amounts.valueA : amounts.valueB
    const amount = side === 'A' ? amounts.amountA : amounts.amountB
    const set = side === 'A' ? amounts.setA : amounts.setB
    const price = priceOf(prices, token)
    const tid = `${testIdPrefix}-${side.toLowerCase()}`
    if (disabled[side])
      return (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-2 p-4 text-body-3 text-text-2" data-testid={`${tid}-locked`}>
          <Lock size={18} className="shrink-0" />
          The price range is outside the current price, so this position takes only the other token. No {token.symbol} needed.
        </div>
      )
    return (
      <CurrencyInputPanel
        label={token.symbol}
        token={token}
        value={value}
        onChange={set}
        balance={bal}
        onMax={bal !== undefined ? () => set(toInputString(maxSpendable(bal, !!token.isNative), token.decimals, token.decimals)) : undefined}
        usdValue={price !== undefined ? toNumber(amount, token.decimals) * price : undefined}
        error={bal !== undefined && amount > bal}
        testId={tid}
      />
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {panel('A')}
      {panel('B')}
    </div>
  )
}
