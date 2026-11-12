import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowRight, ChartNoAxesColumnIncreasing, ChevronDown, Info, Plus, Rocket, Sparkles, TrendingUp } from 'lucide-react'
import { ButtonLink, Marquee, Skeleton, Tooltip } from '@/components/ui'
import { LogoMark } from '@/components/layout/Logo'
import { cn } from '@/lib/cn'
import { useLaunches, useTrendingLaunches, type LaunchStatusFilter } from './api'
import { launchpadName, type LaunchRow } from './types'
import { Countdown, formatAge, LaunchStatusBadge, ProgressBar, VerifiedMark, useNow } from './components/LaunchBits'
import { usdCompact, Delta, LaunchCard, LaunchCardSkeleton, LaunchLogo, LaunchPill, LaunchPillSkeleton, LaunchpadIcon } from './components/LaunchVisuals'

const auctionHref = (r: LaunchRow) => `/launches/${r.auction}`

/** /launches — measured against Uniswap's Launches page (docs/analysis/launches-spec.md). */
export function LaunchesHome() {
  const launched = useLaunches({ status: 'launched', sort: 'volume' })
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-9 px-4 pt-6 pb-12 md:px-10" data-testid="launches-page">
      <LaunchBanner rows={launched.data ?? []} loading={launched.isLoading || launched.isError} />
      <TrendingLaunches />
      <AllLaunches />
      <Auctions />
    </div>
  )
}

function SectionTitle({ children, info, right }: { children: ReactNode; info?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 md:mb-4">
      <h2 className="flex items-center gap-1.5 text-body-1 font-medium">
        {children}
        {info && (
          <Tooltip content={info}>
            <button type="button" aria-label="More info" className="inline-flex text-text-3 hover:text-text-2">
              <Info size={16} />
            </button>
          </Tooltip>
        )}
      </h2>
      {right}
    </div>
  )
}

/* ------------------------------------------------------------------ 1. banner */

