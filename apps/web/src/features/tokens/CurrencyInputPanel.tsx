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
  /** Up to 5 quick-pick tokens shown beside "Select token" while no token is chosen (Uniswap's buy panel). */
  quickPicks?: Token[]
  className?: string
  /**
   * Uniswap's compact limit panel (120px): 14px label, 36px amount row, and a reserved 18px line that
   * shows only the balance (no fiat value).
   */
  compact?: boolean
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
  quickPicks,
  className,
  compact,
}: CurrencyInputPanelProps) {
  const [selectorOpen, setSelectorOpen] = useState(false)
  const showBalance = balance !== undefined && token
  return (
    <div
      data-testid={testId}
      className={cn(
        'group/panel rounded-[20px] px-4 pt-4 transition-colors',
        compact ? 'pb-4' : 'pb-5',
        variant === 'sell' ? 'border border-border bg-surface-1 focus-within:bg-surface-2 hover:bg-surface-1-hover' : 'border border-transparent bg-surface-2',
        className,
      )}
    >
      <div className={cn('text-text-2', compact ? 'text-body-3' : 'text-body-2 leading-5')}>{label}</div>
      <div className={cn('mt-2 flex items-center gap-2', compact && 'h-9')}>
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
                'w-full min-w-0 bg-transparent text-[36px] font-medium outline-none tabular placeholder:text-text-3',
                compact ? 'h-9 leading-9' : 'h-[43px] leading-[43px]',
                error ? 'text-critical' : 'text-text-1',
                estimating && 'opacity-50',
              )}
            />
          )}
        </div>
        {!token && onTokenSelect && quickPicks && quickPicks.length > 0 && (
          <div className="hidden items-center gap-1 transition-opacity duration-150 md:flex md:opacity-0 md:group-hover/panel:opacity-100 md:focus-within:opacity-100" data-testid={testId ? `${testId}-quick-picks` : undefined}>
            <QuickPicks tokens={quickPicks} onPick={onTokenSelect} testId={testId} />
          </div>
        )}
        <TokenButton token={token} onClick={onTokenSelect ? () => setSelectorOpen(true) : undefined} testId={testId ? `${testId}-token` : undefined} />
      </div>
      {!token && onTokenSelect && quickPicks && quickPicks.length > 0 && (
        <div className="mt-2 flex items-center gap-1 md:hidden" data-testid={testId ? `${testId}-quick-picks-mobile` : undefined}>
          <QuickPicks tokens={quickPicks} onPick={onTokenSelect} testId={testId ? `${testId}-m` : undefined} />
        </div>
      )}
      {children}
      <div className="mt-2 flex min-h-[18px] items-center justify-between gap-2 text-body-3 text-text-2">
        {/* Uniswap shows "$0" under an empty panel; a typed amount without a price shows nothing. */}
        <span className="tabular" data-testid={testId ? `${testId}-fiat` : undefined}>
          {!token || compact ? '' : !value || Number(value) === 0 ? '$0' : usdValue !== undefined ? formatUsd(usdValue) : ''}
        </span>
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

function QuickPicks({ tokens, onPick, testId }: { tokens: Token[]; onPick: (t: Token) => void; testId?: string }) {
  return (
    <>
      {tokens.slice(0, 5).map((t) => (
        <button
          key={t.address}
          type="button"
          title={t.symbol}
          aria-label={`Select ${t.symbol}`}
          onClick={() => onPick(t)}
          data-testid={testId ? `${testId}-quick-${t.symbol}` : undefined}
          className="flex size-7 items-center justify-center rounded-full bg-surface-3 p-1 transition-colors hover:bg-surface-3-hover"
        >
          <TokenLogo token={t} size={20} />
        </button>
      ))}
    </>
  )
}

export function TokenButton({ token, onClick, testId }: { token: Token | undefined; onClick?: () => void; testId?: string }) {
  if (!token)
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className="flex h-[38px] shrink-0 items-center gap-1 rounded-full border border-surface-3-solid bg-accent-fill pr-2 pl-3 text-body-2 font-semibold text-white transition-colors hover:bg-accent-fill-hover"
      >
        Select token <ChevronDown size={20} />
      </button>
    )
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      data-testid={testId}
      className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-full border border-surface-3-solid bg-bg py-1 pr-2 pl-1 font-semibold transition-colors hover:bg-surface-2-hover disabled:cursor-default disabled:hover:bg-bg"
    >
      <TokenLogo token={token} size={28} chainBadge />
      <span className="text-body-2 leading-[18px]">{token.symbol}</span>
      {onClick && <ChevronDown size={20} className="text-text-1" />}
    </button>
  )
}
