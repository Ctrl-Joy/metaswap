import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDown, ChevronsUpDown, Coins, Eye, EyeOff, Image as ImageIcon, Layers, MoreHorizontal, PiggyBank } from 'lucide-react'
import { DoubleLogo, EmptyState, PercentChange, Popover, Skeleton, TokenLogo } from '@/components/ui'
import { useSettings } from '@/state/settings'
import { NameCell, PfHead, PfSectionHeader, PfTable, PfTd, PfTh, PfTr, PillLink } from './ui'
import type { EarnPosition, EarnVault, PortfolioNft, PositionRow } from '@/api/types'
import { useEarnVaults } from '@/api/hooks'
import { useTokenList } from '@/features/tokens/useTokenList'
import { formatPrice, formatTokenAmount, formatUsd } from '@/lib/format'
import { toNumber } from '@/lib/amount'
import { cn } from '@/lib/cn'
import { CHAIN_SLUG } from '@/config'
import { useMask, type HiddenRow, type HoldingRow } from './usePortfolioData'

export function SectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return <PfSectionHeader title={title} subtitle={subtitle} right={right} />
}

export function ViewAll({ to, label, testId }: { to: string; label: string; testId?: string }) {
  return <PillLink to={to} label={label} testId={testId} className="mt-4" />
}

function Pnl({ usd, pct }: { usd: number | null; pct: number | null }) {
  const mask = useMask()
  if (usd === null) return <span className="text-text-3">-</span>
  return (
    <span className="inline-flex flex-col items-end">
      <span className="tabular text-text-1">{mask(`${usd < 0 ? '-' : ''}${formatUsd(Math.abs(usd))}`)}</span>
      <PnlPct pct={pct ?? 0} />
    </span>
  )
}

/** "▲ 20.43%": coloured triangle, grey number (Uniswap P/L sub-line). */
function PnlPct({ pct }: { pct: number }) {
  const r = Number(pct.toFixed(2))
  return (
    <span className="inline-flex items-center gap-1 text-text-2 tabular">
      <span aria-hidden className={cn('text-[0.7em]', r > 0 ? 'text-success' : r < 0 ? 'text-critical' : 'text-text-3')}>
        {r < 0 ? '▼' : '▲'}
      </span>
      {Math.abs(r).toLocaleString('en-US', { maximumFractionDigits: 2 })}%
    </span>
  )
}

/** Row "⋯" menu: hide / unhide a token (stored in settings.hiddenTokens). */
function RowMenu({ row, hidden }: { row: HoldingRow; hidden: boolean }) {
  const toggle = useSettings((s) => s.toggleHiddenToken)
  if (row.token.isNative && !hidden) return <span className="inline-block size-7" />
  return (
    <Popover
      align="end"
      className="w-[180px] p-1.5"
      trigger={
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`${row.token.symbol} options`}
          data-testid={`token-menu-${row.token.symbol}`}
          className="inline-flex size-7 items-center justify-center rounded-xl text-text-2 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-3 hover:text-text-1 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal size={18} />
        </button>
      }
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggle(row.token.address)
        }}
        data-testid={`token-${hidden ? 'unhide' : 'hide'}-${row.token.symbol}`}
        className="flex h-10 w-full items-center gap-2 rounded-lg px-2 text-body-3 font-semibold hover:bg-surface-2"
      >
        {hidden ? <Eye size={16} /> : <EyeOff size={16} />} {hidden ? 'Unhide token' : 'Hide token'}
      </button>
    </Popover>
  )
}

function AllocationBar({ pct }: { pct: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="tabular">{pct.toFixed(1)}%</span>
      <span className="relative h-1 w-[52px] overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-text-1" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </span>
    </span>
  )
}

/**
 * Portfolio tokens table. `overview`: Token, Price, Balance, Value, Unrealized P/L (Overview card, 752px).
 * `full`: adds Avg cost, 1D change and Allocation, sorted by Value ↓, with a per-row Hide menu (Tokens tab).
 */
