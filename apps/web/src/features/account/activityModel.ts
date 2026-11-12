// Activity rows for the account drawer, portfolio "Recent activity" and the Activity tab (pure, unit tested).
// Merges this browser's tracked txs (instant, with pending state) with the API indexer's history.
import type { ActivityItem } from '@/api/types'
import type { TrackedTx } from '@/state/transactions'
import { TX_TYPE_LABEL } from '@/state/transactions'
import { shortenAddress } from '@/lib/format'
import { t } from '@/i18n'

export type ActivityKind =
  | 'swap'
  | 'send'
  | 'receive'
  | 'wrap'
  | 'unwrap'
  | 'approve'
  | 'add'
  | 'remove'
  | 'collect'
  | 'mint'
  | 'order'
  | 'earn-deposit'
  | 'earn-withdraw'
  | 'bid'
  | 'other'

export interface ActivityLeg {
  symbol: string
  address?: string
  amount: number | null
  usd?: number | null
}

export interface ActivityRowModel {
  key: string
  hash?: string
  kind: ActivityKind
  /** Uniswap-style past-tense verb: "Swapped", "Sent", "Received", … */
  label: string
  /** ms since epoch */
  time?: number
  status: TrackedTx['status'] | 'indexed'
  /** One leg (send/receive/mint), two (swap: in → out; liquidity: token0 + token1) or none (local summary only). */
  legs: ActivityLeg[]
  /** Free text when no structured legs exist (locally tracked txs). */
  detail?: string
  counterpart?: { label: 'To' | 'From' | 'Transaction' | 'Protocol'; value: string; address?: string }
  usd?: number | null
}

const LOCAL_KIND: Record<TrackedTx['type'], ActivityKind> = {
  swap: 'swap',
  wrap: 'wrap',
  unwrap: 'unwrap',
  approve: 'approve',
  send: 'send',
  faucet: 'mint',
  'cancel-order': 'order',
  'add-liquidity': 'add',
  'remove-liquidity': 'remove',
  'collect-fees': 'collect',
  'earn-deposit': 'earn-deposit',
  'earn-withdraw': 'earn-withdraw',
  bid: 'bid',
  other: 'other',
}

export const KIND_LABEL: Record<ActivityKind, string> = {
  swap: 'Swapped',
  send: 'Sent',
  receive: 'Received',
  wrap: 'Wrapped',
  unwrap: 'Unwrapped',
  approve: 'Approved',
  add: 'Added liquidity',
  remove: 'Removed liquidity',
  collect: 'Claimed fees',
  mint: 'Minted',
  order: 'Limit order',
  'earn-deposit': 'Deposited',
  'earn-withdraw': 'Withdrew',
  bid: 'Auction bid',
  other: 'Transaction',
}

/** KIND_LABEL in the current language (the table above stays English). */
export function kindLabel(kind: ActivityKind): string {
  switch (kind) {
    case 'swap': return t('Swapped')
    case 'send': return t('Sent')
    case 'receive': return t('Received')
    case 'wrap': return t('Wrapped')
    case 'unwrap': return t('Unwrapped')
    case 'approve': return t('Approved')
    case 'add': return t('Added liquidity')
    case 'remove': return t('Removed liquidity')
    case 'collect': return t('Claimed fees')
    case 'mint': return t('Minted')
    case 'order': return t('Limit order')
    case 'earn-deposit': return t('Deposited')
    case 'earn-withdraw': return t('Withdrew')
    case 'bid': return t('Auction bid')
    default: return t('Transaction')
  }
}

function orderLabel(status: string): string {
  switch (status) {
    case 'open': return t('Limit order open')
    case 'filled': return t('Limit order filled')
    case 'expired': return t('Limit order expired')
    case 'cancelled': return t('Limit order cancelled')
    case 'error': return t('Limit order error')
    default: return t('Limit order {status}', { status })
  }
}

