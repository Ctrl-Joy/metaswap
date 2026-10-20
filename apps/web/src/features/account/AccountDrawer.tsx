import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDisconnect } from 'wagmi'
import { ArrowDownCircle, ArrowLeft, ArrowRight, ChevronRight, Copy, Check, Power, Send, Settings } from 'lucide-react'
import { Identicon, Skeleton, Switch } from '@/components/ui'
import { ThemeToggle } from '@/components/layout/Header'
import { useUi } from '@/state/ui'
import { useSettings } from '@/state/settings'
import { useWallet } from '@/wallet/hooks'
import { isDevWalletId } from '@/wallet/devWallet'
import { formatUsd, shortenAddress } from '@/lib/format'
import { cn } from '@/lib/cn'
import { usePortfolioQuery } from '@/api/hooks'
import { usePortfolio } from './TokenBalancesList'
import { ActivityList } from './ActivityList'
import { TopRightPanel } from './TopRightPanel'

type View = 'main' | 'settings' | 'receive'

/** "Dev wallet #4 · Anvil" / "Local account · devnet" / connector name. */
export function walletLabel(connectorId: string | undefined, connectorName: string | undefined): string {
  if (isDevWalletId(connectorId)) return `${connectorName} · Anvil`
  if (connectorId === 'metaswap-local') return 'Devnet account · this browser'
  return connectorName ?? 'Wallet'
}

/** "$1,234" + faded ".56" (Uniswap fades the decimals of USD balances). */
function FadedUsd({ value }: { value: number }) {
  const s = formatUsd(value)
  const i = s.lastIndexOf('.')
  if (i < 0 || /[KMB]$/.test(s)) return <>{s}</>
  return (
    <>
      {s.slice(0, i)}
      <span className="text-text-3">{s.slice(i)}</span>
    </>
  )
}

function IconAction({ label, onClick, children, testId }: { label: string; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} data-testid={testId} className="inline-flex size-9 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1">
      {children}
    </button>
  )
}

/** Accent action tile (Uniswap ActionTile: p-12, gap-12, radius 16, accent2 fill, buttonLabel2 accent text). */
function ActionTile({ icon, label, onClick, testId }: { icon: ReactNode; label: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className="flex flex-1 basis-0 flex-col items-start gap-3 rounded-2xl border border-transparent bg-accent-tint p-3 text-accent transition-colors hover:bg-accent-tint-hover">
      {icon}
      <span className="text-body-2 font-semibold">{label}</span>
    </button>
  )
}

/** Small tertiary pill with a trailing arrow (Uniswap ViewAllButton). */
function ViewAll({ label, onClick, full, testId }: { label: string; onClick: () => void; full?: boolean; testId?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className={cn('inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-body-3 font-semibold text-text-1 transition-colors hover:bg-surface-2', full ? 'w-full justify-center' : 'w-max')}>
      {label} <ArrowRight size={16} />
    </button>
  )
}

/** Slide-out sub view header: back arrow (15%), centred subheading1 title (SlideOutMenu.tsx). */
function SubView({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="mt-1 p-3 animate-fade-in">
      <div className="mb-6 flex items-center justify-between">
        <button type="button" onClick={onBack} aria-label="Back" data-testid="drawer-back" className="w-[15%] text-text-2 hover:text-text-1">
          <ArrowLeft size={24} />
        </button>
        <span className="text-body-1 font-medium">{title}</span>
        <span className="w-[15%]" />
      </div>
      {children}
    </div>
  )
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-1">
      <span className="text-body-2 text-text-1">{label}</span>
      {children}
    </div>
  )
}

/**
 * Account drawer, rebuilt from Uniswap's AccountDrawer/AuthenticatedHeader + MiniPortfolio:
 * 368px top-right panel; 48px avatar with settings / disconnect icons; subheading1 address (copy);
 * 36px balance with faded decimals and today's change; Send / Receive tiles; "View portfolio";
 * "Recent activity" (3 rows, limit orders included) and "View all activity".
 */
