import { Suspense } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { CopyButton, Identicon, Skeleton } from '@/components/ui'
import { ConnectBanner } from '@/features/portfolio/ConnectBanner'
import { Dropdown } from '@/features/portfolio/ui'
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
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-24 md:px-6 md:pt-10" data-testid="portfolio-page" data-demo={account.isDemo || undefined}>
      {account.isDemo && <ConnectBanner onConnect={openConnect} />}

      {/* Wallet row: 48px avatar, 18px name + eye, running ticker, network dropdown (Uniswap: "All networks"). */}
      <div className="flex items-center gap-3 pt-4">
        {account.address ? (
          account.isDemo ? (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-tint">
              <LogoMark size={26} />
            </span>
          ) : (
            <Identicon address={account.address} size={48} />
          )
        ) : (
          <Skeleton width={48} height={48} rounded="full" />
        )}
        <div className="flex min-w-0 items-center gap-1">
          {account.isDemo ? (
            <span className="ml-1 text-body-1 font-medium whitespace-nowrap" data-testid="demo-label">
              Demo wallet
            </span>
          ) : account.address ? (
            <CopyButton value={account.address} label="Copy address" className="ml-1 text-body-1 font-medium text-text-1">
              <span className="font-mono">{shortenAddress(account.address)}</span>
            </CopyButton>
          ) : null}
          <button
            type="button"
            onClick={() => setHidden(!hidden)}
            aria-label={hidden ? 'Show balances' : 'Hide balances'}
            aria-pressed={hidden}
            data-testid="hide-balances"
            className="inline-flex size-7 items-center justify-center rounded-full text-text-2 hover:bg-surface-3 hover:text-text-1"
          >
            {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <div className="mx-4 hidden min-w-0 flex-1 justify-end lg:flex">
          <div className="w-full max-w-[520px]">
            <HoldingsTicker rows={data.tokens} />
          </div>
        </div>
        <div className="ml-auto shrink-0 lg:ml-0">
          <Dropdown
            value="devnet"
            align="end"
            width={240}
            testId="portfolio-network"
            compactLabel
            options={[{ value: 'devnet', label: 'MetaChain Devnet', icon: <NetworkIcon />, testId: 'portfolio-network-devnet' }]}
          />
        </div>
      </div>

      <nav aria-label="Portfolio" className="mt-9 flex items-center gap-6 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            data-testid={`portfolio-tab-${t.label.toLowerCase()}`}
            className={({ isActive }) =>
              cn('-mb-px shrink-0 border-b-2 pb-3 text-body-2 transition-colors', isActive ? 'border-text-1 text-text-1' : 'border-transparent text-text-2 hover:text-text-1')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-4">
        <Suspense fallback={<Skeleton width="100%" height={320} rounded="lg" />}>
          <Outlet context={{ account, data } satisfies PortfolioContext} />
        </Suspense>
      </div>
    </div>
  )
}

/** Chain mark for the network dropdown: green live dot on the MetaSwap logo tile. */
function NetworkIcon() {
  return (
    <span className="relative inline-flex size-5 items-center justify-center rounded-md bg-accent-tint">
      <LogoMark size={14} />
      <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-surface-1 bg-success" aria-hidden />
    </span>
  )
}
