import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDisconnect } from 'wagmi'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDownLeft, ChevronsRight, CreditCard, LogOut, Send, Settings, ArrowLeftRight, ChevronLeft } from 'lucide-react'
import { CopyButton, IconButton, Identicon, Sheet, Skeleton, Switch, UnderlineTabs } from '@/components/ui'
import { ThemeToggle } from '@/components/layout/Header'
import { useUi } from '@/state/ui'
import { useSettings } from '@/state/settings'
import { useWallet } from '@/wallet/hooks'
import { isDevWalletId } from '@/wallet/devWallet'
import { formatUsd, shortenAddress } from '@/lib/format'
import { OrdersList } from '@/features/limit/OrdersList'
import { TokenBalancesList, usePortfolio } from './TokenBalancesList'
import { PositionsSummary } from './PositionsSummary'
import { ActivityList } from './ActivityList'
import { NftGrid } from '@/features/portfolio/PortfolioTables'
import { usePortfolioQuery } from '@/api/hooks'
import { cn } from '@/lib/cn'

type Tab = 'tokens' | 'nfts' | 'pools' | 'activity' | 'orders'

/** Right-side account drawer (ui-ux.md §7.3). */
export function AccountDrawer() {
  const open = useUi((s) => s.drawerOpen)
  const setOpen = useUi((s) => s.setDrawerOpen)
  const { address, connectorName, connectorId } = useWallet()
  const { disconnect } = useDisconnect()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('tokens')
  const [view, setView] = useState<'main' | 'settings' | 'receive'>('main')
  const { total, isLoading } = usePortfolio(open ? address : undefined)
  const pf = usePortfolioQuery(open ? address : undefined)
  const ch = pf.data?.change24hUsd ?? null
  const chPct = pf.data?.change24hPct ?? null
  const hide = useSettings((s) => s.hideSmallBalances)
  const setHide = useSettings((s) => s.setHideSmallBalances)
  const close = () => setOpen(false)
  const go = (path: string) => {
    close()
    navigate(path)
  }

  if (!address) return null
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setView('main')
      }}
      title="Account"
      testId="account-drawer"
    >
      <div className="flex items-center gap-1 px-3 pt-3">
        <Dialog.Close asChild>
          <IconButton label="Close account drawer" size={36}>
            <ChevronsRight size={20} />
          </IconButton>
        </Dialog.Close>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Settings" size={36} onClick={() => setView(view === 'settings' ? 'main' : 'settings')} data-testid="drawer-settings">
            <Settings size={18} />
          </IconButton>
          <IconButton
            label="Disconnect"
            size={36}
            data-testid="disconnect-button"
            onClick={() => {
              disconnect()
              close()
            }}
          >
            <LogOut size={18} />
          </IconButton>
        </div>
      </div>

      {view === 'settings' ? (
        <div className="flex flex-col gap-4 px-5 py-2">
          <button onClick={() => setView('main')} className="-ml-1 flex items-center gap-1 text-body-2 font-semibold">
            <ChevronLeft size={18} /> Settings
          </button>
          <div className="flex items-center justify-between">
            <span className="text-body-3 text-text-2">Theme</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body-3 text-text-2">Hide small balances (&lt; $1)</span>
            <Switch checked={hide} onChange={setHide} label="Hide small balances" testId="hide-small-balances" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body-3 text-text-2">Wallet</span>
            <span className="text-body-3">{isDevWalletId(connectorId) ? `${connectorName} (Anvil)` : connectorName}</span>
          </div>
        </div>
      ) : view === 'receive' ? (
        <div className="flex flex-col items-center gap-4 px-5 py-6 text-center">
          <Identicon address={address} size={72} />
          <div className="text-body-1 font-semibold">Receive on MetaChain Devnet</div>
          <p className="font-mono text-body-3 break-all text-text-2" data-testid="receive-address">
            {address}
          </p>
          <CopyButton value={address} className="rounded-full bg-surface-3 px-4 py-2 text-body-3 font-semibold text-text-1">
            Copy address
          </CopyButton>
          <p className="text-body-4 text-text-3">Only send MetaChain Devnet (chain 31337) assets to this address.</p>
          <button onClick={() => setView('main')} className="text-body-3 text-accent hover:underline">
            Back
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-5 pt-2">
            <div className="flex items-center gap-3">
              <Identicon address={address} size={40} />
              <div className="min-w-0">
                <CopyButton value={address} label="Copy address" className="text-body-1 font-semibold text-text-1">
                  <span className="font-mono" data-testid="drawer-address">{shortenAddress(address)}</span>
                </CopyButton>
                <div className="text-body-4 text-text-3">{isDevWalletId(connectorId) ? `${connectorName} · Anvil` : connectorName}</div>
              </div>
            </div>
            <div className="mt-4 text-heading-2 font-semibold tracking-[-0.02em] tabular" data-testid="portfolio-total">
              {isLoading ? <Skeleton width={160} height={36} rounded="lg" /> : formatUsd(total)}
            </div>
            {ch !== null && !isLoading && (
              <div className="mt-1 flex items-center gap-1.5 text-body-3 text-text-2" data-testid="drawer-change">
                <span className={cn('inline-flex items-center gap-1 tabular', ch > 0 ? 'text-success' : ch < 0 ? 'text-critical' : 'text-text-2')}>
                  <span aria-hidden className="text-[0.7em]">
                    {ch >= 0 ? '▲' : '▼'}
                  </span>
                  {formatUsd(Math.abs(ch))} ({Math.abs(chPct ?? 0).toFixed(2)}%)
                </span>
                today
              </div>
            )}
            <div className="mt-4 grid grid-cols-4 gap-2">
              <Shortcut icon={<ArrowLeftRight size={18} />} label="Swap" onClick={() => go('/swap')} />
              <Shortcut icon={<Send size={18} />} label="Send" onClick={() => go('/send')} />
              <Shortcut icon={<ArrowDownLeft size={18} />} label="Receive" onClick={() => setView('receive')} />
              <Shortcut icon={<CreditCard size={18} />} label="Buy" onClick={() => go('/buy')} />
            </div>
          </div>
          <UnderlineTabs
            className="mx-5 mt-5"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'tokens', label: 'Tokens', testId: 'drawer-tab-tokens' },
              { value: 'nfts', label: 'NFTs', testId: 'drawer-tab-nfts' },
              { value: 'pools', label: 'Pools', testId: 'drawer-tab-pools' },
              { value: 'activity', label: 'Activity', testId: 'drawer-tab-activity' },
              { value: 'orders', label: 'Orders', testId: 'drawer-tab-orders' },
            ]}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
            {tab === 'tokens' && <TokenBalancesList address={address} onNavigate={close} />}
            {tab === 'nfts' && (
              <div className="px-2" onClick={(e) => (e.target as HTMLElement).closest('a') && close()}>
                <NftGrid nfts={pf.data?.nfts ?? []} loading={pf.isLoading} />
              </div>
            )}
            {tab === 'pools' && <PositionsSummary address={address} onNavigate={close} />}
            {tab === 'activity' && <ActivityList address={address} limit={50} />}
            {tab === 'orders' && (
              <div className="px-2">
                <OrdersList compact />
              </div>
            )}
          </div>
          <button onClick={() => go('/portfolio')} className="border-t border-border py-3 text-center text-body-3 font-semibold text-accent hover:bg-surface-2">
            View full portfolio
          </button>
        </div>
      )}
    </Sheet>
  )
}

function Shortcut({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} data-testid={`shortcut-${label.toLowerCase()}`} className="flex flex-col items-center gap-1.5 rounded-2xl bg-accent-tint py-3 text-accent transition-colors hover:bg-accent-tint-hover">
      {icon}
      <span className="text-body-4 font-semibold">{label}</span>
    </button>
  )
}
