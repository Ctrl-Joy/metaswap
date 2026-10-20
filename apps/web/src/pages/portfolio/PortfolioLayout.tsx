import { Suspense } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { Eye, EyeOff, Wallet } from 'lucide-react'
import { Button, CopyButton, Identicon, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { shortenAddress } from '@/lib/format'
import { useUi } from '@/state/ui'
import { useSettings } from '@/state/settings'
import { LogoMark } from '@/components/layout/Logo'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePortfolioAccount, usePortfolioData, type PortfolioAccount, type PortfolioData } from '@/features/portfolio/usePortfolioData'
import { HoldingsTicker } from '@/features/portfolio/TokenStrip'

export interface PortfolioContext {
  account: PortfolioAccount
  data: PortfolioData
}

export function usePortfolioContext() {
  return useOutletContext<PortfolioContext>()
}

const TABS = [
  { to: '/portfolio', label: 'Overview', end: true },
  { to: '/portfolio/tokens', label: 'Tokens' },
  { to: '/portfolio/nfts', label: 'NFTs' },
  { to: '/portfolio/activity', label: 'Activity' },
]

/** /portfolio shell: demo banner when signed out, wallet header with hide-balances eye, sub-route tabs. */
export default function PortfolioLayout() {
  useDocumentTitle('Portfolio')
  const account = usePortfolioAccount()
  const data = usePortfolioData(account.address)
  const openConnect = useUi((s) => s.openConnect)
  const hidden = useSettings((s) => s.hideBalances)
  const setHidden = useSettings((s) => s.setHideBalances)

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 pb-24 md:px-8" data-testid="portfolio-page" data-demo={account.isDemo || undefined}>
      {account.isDemo && (
        <div className="relative mb-6 overflow-hidden rounded-3xl border border-border bg-accent-solid px-6 py-8 text-center" data-testid="portfolio-gate">
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            aria-hidden
            style={{
              backgroundImage:
                'radial-gradient(circle at 12% 30%, var(--ms-accent-tint-hover) 0, transparent 28%), radial-gradient(circle at 88% 70%, var(--ms-accent-tint-hover) 0, transparent 26%), radial-gradient(var(--ms-accent-tint) 1px, transparent 1px)',
              backgroundSize: 'auto, auto, 16px 16px',
            }}
          />
          <div className="relative flex flex-col items-center gap-3">
            <div className="text-body-1">
              <span className="font-semibold">Connect a wallet</span> <span className="text-text-2">to view your portfolio</span>
            </div>
            <Button onClick={openConnect} leftIcon={<Wallet size={16} />} data-testid="portfolio-connect">
              Connect
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {account.address ? (
          account.isDemo ? (
            <span className="flex size-10 items-center justify-center rounded-full bg-accent-tint">
              <LogoMark size={22} />
            </span>
          ) : (
            <Identicon address={account.address} size={40} />
          )
        ) : (
          <Skeleton width={40} height={40} />
        )}
        <div className="flex min-w-0 items-center gap-2">
          {account.isDemo ? (
            <span className="text-body-1 font-semibold" data-testid="demo-label">
              Demo wallet
            </span>
          ) : account.address ? (
            <CopyButton value={account.address} label="Copy address" className="text-body-1 font-semibold text-text-1">
              <span className="font-mono">{shortenAddress(account.address)}</span>
            </CopyButton>
          ) : null}
          <button
            type="button"
            onClick={() => setHidden(!hidden)}
            aria-label={hidden ? 'Show balances' : 'Hide balances'}
            aria-pressed={hidden}
            data-testid="hide-balances"
            className="inline-flex size-8 items-center justify-center rounded-full text-text-2 hover:bg-surface-3 hover:text-text-1"
          >
            {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <div className="ml-auto hidden min-w-0 flex-1 lg:block lg:max-w-[560px]">
          <HoldingsTicker rows={data.tokens} />
        </div>
      </div>

      <nav aria-label="Portfolio" className="mt-6 flex items-center gap-6 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            data-testid={`portfolio-tab-${t.label.toLowerCase()}`}
            className={({ isActive }) =>
              cn('-mb-px shrink-0 border-b-2 pb-2.5 text-body-1 font-medium transition-colors', isActive ? 'border-text-1 text-text-1' : 'border-transparent text-text-2 hover:text-text-1')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6">
        <Suspense fallback={<Skeleton width="100%" height={320} rounded="lg" />}>
          <Outlet context={{ account, data } satisfies PortfolioContext} />
        </Suspense>
      </div>
    </div>
  )
}
