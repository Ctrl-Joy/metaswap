import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { BadgeCheck } from 'lucide-react'
import { t } from '@/i18n'
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
  if (d > 0) return t('{d}d {h}h {m}m', { d, h, m })
  if (h > 0) return t('{h}h {m}m {s}s', { h, m, s: sec })
  return t('{m}m {s}s', { m, s: sec })
}

export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-'
  if (seconds < 3600) return t('{n}m', { n: Math.max(1, Math.floor(seconds / 60)) })
  if (seconds < 86400) return t('{n}h', { n: Math.floor(seconds / 3600) })
  return t('{n}d', { n: Math.floor(seconds / 86400) })
}

export function Countdown({ to, testId, className }: { to: number; testId?: string; className?: string }) {
  const now = useNow()
  return (
    <span className={cn('tabular', className)} data-testid={testId}>
      {formatCountdown(to - now)}
    </span>
  )
}

const STATUS_TONE: Record<LaunchStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'critical'> = {
  upcoming: 'neutral',
  active: 'accent',
  ended: 'warning',
  launched: 'success',
  failed: 'critical',
}

/** Status label in the current language (called at render time). */
export function launchStatusLabel(status: LaunchStatus): string {
  switch (status) {
    case 'upcoming':
      return t('Starting soon')
    case 'active':
      return t('Live auction')
    case 'ended':
      return t('Ended · awaiting settlement')
    case 'launched':
      return t('Launched')
    case 'failed':
      return t('Failed · refunds open')
  }
}

/** Fills {placeholders} of an already translated string with React nodes, keeping the language's word order. */
export function withNodes(text: string, nodes: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1]
    return key !== undefined && key in nodes ? <Fragment key={i}>{nodes[key]}</Fragment> : part
  })
}

export function LaunchStatusBadge({ status, testId }: { status: LaunchStatus; testId?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      {status === 'active' && <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />}
      <span data-testid={testId} data-status={status}>
        {launchStatusLabel(status)}
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
  return <BadgeCheck size={16} className="shrink-0 text-accent" aria-label={t('Verified')} />
}


export { formatDuration }
