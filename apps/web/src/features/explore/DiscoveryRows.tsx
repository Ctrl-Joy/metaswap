import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { PercentChange, Skeleton, TokenLogo, Tooltip } from '@/components/ui'
import { formatPrice } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Sparkline } from './charts/SvgCharts'
import { useEarnVaults, useTrendingTokens } from './discoveryApi'
import { tokenHref } from './TokensTable'

/** Trending row: four cards with logo, name, symbol, 24h change and a sparkline. Hidden when empty. */
export function TrendingRow() {
  const q = useTrendingTokens()
  const rows = (q.data ?? []).slice(0, 4)
  // Hide the whole row while the endpoint is missing or empty; show skeletons only while first loading.
  if (!q.isLoading && rows.length === 0) return null
  return (
    <section aria-label="Trending" className="flex flex-col gap-4" data-testid="trending-row">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-heading-3 font-semibold">Trending</h2>
          <Tooltip content="The tokens with the most activity and price movement over the last 24 hours.">
            <button type="button" aria-label="About trending" className="inline-flex text-text-3 hover:text-text-2">
              <Info size={16} />
            </button>
          </Tooltip>
        </div>
        <Link to="/explore/tokens?category=trending" className="text-body-2 font-semibold text-text-2 hover:text-text-1">
          View all
        </Link>
      </div>
      <div className="grid grid-flow-col auto-cols-[min(280px,80vw)] gap-3 overflow-x-auto pb-1 scrollbar-thin md:grid-flow-row md:auto-cols-auto md:grid-cols-4 md:overflow-visible">
        {q.isLoading && !q.data
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} width="100%" height={82} rounded="lg" className="!rounded-2xl" />)
          : rows.map((t) => (
              <Link
                key={t.address}
                to={tokenHref(t.address)}
                data-testid="trending-card"
                data-symbol={t.symbol}
                className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-surface-1 p-4 transition-colors hover:bg-surface-1-hover"
              >
                <TokenLogo token={{ symbol: t.symbol, address: t.address }} size={36} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-2 font-semibold text-text-1">{t.name}</span>
                  <span className="flex items-center gap-1.5 text-body-3 text-text-2">
                    <span className="truncate">{t.symbol}</span>
                    <PercentChange value={t.change24h} className="text-body-3" />
                  </span>
                </div>
                <Sparkline values={t.sparkline} width={84} height={34} className="shrink-0" />
                <span className="sr-only">{formatPrice(t.priceUsd)}</span>
              </Link>
            ))}
      </div>
    </section>
  )
}

/** Earn row: three vault cards with logo, symbol and APY in accent. Hidden when there are no vaults. */
export function EarnRow() {
  const q = useEarnVaults()
  const vaults = (q.data ?? []).slice(0, 3)
  if (!q.isLoading && vaults.length === 0) return null
  return (
    <section aria-label="Earn" className="flex flex-col gap-4 md:flex-row md:items-center md:gap-10" data-testid="earn-row">
      <div className="flex flex-col gap-1 md:w-[220px] md:shrink-0">
        <h2 className="text-heading-3 font-semibold">Earn</h2>
        <p className="text-body-3 text-text-2">Deposit for yield with no lockup</p>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
        {q.isLoading && !q.data
          ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} width="100%" height={72} rounded="lg" className="!rounded-2xl" />)
          : vaults.map((v) => (
              <Link
                key={v.id}
                to={`/earn/${encodeURIComponent(v.id)}`}
                data-testid="earn-card"
                data-vault={v.id}
                className={cn('flex items-center gap-3 rounded-2xl border border-border bg-surface-1 p-4 transition-colors hover:bg-surface-1-hover')}
              >
                <TokenLogo token={{ symbol: v.logoSymbol }} size={36} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-body-2 font-semibold text-text-1">{v.symbol}</span>
                  <span className="text-body-3 font-semibold text-accent tabular">{v.apyPct === null ? 'APY -' : `${v.apyPct.toFixed(2)}% APY`}</span>
                </div>
              </Link>
            ))}
      </div>
    </section>
  )
}
