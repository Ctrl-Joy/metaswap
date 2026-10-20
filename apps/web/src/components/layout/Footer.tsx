import { Link } from 'react-router-dom'
import { useHealth } from '@/api/hooks'
import { cn } from '@/lib/cn'
import { LogoMark } from './Logo'

/** Compact footer for non-trade pages (ui-ux.md §1.7): links, API status, version. */
export function Footer() {
  const health = useHealth()
  // Only call the API offline once a check has actually failed with no good answer to fall back on;
  // while the first request is in flight show a neutral "checking" state (no red flash on route changes).
  const apiUp = !!health.data && !health.isError
  const status: 'up' | 'down' | 'checking' = apiUp ? 'up' : health.isError ? 'down' : 'checking'
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-6 text-body-4 text-text-2 md:px-8">
        <span className="flex items-center gap-2 font-semibold text-text-1">
          <LogoMark size={18} /> MetaSwap
        </span>
        <Link to="/metaswapx" className="hover:text-text-1">
          MetaSwapX
        </Link>
        <Link to="/metachain" className="hover:text-text-1">
          MetaChain
        </Link>
        <Link to="/buy" className="hover:text-text-1">
          Devnet faucet
        </Link>
        <span className="flex items-center gap-1.5" data-testid="footer-api-status" data-status={status}>
          <span className={cn('size-1.5 rounded-full', status === 'up' ? 'bg-success' : status === 'down' ? 'bg-critical' : 'bg-text-3')} />
          API {status === 'up' ? `synced to block ${health.data?.indexedBlock ?? ''}` : status === 'down' ? 'offline' : 'checking…'}
        </span>
        <span className="ml-auto">v{__APP_VERSION__} · devnet build · no real funds</span>
      </div>
    </footer>
  )
}
