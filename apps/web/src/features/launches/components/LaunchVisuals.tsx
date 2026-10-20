// Launches-page building blocks measured from Uniswap's Launches page (docs/analysis/launches-spec.md).
import { Link } from 'react-router-dom'
import { Rocket } from 'lucide-react'
import { hueFrom, Skeleton, TokenLogo } from '@/components/ui'
import { Sparkline } from '@/features/explore/charts/SvgCharts'
import { cn } from '@/lib/cn'
import { launchpadName, sparkValues, type LaunchRow } from '../types'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1, minimumFractionDigits: 1 })

/** Uniswap-style compact USD: $116.2M, $767.4K, $85.20, <$0.01. */
export function usdCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-'
  if (v === 0) return '$0'
  if (Math.abs(v) < 0.01) return '<$0.01'
  if (Math.abs(v) < 1000) return '$' + v.toFixed(2)
  return '$' + compact.format(v)
}

/** Stable per-token colour (same hue as the initials fallback logo). */
export function tokenHue(row: Pick<LaunchRow, 'token' | 'symbol'>): number {
  return hueFrom(row.token ?? row.symbol)
}

/** Launchpad mark: accent rounded square with a rocket for MetaSwap's pad, a hue square + initial otherwise. */
export function LaunchpadIcon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const metaswap = !name || /metaswap/i.test(name)
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center text-white', className)}
      style={{ width: size, height: size, borderRadius: Math.max(3, size * 0.28), background: metaswap ? 'var(--ms-accent-fill)' : `hsl(${hueFrom(name)} 60% 42%)` }}
    >
      {metaswap ? <Rocket size={Math.max(7, size * 0.62)} strokeWidth={2.4} /> : <span style={{ fontSize: Math.max(7, size * 0.55), fontWeight: 700, lineHeight: 1 }}>{name.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase()}</span>}
    </span>
  )
}

/** Token logo with the launchpad badge at its bottom-right (48/16, 32/12, 24/11). */
export function LaunchLogo({ row, size, badge }: { row: Pick<LaunchRow, 'token' | 'symbol' | 'logoURI' | 'launchpad'>; size: number; badge: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <TokenLogo token={{ symbol: row.symbol, address: row.token, logoURI: row.logoURI ?? undefined }} size={size} />
      <span className="absolute rounded-[5px] ring-2 ring-surface-1" style={{ right: -2, bottom: -2, borderRadius: badge * 0.3 }}>
        <LaunchpadIcon name={launchpadName(row as LaunchRow)} size={badge} />
      </span>
    </span>
  )
}

/** ▲/▼ glyph + % in success/critical (Uniswap's filled triangles). */
export function Delta({ value, className, testId }: { value: number | null | undefined; className?: string; testId?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cn('text-text-3', className)}>-</span>
  const up = value >= 0
  return (
    <span className={cn('relative inline-flex items-center gap-1 tabular', up ? 'text-success' : 'text-critical', className)} data-testid={testId}>
      <svg width="9" height="8" viewBox="0 0 9 8" aria-hidden className={up ? '' : 'rotate-180'}>
        <path d="M4.5 0 9 8H0z" fill="currentColor" />
      </svg>
      {Math.abs(value).toFixed(2)}%<span className="sr-only">{up ? ' up' : ' down'}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ ticker pill (42px) */

export function LaunchPill({ row, to }: { row: LaunchRow; to: string }) {
  return (
    <Link
      to={to}
      data-testid={`launch-pill-${row.symbol}`}
      className="flex h-[42px] items-center gap-2 rounded-full border-[0.8px] border-border bg-surface-2 px-3 py-2 whitespace-nowrap transition-colors hover:bg-surface-2-hover"
    >
      <LaunchLogo row={row} size={24} badge={11} />
      <span className="text-body-3 font-medium">{row.name}</span>
      <Delta value={row.change1d} className="text-body-3 font-medium" />
    </Link>
  )
}

export function LaunchPillSkeleton({ width = 150 }: { width?: number }) {
  return (
    <span className="flex h-[42px] items-center gap-2 rounded-full border-[0.8px] border-border bg-surface-2 px-3" style={{ width }} aria-hidden>
      <Skeleton width={24} height={24} />
      <Skeleton width={width - 90} height={12} />
      <Skeleton width={36} height={12} />
    </span>
  )
}

/* ------------------------------------------------------------------ trending card (271×150) */

export function LaunchpadChip({ name, testId, maxWidth }: { name: string; testId?: string; maxWidth?: number }) {
  if (!name) return null
  return (
    <span className="inline-flex h-[34px] min-w-0 shrink-0 items-center gap-1.5 rounded-xl border-[0.8px] border-border bg-surface-1 px-2 py-1.5 text-body-3 font-medium" data-testid={testId} title={name}>
      <LaunchpadIcon name={name} size={20} />
      <span className="truncate" style={{ maxWidth }}>{name}</span>
    </span>
  )
}

export function LaunchCard({ row, to }: { row: LaunchRow; to: string }) {
  const hue = tokenHue(row)
  return (
    <Link
      to={to}
      data-testid={`trending-card-${row.symbol}`}
      className="relative flex h-[150px] w-[271px] flex-col justify-between overflow-hidden rounded-[20px] bg-surface-2 p-3 transition-[filter] hover:brightness-110"
      style={{ backgroundImage: `radial-gradient(90% 70% at 60% 118%, hsl(${hue} 80% 55% / 0.12) 0%, transparent 60%)` }}
    >
      <div className="flex items-start gap-3">
        <LaunchLogo row={row} size={48} badge={16} />
        <div className="relative z-[1] min-w-0 flex-1 pt-0.5">
          <div className="truncate text-body-1 font-medium">{row.name}</div>
          <div className="truncate text-body-2 text-text-2">{row.symbol}</div>
        </div>
        <div className="pointer-events-none absolute top-2 right-2">
          <Sparkline values={sparkValues(row)} width={110} height={56} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="relative z-[1] text-body-2 font-medium whitespace-nowrap tabular">
          {usdCompact(row.fdvUsd)} <span className="text-text-2">FDV</span>
        </span>
        <Delta value={row.change1d} className="text-body-3 font-medium" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-4 whitespace-nowrap tabular">
          {usdCompact(row.volume24hUsd)} <span className="text-text-2">24H volume</span>
        </span>
        <LaunchpadChip name={launchpadName(row).replace(/\s*Launchpad$/i, '') || launchpadName(row)} maxWidth={100} />
      </div>
    </Link>
  )
}

export function LaunchCardSkeleton() {
  return (
    <div className="flex h-[150px] w-[271px] flex-col justify-between rounded-[20px] bg-surface-2 p-3" aria-hidden data-testid="trending-card-skeleton">
      <div className="flex items-start gap-3">
        <Skeleton width={48} height={48} />
        <div className="flex flex-col gap-2 pt-1">
          <Skeleton width={96} height={14} />
          <Skeleton width={56} height={12} />
        </div>
      </div>
      <Skeleton width={120} height={14} />
      <div className="flex items-center justify-between">
        <Skeleton width={100} height={10} />
        <Skeleton width={72} height={34} rounded="lg" />
      </div>
    </div>
  )
}
