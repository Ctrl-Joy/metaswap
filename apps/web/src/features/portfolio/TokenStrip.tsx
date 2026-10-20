import { useMemo } from 'react'
import { deployment } from '@metaswap/sdk'
import type { Address } from 'viem'
import { ChartCard, Marquee, TickerPill } from '@/components/ui'
import { usePriceHistory, useExploreTokens } from '@/api/hooks'
import type { PortfolioRange } from '@/api/hooks'
import { Sparkline } from '@/features/explore/charts/SvgCharts'
import { formatPrice, formatTokenAmount, formatUsd } from '@/lib/format'
import { CHAIN_SLUG } from '@/config'
import { useMask, type HoldingRow } from './usePortfolioData'

const WETH = deployment.tokens?.find((t) => t.symbol === 'WETH')?.address
const priceAddress = (h: HoldingRow): Address | undefined => (h.token.isNative ? (WETH as Address | undefined) : h.token.address)
const tokenHref = (h: HoldingRow) => `/explore/tokens/${CHAIN_SLUG}/${h.token.isNative ? 'NATIVE' : h.token.address}`
const historyRange = (r: PortfolioRange) => (r === 'ALL' ? '1Y' : r)

/** 24h change per token address from the explore rows (live market). */
function useChanges() {
  const q = useExploreTokens('volume')
  return useMemo(() => {
    const m = new Map<string, number>()
    for (const r of q.data ?? []) {
      const addr = r.address ?? r.token?.address
      if (addr && typeof r.change24h === 'number') m.set(addr.toLowerCase(), r.change24h)
    }
    return m
  }, [q.data])
}

function changeOf(h: HoldingRow, changes: Map<string, number>): number | null {
  if (h.change24h !== null) return h.change24h
  const a = priceAddress(h)
  return a ? (changes.get(a.toLowerCase()) ?? null) : null
}

function HoldingCard({ h, range, change }: { h: HoldingRow; range: PortfolioRange; change: number | null }) {
  const hist = usePriceHistory(priceAddress(h), historyRange(range))
  const values = useMemo(() => (hist.data ?? []).map((p) => p.priceUsd).filter((v) => Number.isFinite(v)), [hist.data])
  const mask = useMask()
  return (
    <ChartCard
      to={tokenHref(h)}
      testId={`holding-card-${h.token.symbol}`}
      token={h.token}
      title={h.token.name}
      subtitle={h.token.symbol}
      chart={<Sparkline values={values} width={112} height={40} />}
      primary={h.valueUsd === null ? '-' : mask(formatUsd(h.valueUsd))}
      changePct={change}
      secondary={mask(`${formatTokenAmount(h.balance, h.token.decimals)} ${h.token.symbol}`)}
      chip={formatPrice(h.priceUsd)}
    />
  )
}

/**
 * "Your tokens" running strip: one chart card per held token (sorted by value), auto-scrolling,
 * with mini price charts for the selected range that refresh every 15s.
 */
export function HoldingsStrip({ rows, range }: { rows: HoldingRow[]; range: PortfolioRange }) {
  const changes = useChanges()
  const held = rows.filter((r) => r.balance > 0n).slice(0, 12)
  if (held.length === 0) return null
  return (
    <section aria-labelledby="your-tokens-strip">
      <div className="mb-3 flex items-end justify-between px-1">
        <h2 id="your-tokens-strip" className="text-body-1 font-semibold">
          Your tokens
        </h2>
        <span className="text-body-4 text-text-3">Live · {range === 'ALL' ? '1Y' : range} charts</span>
      </div>
      <Marquee ariaLabel="Your tokens" testId="holdings-strip" speed={32} gap={12} arrows fade>
        {held.map((h) => (
          <HoldingCard key={h.token.address} h={h} range={range} change={changeOf(h, changes)} />
        ))}
      </Marquee>
    </section>
  )
}

/** Thin live ticker of the user's tokens with 24h change. */
export function HoldingsTicker({ rows }: { rows: HoldingRow[] }) {
  const changes = useChanges()
  const held = rows.filter((r) => r.balance > 0n)
  if (held.length < 2) return null
  return (
    <Marquee ariaLabel="Live prices of your tokens" testId="holdings-ticker" speed={40} gap={8} fade>
      {held.map((h) => (
        <TickerPill key={h.token.address} to={tokenHref(h)} token={h.token} label={`${h.token.symbol} ${formatPrice(h.priceUsd)}`} changePct={changeOf(h, changes)} />
      ))}
    </Marquee>
  )
}
