import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Coins, Image as ImageIcon, Layers, PiggyBank } from 'lucide-react'
import { Badge, DoubleLogo, EmptyState, PercentChange, Skeleton, Table, THead, Th, Tr, Td, TableSkeleton, TokenLogo } from '@/components/ui'
import type { EarnPosition, EarnVault, PortfolioNft, PositionRow } from '@/api/types'
import { useEarnVaults, useExploreTokens } from '@/api/hooks'
import { useTokenList } from '@/features/tokens/useTokenList'
import { Sparkline } from '@/features/explore/charts/SvgCharts'
import { formatPrice, formatTokenAmount, formatUsd } from '@/lib/format'
import { toNumber } from '@/lib/amount'
import { cn } from '@/lib/cn'
import { CHAIN_SLUG } from '@/config'
import { useMask, type HoldingRow } from './usePortfolioData'

export function SectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-1">
      <div>
        <h2 className="text-body-1 font-semibold">{title}</h2>
        {subtitle && <div className="text-body-4 text-text-2">{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}

export function ViewAll({ to, label, testId }: { to: string; label: string; testId?: string }) {
  return (
    <Link to={to} data-testid={testId} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-body-3 font-semibold transition-colors hover:bg-surface-2">
      {label} <ArrowRight size={14} />
    </Link>
  )
}

function Pnl({ usd, pct }: { usd: number | null; pct: number | null }) {
  const mask = useMask()
  if (usd === null) return <span className="text-text-3">-</span>
  return (
    <span className="inline-flex flex-col items-end">
      <span className="tabular">{mask(`${usd < 0 ? '-' : ''}${formatUsd(Math.abs(usd))}`)}</span>
      <PercentChange value={pct ?? 0} className="text-body-4" />
    </span>
  )
}

/** Tokens table (Token, Price, Balance, Value, Unrealized P/L [, 1D sparkline]). */
export function TokensTable({ rows, loading, limit, sparklines = false }: { rows: HoldingRow[]; loading: boolean; limit?: number; sparklines?: boolean }) {
  const navigate = useNavigate()
  const mask = useMask()
  const explore = useExploreTokens('volume')
  const sparks = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const r of explore.data ?? []) {
      const s = (r.sparkline ?? []).map((p) => (typeof p === 'number' ? p : p.priceUsd)).filter((v) => Number.isFinite(v))
      const addr = r.address ?? r.token?.address
      if (addr) m.set(addr.toLowerCase(), s)
    }
    return m
  }, [explore.data])
  const shown = limit ? rows.slice(0, limit) : rows
  const cols = sparklines ? 6 : 5
  if (!loading && rows.length === 0)
    return (
      <div className="rounded-2xl border border-border">
        <EmptyState icon={<Coins size={20} />} title="No tokens yet">
          Get free test tokens on the <Link to="/buy" className="text-accent hover:underline">Buy</Link> page.
        </EmptyState>
      </div>
    )
  return (
    <Table dense minWidth={sparklines ? 720 : 600}>
      <THead>
        <Th>Token</Th>
        <Th align="right">Price</Th>
        <Th align="right">Balance</Th>
        <Th align="right">Value</Th>
        <Th align="right">Unrealized P/L</Th>
        {sparklines && <Th align="right">1D</Th>}
      </THead>
      {loading ? (
        <TableSkeleton rows={5} cols={cols} />
      ) : (
        <tbody data-testid="portfolio-tokens">
          {shown.map((r) => {
            const key = (r.token.isNative ? (explore.data ?? []).map((x) => x.token ?? x).find((x) => x.symbol === 'WETH')?.address : r.token.address)?.toLowerCase()
            return (
              <Tr key={r.token.address} onClick={() => navigate(`/explore/tokens/${CHAIN_SLUG}/${r.token.isNative ? 'NATIVE' : r.token.address}`)} data-testid={`portfolio-token-${r.token.symbol}`}>
                <Td>
                  <span className="flex items-center gap-3">
                    <TokenLogo token={r.token} size={32} chainBadge />
                    <span>
                      <span className="block text-body-3 font-semibold">{r.token.name}</span>
                      <span className="block text-body-4 text-text-2">{r.token.symbol}</span>
                    </span>
                  </span>
                </Td>
                <Td align="right">{formatPrice(r.priceUsd)}</Td>
                <Td align="right">{mask(`${formatTokenAmount(r.balance, r.token.decimals)} ${r.token.symbol}`)}</Td>
                <Td align="right" className="font-medium">{r.valueUsd === null ? '-' : mask(formatUsd(r.valueUsd))}</Td>
                <Td align="right">
                  <Pnl usd={r.unrealizedPnlUsd} pct={r.unrealizedPnlPct} />
                </Td>
                {sparklines && (
                  <Td align="right">
                    <span className="inline-flex">
                      <Sparkline values={(key && sparks.get(key)) || []} width={88} height={28} />
                    </span>
                  </Td>
                )}
              </Tr>
            )
          })}
        </tbody>
      )}
    </Table>
  )
}

