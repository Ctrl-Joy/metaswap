import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { UnderlineTabs, Skeleton } from '@/components/ui'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useTokenList } from '@/features/tokens/useTokenList'
import { ApiErrorState, isNotFound, NotFoundState } from '@/features/explore/ExploreStates'
import { apiTokenAddress, useExplorePoolRows, useExploreTransactions, useTokenAllCandles, useTokenDetail } from '@/features/explore/api'
import { TokenChartPanel } from '@/features/explore/token/TokenChartPanel'
import { TokenAbout, TokenHeader, TokenStats } from '@/features/explore/token/TokenParts'
import { TokenSwapWidget } from '@/features/explore/token/TokenSwapWidget'
import { PoolsTable } from '@/features/explore/PoolsTable'
import { TransactionsTable } from '@/features/explore/TransactionsTable'
import { poolHasToken } from '@/features/explore/transforms'
import { CHAIN_SLUG } from '@/config'

type Tab = 'transactions' | 'pools'

/** Token detail: header, price + chart, stats, about, embedded swap card, transactions and pools. */
export default function TokenDetailPage() {
  const { chain, address: urlAddress = '' } = useParams()
  const { find } = useTokenList()
  const token = find(urlAddress === 'NATIVE' ? 'ETH' : urlAddress)
  const apiAddr = apiTokenAddress(urlAddress)
  const detail = useTokenDetail(apiAddr)
  const allCandles = useTokenAllCandles(apiAddr)
  const txs = useExploreTransactions({ token: apiAddr }, 50)
  const pools = useExplorePoolRows()
  const [tab, setTab] = useState<Tab>('transactions')

  const d = detail.data
  const symbol = d?.token.symbol ?? token?.symbol ?? ''
  const name = d?.token.name ?? token?.name ?? ''
  useDocumentTitle(symbol ? `${symbol}` : 'Token')

  const poolsForToken = useMemo(() => (pools.data ?? []).filter((p) => poolHasToken(p, apiAddr)), [pools.data, apiAddr])

  if (chain && chain !== CHAIN_SLUG) return <NotFoundState what="Network" backTo="/explore" backLabel="Back to explore" />
  if (detail.isError && isNotFound(detail.error)) return <NotFoundState what="Token" backTo="/explore/tokens" backLabel="Back to tokens" />
  if (detail.isError && !d) return <ApiErrorState error={detail.error} onRetry={() => detail.refetch()} title="Could not load this token" className="mx-auto mt-10 max-w-[720px]" />

  const loading = detail.isLoading && !d
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-24 md:px-6 md:pt-8" data-testid="token-page">
      <div
        className="grid grid-cols-1 gap-x-10 gap-y-8 [grid-template-areas:'top'_'swap'_'bottom'] lg:grid-cols-[minmax(0,1fr)_380px] lg:[grid-template-areas:'top_swap'_'bottom_swap']"
      >
        <div className="flex min-w-0 flex-col gap-6 [grid-area:top]">
          <TokenHeader symbol={symbol} name={name} address={apiAddr} loading={loading} />
          {d ? (
            <TokenChartPanel address={apiAddr} symbol={symbol} latestPriceUsd={d.priceUsd} apiChange24h={d.change24h} />
          ) : (
            <Skeleton width="100%" height={380} rounded="lg" />
          )}
        </div>

        <div className="min-w-0 [grid-area:swap] lg:sticky lg:top-24 lg:self-start">
          <TokenSwapWidget key={apiAddr} address={apiAddr} symbol={symbol} token={token} />
        </div>

        <div className="flex min-w-0 flex-col gap-10 [grid-area:bottom]">
          <TokenStats
            tvl={d?.tvlUsd ?? null}
            marketCap={d?.marketCapUsd ?? null}
            fdv={d?.fdvUsd ?? null}
            volume24h={d?.volume24hUsd ?? null}
            candles={allCandles.data}
            loading={loading}
          />
          {symbol && <TokenAbout symbol={symbol} name={name} />}
          <section className="flex flex-col gap-4">
            <UnderlineTabs<Tab>
              value={tab}
              onChange={setTab}
              items={[
                { value: 'transactions', label: 'Transactions', testId: 'token-tab-transactions' },
                { value: 'pools', label: 'Pools', testId: 'token-tab-pools' },
              ]}
            />
            {tab === 'transactions' ? (
              <TransactionsTable
                rows={txs.data}
                isLoading={txs.isLoading}
                error={txs.error}
                onRetry={() => txs.refetch()}
                emptyText={`No ${symbol || 'token'} transactions yet.`}
                testId="token-transactions"
              />
            ) : (
              <PoolsTable
                pools={poolsForToken}
                isLoading={pools.isLoading}
                error={pools.error}
                onRetry={() => pools.refetch()}
                showNewPosition={false}
                emptyText={`No pools for ${symbol || 'this token'} yet.`}
                testId="token-pools"
              />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
