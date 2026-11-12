import { useMemo, useState } from 'react'
import { CalendarDays, ListFilter } from 'lucide-react'
import { CopyButton, EmptyState, Identicon, Skeleton } from '@/components/ui'
import { HiddenTokens, NftGrid, TokensTable } from '@/features/portfolio/PortfolioTables'
import { Dropdown, PfHead, PfTable, PfTd, PfTh, PfTr, SearchField } from '@/features/portfolio/ui'
import { useMask } from '@/features/portfolio/usePortfolioData'
import { AmountCell, iconFor, useActivityRows } from '@/features/account/ActivityList'
import { filterActivity, TIME_FILTERS, TYPE_FILTERS, type TimeFilter, type TypeFilter } from '@/features/account/activityModel'
import { formatUsd, fixedNumber } from '@/lib/format'
import { searchTokens } from '@/features/tokens/tokenSearch'
import { cn } from '@/lib/cn'
import { usePortfolioContext } from './PortfolioLayout'
import { displayLocale } from '@/lib/displayPrefs'
import { t } from '@/i18n'

/** Tokens tab: total + "▲ change • n tokens", search, full table (Avg cost, 1D change, Allocation), hidden tokens. */
export function TokensPage() {
  const { data } = usePortfolioContext()
  const mask = useMask()
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    if (!query.trim()) return data.tokens
    const keep = new Set(searchTokens(data.tokens.map((r) => r.token), query).map((tok) => tok.address))
    return data.tokens.filter((r) => keep.has(r.token.address))
  }, [data.tokens, query])
  const d = data.change24hUsd
  return (
    <section>
      <div className="mb-[30px] flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-heading-2 font-medium tabular" data-testid="tokens-total">
            {data.isLoading || data.totalUsd === null ? <Skeleton width={180} height={40} rounded="lg" /> : mask(formatUsd(data.totalUsd))}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-body-3 text-text-2">
            {d != null && (
              <span className={cn('inline-flex items-center gap-1 tabular', d > 0 ? 'text-success' : d < 0 ? 'text-critical' : 'text-text-2')}>
                <span aria-hidden className="text-[0.7em]">
                  {d >= 0 ? '▲' : '▼'}
                </span>
                <span className="text-text-1">
                  {mask(formatUsd(Math.abs(d)))} ({fixedNumber(Math.abs(data.change24hPct ?? 0), 2)}%)
                </span>
              </span>
            )}
            {d != null && <span aria-hidden>•</span>}
            {!data.isLoading && <span>{data.tokens.length === 1 ? t('1 token') : t('{count} tokens', { count: data.tokens.length })}</span>}
          </div>
        </div>
        <SearchField value={query} onChange={setQuery} placeholder={t('Search tokens')} width={280} testId="portfolio-token-search" />
      </div>
      {query && rows.length === 0 ? (
        <EmptyState title={t('No tokens found')} className="py-10">
          {t('No tokens match “{query}”.', { query })}
        </EmptyState>
      ) : (
        <TokensTable rows={rows} loading={data.isLoading} variant="full" totalUsd={data.totalUsd} />
      )}
      <HiddenTokens rows={data.hiddenTokens} totalUsd={data.totalUsd} />
    </section>
  )
}

/** NFTs tab: "NFTs" label + search on one row, 200px cards. */
export function NftsPage() {
  const { data } = usePortfolioContext()
  const [query, setQuery] = useState('')
  const nfts = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? data.nfts.filter((n) => `${n.name ?? ''} ${n.tokenId}`.toLowerCase().includes(q)) : data.nfts
  }, [data.nfts, query])
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-body-2 text-text-2">NFTs</span>
        <SearchField value={query} onChange={setQuery} placeholder={t('Search NFTs')} width={320} testId="portfolio-nft-search" />
      </div>
      <NftGrid nfts={nfts} loading={data.isLoading} />
    </section>
  )
}

const TYPE_OPTIONS = (Object.keys(TYPE_FILTERS) as TypeFilter[]).map((k) => ({ value: k, label: TYPE_FILTERS[k].label, testId: `activity-filter-${k}` }))
const TIME_OPTIONS = (Object.keys(TIME_FILTERS) as TimeFilter[]).map((k) => ({ value: k, label: TIME_FILTERS[k].label, testId: `activity-time-${k}` }))

