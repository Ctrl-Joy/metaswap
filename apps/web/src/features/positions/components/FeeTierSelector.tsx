import { Check } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { FEE_TIER_LIST } from '../tokens'
import type { V3PoolState } from '../chain'

/** Fee tier tiles with "% of pair TVL" per tier, or "Not created" when the pool does not exist. */
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
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="radiogroup" aria-label="Fee tier">
      {FEE_TIER_LIST.map((t) => {
        const selected = t.fee === value
        const pool = pools?.[t.fee]
        const share = tvlShare[t.fee]
        return (
          <button
            key={t.fee}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(t.fee)}
            data-testid={`fee-tier-${t.fee}`}
            className={cn(
              'flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-colors',
              selected ? 'border-accent bg-accent-tint' : 'border-border bg-surface-1 hover:bg-surface-2',
            )}
          >
            <span className="flex w-full items-center justify-between">
              <span className="text-body-2 font-semibold">{t.label}</span>
              {selected && <Check size={16} className="text-accent" />}
            </span>
            <span className="text-body-4 text-text-2">{t.description}</span>
            <span className="mt-auto whitespace-nowrap rounded-full bg-surface-3 px-2 py-0.5 text-body-4 font-medium text-text-2" data-testid={`fee-tier-${t.fee}-tvl`}>
              {loading || !pools ? (
                <Skeleton width={60} />
              ) : !pool?.initialized ? (
                'Not created'
              ) : share !== undefined ? (
                `${(share * 100).toFixed(share > 0 && share < 0.01 ? 2 : 0)}% TVL`
              ) : (
                'Created'
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