export function AccountDrawer() {
  const open = useUi((s) => s.drawerOpen)
  const setOpen = useUi((s) => s.setDrawerOpen)
  const { address, connectorName, connectorId } = useWallet()
  const { disconnect } = useDisconnect()
  const navigate = useNavigate()
  const [view, setView] = useState<View>('main')
  const [copied, setCopied] = useState(false)
  const { total, isLoading } = usePortfolio(open ? address : undefined)
  const pf = usePortfolioQuery(open ? address : undefined)
  const hide = useSettings((s) => s.hideSmallBalances)
  const setHide = useSettings((s) => s.setHideSmallBalances)
  const ch = pf.data?.change24hUsd ?? null
  const chPct = pf.data?.change24hPct ?? null

  // Like Uniswap: reset to the main view shortly after the drawer closes.
  useEffect(() => {
    if (open || view === 'main') return
    const t = setTimeout(() => setView('main'), 250)
    return () => clearTimeout(t)
  }, [open, view])
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  const close = () => setOpen(false)
  const go = (path: string) => {
    close()
    navigate(path)
  }
  if (!address) return null
  const copy = () => {
    void navigator.clipboard?.writeText(address).catch(() => undefined)
    setCopied(true)
  }

  return (
    <TopRightPanel open={open} onOpenChange={setOpen} title="Account" testId="account-drawer">
      {view === 'settings' ? (
        <SubView title="Settings" onBack={() => setView('main')}>
          <div className="flex flex-col" data-testid="drawer-settings-view">
            <SettingRow label="Theme">
              <ThemeToggle />
            </SettingRow>
            <SettingRow label="Hide small balances">
              <Switch checked={hide} onChange={setHide} label="Hide small balances" testId="hide-small-balances" />
            </SettingRow>
            <SettingRow label="Language">
              <span className="inline-flex items-center gap-1 text-body-2 font-semibold">
                English <ChevronRight size={20} className="text-text-2" />
              </span>
            </SettingRow>
            <SettingRow label="Currency">
              <span className="inline-flex items-center gap-1 text-body-2 font-semibold">
                USD <ChevronRight size={20} className="text-text-2" />
              </span>
            </SettingRow>
            <SettingRow label="Wallet">
              <span className="text-body-3 text-text-2">{walletLabel(connectorId, connectorName)}</span>
            </SettingRow>
          </div>
        </SubView>
      ) : view === 'receive' ? (
        <SubView title="Receive" onBack={() => setView('main')}>
          <div className="flex flex-col items-center gap-4 pb-2 text-center">
            <Identicon address={address} size={72} />
            <p className="font-mono text-body-3 break-all text-text-2" data-testid="receive-address">
              {address}
            </p>
            <button type="button" onClick={copy} className="inline-flex h-10 items-center gap-2 rounded-full bg-surface-3 px-4 text-body-3 font-semibold text-text-1 hover:bg-surface-3-hover">
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy address'}
            </button>
            <p className="text-body-4 text-text-3">Only send MetaChain Devnet (chain 31337) assets to this address.</p>
          </div>
        </SubView>
      ) : (
        <div className="flex flex-col px-4 py-5 animate-fade-in">
          <div className="mb-2 flex items-start justify-between">
            <Identicon address={address} size={48} />
            <div className="flex items-center gap-1">
              <IconAction label="Settings" onClick={() => setView('settings')} testId="drawer-settings">
                <Settings size={24} />
              </IconAction>
              <IconAction
                label="Disconnect"
                testId="disconnect-button"
                onClick={() => {
                  disconnect()
                  close()
                }}
              >
                <Power size={22} />
              </IconAction>
            </div>
          </div>
          <button type="button" onClick={copy} className="group flex w-max items-center gap-1.5 text-left" title="Copy address">
            <span className="text-body-1 font-medium text-text-1" data-testid="drawer-address">
              {shortenAddress(address)}
            </span>
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} className="text-text-3 group-hover:text-text-2" />}
          </button>
          <span className="text-body-3 text-text-3" data-testid="drawer-wallet-label">
            {walletLabel(connectorId, connectorName)}
          </span>

          <div className="mt-4 mb-4 flex flex-col gap-1" data-testid="drawer-balance">
            <div className="text-heading-2 font-medium tabular" data-testid="portfolio-total">
              {isLoading ? <Skeleton width={180} height={40} rounded="lg" /> : <FadedUsd value={total} />}
            </div>
            {ch !== null && !isLoading && (
              <div className={cn('flex items-center gap-1 text-body-3 tabular', ch > 0 ? 'text-success' : ch < 0 ? 'text-critical' : 'text-text-2')} data-testid="drawer-change">
                <span aria-hidden className="text-[0.75em]">
                  {ch >= 0 ? '▲' : '▼'}
                </span>
                {formatUsd(Math.abs(ch))} ({Math.abs(chPct ?? 0).toFixed(2)}%)
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <ActionTile icon={<Send size={24} />} label="Send" onClick={() => go('/send')} testId="shortcut-send" />
            <ActionTile icon={<ArrowDownCircle size={24} />} label="Receive" onClick={() => setView('receive')} testId="shortcut-receive" />
          </div>

          <div className="mt-3 flex flex-col gap-1">
            <ViewAll label="View portfolio" onClick={() => go('/portfolio')} full testId="drawer-view-portfolio" />
            <div className="flex flex-col gap-2 pt-4">
              <span className="p-2 text-body-2 font-semibold text-text-1">Recent activity</span>
              <div className="-mx-3" data-testid="drawer-activity">
                <ActivityList address={address} limit={3} />
              </div>
            </div>
            <ViewAll label="View all activity" onClick={() => go('/portfolio/activity')} testId="drawer-view-activity" />
          </div>
        </div>
      )}
    </TopRightPanel>
  )
}
