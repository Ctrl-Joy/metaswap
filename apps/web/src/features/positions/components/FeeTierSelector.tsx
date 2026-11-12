import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { FEE_TIER_LIST } from '../tokens'
import type { V3PoolState } from '../chain'
import { t } from '@/i18n'

/** Fee tier blurbs (the tier list comes from the SDK in English). */
function tierDescription(fee: number, fallback: string): string {
  switch (fee) {
    case 100:
      return t('Best for very stable pairs.')
    case 500:
      return t('Best for stable pairs.')
    case 3000:
      return t('Best for most pairs.')
    case 10000:
      return t('Best for exotic pairs.')
    default:
      return fallback
  }
}

/**
 * Fee tier picker laid out like Uniswap's create-position step 1: a summary row (selected tier,
 * Less/More toggle) above four 122px tiles with "% of pair TVL" per tier, or "Not created".
 */
export function FeeTierSelector({
  value,
  onChange,
  pools,
  tvlShare,
  loading,
}: {
  value: number
  onChange: (fee: number) => void
  pools: Record<number, V3PoolState> | undefined
  /** fee → share of the pair's V3 TVL (0..1). */
  tvlShare: Record<number, number>
  loading?: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const current = FEE_TIER_LIST.find((t) => t.fee === value)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-[68px] items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
        <div>
          <div className="text-body-2 leading-5" data-testid="fee-tier-current">
            {t('{fee} fee tier', { fee: current ? current.label : '--' })}
          </div>
          <div className="text-body-3 text-text-2">{t('The % you will earn in fees')}</div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="inline-flex h-[38px] items-center gap-1 rounded-xl bg-surface-3 px-3 text-body-4 font-semibold transition-colors hover:bg-surface-3-hover"
        >
          {expanded ? t('Less') : t('More')}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {expanded && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="radiogroup" aria-label={t('Fee tier')}>
          {FEE_TIER_LIST.map((tier) => {
            const selected = tier.fee === value
            const pool = pools?.[tier.fee]
            const share = tvlShare[tier.fee]
            return (
              <button
                key={tier.fee}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(tier.fee)}
                data-testid={`fee-tier-${tier.fee}`}
                className={cn(
                  'flex min-h-[122px] flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors',
                  selected ? 'border-accent bg-accent-tint' : 'border-border bg-surface-1 hover:bg-surface-1-hover',
                )}
              >
                <span className="text-body-3 leading-4 font-semibold">{tier.label}</span>
                <span className="text-body-4">{tierDescription(tier.fee, tier.description)}</span>
                <span className="mt-auto text-body-4 whitespace-nowrap text-text-2" data-testid={`fee-tier-${tier.fee}-tvl`}>
                  {loading || !pools ? (
                    <Skeleton width={60} />
                  ) : !pool?.initialized ? (
                    t('Not created')
                  ) : share !== undefined ? (
                    t('{pct}% TVL', { pct: (share * 100).toFixed(share > 0 && share < 0.01 ? 2 : 0) })
                  ) : (
                    t('Created')
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
