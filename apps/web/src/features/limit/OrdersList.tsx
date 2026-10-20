import { useMemo, useState } from 'react'
import { ArrowRight, Clock } from 'lucide-react'
import type { Address, Hex } from 'viem'
import { contractAddress } from '@metaswap/sdk'
import { Badge, Button, CopyButton, DoubleLogo, EmptyState, SegmentedTabs, Skeleton } from '@/components/ui'
import { useXOrders } from '@/api/hooks'
import type { XOrder } from '@/api/types'
import { useTokenList } from '@/features/tokens/useTokenList'
import { formatAmount, formatDuration, formatRelativeTime, formatTokenAmount, shortenAddress } from '@/lib/format'
import { toNumber } from '@/lib/amount'
import { parseTxError } from '@/lib/errors'
import { toast } from '@/state/toasts'
import { useWallet } from '@/wallet/hooks'
import { decodeOrder, type ExclusiveDutchOrder } from './order'
import { cancelLimitOrder, orderLabel } from './executeLimit'

type Tab = 'open' | 'filled' | 'closed'

function toMs(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined
  const n = typeof v === 'string' && !/^\d+$/.test(v) ? Date.parse(v) : Number(v)
  if (!Number.isFinite(n)) return undefined
  return n < 1e12 ? n * 1000 : n
}

interface Row {
  raw: XOrder
  order?: ExclusiveDutchOrder
  hash: Hex
}

/** MetaSwapX orders for the connected account: open / filled / expired+cancelled, with cancel. */
export function OrdersList({ compact = false }: { compact?: boolean }) {
  const { address } = useWallet()
  const q = useXOrders(address)
  const [tab, setTab] = useState<Tab>('open')
  const rows: Row[] = useMemo(
    () =>
      (q.data ?? []).map((raw) => {
        let order: ExclusiveDutchOrder | undefined
        try {
          if (raw.encodedOrder) order = decodeOrder(raw.encodedOrder)
        } catch {
          /* ignore malformed */
        }
        return { raw, order, hash: (raw.orderHash ?? raw.hash) as Hex }
      }),
    [q.data],
  )
  const filtered = rows.filter((r) => (tab === 'open' ? r.raw.status === 'open' : tab === 'filled' ? r.raw.status === 'filled' : r.raw.status !== 'open' && r.raw.status !== 'filled'))
  const counts = {
    open: rows.filter((r) => r.raw.status === 'open').length,
    filled: rows.filter((r) => r.raw.status === 'filled').length,
  }

  if (!address) return <EmptyState title="Connect a wallet to see your orders" className="py-8" />

  return (
    <div className="flex flex-col gap-3" data-testid="orders-list">
      <SegmentedTabs
        size="sm"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'open', label: `Open${counts.open ? ` (${counts.open})` : ''}`, testId: 'orders-tab-open' },
          { value: 'filled', label: `Filled${counts.filled ? ` (${counts.filled})` : ''}`, testId: 'orders-tab-filled' },
          { value: 'closed', label: 'Expired / cancelled', testId: 'orders-tab-closed' },
        ]}
      />
      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton width="100%" height={64} rounded="lg" />
          <Skeleton width="100%" height={64} rounded="lg" />
        </div>
      ) : q.isError ? (
        <p className="py-6 text-center text-body-3 text-text-2">Orders unavailable — the MetaSwap API is not reachable.</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          className="py-6"
          icon={<Clock size={20} />}
          title={tab === 'open' ? 'No open orders' : tab === 'filled' ? 'No filled orders yet' : 'Nothing here'}
        >
          {tab === 'open' && !compact ? 'Place a limit order above. Fillers execute it gaslessly when the market reaches your price.' : undefined}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((r) => (
            <OrderRow key={r.hash} row={r} account={address} />
          ))}
        </ul>
      )}
    </div>
  )
}

function OrderRow({ row, account }: { row: Row; account: Address }) {
  const { find } = useTokenList()
  const [cancelling, setCancelling] = useState(false)
  const o = row.order
  const tIn = o ? find(o.input.token) : undefined
  const out = o?.outputs[0]
  const tOut = out ? find(out.token) : undefined
  const status = row.raw.status
  const nowSec = Date.now() / 1000
  const deadline = o ? Number(o.info.deadline) : row.raw.deadline
  const price = o && out && tIn && tOut ? toNumber(out.endAmount, tOut.decimals) / toNumber(o.input.startAmount, tIn.decimals) : undefined
  const created = toMs(row.raw.createdAt)
  const fillTx = (row.raw.fillTx ?? row.raw.fillTxHash ?? row.raw.txHash) as string | undefined

  const cancel = async () => {
    if (!o) return
    setCancelling(true)
    try {
      await cancelLimitOrder({ account, permit2: contractAddress('Permit2'), nonce: o.info.nonce, label: orderLabel(o, tIn, tOut) })
    } catch (e) {
      const err = parseTxError(e)
      if (err.kind !== 'rejected') toast.error('Could not cancel order', err.message)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-surface-1 p-3" data-testid="order-row" data-status={status}>
      <DoubleLogo token0={tIn} token1={tOut} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 text-body-3 font-semibold tabular">
          {o && tIn ? formatTokenAmount(o.input.startAmount, tIn.decimals) : '?'} {tIn?.symbol}
          <ArrowRight size={14} className="text-text-3" />
          {out && tOut ? formatTokenAmount(out.endAmount, tOut.decimals) : '?'} {tOut?.symbol}
        </div>
        <div className="text-body-4 text-text-2 tabular">
          {price !== undefined && (
            <>
              1 {tIn?.symbol} = {formatAmount(price)} {tOut?.symbol}
            </>
          )}
          {status === 'open' && deadline ? ` · expires in ${formatDuration(deadline - nowSec)}` : ''}
          {status !== 'open' && created ? ` · ${formatRelativeTime(created)}` : ''}
        </div>
        {fillTx && (
          <CopyButton value={fillTx} label="Copy fill transaction" className="font-mono text-body-4">
            fill {shortenAddress(fillTx, 4)}
          </CopyButton>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge tone={status === 'open' ? 'accent' : status === 'filled' ? 'success' : status === 'cancelled' ? 'neutral' : 'warning'}>
          {status === 'open' ? 'Open' : status === 'filled' ? 'Filled' : status === 'cancelled' ? 'Cancelled' : status === 'expired' ? 'Expired' : status}
        </Badge>
        {status === 'open' && o && (
          <Button size="sm" variant="secondary" onClick={cancel} loading={cancelling} data-testid="cancel-order" className="h-7">
            Cancel
          </Button>
        )}
      </div>
    </li>
  )
}
