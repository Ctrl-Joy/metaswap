import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowDownUp, Plus, ArrowLeftRight, ChevronRight, Share2 } from 'lucide-react'
import { CopyButton, DoubleLogo, Skeleton, TokenLogo, Usd } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { CHAIN_SLUG } from '@/config'
import { formatPercent, shortenAddress } from '@/lib/format'
import { usePoolDetail, usePoolHistory, useExploreTransactions } from '@/features/explore/api'
import { ApiErrorState, isNotFound, NotFoundState } from '@/features/explore/ExploreStates'
import { PoolChartPanel } from '@/features/explore/pool/PoolChartPanel'
import { TransactionsTable } from '@/features/explore/TransactionsTable'
import { balanceShares, feeLabel, tokenOf, volumeOverTvl } from '@/features/explore/transforms'
import { poolFieldDelta } from '@/features/explore/poolFilters'

const compactAmt = (v: number | null | undefined) => (v === null || v === undefined ? '-' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v))

/**
 * Pool detail, laid out from Uniswap's pool page (docs/analysis/measured/pool-ethusdc): breadcrumb,
 * 99px header block (56px pair logo, 24px title + invert, network / version·fee / address row) with a
 * bottom rule; a 680px chart + transactions column and a 360px side column (Swap / Add liquidity,
 * the Stats card, Links).
 */
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
  const bal0 = invert ? d?.reserve1Formatted : d?.reserve0Formatted
  const bal1 = invert ? d?.reserve0Formatted : d?.reserve1Formatted
  const ratio = d ? volumeOverTvl(d.volume24hUsd, d.tvlUsd) : null
  const swapHref = `/swap?inputCurrency=${t0.address}&outputCurrency=${t1.address}`
  const addHref = `/positions/create?currencyA=${t0.address}&currencyB=${t1.address}&fee=${d?.fee ?? ''}&version=${d?.version ?? 'v3'}`

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-24 md:px-10 md:pt-12" data-testid="pool-page">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-body-2 leading-6 text-text-2">
        <Link to="/explore/pools" className="hover:text-text-1">
          Pools
        </Link>
        <ChevronRight size={16} aria-hidden />
        <span className="text-text-1">{loading ? '...' : `${t0.symbol} / ${t1.symbol}`}</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pt-5 pb-5">
        <div className="flex min-w-0 items-center gap-3">
          {loading ? (
            <Skeleton width={90} height={56} rounded="full" />
          ) : (
            <DoubleLogo token0={{ symbol: sym0, address: invert ? t1.address : t0.address }} token1={{ symbol: sym1, address: invert ? t0.address : t1.address }} size={56} />
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[24px] leading-7 font-medium">{loading ? <Skeleton width={160} height={28} /> : `${sym0} / ${sym1}`}</h1>
              <button type="button" aria-label="Invert pair" title="Invert pair" onClick={() => setInvert((v) => !v)} data-testid="invert-pair" className="text-text-2 hover:text-text-1">
                <ArrowDownUp size={20} />
              </button>
            </div>
            {d && (
              <div className="flex flex-wrap items-center gap-4 text-body-3">
                <span className="inline-flex items-center gap-1.5 font-semibold text-text-2">
                  <span className="flex size-4 items-center justify-center rounded-[5px] bg-accent-tint">
                    <span className="size-1.5 rounded-full bg-success" />
                  </span>
                  MetaChain Devnet
                </span>
                <span className="inline-flex h-[22px] items-stretch gap-px overflow-hidden rounded-[4px] text-text-2" data-testid="pool-version-fee">
                  <span className="flex items-center bg-surface-3 px-1.5">{d.version}</span>
                  {fee && <span className="flex items-center bg-surface-3 px-1.5">{fee}</span>}
                </span>
                <CopyButton value={d.address} label="Copy pool address" className="text-body-2 text-text-2">
                  {shortenAddress(d.address)}
                </CopyButton>
              </div>
            )}
          </div>
        </div>
        {d && (
          <CopyButton value={`${globalThis.location?.origin ?? ''}/explore/pools/${CHAIN_SLUG}/${d.address}`} label="Copy link" className="inline-flex size-10 items-center justify-center rounded-xl text-text-2 hover:bg-surface-2 hover:text-text-1">
            <Share2 size={20} />
          </CopyButton>
        )}
      </header>

      <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 [grid-template-areas:'top'_'side'_'bottom'] lg:grid-cols-[minmax(0,680px)_360px] lg:justify-between lg:[grid-template-areas:'top_side'_'bottom_side']">
        <div className="flex min-w-0 flex-col [grid-area:top]">
          <div className="pt-3">{d ? <PoolChartPanel pool={d} address={address} invert={invert} /> : <Skeleton width="100%" height={420} rounded="lg" />}</div>
          <hr className="mt-[38px] border-border" />
        </div>

        <aside className="flex min-w-0 flex-col [grid-area:side] lg:self-start" data-testid="pool-side">
          <div className="grid grid-cols-2 gap-3">
            <Link to={swapHref} className="flex h-[46px] items-center justify-center gap-2 rounded-2xl bg-accent-tint px-4 text-body-2 font-semibold text-accent transition-colors hover:bg-accent-tint-hover" data-testid="pool-swap">
              <ArrowLeftRight size={20} aria-hidden /> Swap
            </Link>
            <Link to={addHref} className="flex h-[46px] items-center justify-center gap-2 rounded-2xl bg-accent-tint px-4 text-body-2 font-semibold text-accent transition-colors hover:bg-accent-tint-hover" data-testid="pool-add-liquidity">
              <Plus size={20} aria-hidden /> Add liquidity
            </Link>
          </div>

          <section className="mt-6 flex flex-col gap-6 rounded-[20px] bg-surface-2 p-5" data-testid="pool-stats">
            <h2 className="text-[24px] leading-9 font-medium">Stats</h2>
            <div className="flex flex-col gap-2" data-testid="pool-balances">
              <span className="text-body-1 text-text-2">Pool balances</span>
              {loading ? (
                <Skeleton width="100%" height={40} />
              ) : (
                <>
                  <div className="flex items-center justify-between text-body-2 leading-6 tabular">
                    <span>
                      {compactAmt(bal0)} {sym0}
                    </span>
                    <span>
                      {compactAmt(bal1)} {sym1}
                    </span>
                  </div>
                  <div className="flex h-2 w-full gap-0.5 overflow-hidden" role="img" aria-label={`${sym0} ${formatPercent(sh0 * 100, { digits: 1 })}, ${sym1} ${formatPercent(sh1 * 100, { digits: 1 })}`}>
                    <span className="h-full rounded-l-full bg-accent" style={{ width: `${sh0 * 100}%` }} />
                    <span className="h-full rounded-r-full bg-accent-fill" style={{ width: `${sh1 * 100}%` }} />
                  </div>
                </>
              )}
            </div>
            <Stat label="Total APR" value={d && d.apr !== null ? formatPercent(d.apr, { digits: 2 }) : '-'} loading={loading} testId="pool-stat-apr" />
            <Stat label="TVL" value={<Usd value={d?.tvlUsd ?? null} compact />} loading={loading} delta={poolFieldDelta(dayHist.data, 'tvlUsd')} testId="pool-stat-tvl" />
            <Stat label="24H volume" value={<Usd value={d?.volume24hUsd ?? null} compact />} loading={loading} delta={poolFieldDelta(dayHist.data, 'volumeUsd')} testId="pool-stat-volume" />
            <Stat label="24H fees" value={<Usd value={d?.fees24hUsd ?? null} compact />} loading={loading} testId="pool-stat-fees" />
            {ratio !== null && <span className="sr-only">1D volume to TVL ratio {ratio.toFixed(2)}</span>}
          </section>

          {d && (
            <section className="mt-11 flex flex-col gap-4" data-testid="pool-links">
              <h2 className="text-[24px] leading-8 font-medium">Links</h2>
              <LinkRow logo={<DoubleLogo token0={{ symbol: t0.symbol, address: t0.address }} token1={{ symbol: t1.symbol, address: t1.address }} size={20} />} label={`${t0.symbol} / ${t1.symbol}`} address={d.address} />
              <LinkRow logo={<TokenLogo token={{ symbol: t0.symbol, address: t0.address }} size={20} />} label={t0.symbol} address={t0.address} to={`/explore/tokens/${CHAIN_SLUG}/${t0.address}`} />
              <LinkRow logo={<TokenLogo token={{ symbol: t1.symbol, address: t1.address }} size={20} />} label={t1.symbol} address={t1.address} to={`/explore/tokens/${CHAIN_SLUG}/${t1.address}`} />
            </section>
          )}
        </aside>

        <section className="flex min-w-0 flex-col gap-[22px] [grid-area:bottom]">
          <h2 className="text-[24px] leading-7 font-medium">Transactions</h2>
          <TransactionsTable rows={txs.data} isLoading={txs.isLoading} error={txs.error} onRetry={() => txs.refetch()} showFilter={false} emptyText="No swaps or liquidity changes in this pool yet." testId="pool-transactions" perspective={d ? sym0 : undefined} pair={d ? [sym0, sym1] : undefined} />
        </section>
      </div>
    </div>
  )
}