export function TokensTable({ rows, loading, limit, variant = 'overview', hidden = false, totalUsd, emptyWhenNone = true }: { rows: HoldingRow[]; loading: boolean; limit?: number; variant?: 'overview' | 'full'; hidden?: boolean; totalUsd?: number | null; emptyWhenNone?: boolean; /** @deprecated */ sparklines?: boolean }) {
  const navigate = useNavigate()
  const mask = useMask()
  const full = variant === 'full'
  const shown = limit ? rows.slice(0, limit) : rows
  const total = totalUsd ?? rows.reduce((s, r) => s + (r.valueUsd ?? 0), 0)
  if (!loading && rows.length === 0 && emptyWhenNone)
    return (
      <div className="rounded-2xl border border-border">
        <EmptyState icon={<Coins size={20} />} title="No tokens yet">
          Get free test tokens on the <Link to="/buy" className="text-accent hover:underline">Buy</Link> page.
        </EmptyState>
      </div>
    )
  return (
    <PfTable minWidth={full ? 1000 : 600}>
      {!hidden && (
        <PfHead>
          <PfTh>Token</PfTh>
          <PfTh align="right">Price</PfTh>
          {full && <PfTh align="right">Avg cost</PfTh>}
          {full && <PfTh align="right">1D change</PfTh>}
          <PfTh align="right">Balance</PfTh>
          <PfTh align="right" className={cn(full && 'text-text-1')}>
            {full && <ArrowDown size={14} className="mr-1 inline align-[-2px]" aria-hidden />}Value
          </PfTh>
          <PfTh align="right">Unrealized P/L</PfTh>
          {full && <PfTh align="right">Allocation</PfTh>}
          {full && <PfTh className="w-12 px-2" aria-label="Actions" />}
        </PfHead>
      )}
      {loading ? (
        <tbody>
          {[0, 1, 2, 3].map((i) => (
            <tr key={i} className="h-[72px]">
              <td className="px-5" colSpan={full ? 9 : 5}>
                <span className="flex items-center gap-3">
                  <Skeleton width={32} height={32} rounded="full" />
                  <Skeleton width={160} height={14} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      ) : (
        <tbody data-testid={hidden ? 'portfolio-hidden-tokens' : 'portfolio-tokens'}>
          {shown.map((r) => (
            <PfTr
              key={r.token.address}
              onClick={() => navigate(`/explore/tokens/${CHAIN_SLUG}/${r.token.isNative ? 'NATIVE' : r.token.address}`)}
              data-testid={`portfolio-token-${r.token.symbol}`}
              className={cn(hidden && 'opacity-60')}
            >
              <PfTd>
                <NameCell
                  logo={<TokenLogo token={r.token} size={32} chainBadge />}
                  name={r.token.name}
                  sub={
                    <>
                      {r.token.symbol}
                      {hidden && 'reason' in r && <span className="ml-1.5 text-text-3">· {(r as HiddenRow).reason === 'spam' ? 'Unverified' : (r as HiddenRow).reason === 'small' ? 'Small balance' : 'Hidden'}</span>}
                    </>
                  }
                />
              </PfTd>
              <PfTd align="right">{formatPrice(r.priceUsd)}</PfTd>
              {full && <PfTd align="right">{r.avgCostUsd == null ? <span className="text-text-3">-</span> : formatPrice(r.avgCostUsd)}</PfTd>}
              {full && (
                <PfTd align="right">
                  <PercentChange value={r.change24h} />
                </PfTd>
              )}
              <PfTd align="right">{mask(`${formatTokenAmount(r.balance, r.token.decimals)} ${r.token.symbol}`)}</PfTd>
              <PfTd align="right">{r.valueUsd === null ? '-' : mask(formatUsd(r.valueUsd))}</PfTd>
              <PfTd align="right">
                <Pnl usd={r.unrealizedPnlUsd} pct={r.unrealizedPnlPct} />
              </PfTd>
              {full && <PfTd align="right">{total > 0 && r.valueUsd != null ? <AllocationBar pct={(r.valueUsd / total) * 100} /> : <span className="text-text-3">-</span>}</PfTd>}
              {full && (
                <PfTd className="w-12 px-2" onClick={(e) => e.stopPropagation()}>
                  <RowMenu row={r} hidden={hidden} />
                </PfTd>
              )}
            </PfTr>
          ))}
        </tbody>
      )}
    </PfTable>
  )
}

/** Collapsible "Hidden tokens (n)" section (user-hidden, unverified and small balances). */
export function HiddenTokens({ rows, totalUsd }: { rows: HiddenRow[]; totalUsd?: number | null }) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null
  return (
    <div className="mt-4" data-testid="hidden-tokens">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="hidden-tokens-toggle" className="flex h-[54px] w-full items-center gap-2 rounded-xl p-4 text-left text-body-2 text-text-2 hover:text-text-1">
        Hidden tokens ({rows.length}) <ChevronsUpDown size={16} aria-hidden />
      </button>
      {open && <TokensTable rows={rows} loading={false} variant="full" hidden totalUsd={totalUsd} />}
    </div>
  )
}

function addrOf(t: PositionRow['token0']): string {
  return typeof t === 'string' ? t : t.address
}

/** Pools table (Pool, Status, Fees, Value) in the portfolio table style. */
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
    <PfTable minWidth={520}>
      <PfHead>
        <PfTh>Pool</PfTh>
        <PfTh align="center">Status</PfTh>
        <PfTh align="right">Fees</PfTh>
        <PfTh align="right">Value</PfTh>
      </PfHead>
      {loading ? (
        <tbody>
          {[0, 1].map((i) => (
            <tr key={i} className="h-[56px]">
              <td className="px-5" colSpan={4}>
                <Skeleton width={200} height={14} />
              </td>
            </tr>
          ))}
        </tbody>
      ) : (
        <tbody data-testid="portfolio-pools">
          {(limit ? rows.slice(0, limit) : rows).map((p) => {
            const t0 = find(addrOf(p.token0))
            const t1 = find(addrOf(p.token1))
            const fees = (p.uncollectedFees as { valueUsd?: number | null } | undefined)?.valueUsd ?? p.uncollectedFeesUsd ?? null
            const href = p.version === 'v3' ? `/positions/v3/${p.tokenId}` : `/positions/v2/${p.pair ?? p.pool}`
            return (
              <PfTr key={`${p.version}-${p.tokenId ?? p.pair}`} onClick={() => navigate(href)} className="h-[64px]">
                <PfTd>
                  <NameCell
                    logo={<DoubleLogo token0={t0} token1={t1} size={28} />}
                    name={`${t0?.symbol ?? '?'} / ${t1?.symbol ?? '?'}`}
                    sub={`${p.fee ? `${p.fee / 10_000}% • ` : ''}${p.version}`}
                  />
                </PfTd>
                <PfTd align="center">
                  <span className={cn('inline-flex h-[22px] items-center rounded-lg px-2 text-body-3', p.inRange ? 'bg-success/12 text-success' : 'bg-warning/12 text-warning')}>{p.inRange ? 'In range' : 'Out of range'}</span>
                </PfTd>
                <PfTd align="right">{fees === null ? '-' : mask(formatUsd(fees))}</PfTd>
                <PfTd align="right">{p.valueUsd == null ? '-' : mask(formatUsd(p.valueUsd as number))}</PfTd>
              </PfTr>
            )
          })}
        </tbody>
      )}
    </PfTable>
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
      <div className="mb-4 flex items-end justify-between px-2">
        <div>
          <h2 className="text-body-1 font-medium">
            Earn{positions.length > 0 && <span> · {mask(formatUsd(total))}</span>}
          </h2>
          <div className="text-body-3 text-text-2">Lifetime earnings</div>
        </div>
        <span className="text-body-3 text-success tabular" data-testid="earn-lifetime">
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
                <Link to={`/earn/${v?.address ?? p.vault}`} className="flex h-[52px] items-center gap-3 rounded-xl px-2 hover:bg-surface-2">
                  <TokenLogo token={token ? { symbol: token.symbol === 'WETH' ? 'ETH' : token.symbol, address: token.address } : undefined} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-3">{token?.symbol === 'WETH' ? 'ETH' : token?.symbol ?? v?.symbol}</span>
                    {v && <span className="block text-body-4 text-accent">{v.apyPct.toFixed(2)}% APY</span>}
                  </span>
                  <span className="text-right">
                    <span className="block text-body-3 tabular">{p.valueUsd == null ? '-' : mask(formatUsd(p.valueUsd))}</span>
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

/** Grid of V3 position NFTs: 200×262 cards (4px pad, 190px rounded art, name + collection), Uniswap metrics. */
export function NftGrid({ nfts, loading }: { nfts: PortfolioNft[]; loading: boolean }) {
  if (loading)
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,200px)]">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} width="100%" height={262} rounded="lg" />
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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,200px)]" data-testid="portfolio-nfts">
      {nfts.map((n) => {
        const img = nftImage(n)
        return (
          <Link key={n.tokenId} to={`/positions/v3/${n.tokenId}`} className="group flex flex-col gap-1 rounded-2xl border border-border p-1 transition-colors hover:bg-surface-2" data-testid="nft-card">
            <div className={cn('aspect-square w-full overflow-hidden rounded-xl bg-surface-3-solid', !img && 'flex items-center justify-center text-text-3')}>
              {img ? <img src={img} alt={`Position #${n.tokenId}`} className="size-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.03]" loading="lazy" /> : <ImageIcon size={28} />}
            </div>
            <div className="flex flex-col gap-1 px-3 pt-2 pb-2.5">
              <span className="truncate text-body-3 text-text-1">{n.name ?? `MetaSwap V3 #${n.tokenId}`}</span>
              <span className="truncate text-body-4 text-text-2">MetaSwap V3 Positions NFT</span>
              <span className="text-body-4 text-text-2">#{n.tokenId}</span>
            </div>
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
