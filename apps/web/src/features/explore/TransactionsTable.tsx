import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Badge, SegmentedTabs, Table, TableSkeleton, Td, Th, THead, Tr, Usd } from '@/components/ui'
import { formatAmount, formatRelativeTime, shortenAddress } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiErrorState, useNow } from './ExploreStates'
import { txTitle } from './transforms'
import type { TxRow } from './types'

type KindFilter = 'all' | 'swap' | 'add' | 'remove'

const FILTERS: Array<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'swap', label: 'Swaps' },
  { value: 'add', label: 'Adds' },
  { value: 'remove', label: 'Removes' },
]

const KIND_TONE: Record<TxRow['kind'], 'accent' | 'success' | 'warning' | 'neutral'> = {
  swap: 'accent',
  add: 'success',
  remove: 'warning',
  other: 'neutral',
}

/** Live transactions list. Time is relative and re-renders every 10 s. Pass `rows` from a hook. */
export function TransactionsTable({
  rows,
  isLoading,
  error,
  onRetry,
  showFilter = true,
  emptyText = 'No transactions yet. Swaps and liquidity changes appear here as they happen.',
  testId = 'transactions-table',
}: {
  rows: TxRow[] | undefined
  isLoading: boolean
  error: unknown
  onRetry: () => void
  showFilter?: boolean
  emptyText?: string
  testId?: string
}) {
  const now = useNow(10_000)
  const [kind, setKind] = useState<KindFilter>('all')
  const visible = useMemo(() => (rows ?? []).filter((r) => kind === 'all' || r.kind === kind), [rows, kind])

  if (error && !rows) return <ApiErrorState error={error} onRetry={onRetry} title="Could not load transactions" />

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {showFilter && (
        <SegmentedTabs items={FILTERS.map((f) => ({ value: f.value, label: f.label, testId: `tx-filter-${f.value}` }))} value={kind} onChange={setKind} size="sm" ariaLabel="Transaction type" />
      )}
      <Table minWidth={780}>
        <THead>
          <Th>Time</Th>
          <Th>Type</Th>
          <Th align="right">USD</Th>
          <Th>Amounts</Th>
          <Th>Wallet</Th>
        </THead>
        {isLoading && !rows ? (
          <TableSkeleton rows={6} cols={5} />
        ) : visible.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-body-2 text-text-2" data-testid="tx-empty">
                {rows && rows.length ? 'No transactions of this type.' : emptyText}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody>
            {visible.map((tx) => (
              <Tr key={tx.id} data-testid="tx-row" data-kind={tx.kind}>
                <Td className="text-text-2" title={new Date(tx.timeMs).toLocaleString()}>
                  {formatRelativeTime(tx.timeMs, now)}
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <Badge tone={KIND_TONE[tx.kind]}>{tx.kind === 'swap' ? 'Swap' : tx.kind === 'add' ? 'Add' : tx.kind === 'remove' ? 'Remove' : 'Other'}</Badge>
                    <span className="hidden text-text-2 xl:inline">{txTitle(tx)}</span>
                  </span>
                </Td>
                <Td align="right">
                  <Usd value={tx.usd} />
                </Td>
                <Td>
                  <span className="flex items-center gap-2 text-text-1">
                    <span className={cn('tabular')}>
                      {formatAmount(tx.legs[0]?.amount ?? null)} {tx.legs[0]?.symbol}
                    </span>
                    <ArrowRight size={14} className="text-text-3" aria-hidden />
                    <span className="tabular">
                      {formatAmount(tx.legs[1]?.amount ?? null)} {tx.legs[1]?.symbol}
                    </span>
                  </span>
                </Td>
                <Td className="text-text-2" title={tx.wallet ?? undefined}>
                  {tx.wallet ? shortenAddress(tx.wallet) : '-'}
                </Td>
              </Tr>
            ))}
          </tbody>
        )}
      </Table>
    </div>
  )
}