function addrOf(t: PositionRow['token0']): string {
  return typeof t === 'string' ? t : t.address
}

/** Pools table (Pool, Status, Fees, Value). */
export function PoolsTable({ rows, loading, limit }: { rows: PositionRow[]; loading: boolean; limit?: number }) {
  const { find } = useTokenList()
  const navigate = useNavigate()
  const mask = useMask()
  if (!loading && rows.length === 0)
    return (
      <div className="rounded-2xl border border-border">
        <EmptyState icon={<Layers size={20} />} title="No open positions">
          <Link to="/positions/create" className="text-accent hover:underline">Create a position</Link> to earn fees on every trade.
        </EmptyState>
      </div>
    )
  return (
    <Table dense minWidth={520}>
      <THead>
        <Th>Pool</Th>
        <Th align="center">Status</Th>
        <Th align="right">Fees</Th>
        <Th align="right">Value</Th>
      </THead>
      {loading ? (
        <TableSkeleton rows={2} cols={4} />
      ) : (
        <tbody data-testid="portfolio-pools">
          {(limit ? rows.slice(0, limit) : rows).map((p) => {
            const t0 = find(addrOf(p.token0))
            const t1 = find(addrOf(p.token1))
            const fees = (p.uncollectedFees as { valueUsd?: number | null } | undefined)?.valueUsd ?? p.uncollectedFeesUsd ?? null
            const href = p.version === 'v3' ? `/positions/v3/${p.tokenId}` : `/positions/v2/${p.pair ?? p.pool}`
            return (
              <Tr key={`${p.version}-${p.tokenId ?? p.pair}`} onClick={() => navigate(href)}>
                <Td>
                  <span className="flex items-center gap-3">
                    <DoubleLogo token0={t0} token1={t1} size={28} />
                    <span>
                      <span className="block text-body-3 font-semibold">
                        {t0?.symbol ?? '?'} / {t1?.symbol ?? '?'}
                      </span>
                      <span className="block text-body-4 text-text-2">
                        {p.fee ? `${p.fee / 10_000}% · ` : ''}
                        {p.version}
                      </span>
                    </span>
                  </span>
                </Td>
                <Td align="center">
                  <Badge tone={p.inRange ? 'success' : 'warning'}>{p.inRange ? 'In range' : 'Out of range'}</Badge>
                </Td>
                <Td align="right">{fees === null ? '-' : mask(formatUsd(fees))}</Td>
                <Td align="right" className="font-medium">{p.valueUsd == null ? '-' : mask(formatUsd(p.valueUsd as number))}</Td>
              </Tr>
            )
          })}
        </tbody>
      )}
    </Table>
  )
}

export function vaultOf(e: EarnPosition, vaults: EarnVault[] | undefined): EarnVault | undefined {
  if (typeof e.vault === 'object') return e.vault
  return vaults?.find((v) => v.address.toLowerCase() === String(e.vault).toLowerCase())
}

