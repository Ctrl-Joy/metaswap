import { useMemo, useState } from 'react'
import { SegmentedTabs, Usd, useRowEnter } from '@/components/ui'
import { ExTableSkeleton, ExTd, ExTh, ExTHead, ExTr, ExTable } from './ExploreTable'
import { formatAmount, formatRelativeTime, shortenAddress } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiErrorState, useNow } from './ExploreStates'
import { txLabel } from './transforms'
import type { TxRow } from './types'

type KindFilter = 'all' | 'swap' | 'add' | 'remove'

const PAGE_SIZE = 25

const FILTERS: Array<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'swap', label: 'Swaps' },
  { value: 'add', label: 'Adds' },
  { value: 'remove', label: 'Removes' },
]

const VERB_CLASS: Record<ReturnType<typeof txLabel>['verb'], string> = {
  buy: 'text-success',
  sell: 'text-critical',
  swap: 'text-text-1',
  add: 'text-success',
  remove: 'text-warning',
  other: 'text-text-2',
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
  perspective,
}: {
  rows: TxRow[] | undefined
  isLoading: boolean
  error: unknown
  onRetry: () => void
  showFilter?: boolean
  emptyText?: string
  testId?: string
  /** Token symbol the page is about: swaps then read "Buy X" / "Sell X" (token and pool pages). */
  perspective?: string
}) {
  const now = useNow(10_000)
  const [kind, setKind] = useState<KindFilter>('all')
  // like Uniswap: one page of rows, then "Show more" (the list is live and can be long)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const filtered = useMemo(() => (rows ?? []).filter((r) => kind === 'all' || r.kind === kind), [rows, kind])
  const visible = filtered.slice(0, limit)
  const enter = useRowEnter(useMemo(() => visible.map((t) => t.id), [visible]))

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
      <ExTable minWidth={620}>
        <ExTHead>
          <ExTh>Time</ExTh>
          <ExTh>Type</ExTh>
          <ExTh align="right">USD</ExTh>
          <ExTh align="right">Token amount</ExTh>
          <ExTh align="right">Token amount</ExTh>
          <ExTh>Wallet</ExTh>
        </ExTHead>
        {isLoading && !rows ? (
          <ExTableSkeleton rows={6} cols={6} />
        ) : visible.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-body-2 text-text-2" data-testid="tx-empty">
                {rows && rows.length ? 'No transactions of this type.' : emptyText}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody>
            {visible.map((tx) => {
              const label = txLabel(tx, perspective)
              const [first, ...rest] = label.text.split(' ')
              return (
              <ExTr height={56} key={tx.id} rowRef={enter(tx.id)} data-testid="tx-row" data-kind={tx.kind} data-verb={label.verb}>
                <ExTd className="text-text-2" title={new Date(tx.timeMs).toLocaleString()}>
                  {formatRelativeTime(tx.timeMs, now)}
                </ExTd>
                <ExTd title={label.text} data-testid="tx-label">
                  <span className={cn('font-semibold', VERB_CLASS[label.verb])}>{first}</span> <span className="text-text-1">{rest.join(' ')}</span>
                </ExTd>
                <ExTd align="right">
                  <Usd value={tx.usd} />
                </ExTd>
                <ExTd align="right" className="text-text-1">
                  {formatAmount(tx.legs[0]?.amount ?? null, 5)} <span className="text-text-2">{tx.legs[0]?.symbol}</span>
                </ExTd>
                <ExTd align="right" className="text-text-1">
                  {formatAmount(tx.legs[1]?.amount ?? null, 5)} <span className="text-text-2">{tx.legs[1]?.symbol}</span>
                </ExTd>
                <ExTd className="text-text-2" title={tx.wallet ?? undefined}>
                  {tx.wallet ? shortenAddress(tx.wallet) : '-'}
                </ExTd>
              </ExTr>
              )
            })}
          </tbody>
        )}
      </ExTable>
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
