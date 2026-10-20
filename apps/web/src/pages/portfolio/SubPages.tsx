import { useState } from 'react'
import { SegmentedTabs } from '@/components/ui'
import { NftGrid, SectionHeader, TokensTable } from '@/features/portfolio/PortfolioTables'
import { ActivityList } from '@/features/account/ActivityList'
import { usePortfolioContext } from './PortfolioLayout'

export function TokensPage() {
  const { data } = usePortfolioContext()
  return (
    <section>
      <SectionHeader title="Tokens" subtitle={data.isLoading ? undefined : `${data.tokens.length} tokens`} />
      <TokensTable rows={data.tokens} loading={data.isLoading} sparklines />
    </section>
  )
}

export function NftsPage() {
  const { data } = usePortfolioContext()
  return (
    <section>
      <SectionHeader title="NFTs" subtitle="MetaSwap V3 liquidity positions" />
      <NftGrid nfts={data.nfts} loading={data.isLoading} />
    </section>
  )
}

const FILTERS = {
  all: undefined,
  swaps: ['swap'],
  transfers: ['send', 'receive', 'mint', 'faucet'],
  liquidity: ['add', 'remove', 'collect', 'add-liquidity', 'remove-liquidity', 'collect-fees'],
  orders: ['order', 'cancel-order'],
  earn: ['earn-deposit', 'earn-withdraw', 'deposit-vault', 'withdraw-vault', 'earn'],
  wraps: ['wrap', 'unwrap', 'deposit', 'withdrawal'],
} as const
type Filter = keyof typeof FILTERS

export function ActivityPage() {
  const { account } = usePortfolioContext()
  const [filter, setFilter] = useState<Filter>('all')
  return (
    <section>
      <SegmentedTabs
        size="sm"
        className="mb-4 flex-wrap"
        value={filter}
        onChange={setFilter}
        ariaLabel="Activity filter"
        items={(Object.keys(FILTERS) as Filter[]).map((f) => ({ value: f, label: f.charAt(0).toUpperCase() + f.slice(1), testId: `activity-filter-${f}` }))}
      />
      <div className="rounded-2xl border border-border p-2">{account.address && <ActivityList address={account.address} types={FILTERS[filter]} />}</div>
    </section>
  )
}
