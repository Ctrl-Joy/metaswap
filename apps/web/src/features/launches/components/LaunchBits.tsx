import { useEffect, useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { Badge, TokenLogo } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/format'
import type { LaunchRow, LaunchStatus } from '../types'

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** "1d 8h 45m" / "3h 33m 1s" style countdown. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${sec}s`
  return `${m}m ${sec}s`
}

export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-'
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function Countdown({ to, testId, className }: { to: number; testId?: string; className?: string }) {
  const now = useNow()
  return (
    <span className={cn('tabular', className)} data-testid={testId}>
      {formatCountdown(to - now)}
    </span>
  )
}

const STATUS_COPY: Record<LaunchStatus, { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'critical' }> = {
  upcoming: { label: 'Starting soon', tone: 'neutral' },
  active: { label: 'Live auction', tone: 'accent' },
  ended: { label: 'Ended · awaiting settlement', tone: 'warning' },
  launched: { label: 'Launched', tone: 'success' },
  failed: { label: 'Failed · refunds open', tone: 'critical' },
}

export function LaunchStatusBadge({ status, testId }: { status: LaunchStatus; testId?: string }) {
  const c = STATUS_COPY[status]
  return (
    <Badge tone={c.tone}>
      {status === 'active' && <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />}
      <span data-testid={testId} data-status={status}>
        {c.label}
      </span>
    </Badge>
  )
}

/** Thin progress bar (threshold met / time elapsed). */
export function ProgressBar({ value, className, tone = 'text' }: { value: number; className?: string; tone?: 'text' | 'success' | 'accent' }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <span className={cn('block h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span className={cn('block h-full rounded-full', tone === 'success' ? 'bg-success' : tone === 'accent' ? 'bg-accent-fill' : 'bg-text-1')} style={{ width: `${pct}%` }} />
    </span>
  )
}

export function LaunchTokenLogo({ row, size = 32 }: { row: Pick<LaunchRow, 'symbol' | 'logoURI' | 'token'>; size?: number }) {
  // launched tokens have no generated /tokens/<SYMBOL>.svg; fall back to coloured initials
  return <TokenLogo token={{ symbol: row.symbol, address: row.token, logoURI: row.logoURI ?? `/tokens/${row.symbol}.svg` }} size={size} />
}

export function VerifiedMark({ verified }: { verified: boolean }) {
  if (!verified) return null
  return <BadgeCheck size={16} className="shrink-0 text-accent" aria-label="Verified" />
}


export { formatDuration }
