import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Badge, SegmentedTabs, Table, TableSkeleton, Td, Th, THead, Tr, Usd } from '@/components/ui'
import { formatAmount, formatRelativeTime, shortenAddress } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiErrorState, useNow } from './ExploreStates'
import { txTitle } from './transforms'
import type { TxRow } from './types'

type KindFilter = 'all' | 'swap' | 'add' | 'remove'

const PAGE_SIZE = 25

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
  // like Uniswap: one page of rows, then "Show more" (the list is live and can be long)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const filtered = useMemo(() => (rows ?? []).filter((r) => kind === 'all' || r.kind === kind), [rows, kind])
  const visible = filtered.slice(0, limit)

  if (error && !rows) return <ApiErrorState error={error} onRetry={onRetry} title="Could not load transactions" />

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {showFilter && (
        <SegmentedTabs
          items={FILTERS.map((f) => ({ value: f.value, label: f.label, testId: `tx-filter-${f.value}` }))}
          value={kind}
          onChange={(k) => {
            setKind(k)
            setLimit(PAGE_SIZE)
          }}
          size="sm"
          ariaLabel="Transaction type"
        />
      )}
      <Table minWidth={620}>
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
                <Td title={txTitle(tx)}>
                  <Badge tone={KIND_TONE[tx.kind]}>{tx.kind === 'swap' ? 'Swap' : tx.kind === 'add' ? 'Add' : tx.kind === 'remove' ? 'Remove' : 'Other'}</Badge>
                </Td>
                <Td align="right">
                  <Usd value={tx.usd} />
                </Td>
                <Td className="whitespace-normal">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-text-1">
                    <span className={cn('tabular')}>
                      {formatAmount(tx.legs[0]?.amount ?? null, 5)} {tx.legs[0]?.symbol}
                    </span>
                    <ArrowRight size={14} className="text-text-3" aria-hidden />
                    <span className="tabular">
                      {formatAmount(tx.legs[1]?.amount ?? null, 5)} {tx.legs[1]?.symbol}
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
      {filtered.length > visible.length && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE_SIZE)}
          className="self-center rounded-full bg-surface-2 px-4 py-2 text-body-3 font-medium text-text-1 transition-colors hover:bg-surface-2-hover"
          data-testid="tx-show-more"
        >
          Show more ({filtered.length - visible.length} older)
        </button>
      )}
    </div>
  )
}
