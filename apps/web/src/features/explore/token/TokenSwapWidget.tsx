import { Link } from 'react-router-dom'
import { ArrowLeftRight } from 'lucide-react'
import { NATIVE_ADDRESS, type Token } from '@metaswap/sdk'
import { ButtonLink, Card } from '@/components/ui'
import { SwapForm } from '@/features/swap/SwapForm'
import { SettingsPopover } from '@/features/settings/SettingsPopover'
import { cn } from '@/lib/cn'

const TABS = [
  { to: '/swap', label: 'Swap' },
  { to: '/limit', label: 'Limit' },
  { to: '/send', label: 'Send' },
  { to: '/buy', label: 'Buy' },
] as const

/**
 * Embedded swap card with this token preselected as the output (ui-ux.md §9.2). Reuses the web shell's
 * SwapForm body. Native ETH has no separate swap card here, so it links to /swap instead.
 */
export function TokenSwapWidget({ address, symbol, token }: { address: string; symbol: string; token: Token | undefined }) {
  if (address === NATIVE_ADDRESS || !token) {
    return (
      <Card className="flex flex-col gap-4 p-5" data-testid="token-swap-link">
        <div className="flex items-center gap-2 text-body-1 font-semibold">
          <ArrowLeftRight size={18} aria-hidden /> Trade {symbol}
        </div>
        <p className="text-body-3 text-text-2">Swap {symbol} on the full swap page, with the pair pre-filled.</p>
        <ButtonLink to={`/swap?outputCurrency=${symbol === 'ETH' ? 'ETH' : address}`} size="lg" fullWidth>
          Swap {symbol}
        </ButtonLink>
        <Link to="/swap" className="text-center text-body-3 text-accent hover:underline">
          Open swap
        </Link>
      </Card>
    )
  }
  // Uniswap's token page embeds the trade card with its own tab row (Swap active) and no outer frame.
  return (
    <div className="flex flex-col gap-1" data-testid="token-swap-widget">
      <div className="mb-1 flex items-center justify-between">
        <nav aria-label="Trade" className="flex items-center gap-3 p-1">
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to === '/swap' ? `/swap?outputCurrency=${address}` : t.to}
              aria-current={t.to === '/swap' ? 'page' : undefined}
              className={cn('rounded-full px-3 py-2 text-body-3 font-semibold transition-colors', t.to === '/swap' ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:text-text-1')}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <SettingsPopover />
      </div>
      <SwapForm key={address} defaultOutput={token} />
    </div>
  )
}
