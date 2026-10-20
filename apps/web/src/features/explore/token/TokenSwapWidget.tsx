import { Link } from 'react-router-dom'
import { ArrowLeftRight } from 'lucide-react'
import { NATIVE_ADDRESS, type Token } from '@metaswap/sdk'
import { ButtonLink, Card } from '@/components/ui'
import { SwapForm } from '@/features/swap/SwapForm'

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
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-2" data-testid="token-swap-widget">
      <SwapForm key={address} defaultOutput={token} />
    </div>
  )
}
