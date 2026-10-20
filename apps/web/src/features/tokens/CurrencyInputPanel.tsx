import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Token } from '@metaswap/sdk'
import { TokenLogo, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatTokenAmount, formatUsd } from '@/lib/format'
import { sanitizeAmountInput } from '@/lib/amount'
import { TokenSelector } from './TokenSelector'

export interface CurrencyInputPanelProps {
  label: ReactNode
  token: Token | undefined
  value: string
  onChange?: (value: string) => void
  /** If provided, the token button opens the selector and calls this. */
  onTokenSelect?: (t: Token) => void
  tokenFilter?: (t: Token) => boolean
  balance?: bigint
  /** Show the Max button (sell side). */
  onMax?: () => void
  usdValue?: number
  /** Amount is being estimated (other side typed) → skeleton/dim. */
  estimating?: boolean
  readOnly?: boolean
  /** Background step: 'sell' = surface-1 with border, 'buy' = surface-2. */
  variant?: 'sell' | 'buy'
  error?: boolean
  testId?: string
  footer?: ReactNode
  /** Rendered between the amount and the token button row (e.g. percent chips). */
  children?: ReactNode
}

/**
 * Amount + token panel used by swap / limit / send (ui-ux.md §2.3). Handles keystroke
 * sanitising (digits + one separator, max token decimals), fiat line, balance and Max.
 */
export function CurrencyInputPanel({
  label,
  token,
  value,
  onChange,
  onTokenSelect,
  tokenFilter,
  balance,
  onMax,
  usdValue,
  estimating,
  readOnly,
  variant = 'sell',
  error,
  testId,
  footer,
  children,
}: CurrencyInputPanelProps) {
  const [selectorOpen, setSelectorOpen] = useState(false)
  const showBalance = balance !== undefined && token
  return (
    <div
      data-testid={testId}
      className={cn(
        'rounded-2xl p-4 transition-colors focus-within:border-surface-3-solid',
        variant === 'sell' ? 'border border-border bg-surface-1 hover:border-surface-3-solid' : 'border border-transparent bg-surface-2',
      )}
    >
      <div className="text-body-3 text-text-2">{label}</div>
      <div className="mt-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {estimating && !value ? (
            <Skeleton width={120} height={36} rounded="lg" className="my-1" />
          ) : (
            <input
              inputMode="decimal"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="0"
              aria-label={typeof label === 'string' ? `${label} amount` : 'Amount'}
              data-testid={testId ? `${testId}-input` : undefined}
              readOnly={readOnly}
              value={value}
              onChange={(e) => {
                const next = sanitizeAmountInput(e.target.value, token?.decimals ?? 18)
                if (next !== null) onChange?.(next)
              }}
              className={cn(
                'h-11 w-full min-w-0 bg-transparent text-[36px] leading-[44px] font-medium tracking-[-0.01em] outline-none tabular',
                error ? 'text-critical' : 'text-text-1',
                estimating && 'opacity-50',
              )}
            />
          )}
        </div>
        <TokenButton token={token} onClick={onTokenSelect ? () => setSelectorOpen(true) : undefined} testId={testId ? `${testId}-token` : undefined} />
      </div>
      {children}
      <div className="mt-2 flex min-h-5 items-center justify-between gap-2 text-body-3 text-text-2">
        <span className="tabular">{usdValue !== undefined && value ? formatUsd(usdValue) : value ? '' : ''}</span>
        {showBalance && (
          <span className="flex items-center gap-2">
            <span className="tabular" data-testid={testId ? `${testId}-balance` : undefined}>
              {formatTokenAmount(balance, token.decimals)} {token.symbol}
            </span>
            {onMax && balance > 0n && (
              <button
                type="button"
                onClick={onMax}
                className="rounded-full bg-accent-tint px-2 py-0.5 text-body-4 font-semibold text-accent transition-colors hover:bg-accent-tint-hover"
                data-testid={testId ? `${testId}-max` : undefined}
              >
                Max
              </button>
            )}
          </span>
        )}
      </div>
      {footer}
      {onTokenSelect && (
        <TokenSelector open={selectorOpen} onOpenChange={setSelectorOpen} onSelect={onTokenSelect} selected={token} filter={tokenFilter} />
      )}
    </div>
  )
}

export function TokenButton({ token, onClick, testId }: { token: Token | undefined; onClick?: () => void; testId?: string }) {
  if (!token)
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent-fill pr-3 pl-4 font-semibold text-white shadow-short transition-colors hover:bg-accent-fill-hover"
      >
        Select token <ChevronDown size={18} />
      </button>
    )
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      data-testid={testId}
      className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-surface-1 py-1 pr-2.5 pl-1 font-semibold shadow-short transition-colors hover:bg-surface-2-hover disabled:cursor-default disabled:hover:bg-surface-1"
    >
      <TokenLogo token={token} size={28} chainBadge />
      <span className="text-body-1">{token.symbol}</span>
      {onClick && <ChevronDown size={18} className="text-text-2" />}
    </button>
  )
}
