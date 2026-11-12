import { Link } from 'react-router-dom'
import { useHealth } from '@/api/hooks'
import { useRealtimeStatus } from '@/api/realtime'
import { cn } from '@/lib/cn'
import { richText } from '@/components/ui'
import { LogoMark } from './Logo'
import { t } from '@/i18n'

/** Compact footer for non-trade pages (ui-ux.md §1.7): links, API status, version. */
export function Footer() {
  const health = useHealth()
  const live = useRealtimeStatus() === 'open'
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
          {t('Devnet faucet')}
        </Link>
        <span className="flex items-center gap-1.5" data-testid="footer-api-status" data-status={status}>
          <span className={cn('size-1.5 rounded-full', status === 'up' ? 'bg-success' : status === 'down' ? 'bg-critical' : 'bg-text-3')} />
          {status === 'up'
            ? richText(t('API synced to block {block}'), { block: <span data-testid="footer-block">{health.data?.indexedBlock ?? ''}</span> })
            : status === 'down'
              ? t('API offline')
              : t('API checking…')}
        </span>
        {status === 'up' && (
          <span className="flex items-center gap-1.5" data-testid="footer-live" data-live={live ? 'on' : 'off'} title={live ? t('Real-time updates connected') : t('Real-time updates reconnecting; polling meanwhile')}>
            <span className="relative flex size-1.5">
              {live && <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />}
              <span className={cn('relative size-1.5 rounded-full', live ? 'bg-success' : 'bg-text-3')} />
            </span>
            {live ? t('realtime::Live') : t('Polling')}
          </span>
        )}
        <span className="ml-auto">{t('v{version} · devnet build · no real funds', { version: __APP_VERSION__ })}</span>
      </div>
    </footer>
  )
}
