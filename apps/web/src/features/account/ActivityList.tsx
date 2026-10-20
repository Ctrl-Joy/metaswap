import { useMemo } from 'react'
import { ArrowLeftRight, ArrowUpRight, ArrowDownLeft, Check, Droplets, Layers, X, Zap, Clock, ShieldCheck } from 'lucide-react'
import type { Address } from 'viem'
import { CopyButton, EmptyState, Skeleton, Spinner } from '@/components/ui'
import { useAccountActivity } from '@/api/hooks'
import type { ActivityItem } from '@/api/types'
import { useAccountTxs, TX_TYPE_LABEL, type TrackedTx } from '@/state/transactions'
import { formatAmount, formatRelativeTime, formatUsd, shortenAddress } from '@/lib/format'
import { cn } from '@/lib/cn'

interface Row {
  key: string
  hash?: string
  type: string
  title: string
  detail: string
  time?: number
  status: TrackedTx['status'] | 'indexed'
  usd?: number | null
}

type Amt = { symbol?: string; amountFormatted?: number }
const amt = (a: unknown) => {
  const x = a as Amt | undefined
  return x && x.symbol ? `${formatAmount(Math.abs(x.amountFormatted ?? 0))} ${x.symbol}` : ''
}

/** Human description of an indexed API activity item. */
export function describeActivity(it: ActivityItem): { title: string; detail: string } {
  const t = String(it.type)
  switch (t) {
    case 'swap':
      return { title: 'Swapped', detail: `${amt(it.tokenIn)} → ${amt(it.tokenOut)}` }
    case 'add':
    case 'mint':
      if (it.token0) return { title: 'Added liquidity', detail: `${amt(it.token0)} + ${amt(it.token1)}` }
      return { title: 'Received (mint)', detail: amt(it.token) }
    case 'remove':
    case 'burn':
      return { title: 'Removed liquidity', detail: `${amt(it.token0)} + ${amt(it.token1)}` }
    case 'collect':
      return { title: 'Collected fees', detail: it.tokenId ? `Position #${String(it.tokenId)}` : '' }
    case 'deposit':
    case 'wrap':
      return { title: 'Wrapped', detail: `${formatAmount(Number(it.amount ?? 0) / 1e18)} ETH → WETH` }
    case 'withdrawal':
    case 'withdraw':
    case 'unwrap':
      return { title: 'Unwrapped', detail: `${formatAmount(Number(it.amount ?? 0) / 1e18)} WETH → ETH` }
    case 'send':
      return { title: 'Sent', detail: `${amt(it.token)} to ${shortenAddress(String(it.to ?? ''))}` }
    case 'receive':
      return { title: 'Received', detail: `${amt(it.token)} from ${shortenAddress(String(it.from ?? ''))}` }
    case 'order': {
      const o = it.order as { status?: string } | undefined
      return { title: `Limit order ${o?.status ?? ''}`.trim(), detail: 'MetaSwapX' }
    }
    default:
      return { title: t.charAt(0).toUpperCase() + t.slice(1), detail: String(it.summary ?? '') }
  }
}

function iconFor(type: string) {
  switch (type) {
    case 'swap':
      return ArrowLeftRight
    case 'send':
      return ArrowUpRight
    case 'receive':
    case 'mint':
      return ArrowDownLeft
    case 'faucet':
      return Droplets
    case 'approve':
      return ShieldCheck
    case 'order':
    case 'cancel-order':
      return Zap
    case 'add':
    case 'remove':
    case 'add-liquidity':
    case 'remove-liquidity':
    case 'collect':
    case 'collect-fees':
      return Layers
    default:
      return ArrowLeftRight
  }
}

/** Activity = this browser's tracked txs (instant, with pending state) + the API indexer's history. */
export function ActivityList({ address, limit }: { address: Address; limit?: number }) {
  const local = useAccountTxs(address)
  const api = useAccountActivity(address)
  const rows = useMemo(() => {
    const out: Row[] = local.map((t) => ({ key: t.hash, hash: t.hash, type: t.type, title: TX_TYPE_LABEL[t.type], detail: t.summary, time: t.addedAt, status: t.status }))
    const seen = new Set(local.map((t) => t.hash.toLowerCase()))
    for (const it of api.data ?? []) {
      const h = (it.txHash ?? it.hash) as string | undefined
      if (h && seen.has(h.toLowerCase())) continue
      if (h) seen.add(h.toLowerCase())
      const d = describeActivity(it)
      out.push({ key: h ?? `${it.type}-${it.blockNumber}-${String(it.logIndex)}`, hash: h ?? undefined, type: String(it.type), title: d.title, detail: d.detail, time: it.timestamp ? Number(it.timestamp) * 1000 : undefined, status: 'indexed', usd: (it.amountUsd as number | null | undefined) ?? null })
    }
    return out.sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, limit ?? 100)
  }, [local, api.data, limit])

  if (api.isLoading && local.length === 0)
    return (
      <div className="flex flex-col gap-3 p-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton width={36} height={36} />
            <Skeleton width={180} height={14} />
          </div>
        ))}
      </div>
    )
  if (rows.length === 0) return <EmptyState icon={<Clock size={20} />} title="No activity yet" className="py-8">Your swaps, sends and orders will show up here.</EmptyState>
  return (
    <ul className="flex flex-col" data-testid="activity-list">
      {rows.map((r) => {
        const Icon = iconFor(r.type)
        return (
          <li key={r.key} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2" data-testid="activity-row" data-status={r.status}>
            <span className={cn('relative flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-2')}>
              <Icon size={16} />
              {r.status === 'pending' && (
                <span className="absolute -right-1 -bottom-1 rounded-full bg-surface-1 text-accent">
                  <Spinner size={14} />
                </span>
              )}
              {r.status === 'confirmed' && (
                <span className="absolute -right-1 -bottom-1 rounded-full bg-success p-0.5 text-white">
                  <Check size={8} strokeWidth={4} />
                </span>
              )}
              {(r.status === 'reverted' || r.status === 'dropped') && (
                <span className="absolute -right-1 -bottom-1 rounded-full bg-critical p-0.5 text-white">
                  <X size={8} strokeWidth={4} />
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-3 font-semibold">
                {r.title}
                {r.status === 'reverted' && <span className="ml-1.5 font-normal text-critical">failed</span>}
                {r.status === 'pending' && <span className="ml-1.5 font-normal text-accent">pending</span>}
              </span>
              <span className="block truncate text-body-4 text-text-2">{r.detail}</span>
            </span>
            <span className="shrink-0 text-right">
              {r.time && <span className="block text-body-4 text-text-3">{formatRelativeTime(r.time)}</span>}
              {r.usd ? <span className="block text-body-4 text-text-2 tabular">{formatUsd(r.usd)}</span> : null}
              {r.hash && !r.usd && (
                <CopyButton value={r.hash} label="Copy transaction hash" className="font-mono text-[11px] text-text-3">
                  {r.hash.slice(0, 6)}
                </CopyButton>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