/** Copy-button label for an activity counterpart ("Copy to", "Copy transaction", …). */
function copyLabel(kind: 'To' | 'From' | 'Transaction' | 'Protocol'): string {
  if (kind === 'To') return t('Copy to')
  if (kind === 'From') return t('Copy from')
  if (kind === 'Transaction') return t('Copy transaction')
  return t('Copy protocol')
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(displayLocale(), { month: 'short', day: 'numeric' })
}

/** Activity tab: "All types" / "All time" dropdowns + search; Time · Type · Amount · Address table. */
export function ActivityPage() {
  const { account } = usePortfolioContext()
  const [type, setType] = useState<TypeFilter>('all')
  const [time, setTime] = useState<TimeFilter>('all')
  const [query, setQuery] = useState('')
  const { rows: all, loading } = useActivityRows(account.address)
  const rows = useMemo(() => filterActivity(all, { type, time, query }), [all, type, time, query])
  // Filter labels are English constants (activityModel); translate them where they are shown.
  const typeOptions = TYPE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))
  const timeOptions = TIME_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))
  return (
    <section>
      <div className="mb-7 flex flex-wrap items-center gap-2">
        <Dropdown value={type} onChange={setType} options={typeOptions} icon={<ListFilter size={16} className="text-text-2" />} testId="activity-type" width={260} />
        <Dropdown value={time} onChange={setTime} options={timeOptions} icon={<CalendarDays size={16} className="text-text-2" />} testId="activity-time" width={182} />
        <div className="ml-auto w-full md:w-auto">
          <SearchField value={query} onChange={setQuery} placeholder={t('Search activity')} width={320} testId="activity-search" />
        </div>
      </div>
      <PfTable minWidth={900} testId="activity-table">
        <PfHead>
          <PfTh className="w-[152px]">{t('Time')}</PfTh>
          <PfTh className="w-[180px]">{t('Type')}</PfTh>
          <PfTh>{t('Amount')}</PfTh>
          <PfTh className="w-[260px]">{t('Address')}</PfTh>
        </PfHead>
        <tbody data-testid="activity-list">
          {loading ? (
            [0, 1, 2].map((i) => (
              <tr key={i} className="h-16">
                <td colSpan={4} className="px-5">
                  <Skeleton width={260} height={14} />
                </td>
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <EmptyState title={t('No activity')} className="py-10">
                  {all.length ? t('Nothing matches these filters.') : t('Your swaps, sends and orders will show up here.')}
                </EmptyState>
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const Icon = iconFor(r.kind)
              return (
                <PfTr key={r.key} className="h-16 [&>td]:border-y-0" data-testid="activity-row" data-kind={r.kind} data-status={r.status}>
                  <PfTd className="text-text-2" title={r.time ? new Date(r.time).toLocaleString() : undefined}>
                    {r.time ? shortDate(r.time) : '-'}
                  </PfTd>
                  <PfTd>
                    <span className="flex items-center gap-2 text-text-1">
                      <Icon size={16} className="shrink-0" aria-hidden />
                      {t(r.label)}
                      {r.status === 'pending' && <span className="text-accent">· {t('pending')}</span>}
                      {(r.status === 'reverted' || r.status === 'dropped') && <span className="text-critical">· {t('failed')}</span>}
                    </span>
                  </PfTd>
                  <PfTd className="whitespace-normal">
                    <AmountCell r={r} />
                  </PfTd>
                  <PfTd>
                    {r.counterpart ? (
                      <span className="flex flex-col">
                        <span className="text-body-4 text-text-2">{t(r.counterpart.label)}</span>
                        {r.counterpart.address ? (
                          <CopyButton value={r.counterpart.address} label={copyLabel(r.counterpart.label)} className="justify-start text-body-3 text-text-1">
                            {r.counterpart.label !== 'Transaction' && <Identicon address={r.counterpart.address as `0x${string}`} size={16} />}
                            <span className="font-mono">{r.counterpart.value}</span>
                          </CopyButton>
                        ) : (
                          <span className="text-body-3 text-text-1">{r.counterpart.value}</span>
                        )}
                      </span>
                    ) : (
                      '-'
                    )}
                  </PfTd>
                </PfTr>
              )
            })
          )}
        </tbody>
      </PfTable>
    </section>
  )
}
