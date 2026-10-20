import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UnderlineTabs } from '@/components/ui'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ExploreCharts, ExploreStats } from '@/features/explore/ExploreOverview'
import { PoolsTable } from '@/features/explore/PoolsTable'
import { TokensTable } from '@/features/explore/TokensTable'
import { TransactionsTable } from '@/features/explore/TransactionsTable'
import { useExplorePoolRows, useExploreTokenRows, useExploreTransactions } from '@/features/explore/api'
import type { RangeKey } from '@/features/explore/types'

export type ExploreTab = 'tokens' | 'pools' | 'transactions'

const TAB_PATH: Record<ExploreTab, string> = { tokens: '/explore', pools: '/explore/pools', transactions: '/explore/transactions' }

/** Explore: stats strip, charts header, then Tokens / Pools / Transactions with URL sync (ui-ux.md §8). */
export default function ExplorePage({ tab = 'tokens' }: { tab?: ExploreTab }) {
  useDocumentTitle('Explore')
  const navigate = useNavigate()
  const [range, setRange] = useState<RangeKey>('1D')
  const tokens = useExploreTokenRows(range)
  const pools = useExplorePoolRows()
  const txs = useExploreTransactions({}, 50)

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 pt-6 pb-24 md:px-6 md:pt-10" data-testid="explore-page">
      <ExploreStats />
      <ExploreCharts />
      <div className="flex flex-col gap-4">
        <UnderlineTabs<ExploreTab>
          value={tab}
          onChange={(t) => navigate(TAB_PATH[t])}
          items={[
            { value: 'tokens', label: 'Tokens', testId: 'explore-tab-tokens' },
            { value: 'pools', label: 'Pools', testId: 'explore-tab-pools' },
            { value: 'transactions', label: 'Transactions', testId: 'explore-tab-transactions' },
          ]}
        />
        {tab === 'tokens' && (
          <TokensTable rows={tokens.data} isLoading={tokens.isLoading} error={tokens.error} onRetry={() => tokens.refetch()} range={range} onRangeChange={setRange} />
        )}
        {tab === 'pools' && <PoolsTable pools={pools.data} isLoading={pools.isLoading} error={pools.error} onRetry={() => pools.refetch()} />}
        {tab === 'transactions' && <TransactionsTable rows={txs.data} isLoading={txs.isLoading} error={txs.error} onRetry={() => txs.refetch()} />}
      </div>
    </div>
  )
}