function apiKind(type: string): ActivityKind {
  switch (type) {
    case 'swap':
      return 'swap'
    case 'send':
      return 'send'
    case 'receive':
      return 'receive'
    case 'mint':
    case 'faucet':
      return 'mint'
    case 'deposit':
    case 'wrap':
      return 'wrap'
    case 'withdrawal':
    case 'withdraw':
    case 'unwrap':
      return 'unwrap'
    case 'add':
    case 'add-liquidity':
      return 'add'
    case 'remove':
    case 'burn':
    case 'remove-liquidity':
      return 'remove'
    case 'collect':
    case 'collect-fees':
      return 'collect'
    case 'approve':
    case 'approval':
      return 'approve'
    case 'order':
    case 'cancel-order':
      return 'order'
    case 'earn-deposit':
    case 'deposit-vault':
      return 'earn-deposit'
    case 'earn-withdraw':
    case 'withdraw-vault':
      return 'earn-withdraw'
    case 'bid':
      return 'bid'
    default:
      return 'other'
  }
}

type Tok = { symbol?: string; address?: string; amountFormatted?: number }
function leg(x: unknown, usd?: number | null): ActivityLeg | null {
  const tok = x as Tok | undefined
  if (!tok || typeof tok !== 'object' || !tok.symbol) return null
  return { symbol: tok.symbol, address: tok.address, amount: tok.amountFormatted !== undefined ? Math.abs(tok.amountFormatted) : null, usd }
}

/** Structured row for one indexed API activity item. */
export function apiActivityRow(it: ActivityItem): ActivityRowModel {
  const kind = apiKind(String(it.type))
  // An add with a single `token` and no token0 is a token mint (faucet).
  const k: ActivityKind = kind === 'add' && !it.token0 && it.token ? 'mint' : kind
  const h = (it.txHash ?? it.hash) as string | undefined
  const usd = (it.amountUsd as number | null | undefined) ?? (it.valueUsd as number | null | undefined) ?? null
  let legs: ActivityLeg[] = []
  if (k === 'swap') legs = [leg(it.tokenIn), leg(it.tokenOut)].filter((l): l is ActivityLeg => !!l)
  else if (k === 'add' || k === 'remove') legs = [leg(it.token0), leg(it.token1)].filter((l): l is ActivityLeg => !!l)
  else if (k === 'wrap' || k === 'unwrap') {
    const amt = Number(it.amount ?? 0) / 1e18
    legs = [{ symbol: k === 'wrap' ? 'ETH' : 'WETH', amount: amt }, { symbol: k === 'wrap' ? 'WETH' : 'ETH', amount: amt }]
  } else {
    const l = leg(it.token, usd)
    if (l) legs = [l]
  }
  if (legs.length === 1 && legs[0]!.usd == null) legs[0]!.usd = usd
  const to = typeof it.to === 'string' ? it.to : undefined
  const from = typeof it.from === 'string' ? it.from : undefined
  const counterpart: ActivityRowModel['counterpart'] =
    k === 'send' && to
      ? { label: 'To', value: shortenAddress(to), address: to }
      : k === 'receive' && from
        ? { label: 'From', value: shortenAddress(from), address: from }
        : k === 'earn-deposit' || k === 'earn-withdraw'
          ? { label: 'Protocol', value: 'MetaSwap Earn' }
          : k === 'order'
            ? { label: 'Protocol', value: 'MetaSwapX' }
            : h
              ? { label: 'Transaction', value: shortenAddress(h), address: h }
              : undefined
  const o = it.order as { status?: string } | undefined
  return {
    key: h ? `${h}:${String(it.logIndex ?? '')}:${k}` : `${it.type}-${it.blockNumber}-${String(it.logIndex)}`,
    hash: h,
    kind: k,
    label: k === 'order' && o?.status ? orderLabel(o.status) : kindLabel(k),
    time: it.timestamp ? Number(it.timestamp) * 1000 : undefined,
    status: 'indexed',
    legs,
    detail: k === 'other' ? String(it.summary ?? '') : undefined,
    counterpart,
    usd,
  }
}

