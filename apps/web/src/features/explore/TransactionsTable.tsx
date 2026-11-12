import { useMemo, useState } from 'react'
import { SegmentedTabs, Usd, useRowEnter } from '@/components/ui'
import { ExTableSkeleton, ExTd, ExTh, ExTHead, ExTr, ExTable } from './ExploreTable'
import { formatAmount, formatRelativeTime, shortenAddress } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiErrorState, useNow } from './ExploreStates'
import { txLabel } from './transforms'
import type { TxRow } from './types'
import { t } from '@/i18n'

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

/** The English template behind each label (see txLabel), used to find the verb in the translated text. */
const VERB_TEMPLATE: Partial<Record<ReturnType<typeof txLabel>['verb'], string>> = {
  buy: 'Buy {token}',
  sell: 'Sell {token}',
  swap: 'Swap {a} for {b}',
  add: 'Add {a} and {b}',
  remove: 'Remove {a} and {b}',
}

/**
 * Splits a label into [before, verb, after] so the verb can be coloured in any language: the verb is the
 * longest fixed part of the translated template ("Swap" in "Swap {a} for {b}"). Null when not found.
 */
function splitVerb(text: string, verb: ReturnType<typeof txLabel>['verb']): [string, string, string] | null {
  const tpl = VERB_TEMPLATE[verb]
  if (!tpl) return null
  const segs = t(tpl).split(/\{\w+\}/)
  let best = -1
  segs.forEach((s, i) => {
    if (s.trim().length > (best < 0 ? 0 : segs[best]!.trim().length)) best = i
  })
  if (best < 0) return null
  const word = segs[best]!.trim()
  const at = best === segs.length - 1 ? text.lastIndexOf(word) : text.indexOf(word)
  if (at < 0) return null
  return [text.slice(0, at), word, text.slice(at + word.length)]
}

/** Live transactions list. Time is relative and re-renders every 10 s. Pass `rows` from a hook. */
export function TransactionsTable({
  rows,
  isLoading,
  error,
  onRetry,
  showFilter = true,
  emptyText,
  testId = 'transactions-table',
  perspective,
  pair,
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
  /**
   * Pool-page layout (Uniswap pool tx table): token symbols as the two amount headers, 50px header and
   * rows without separators, white 14px headers, verb + token coloured, amounts without unit suffix.
   */
  pair?: [string, string]
}) {
  const now = useNow(10_000)
  const [kind, setKind] = useState<KindFilter>('all')
  // like Uniswap: one page of rows, then "Show more" (the list is live and can be long)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const filtered = useMemo(() => (rows ?? []).filter((r) => kind === 'all' || r.kind === kind), [rows, kind])
  const visible = filtered.slice(0, limit)
  const enter = useRowEnter(useMemo(() => visible.map((t) => t.id), [visible]))

  if (error && !rows) return <ApiErrorState error={error} onRetry={onRetry} title={t('Could not load transactions')} />

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {showFilter && (
        <SegmentedTabs
          items={FILTERS.map((f) => ({ value: f.value, label: t(f.label), testId: `tx-filter-${f.value}` }))}
          value={kind}
          onChange={(k) => {
            setKind(k)
            setLimit(PAGE_SIZE)
          }}
          size="sm"
          ariaLabel={t('Transaction type')}
        />
      )}
      <ExTable minWidth={pair ? 600 : 620} className={cn(pair && '[&_td]:px-3 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th]:px-3 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5 [&_thead_tr]:h-[50px] [&_th]:text-text-1')}>
        <ExTHead>
          <ExTh>{t('Time')}</ExTh>
          <ExTh>{t('Type')}</ExTh>
          <ExTh align="right">USD</ExTh>
          <ExTh align="right">{pair ? pair[0] : t('Token amount')}</ExTh>
          <ExTh align="right">{pair ? pair[1] : t('Token amount')}</ExTh>
          <ExTh align={pair ? 'right' : 'left'}>{t('Wallet')}</ExTh>
        </ExTHead>
        {isLoading && !rows ? (
          <ExTableSkeleton rows={6} cols={6} />
        ) : visible.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-body-2 text-text-2" data-testid="tx-empty">
                {rows && rows.length ? t('No transactions of this type.') : (emptyText ?? t('No transactions yet. Swaps and liquidity changes appear here as they happen.'))}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody>
            {visible.map((tx) => {
              const label = txLabel(tx, perspective)
              const parts = splitVerb(label.text, label.verb)
              return (
              <ExTr height={56} key={tx.id} rowRef={enter(tx.id)} data-testid="tx-row" data-kind={tx.kind} data-verb={label.verb} className={cn(pair && 'h-[50px] border-t-0')}>
                <ExTd className="text-text-2" title={new Date(tx.timeMs).toLocaleString()}>
                  {formatRelativeTime(tx.timeMs, now)}
                </ExTd>
                <ExTd title={label.text} data-testid="tx-label">
                  {pair ? (
                    <span className={VERB_CLASS[label.verb]}>{label.text}</span>
                  ) : parts ? (
                    <>
                      {parts[0] && <span className="text-text-1">{parts[0]}</span>}
                      <span className={cn('font-semibold', VERB_CLASS[label.verb])}>{parts[1]}</span>
                      {parts[2] && <span className="text-text-1">{parts[2]}</span>}
                    </>
                  ) : (
                    <span className={cn('font-semibold', VERB_CLASS[label.verb])}>{label.text}</span>
                  )}
                </ExTd>
                <ExTd align="right">
                  <Usd value={tx.usd} />
                </ExTd>
                {pair ? (
                  pair.map((sym) => (
                    <ExTd key={sym} align="right" className="text-text-1">
                      {formatAmount(tx.legs.find((l) => l.symbol === sym)?.amount ?? null, 5)}
                    </ExTd>
                  ))
                ) : (
                  <>
                    <ExTd align="right" className="text-text-1">
                      {formatAmount(tx.legs[0]?.amount ?? null, 5)} <span className="text-text-2">{tx.legs[0]?.symbol}</span>
                    </ExTd>
                    <ExTd align="right" className="text-text-1">
                      {formatAmount(tx.legs[1]?.amount ?? null, 5)} <span className="text-text-2">{tx.legs[1]?.symbol}</span>
                    </ExTd>
                  </>
                )}
                <ExTd className={cn('text-text-2', pair && 'text-right text-text-1')} title={tx.wallet ?? undefined}>
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
          {t('Show more ({count} older)', { count: filtered.length - visible.length })}
        </button>
      )}
    </div>
  )
}
