import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDownLeft, CreditCard, MoreHorizontal, Send, ArrowLeftRight, Zap, PiggyBank, Plus } from 'lucide-react'
import { CopyButton, Identicon, Modal, Popover } from '@/components/ui'
import type { PortfolioRange } from '@/api/hooks'
import { PortfolioValue } from '@/features/portfolio/PortfolioValue'
import { HoldingsStrip } from '@/features/portfolio/TokenStrip'
import { EarnSummary, PoolsTable, SectionHeader, TokensTable, ViewAll } from '@/features/portfolio/PortfolioTables'
import { ActivityList } from '@/features/account/ActivityList'
import { useUi } from '@/state/ui'
import { usePortfolioContext } from './PortfolioLayout'

export default function OverviewPage() {
  const { account, data } = usePortfolioContext()
  const [range, setRange] = useState<PortfolioRange>('1D')
  const weekTxs = useMemo(() => {
    const from = Date.now() / 1000 - 7 * 86_400
    return data.activity.filter((a) => Number(a.timestamp ?? 0) >= from).length
  }, [data.activity])
  return (
    <div className="flex min-w-0 flex-col">
      {/* Value + chart (752px) | action tiles (360px), 40px gutter — measured from Uniswap's overview. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10">
        <PortfolioValue
          address={account.address}
          isDemo={account.isDemo}
          totalUsd={data.totalUsd}
          change24hUsd={data.change24hUsd}
          change24hPct={data.change24hPct}
          loading={data.isLoading}
          range={range}
          onRangeChange={setRange}
        />
        <ActionTiles isDemo={account.isDemo} address={account.address} />
      </div>

      <hr className="mt-10 border-border" />

      {/* MetaSwap's live holdings strip sits between the chart block and the tables. */}
      <div className="mt-10">
        <HoldingsStrip rows={data.tokens} range={range} />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-10">
          <section>
            <SectionHeader title="Tokens" subtitle={data.isLoading ? undefined : `${data.tokens.length} token${data.tokens.length === 1 ? '' : 's'}`} />
            <TokensTable rows={data.tokens} loading={data.isLoading} limit={8} />
            {data.tokens.length > 8 && <ViewAll to="/portfolio/tokens" label="View all tokens" testId="view-all-tokens" />}
          </section>
          <section>
            <SectionHeader title="Pools" subtitle={data.poolsLoading ? undefined : `${data.pools.length} open position${data.pools.length === 1 ? '' : 's'}`} />
            <PoolsTable rows={data.pools} loading={data.poolsLoading} limit={5} />
            {data.pools.length > 0 && <ViewAll to="/positions" label="View all pools" />}
          </section>
        </div>
        <aside className="flex min-w-0 flex-col gap-10">
          <EarnSummary positions={data.earn} loading={data.earnLoading} />
          <section>
            <SectionHeader title="Recent activity" subtitle={`${weekTxs} transaction${weekTxs === 1 ? '' : 's'} in the last 7 days`} />
            {account.address && <ActivityList address={account.address} limit={4} compact />}
            <ViewAll to="/portfolio/activity" label="View all activity" testId="view-all-activity" />
          </section>
        </aside>
      </div>
    </div>
  )
}

function ActionTiles({ isDemo, address }: { isDemo: boolean; address: `0x${string}` | undefined }) {
  const navigate = useNavigate()
  const openConnect = useUi((s) => s.openConnect)
  const [receive, setReceive] = useState(false)
  const gated = (fn: () => void) => () => (isDemo ? openConnect() : fn())
  return (
    <div className="grid h-fit grid-cols-2 gap-3 lg:mt-[92px]" data-testid="portfolio-actions">
      <Tile icon={<Send size={22} />} label="Send" onClick={gated(() => navigate('/send'))} />
      <Tile icon={<ArrowDownLeft size={22} />} label="Receive" onClick={gated(() => setReceive(true))} />
      <Tile icon={<CreditCard size={22} />} label="Buy" onClick={gated(() => navigate('/buy'))} />
      <Popover
        align="end"
        className="w-[220px] p-2"
        trigger={
          <button type="button" data-testid="portfolio-action-more" className="flex h-[88px] flex-col justify-between rounded-2xl bg-accent-tint p-4 text-left text-accent transition-colors hover:bg-accent-tint-hover">
            <MoreHorizontal size={22} />
            <span className="text-body-2 font-semibold">More</span>
          </button>
        }
      >
        {[
          { to: '/swap', label: 'Swap', icon: <ArrowLeftRight size={16} /> },
          { to: '/limit', label: 'Limit order', icon: <Zap size={16} /> },
          { to: '/earn', label: 'Earn', icon: <PiggyBank size={16} /> },
          { to: '/positions/create', label: 'New position', icon: <Plus size={16} /> },
        ].map((l) => (
          <Link key={l.to} to={l.to} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-body-3 hover:bg-surface-2">
            <span className="text-accent">{l.icon}</span> {l.label}
          </Link>
        ))}
      </Popover>
      {address && (
        <Modal open={receive} onOpenChange={setReceive} title="Receive" width={400}>
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <Identicon address={address} size={64} />
            <p className="font-mono text-body-3 break-all">{address}</p>
            <CopyButton value={address} className="rounded-full bg-surface-3 px-4 py-2 text-body-3 font-semibold text-text-1">
              Copy address
            </CopyButton>
            <p className="text-body-4 text-text-3">Only send MetaChain Devnet (chain 31337) assets to this address.</p>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Tile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} data-testid={`portfolio-action-${label.toLowerCase()}`} className="flex h-[88px] flex-col justify-between rounded-2xl bg-accent-tint p-4 text-left text-accent transition-colors hover:bg-accent-tint-hover">
      {icon}
      <span className="text-body-2 font-semibold">{label}</span>
    </button>
  )
}