function LaunchBanner({ rows, loading }: { rows: LaunchRow[]; loading: boolean }) {
  const items = rows.filter((r) => r.change1d !== undefined && r.change1d !== null).slice(0, 20)
  return (
    <section
      className="flex flex-col gap-4 overflow-hidden rounded-3xl border-[0.8px] border-border bg-surface-1 p-4 md:p-6"
      style={{ backgroundImage: 'radial-gradient(color-mix(in srgb, var(--ms-text-1) 5%, transparent) 1px, transparent 1px)', backgroundSize: '16px 16px' }}
      data-testid="launch-banner"
    >
      <div className="flex items-center gap-3 md:gap-4">
        <span className="relative size-[52px] shrink-0" aria-hidden>
          <span className="absolute top-0 left-0 flex size-10 items-center justify-center rounded-xl bg-accent-fill">
            <span className="text-white">
              <LogoMark size={24} />
            </span>
          </span>
          <span className="absolute right-0 bottom-0 flex size-7 items-center justify-center rounded-lg border-2 border-surface-1 bg-surface-3 text-text-1">
            <Rocket size={14} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-body-1 font-medium">Launch and trade</div>
          <div className="text-body-3 text-text-2 md:text-body-2">
            Trade new MetaChain tokens on{' '}
            <a href="#all-launches" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              <Rocket size={14} />
              Launchpads
            </a>
          </div>
        </div>
        <Link to="/launches/create" aria-label="Launch a token" data-testid="banner-create" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-1 transition-colors hover:bg-surface-3-hover">
          <ArrowRight size={24} />
        </Link>
      </div>
      <div data-testid="launch-ticker" data-state={loading ? 'loading' : items.length ? 'ready' : 'empty'}>
        {loading || items.length === 0 ? (
          <div className="flex gap-2 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_24px,#000_calc(100%-24px),transparent)]">
            {[150, 120, 170, 140, 160, 130, 150].map((w, i) => (
              <LaunchPillSkeleton key={i} width={w} />
            ))}
          </div>
        ) : (
          <Marquee fade itemGap={8} speed={35} ariaLabel="Launched tokens ticker">
            {items.map((r) => (
              <LaunchPill key={r.auction} row={r} to={auctionHref(r)} />
            ))}
          </Marquee>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ 2. trending */

function TrendingLaunches() {
  const q = useTrendingLaunches()
  const rows = q.data ?? []
  return (
    <section data-testid="trending-launches">
      <SectionTitle
        info="Launched tokens ranked by 24h trading volume."
        right={
          <a href="#all-launches" className="text-body-3 font-semibold text-text-2 hover:text-text-1" data-testid="trending-view-all">
            View all
          </a>
        }
      >
        Trending launches
      </SectionTitle>
      {q.isLoading || rows.length === 0 ? (
        <div className="relative">
          <div className="flex gap-3 overflow-hidden" data-state={q.isLoading ? 'loading' : 'empty'}>
            {[0, 1, 2, 3, 4].map((i) => (
              <LaunchCardSkeleton key={i} />
            ))}
          </div>
          {!q.isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-full border-[0.8px] border-border bg-surface-1 px-4 py-2 text-body-3 text-text-2 shadow-short">
                {q.isError ? 'Launches are unavailable right now.' : 'No launched tokens yet.'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="[&_button[aria-label^=Scroll]]:opacity-0 [&_button[aria-label^=Scroll]]:transition-opacity hover:[&_button[aria-label^=Scroll]]:opacity-100 focus-within:[&_button[aria-label^=Scroll]]:opacity-100">
        <Marquee fade arrows itemGap={12} speed={30} ariaLabel="Trending launches" testId="trending-strip">
          {rows.map((r) => (
            <LaunchCard key={r.auction} row={r} to={auctionHref(r)} />
          ))}
        </Marquee>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ 3. all launches */

type ListMode = 'all' | 'recent' | 'trending'

function FilterChip({ active, onClick, icon, children, testId }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode; testId: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={cn('inline-flex h-9 items-center gap-1.5 rounded-full px-3 py-2 text-body-3 font-semibold whitespace-nowrap transition-colors', active ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:text-text-1')}
    >
      {icon}
      {children}
    </button>
  )
}

function Dropdown({ value, onChange, children, ariaLabel, testId, leading, className }: { value: string; onChange: (v: string) => void; children: ReactNode; ariaLabel: string; testId?: string; leading?: ReactNode; className?: string }) {
  return (
    <label className={cn('relative inline-flex h-10 items-center gap-2 rounded-xl border-[0.8px] border-border bg-surface-1 pr-1.5 pl-3 text-body-3 font-semibold hover:bg-surface-2', className)}>
      {leading}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} data-testid={testId} className="absolute inset-0 cursor-pointer opacity-0">
        {children}
      </select>
      <span className="pointer-events-none truncate">{leading ? null : ariaLabelValue(children, value)}</span>
      <ChevronDown size={20} className="pointer-events-none shrink-0 text-text-2" />
    </label>
  )
}

function ariaLabelValue(children: ReactNode, value: string): string {
  const opts = (Array.isArray(children) ? children.flat() : [children]) as Array<{ props?: { value?: string; children?: ReactNode } }>
  const hit = opts.find((o) => o?.props?.value === value)
  return String(hit?.props?.children ?? '')
}

function useParam(key: string) {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? ''
  const set = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(key, v)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  return [value, set] as const
}

function usePadNames(): string[] {
  const q = useLaunches({ status: 'all' })
  return useMemo(() => [...new Set((q.data ?? []).map(launchpadName).filter(Boolean))].sort(), [q.data])
}

const TH = 'h-[42px] px-3 text-body-3 font-medium text-text-2 whitespace-nowrap first:rounded-l-xl last:rounded-r-xl'
const TD = 'px-3 py-4 whitespace-nowrap'

function AllLaunches() {
  const [mode, setMode] = useState<ListMode>('all')
  const [launchpad, setLaunchpad] = useParam('launchpad')
  const q = useLaunches({ status: 'launched', sort: mode === 'recent' ? 'age' : 'volume', launchpad: launchpad || undefined })
  const pads = usePadNames()
  const navigate = useNavigate()
  const rows = useMemo(() => {
    let r = q.data ?? []
    if (mode === 'recent') r = [...r].sort((a, b) => (a.ageSec ?? Infinity) - (b.ageSec ?? Infinity))
    if (mode === 'trending') r = [...r].sort((a, b) => (b.volume24hUsd ?? 0) * Math.abs(b.change1d ?? 0) - (a.volume24hUsd ?? 0) * Math.abs(a.change1d ?? 0))
    else if (mode === 'all') r = [...r].sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    if (launchpad) r = r.filter((x) => launchpadName(x) === launchpad)
    return r
  }, [q.data, mode, launchpad])

  return (
    <section id="all-launches" className="scroll-mt-24" data-testid="all-launches">
      <SectionTitle>All launches</SectionTitle>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 md:mb-6">
        <div role="tablist" aria-label="Launch list" className="-mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
          <FilterChip active={mode === 'all'} onClick={() => setMode('all')} icon={<ChartNoAxesColumnIncreasing size={16} strokeWidth={2.5} />} testId="launches-mode-all">
            All
          </FilterChip>
          <FilterChip active={mode === 'recent'} onClick={() => setMode('recent')} icon={<Sparkles size={16} />} testId="launches-mode-recent">
            Recently launched
          </FilterChip>
          <FilterChip active={mode === 'trending'} onClick={() => setMode('trending')} icon={<TrendingUp size={16} />} testId="launches-mode-trending">
            Trending
          </FilterChip>
        </div>
        <div className="flex items-center gap-2">
          <Dropdown value={launchpad} onChange={setLaunchpad} ariaLabel="Launchpad" testId="launchpad-filter">
            <option value="">All launchpads</option>
            {pads.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Dropdown>
          <Dropdown value="devnet" onChange={() => undefined} ariaLabel="Network" leading={<LaunchpadIcon name={launchpad || 'MetaSwap'} size={24} />} className="pl-3">
            <option value="devnet">MetaChain Devnet</option>
          </Dropdown>
        </div>
      </div>
      <div className="overflow-x-auto [scrollbar-width:thin]">
        <table className="w-full min-w-[880px] border-separate border-spacing-0 text-left text-body-2">
          <thead>
            <tr className="bg-surface-2">
              <th className={cn(TH, 'w-14 text-center')}>#</th>
              <th className={TH}>Token</th>
              <th className={TH}>Launchpad</th>
              <th className={cn(TH, 'text-right')}>FDV</th>
              <th className={cn(TH, 'text-right', mode !== 'recent' && 'text-text-1')}>
                <span className="inline-flex items-center gap-1">
                  {mode !== 'recent' && <ArrowDown size={14} />}24H volume
                </span>
              </th>
              <th className={cn(TH, 'text-right')}>Liquidity</th>
              <th className={cn(TH, 'text-right')}>1H</th>
              <th className={cn(TH, 'text-right')}>1D</th>
              <th className={cn(TH, 'text-right', mode === 'recent' && 'text-text-1')}>Age</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading
              ? [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="h-[74px]" aria-hidden>
                    <td className={cn(TD, 'text-center')}><Skeleton width={12} height={14} /></td>
                    <td className={TD}><span className="flex items-center gap-3"><Skeleton width={32} height={32} /><span className="flex flex-col gap-1.5"><Skeleton width={96} height={14} /><Skeleton width={56} height={12} /></span></span></td>
                    {[80, 64, 64, 64, 56, 56, 32].map((w, j) => (
                      <td key={j} className={cn(TD, j > 0 && 'text-right')}><Skeleton width={w} height={14} /></td>
                    ))}
                  </tr>
                ))
              : rows.map((r, i) => (
                  <tr key={r.auction} onClick={() => navigate(auctionHref(r))} className="h-[74px] cursor-pointer transition-colors hover:bg-surface-2/60" data-testid={`launch-row-${r.symbol}`}>
                    <td className={cn(TD, 'text-center tabular')}>{i + 1}</td>
                    <td className={TD}>
                      <Link to={auctionHref(r)} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <LaunchLogo row={r} size={32} badge={12} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 font-medium">
                            {r.name} <VerifiedMark verified={r.verified} />
                          </span>
                          <span className="block text-body-3 text-text-2">{r.symbol}</span>
                        </span>
                      </Link>
                    </td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-2 font-medium">
                        <LaunchpadIcon name={launchpadName(r)} size={20} />
                        {launchpadName(r)}
                      </span>
                    </td>
                    <td className={cn(TD, 'text-right tabular')}>{usdCompact(r.fdvUsd)}</td>
                    <td className={cn(TD, 'text-right tabular')}>{usdCompact(r.volume24hUsd)}</td>
                    <td className={cn(TD, 'text-right tabular')}>{usdCompact(r.liquidityUsd)}</td>
                    <td className={cn(TD, 'text-right')}>
                      <Delta value={r.change1h} />
                    </td>
                    <td className={cn(TD, 'text-right')}>
                      <Delta value={r.change1d} />
                    </td>
                    <td className={cn(TD, 'text-right text-text-2 tabular')}>{formatAge(r.ageSec)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {!q.isLoading && rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center" data-testid="launches-empty">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-text-2">
            <Rocket size={22} />
          </span>
          <div className="text-body-1 font-medium">{q.isError ? 'Launches unavailable' : 'No launches yet'}</div>
          <p className="max-w-sm text-body-3 text-text-2">{q.isError ? 'The MetaSwap API is not reachable.' : 'Tokens that graduate from an auction show up here with their pool stats.'}</p>
          <ButtonLink to="/launches/create" size="md">
            Launch a token
          </ButtonLink>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ 4. auctions (same table spec) */

function Auctions() {
  const [status, setStatus] = useState<LaunchStatusFilter>('active')
  const q = useLaunches({ status, sort: 'bidVolume' })
  const navigate = useNavigate()
  const now = useNow(5000)
  const rows = (q.data ?? []).slice(0, 8)
  return (
    <section data-testid="auctions">
      <SectionTitle
        right={
          <span className="flex items-center gap-3">
            <Link to="/launches/create" className="inline-flex items-center gap-1 text-body-3 font-semibold text-text-2 hover:text-text-1" data-testid="launch-auction">
              <Plus size={16} /> Launch auction
            </Link>
            <Link to="/explore/auctions" className="text-body-3 font-semibold text-text-2 hover:text-text-1" data-testid="auctions-view-all">
              View all auctions
            </Link>
          </span>
        }
      >
        Auctions
      </SectionTitle>
      <div role="tablist" aria-label="Auction status" className="mb-4 flex flex-wrap items-center gap-1">
        {(
          [
            ['active', 'Live'],
            ['upcoming', 'Starting soon'],
            ['failed', 'Failed'],
          ] as const
        ).map(([v, label]) => (
          <FilterChip key={v} active={status === v} onClick={() => setStatus(v)} icon={null} testId={`auctions-${v}`}>
            {label}
          </FilterChip>
        ))}
      </div>
      <div className="overflow-x-auto [scrollbar-width:thin]">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-body-2">
          <thead>
            <tr className="bg-surface-2">
              <th className={TH}>Token</th>
              <th className={cn(TH, 'text-right')}>FDV at floor</th>
              <th className={cn(TH, 'text-right')}>Bid volume</th>
              <th className={cn(TH, 'text-right')}>Launch threshold</th>
              <th className={cn(TH, 'text-right')}>Status</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading
              ? [0, 1, 2].map((i) => (
                  <tr key={i} className="h-[74px]" aria-hidden>
                    <td className={TD}><span className="flex items-center gap-3"><Skeleton width={32} height={32} /><Skeleton width={120} height={14} /></span></td>
                    {[64, 64, 72, 96].map((w, j) => (
                      <td key={j} className={cn(TD, 'text-right')}><Skeleton width={w} height={14} /></td>
                    ))}
                  </tr>
                ))
              : rows.map((r) => (
                  <tr key={r.auction} onClick={() => navigate(auctionHref(r))} className="h-[74px] cursor-pointer transition-colors hover:bg-surface-2/60" data-testid={`auction-row-${r.symbol}`}>
                    <td className={TD}>
                      <span className="flex items-center gap-3">
                        <LaunchLogo row={r} size={32} badge={12} />
                        <span className="font-medium">{r.name}</span>
                        <span className="text-text-2">{r.symbol}</span>
                        <VerifiedMark verified={r.verified} />
                      </span>
                    </td>
                    <td className={cn(TD, 'text-right tabular')}>{usdCompact(r.fdvAtFloorUsd)}</td>
                    <td className={cn(TD, 'text-right tabular')}>{r.bidVolumeUsd ? usdCompact(r.bidVolumeUsd) : '-'}</td>
                    <td className={cn(TD, 'text-right')}>
                      <span className="block tabular">{usdCompact(r.thresholdUsd)}</span>
                      <span className="block text-body-4 text-text-2 tabular">{(r.thresholdPct ?? 0).toFixed(2)}% met</span>
                    </td>
                    <td className={cn(TD, 'w-48 text-right')}>
                      <StatusCell row={r} now={now} />
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {!q.isLoading && rows.length === 0 && (
        <p className="py-8 text-center text-body-3 text-text-2" data-testid="auctions-empty">
          {q.isError ? 'Auctions are unavailable right now.' : status === 'active' ? 'No live auctions right now.' : status === 'upcoming' ? 'No auctions starting soon.' : 'No failed auctions.'}
        </p>
      )}
    </section>
  )
}

function StatusCell({ row, now }: { row: LaunchRow; now: number }) {
  if (row.status === 'active') {
    const total = Math.max(1, row.endTime - row.startTime)
    return (
      <span className="flex flex-col items-end gap-1">
        <ProgressBar value={((now - row.startTime) / total) * 100} className="w-24" />
        <Countdown to={row.endTime} className="text-body-4 text-text-2" />
      </span>
    )
  }
  if (row.status === 'upcoming')
    return (
      <span className="flex flex-col items-end">
        <span className="font-medium">Starting soon</span>
        <Countdown to={row.startTime} className="text-body-4 text-text-2" />
      </span>
    )
  return (
    <span className="flex justify-end">
      <LaunchStatusBadge status={row.status} />
    </span>
  )
}