/** "Links" row: logo + name (› to the token page) and a 32px address chip with copy. */
function LinkRow({ logo, label, address, to }: { logo: ReactNode; label: string; address: string; to?: string }) {
  const name = (
    <span className="flex items-center gap-2 text-body-2">
      {logo}
      {label}
      {to && <ChevronRight size={16} className="text-text-2" />}
    </span>
  )
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      {to ? (
        <Link to={to} className="hover:opacity-80">
          {name}
        </Link>
      ) : (
        name
      )}
      <CopyButton value={address} label={`Copy ${label} address`} className="inline-flex h-8 items-center gap-2 rounded-[20px] bg-surface-3 px-3 text-body-3 font-semibold text-text-1">
        {shortenAddress(address)}
      </CopyButton>
    </div>
  )
}

/** Stats card entry: 18px grey label, 36/44 value, 18px grey change with a coloured triangle. */
function Stat({ label, value, loading, delta, testId }: { label: string; value: ReactNode; loading: boolean; delta?: number | null; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <span className="text-body-1 text-text-2">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2 text-[36px] leading-[44px] font-medium tabular">
        {loading ? <Skeleton width={120} height={36} /> : value}
        {!loading && delta !== null && delta !== undefined && Number.isFinite(delta) && (
          <span className="inline-flex items-center gap-1 text-body-1 text-text-2">
            <span aria-hidden className={cn('text-[0.6em]', delta > 0 ? 'text-success' : delta < 0 ? 'text-critical' : 'text-text-3')}>
              {delta < 0 ? '▼' : '▲'}
            </span>
            {Math.abs(delta).toLocaleString('en-US', { maximumFractionDigits: 2 })}%
          </span>
        )}
      </span>
    </div>
  )
}