/** Right-column Earn card: lifetime earnings + vault rows (APY, value, amount). */
export function EarnSummary({ positions, loading }: { positions: EarnPosition[]; loading: boolean }) {
  const vaults = useEarnVaults()
  const mask = useMask()
  const lifetime = positions.reduce((s, p) => s + (p.lifetimeEarningsUsd ?? 0), 0)
  const total = positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0)
  return (
    <section data-testid="portfolio-earn">
      <div className="mb-3 flex items-end justify-between px-1">
        <div>
          <h2 className="text-body-1 font-semibold">
            Earn{positions.length > 0 && <span className="text-text-2"> · {mask(formatUsd(total))}</span>}
          </h2>
          <div className="text-body-4 text-text-2">Lifetime earnings</div>
        </div>
        <span className="text-body-3 font-semibold text-success tabular" data-testid="earn-lifetime">
          {mask(formatUsd(lifetime))}
        </span>
      </div>
      {loading ? (
        <Skeleton width="100%" height={48} rounded="lg" />
      ) : positions.length === 0 ? (
        <Link to="/earn" className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3 text-body-3 text-text-2 hover:bg-surface-2">
          <PiggyBank size={18} className="text-accent" /> Earn yield on mUSDC, mUSDT and ETH. No lockup.
        </Link>
      ) : (
        <ul className="flex flex-col">
          {positions.map((p) => {
            const v = vaultOf(p, vaults.data)
            const token = v?.asset
            return (
              <li key={String(typeof p.vault === 'object' ? p.vault.address : p.vault)}>
                <Link to={`/earn/${v?.address ?? p.vault}`} className="flex items-center gap-3 rounded-xl px-1 py-2 hover:bg-surface-2">
                  <TokenLogo token={token ? { symbol: token.symbol === 'WETH' ? 'ETH' : token.symbol, address: token.address } : undefined} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-3 font-semibold">{token?.symbol === 'WETH' ? 'ETH' : token?.symbol ?? v?.symbol}</span>
                    {v && <span className="block text-body-4 text-success">{v.apyPct.toFixed(2)}% APY</span>}
                  </span>
                  <span className="text-right">
                    <span className="block text-body-3 font-medium tabular">{p.valueUsd == null ? '-' : mask(formatUsd(p.valueUsd))}</span>
                    {token && <span className="block text-body-4 text-text-2 tabular">{mask(`${formatTokenAmount(BigInt(p.assets || '0'), token.decimals)} ${token.symbol === 'WETH' ? 'ETH' : token.symbol}`)}</span>}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function nftImage(n: PortfolioNft): string | undefined {
  if (n.image) return n.image
  const uri = n.tokenURI
  if (!uri) return undefined
  try {
    if (uri.startsWith('data:application/json;base64,')) return (JSON.parse(atob(uri.slice(29))) as { image?: string }).image
    if (uri.startsWith('data:application/json')) return (JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(',') + 1))) as { image?: string }).image
    if (uri.startsWith('data:image')) return uri
  } catch {
    /* malformed */
  }
  return undefined
}

/** Grid of V3 position NFT images (on-chain tokenURI SVGs). */
export function NftGrid({ nfts, loading }: { nfts: PortfolioNft[]; loading: boolean }) {
  if (loading)
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} width="100%" height={260} rounded="lg" />
        ))}
      </div>
    )
  if (nfts.length === 0)
    return (
      <div className="rounded-2xl border border-border">
        <EmptyState icon={<ImageIcon size={20} />} title="No NFTs">
          MetaSwap V3 positions are NFTs. They show up here when you create one.
        </EmptyState>
      </div>
    )
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" data-testid="portfolio-nfts">
      {nfts.map((n) => {
        const img = nftImage(n)
        return (
          <Link key={n.tokenId} to={`/positions/v3/${n.tokenId}`} className="group overflow-hidden rounded-2xl border border-border bg-surface-1 transition-colors hover:border-surface-3-solid">
            <div className={cn('aspect-[290/500] w-full bg-surface-2', !img && 'flex items-center justify-center text-text-3')}>
              {img ? <img src={img} alt={`Position #${n.tokenId}`} className="size-full object-cover" loading="lazy" /> : <ImageIcon size={28} />}
            </div>
            <div className="px-3 py-2 text-body-3 font-semibold">{n.name ?? `MetaSwap V3 #${n.tokenId}`}</div>
          </Link>
        )
      })}
    </div>
  )
}

/** Value of a raw balance (helper for components that don't have USD). */
export function usdOf(raw: bigint, decimals: number, price: number | null | undefined): number | null {
  return price == null ? null : toNumber(raw, decimals) * price
}