export function localActivityRow(tx: TrackedTx): ActivityRowModel {
  const kind = LOCAL_KIND[tx.type] ?? 'other'
  const to = typeof tx.meta?.to === 'string' ? tx.meta.to : undefined
  return {
    key: tx.hash,
    hash: tx.hash,
    kind,
    label: KIND_LABEL[kind] ? kindLabel(kind) : TX_TYPE_LABEL[tx.type],
    time: tx.addedAt,
    status: tx.status,
    legs: [],
    detail: tx.summary,
    counterpart: kind === 'send' && to ? { label: 'To', value: shortenAddress(to), address: to } : { label: 'Transaction', value: shortenAddress(tx.hash), address: tx.hash },
  }
}

/**
 * Local txs first (they carry pending/failed state); an indexed item with the same hash replaces a
 * *confirmed* local row so the richer indexed format wins once the indexer catches up.
 */
export function mergeActivity(local: readonly TrackedTx[], api: readonly ActivityItem[]): ActivityRowModel[] {
  const apiRows = api.map(apiActivityRow)
  const indexed = new Set(apiRows.map((r) => r.hash?.toLowerCase()).filter(Boolean) as string[])
  const out: ActivityRowModel[] = []
  for (const tx of local) {
    if (tx.status === 'confirmed' && indexed.has((tx.hash ?? '').toLowerCase())) continue
    out.push(localActivityRow(tx))
  }
  const localHashes = new Set(out.map((r) => r.hash?.toLowerCase()))
  const seen = new Set<string>()
  for (const r of apiRows) {
    if (r.hash && localHashes.has(r.hash.toLowerCase())) continue
    if (seen.has(r.key)) continue
    seen.add(r.key)
    out.push(r)
  }
  return out.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
}

/** Uniswap's "All types" menu, mapped onto MetaSwap kinds. Keys double as e2e ids (activity-filter-<key>). */
export const TYPE_FILTERS = {
  all: { label: 'All types', kinds: null },
  swaps: { label: 'Swaps', kinds: ['swap'] },
  sends: { label: 'Sends', kinds: ['send'] },
  receives: { label: 'Receives', kinds: ['receive', 'mint'] },
  wraps: { label: 'Wraps', kinds: ['wrap', 'unwrap'] },
  approvals: { label: 'Approvals', kinds: ['approve'] },
  liquidity: { label: 'Added / removed liquidity', kinds: ['add', 'remove'] },
  fees: { label: 'Claimed fees', kinds: ['collect'] },
  orders: { label: 'Limit orders', kinds: ['order'] },
  earn: { label: 'Earn deposits / withdrawals', kinds: ['earn-deposit', 'earn-withdraw'] },
} as const satisfies Record<string, { label: string; kinds: readonly ActivityKind[] | null }>
export type TypeFilter = keyof typeof TYPE_FILTERS

export const TIME_FILTERS = {
  all: { label: 'All time', sec: Infinity },
  '24h': { label: '24 hours', sec: 86_400 },
  '7d': { label: '7 days', sec: 7 * 86_400 },
  '30d': { label: '30 days', sec: 30 * 86_400 },
} as const
export type TimeFilter = keyof typeof TIME_FILTERS

export function filterActivity(rows: readonly ActivityRowModel[], o: { type?: TypeFilter; time?: TimeFilter; query?: string; now?: number }): ActivityRowModel[] {
  const kinds = TYPE_FILTERS[o.type ?? 'all'].kinds as readonly ActivityKind[] | null
  const window = TIME_FILTERS[o.time ?? 'all'].sec
  const now = o.now ?? Date.now()
  const q = (o.query ?? '').trim().toLowerCase()
  return rows.filter((r) => {
    if (kinds && !kinds.includes(r.kind)) return false
    if (window !== Infinity && (r.time === undefined || now - r.time > window * 1000)) return false
    if (q) {
      const hay = [r.label, r.detail, r.hash, r.counterpart?.address, r.counterpart?.value, ...r.legs.flatMap((l) => [l.symbol, l.address])].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
