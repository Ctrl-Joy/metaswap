import { useMemo } from 'react'
import { ArrowLeftRight, ArrowUpRight, ArrowDownLeft, ArrowRight, Check, Droplets, Layers, X, Zap, Clock, ShieldCheck, PiggyBank, Gavel, Repeat } from 'lucide-react'
import type { Address } from 'viem'
import { EmptyState, Skeleton, Spinner, TokenLogo } from '@/components/ui'
import { useAccountActivity } from '@/api/hooks'
import { useAccountTxs } from '@/state/transactions'
import { useTokenList } from '@/features/tokens/useTokenList'
import { formatAmount, formatRelativeTime, formatUsd } from '@/lib/format'
import { cn } from '@/lib/cn'
import { filterActivity, mergeActivity, type ActivityKind, type ActivityLeg, type ActivityRowModel, type TimeFilter, type TypeFilter } from './activityModel'

export function iconFor(kind: ActivityKind) {
  switch (kind) {
    case 'swap':
      return ArrowLeftRight
    case 'send':
      return ArrowUpRight
    case 'receive':
      return ArrowDownLeft
    case 'mint':
      return Droplets
    case 'wrap':
    case 'unwrap':
      return Repeat
    case 'approve':
      return ShieldCheck
    case 'order':
      return Zap
    case 'add':
    case 'remove':
    case 'collect':
      return Layers
    case 'earn-deposit':
    case 'earn-withdraw':
      return PiggyBank
    case 'bid':
      return Gavel
    default:
      return ArrowLeftRight
  }
}

/** Merged, sorted activity rows for an address (local tracked txs + indexed history). */
export function useActivityRows(address: Address | undefined) {
  const local = useAccountTxs(address)
  const api = useAccountActivity(address)
  const rows = useMemo(() => mergeActivity(local, api.data ?? []), [local, api.data])
  return { rows, loading: api.isLoading && local.length === 0 }
}

function StatusBadge({ status }: { status: ActivityRowModel['status'] }) {
  if (status === 'pending')
    return (
      <span className="absolute -right-1 -bottom-1 rounded-full bg-surface-1 text-accent">
        <Spinner size={12} />
      </span>
    )
  if (status === 'reverted' || status === 'dropped')
    return (
      <span className="absolute -right-1 -bottom-1 rounded-full bg-critical p-0.5 text-white">
        <X size={7} strokeWidth={4} />
      </span>
    )
  if (status === 'confirmed')
    return (
      <span className="absolute -right-1 -bottom-1 rounded-full bg-success p-0.5 text-white">
        <Check size={7} strokeWidth={4} />
      </span>
    )
  return null
}

function useLegToken() {
  const { find } = useTokenList()
  return (l: ActivityLeg) => (l.address ? find(l.address) : undefined) ?? find(l.symbol === 'ETH' ? 'ETH' : l.symbol) ?? { symbol: l.symbol, address: l.address ?? l.symbol }
}

function legText(l: ActivityLeg): string {
  return `${l.amount === null ? '' : `${formatAmount(l.amount, 5)} `}${l.symbol}`
}

/** One-line amount summary: "0.5 WETH → 1,517 mUSDC", "42.5 mUSDC", or the tracked summary. */
export function amountSummary(r: ActivityRowModel): string {
  if (r.legs.length >= 2) return `${legText(r.legs[0]!)} ${r.kind === 'add' || r.kind === 'remove' ? '+' : '→'} ${legText(r.legs[1]!)}`
  if (r.legs.length === 1) return legText(r.legs[0]!)
  return r.detail ?? ''
}

/**
 * Activity list for the account drawer and the portfolio "Recent activity" column (Uniswap layout:
 * 64px rows, 24px token logo, 12px verb over a 14px amount, date on the right).
 */
export function ActivityList({ address, limit, types, time }: { address: Address; limit?: number; types?: TypeFilter; time?: TimeFilter; /** @deprecated kept for callers */ compact?: boolean }) {
  const { rows: all, loading } = useActivityRows(address)
  const legToken = useLegToken()
  const rows = useMemo(() => filterActivity(all, { type: types, time }).slice(0, limit ?? 100), [all, types, time, limit])

  if (loading)
    return (
      <div className="flex flex-col gap-3 p-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton width={24} height={24} rounded="full" />
            <Skeleton width={180} height={14} />
          </div>
        ))}
      </div>
    )
  if (rows.length === 0)
    return (
      <EmptyState icon={<Clock size={20} />} title="No activity yet" className="py-8">
        Your swaps, sends and orders will show up here.
      </EmptyState>
    )
  return (
    <ul className="flex flex-col" data-testid="activity-list">
      {rows.map((r) => {
        const Icon = iconFor(r.kind)
        const lead = r.legs[r.kind === 'swap' ? 1 : 0]
        return (
          <li key={r.key} className="flex h-16 items-center gap-3 rounded-xl px-5 transition-colors hover:bg-surface-2" data-testid="activity-row" data-status={r.status} data-kind={r.kind}>
            <span className="relative shrink-0">
              {lead ? (
                <TokenLogo token={legToken(lead)} size={24} />
              ) : (
                <span className="flex size-6 items-center justify-center rounded-full bg-surface-3 text-text-2">
                  <Icon size={13} />
                </span>
              )}
              <StatusBadge status={r.status} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-4 text-text-2">
                {r.label}
                {r.status === 'reverted' && <span className="ml-1 text-critical">· failed</span>}
                {r.status === 'pending' && <span className="ml-1 text-accent">· pending</span>}
              </span>
              <span className="block truncate text-body-3 text-text-1">{amountSummary(r)}</span>
            </span>
            <span className="shrink-0 text-right">
              {r.time && <span className="block text-body-3 text-text-2">{formatRelativeTime(r.time)}</span>}
              {r.usd ? <span className="block text-body-4 text-text-3 tabular">{formatUsd(r.usd)}</span> : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Amount cell: token logo + amount + USD, swaps as "in → out" (Activity tab). */
export function AmountCell({ r }: { r: ActivityRowModel }) {
  const legToken = useLegToken()
  if (r.legs.length === 0) return <span className="text-text-2">{r.detail ?? '-'}</span>
  const one = (l: ActivityLeg) => (
    <span className="flex min-w-0 items-center gap-2">
      <TokenLogo token={legToken(l)} size={32} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-text-1">{legText(l)}</span>
        <span className="block text-body-4 text-text-2 tabular">{l.usd != null ? formatUsd(l.usd) : r.legs.length === 1 && r.usd ? formatUsd(r.usd) : ' '}</span>
      </span>
    </span>
  )
  if (r.legs.length === 1) return one(r.legs[0]!)
  return (
    <span className="grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] items-center gap-2">
      {one(r.legs[0]!)}
      <span className={cn('flex justify-center text-text-2', (r.kind === 'add' || r.kind === 'remove') && 'text-body-2')}>{r.kind === 'add' || r.kind === 'remove' ? '+' : <ArrowRight size={16} />}</span>
      {one(r.legs[1]!)}
    </span>
  )
}
