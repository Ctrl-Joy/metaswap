import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ExploreStats } from '@/features/explore/ExploreOverview'
import { EarnRow, TrendingRow } from '@/features/explore/DiscoveryRows'
import { AuctionsSection } from '@/features/explore/auctions/AuctionsSection'
import { ExploreSectionTabs } from '@/features/explore/ExploreTable'
import { PoolsTable } from '@/features/explore/PoolsTable'
import { TokensTable } from '@/features/explore/TokensTable'
import { TransactionsTable } from '@/features/explore/TransactionsTable'
import { useExplorePoolRows, useExploreTokenRows, useExploreTransactions } from '@/features/explore/api'
import type { RangeKey } from '@/features/explore/types'

export type ExploreTab = 'tokens' | 'auctions' | 'pools' | 'transactions'

const TAB_PATH: Record<ExploreTab, string> = {
  tokens: '/explore',
  auctions: '/explore/auctions',
  pools: '/explore/pools',
  transactions: '/explore/transactions',
}

/**
 * Explore, laid out to Uniswap's explore page (measured): a 1120px column, a stats strip, Trending and
 * Earn rows, then Tokens · Auctions · Pools · Transactions with URL sync.
 */
export default function ExplorePage({ tab = 'tokens' }: { tab?: ExploreTab }) {
  useDocumentTitle('Explore')
  const navigate = useNavigate()
  const [range, setRange] = useState<RangeKey>('1D')
  const tokens = useExploreTokenRows(range)
  const pools = useExplorePoolRows()
  const txs = useExploreTransactions({}, 50)

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-4 pt-6 pb-24 md:px-0 md:pt-6" data-testid="explore-page">
      <ExploreStats />
      {tab === 'tokens' && (
        <>
          <TrendingRow />
          <EarnRow />
        </>
      )}
      <div className="flex flex-col gap-4">
        <ExploreSectionTabs<ExploreTab>
          value={tab}
          onSelect={(t) => navigate(TAB_PATH[t])}
          items={[
            { value: 'tokens', label: 'Tokens', testId: 'explore-tab-tokens' },
            { value: 'auctions', label: 'Auctions', testId: 'explore-tab-auctions' },
            { value: 'pools', label: 'Pools', testId: 'explore-tab-pools' },
            { value: 'transactions', label: 'Transactions', testId: 'explore-tab-transactions' },
          ]}
        />
        {tab === 'tokens' && (
          <TokensTable rows={tokens.data} isLoading={tokens.isLoading} error={tokens.error} onRetry={() => tokens.refetch()} range={range} onRangeChange={setRange} />
        )}
        {tab === 'auctions' && <AuctionsSection />}
        {tab === 'pools' && <PoolsTable pools={pools.data} isLoading={pools.isLoading} error={pools.error} onRetry={() => pools.refetch()} />}
        {tab === 'transactions' && <TransactionsTable rows={txs.data} isLoading={txs.isLoading} error={txs.error} onRetry={() => txs.refetch()} />}
      </div>
    </div>
  )
}
