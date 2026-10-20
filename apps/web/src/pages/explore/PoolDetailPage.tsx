import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowDownUp, Plus, ArrowLeftRight } from 'lucide-react'
import { Badge, buttonClass, Card, CopyButton, DoubleLogo, IconButton, PercentChange, Skeleton, Usd } from '@/components/ui'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { CHAIN_SLUG } from '@/config'
import { formatAmount, formatPercent, shortenAddress } from '@/lib/format'
import { usePoolDetail, usePoolHistory, useExploreTransactions } from '@/features/explore/api'
import { ApiErrorState, isNotFound, NotFoundState } from '@/features/explore/ExploreStates'
import { PoolChartPanel } from '@/features/explore/pool/PoolChartPanel'
import { TransactionsTable } from '@/features/explore/TransactionsTable'
import { balanceShares, feeLabel, tokenOf, volumeOverTvl } from '@/features/explore/transforms'
import { poolFieldDelta } from '@/features/explore/poolFilters'

/** Pool detail: header with invert, chart tabs, balances, stats, Swap and Add liquidity, transactions. */
export default function PoolDetailPage() {
  const { chain, address = '' } = useParams()
  const pool = usePoolDetail(address)
  const txs = useExploreTransactions({ pool: address }, 50)
  const dayHist = usePoolHistory(address || undefined, 'day')
  const [invert, setInvert] = useState(false)
  const d = pool.data
  const t0 = tokenOf(d?.token0)
  const t1 = tokenOf(d?.token1)
  useDocumentTitle(d ? `${t0.symbol} / ${t1.symbol}` : 'Pool')

  if (chain && chain !== CHAIN_SLUG) return <NotFoundState what="Network" backTo="/explore" backLabel="Back to explore" />
  if (pool.isError && isNotFound(pool.error)) return <NotFoundState what="Pool" backTo="/explore/pools" backLabel="Back to pools" />
  if (pool.isError && !d) return <ApiErrorState error={pool.error} onRetry={() => pool.refetch()} title="Could not load this pool" className="mx-auto mt-10 max-w-[720px]" />

  const loading = pool.isLoading && !d
  const fee = d ? feeLabel(d.fee) : null
  const [s0, s1] = balanceShares(d?.reserve0Usd ?? d?.reserve0Formatted, d?.reserve1Usd ?? d?.reserve1Formatted)
  const sym0 = invert ? t1.symbol : t0.symbol
  const sym1 = invert ? t0.symbol : t1.symbol
  const sh0 = invert ? s1 : s0
  const sh1 = invert ? s0 : s1
  const ratio = d ? volumeOverTvl(d.volume24hUsd, d.tvlUsd) : null
  const swapHref = `/swap?inputCurrency=${t0.address}&outputCurrency=${t1.address}`
  const addHref = `/positions/create?currencyA=${t0.address}&currencyB=${t1.address}&fee=${d?.fee ?? ''}&version=${d?.version ?? 'v3'}`

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-24 md:px-0 md:pt-6" data-testid="pool-page">
      <nav aria-label="Breadcrumb" className="text-body-3 text-text-2">
        <Link to="/explore/pools" className="hover:text-text-1">
          Pools
        </Link>
        <span className="mx-1.5 text-text-3">&gt;</span>
        <span className="text-text-1">{loading ? '...' : `${t0.symbol} / ${t1.symbol}`}</span>
      </nav>

      <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 [grid-template-areas:'top'_'side'_'bottom'] lg:grid-cols-[minmax(0,1fr)_360px] lg:[grid-template-areas:'top_side'_'bottom_side']">
        <div className="flex min-w-0 flex-col gap-6 [grid-area:top]">
          <header className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {loading ? (
                  <Skeleton width={68} height={44} />
                ) : (
                  <DoubleLogo token0={{ symbol: t0.symbol, address: t0.address }} token1={{ symbol: t1.symbol, address: t1.address }} size={40} />
                )}
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-[24px] leading-7 font-medium">
                      {loading ? <Skeleton width={160} height={28} /> : `${sym0} / ${sym1}`}
                    </h1>
                    <IconButton label="Invert pair" size={32} onClick={() => setInvert((v) => !v)} data-testid="invert-pair">
                      <ArrowDownUp size={16} />
                    </IconButton>
                  </div>
                  {d && (
                    <div className="flex flex-wrap items-center gap-2 text-body-3 text-text-2">
                      <Badge tone="neutral">MetaChain Devnet</Badge>
                      <Badge tone="accent">{d.version}</Badge>
                      {fee && <Badge tone="neutral">{fee}</Badge>}
                      <CopyButton value={d.address} label="Copy pool address" className="text-body-3">
                        <span className="font-mono">{shortenAddress(d.address, 6)}</span>
                      </CopyButton>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </header>

          {d ? (
            <PoolChartPanel pool={d} address={address} invert={invert} />
          ) : (
            <Skeleton width="100%" height={340} rounded="lg" />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-5 [grid-area:side] lg:sticky lg:top-24 lg:self-start" data-testid="pool-side">
          <div className="grid grid-cols-2 gap-3">
            <Link to={swapHref} className={buttonClass({ variant: 'secondary', size: 'lg', fullWidth: true })} data-testid="pool-swap">
              <ArrowLeftRight size={16} aria-hidden /> Swap
            </Link>
            <Link to={addHref} className={buttonClass({ variant: 'primary', size: 'lg', fullWidth: true })} data-testid="pool-add-liquidity">
              <Plus size={16} aria-hidden /> Add liquidity
            </Link>
          </div>
          <Card className="flex flex-col gap-4 p-5">
            <div className="text-body-3 text-text-2">Pool balances</div>
            {loading ? (
              <Skeleton width="100%" height={10} />
            ) : (
              <div className="flex h-2.5 w-full overflow-hidden rounded-full" role="img" aria-label={`${sym0} ${formatPercent(sh0 * 100, { digits: 1 })}, ${sym1} ${formatPercent(sh1 * 100, { digits: 1 })}`}>
                <span className="h-full bg-accent-fill" style={{ width: `${sh0 * 100}%` }} />
                <span className="h-full bg-success" style={{ width: `${sh1 * 100}%` }} />
              </div>
            )}
            {d && (
              <ul className="flex flex-col gap-2 text-body-3" data-testid="pool-balances">
                <li className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-accent-fill" aria-hidden />
                    {sym0}
                  </span>
                  <span className="tabular text-text-1">
                    {formatAmount(invert ? d.reserve1Formatted ?? null : d.reserve0Formatted ?? null)} <span className="text-text-2">({formatPercent(sh0 * 100, { digits: 1 })})</span>
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-success" aria-hidden />
                    {sym1}
                  </span>
                  <span className="tabular text-text-1">
                    {formatAmount(invert ? d.reserve0Formatted ?? null : d.reserve1Formatted ?? null)} <span className="text-text-2">({formatPercent(sh1 * 100, { digits: 1 })})</span>
                  </span>
                </li>
              </ul>
            )}
          </Card>

          <Card className="grid grid-cols-2 gap-x-4 gap-y-5 p-5" data-testid="pool-stats">
            <Stat label="TVL" value={<Usd value={d?.tvlUsd ?? null} compact />} loading={loading} delta={poolFieldDelta(dayHist.data, 'tvlUsd')} testId="pool-stat-tvl" />
            <Stat label="APR" value={d && d.apr !== null ? formatPercent(d.apr, { digits: 2 }) : '-'} loading={loading} />
            <Stat label="1D volume" value={<Usd value={d?.volume24hUsd ?? null} compact />} loading={loading} delta={poolFieldDelta(dayHist.data, 'volumeUsd')} testId="pool-stat-volume" />
            <Stat label="1D fees" value={<Usd value={d?.fees24hUsd ?? null} />} loading={loading} />
            <Stat label="1D vol / TVL" value={ratio === null ? '-' : ratio.toFixed(2)} loading={loading} />
            <Stat label="7D volume" value={<Usd value={d?.volume7dUsd ?? null} compact />} loading={loading} />
          </Card>

          {d && (
            <Card className="flex flex-col gap-3 p-5 text-body-3">
              <div className="text-text-2">Contracts</div>
              <div className="flex items-center justify-between gap-2">
                <span>Pool</span>
                <CopyButton value={d.address} label="Copy pool address">
                  <span className="font-mono">{shortenAddress(d.address, 6)}</span>
                </CopyButton>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>{t0.symbol}</span>
                <CopyButton value={t0.address} label={`Copy ${t0.symbol} address`}>
                  <span className="font-mono">{shortenAddress(t0.address, 6)}</span>
                </CopyButton>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>{t1.symbol}</span>
                <CopyButton value={t1.address} label={`Copy ${t1.symbol} address`}>
                  <span className="font-mono">{shortenAddress(t1.address, 6)}</span>
                </CopyButton>
              </div>
            </Card>
          )}
        </aside>

        <section className="flex min-w-0 flex-col gap-4 [grid-area:bottom]">
          <h2 className="text-[24px] leading-7 font-medium">Transactions</h2>
          <TransactionsTable rows={txs.data} isLoading={txs.isLoading} error={txs.error} onRetry={() => txs.refetch()} emptyText="No swaps or liquidity changes in this pool yet." testId="pool-transactions" perspective={d ? sym0 : undefined} />
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, loading, delta, testId }: { label: string; value: ReactNode; loading: boolean; delta?: number | null; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={testId}>
      <span className="text-body-4 text-text-2">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2 text-[24px] leading-7 font-medium tabular">
        {loading ? <Skeleton width={70} height={18} /> : value}
        {!loading && delta !== null && delta !== undefined && <PercentChange value={delta} className="text-body-4 font-medium" />}
      </span>
    </div>
  )
}
