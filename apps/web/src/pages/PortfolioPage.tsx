import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowLeftRight, CreditCard, Send, Wallet, Zap } from 'lucide-react'
import { Button, CopyButton, Identicon, Skeleton, UnderlineTabs } from '@/components/ui'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useWallet } from '@/wallet/hooks'
import { useUi } from '@/state/ui'
import { formatUsd, shortenAddress } from '@/lib/format'
import { TokenBalancesList, usePortfolio } from '@/features/account/TokenBalancesList'
import { ActivityList } from '@/features/account/ActivityList'
import { PositionsSummary } from '@/features/account/PositionsSummary'
import { OrdersList } from '@/features/limit/OrdersList'
import { LogoMark } from '@/components/layout/Logo'

type Tab = 'overview' | 'tokens' | 'pools' | 'activity' | 'orders'

export default function PortfolioPage() {
  useDocumentTitle('Portfolio')
  const { address } = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab | null) ?? 'overview'
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })
  const navigate = useNavigate()
  const { total, isLoading } = usePortfolio(address)
  const [receive, setReceive] = useState(false)

  if (!address)
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-8 pb-24 md:px-8">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-accent-solid px-6 py-14 text-center" data-testid="portfolio-gate">
          <div className="pointer-events-none absolute inset-0 opacity-60" aria-hidden style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, var(--ms-accent-tint-hover) 0, transparent 35%), radial-gradient(circle at 80% 70%, var(--ms-accent-tint-hover) 0, transparent 30%)' }} />
          <div className="relative flex flex-col items-center gap-4">
            <LogoMark size={48} />
            <h1 className="text-heading-3 font-semibold">
              Connect a wallet <span className="text-text-2">to view your portfolio</span>
            </h1>
            <p className="max-w-md text-body-3 text-text-2">Track balances, positions, limit orders and activity on MetaChain Devnet.</p>
            <Button size="lg" onClick={openConnect} leftIcon={<Wallet size={18} />} data-testid="portfolio-connect">
              Connect
            </Button>
          </div>
        </div>
      </div>
    )

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-24 md:px-8" data-testid="portfolio-page">
      <div className="flex flex-wrap items-center gap-4">
        <Identicon address={address} size={56} />
        <div className="min-w-0">
          <CopyButton value={address} label="Copy address" className="text-heading-3 font-semibold text-text-1">
            <span className="font-mono">{shortenAddress(address)}</span>
          </CopyButton>
          <div className="mt-1 text-heading-2 font-semibold tracking-[-0.02em] tabular">{isLoading ? <Skeleton width={180} height={36} rounded="lg" /> : formatUsd(total)}</div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Action icon={<ArrowLeftRight size={18} />} label="Swap" onClick={() => navigate('/swap')} />
        <Action icon={<Zap size={18} />} label="Limit" onClick={() => navigate('/limit')} />
        <Action icon={<Send size={18} />} label="Send" onClick={() => navigate('/send')} />
        <Action icon={<ArrowDownLeft size={18} />} label="Receive" onClick={() => setReceive((v) => !v)} />
        <Action icon={<CreditCard size={18} />} label="Buy" onClick={() => navigate('/buy')} />
      </div>
      {receive && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-border p-4">
          <span className="text-body-3 text-text-2">Your MetaChain Devnet address</span>
          <span className="font-mono text-body-3 break-all">{address}</span>
          <CopyButton value={address} label="Copy address" />
        </div>
      )}
      <UnderlineTabs
        className="mt-8"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'tokens', label: 'Tokens', testId: 'portfolio-tab-tokens' },
          { value: 'pools', label: 'Pools' },
          { value: 'activity', label: 'Activity', testId: 'portfolio-tab-activity' },
          { value: 'orders', label: 'Orders', testId: 'portfolio-tab-orders' },
        ]}
      />
      <div className="mt-6">
        {tab === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Section title="Tokens" onMore={() => setTab('tokens')}>
              <TokenBalancesList address={address} limit={6} />
            </Section>
            <div className="flex flex-col gap-6">
              <Section title="Pools" onMore={() => setTab('pools')}>
                <PositionsSummary address={address} />
              </Section>
              <Section title="Recent activity" onMore={() => setTab('activity')}>
                <ActivityList address={address} limit={5} />
              </Section>
            </div>
          </div>
        )}
        {tab === 'tokens' && <TokenBalancesList address={address} />}
        {tab === 'pools' && <PositionsSummary address={address} />}
        {tab === 'activity' && <ActivityList address={address} />}
        {tab === 'orders' && <OrdersList />}
      </div>
    </div>
  )
}

function Section({ title, children, onMore }: { title: string; children: React.ReactNode; onMore?: () => void }) {
  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-3">
      <div className="mb-1 flex items-center justify-between px-2 pt-1">
        <h2 className="text-body-1 font-semibold">{title}</h2>
        {onMore && (
          <button onClick={onMore} className="text-body-3 text-text-2 hover:text-text-1">
            View all
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 rounded-2xl bg-accent-tint px-4 py-4 text-left font-semibold text-accent transition-colors hover:bg-accent-tint-hover">
      {icon}
      {label}
    </button>
  )
}
