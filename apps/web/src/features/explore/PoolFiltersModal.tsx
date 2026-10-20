import { useEffect, useState } from 'react'
import { Button, Modal } from '@/components/ui'
import { cn } from '@/lib/cn'
import { EMPTY_POOL_FILTERS, TVL_BUCKETS, type PoolFilters } from './poolFilters'

function Chip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cn('h-9 rounded-full px-3.5 text-body-3 font-semibold transition-colors', active ? 'bg-accent-tint text-accent' : 'bg-surface-2 text-text-2 hover:text-text-1')}
    >
      {children}
    </button>
  )
}

function toggle<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

function parsePct(s: string): number | null {
  const n = Number(s.replace(',', '.'))
  return s.trim() === '' || !Number.isFinite(n) ? null : n
}

/** Uniswap-style pools filter dialog: protocol, APR range and TVL buckets; Clear all / Apply. */
export function PoolFiltersModal({ open, onOpenChange, value, onApply, maxApr }: { open: boolean; onOpenChange: (o: boolean) => void; value: PoolFilters; onApply: (f: PoolFilters) => void; maxApr?: number }) {
  const [draft, setDraft] = useState<PoolFilters>(value)
  const [aprMin, setAprMin] = useState('')
  const [aprMax, setAprMax] = useState('')
  useEffect(() => {
    if (!open) return
    setDraft(value)
    setAprMin(value.aprMin === null ? '' : String(value.aprMin))
    setAprMax(value.aprMax === null ? '' : String(value.aprMax))
  }, [open, value])

  const minN = parsePct(aprMin)
  const maxN = parsePct(aprMax)
  const aprInvalid = minN !== null && maxN !== null && minN > maxN

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Filters" width={460} testId="pool-filters-modal">
      <div className="flex flex-col gap-5">
        <section className="flex items-center justify-between gap-3">
          <span className="text-body-2 font-semibold">Protocol</span>
          <div className="flex gap-2">
            {(['v3', 'v2'] as const).map((v) => (
              <Chip key={v} active={draft.versions.includes(v)} onClick={() => setDraft((d) => ({ ...d, versions: toggle(d.versions, v) }))} testId={`pool-filter-version-${v}`}>
                {v}
              </Chip>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <span className="text-body-2 font-semibold">APR</span>
          <div className="flex items-center gap-2">
            <label className="flex h-11 flex-1 items-center rounded-2xl border border-border bg-surface-2 px-3 focus-within:border-accent">
              <input inputMode="decimal" value={aprMin} onChange={(e) => setAprMin(e.target.value)} placeholder="0" aria-label="Minimum APR percent" data-testid="pool-filter-apr-min" className="w-full bg-transparent text-body-3 outline-none tabular" />
              <span className="text-text-2">%</span>
            </label>
            <span className="text-text-3">–</span>
            <label className="flex h-11 flex-1 items-center rounded-2xl border border-border bg-surface-2 px-3 focus-within:border-accent">
              <input
                inputMode="decimal"
                value={aprMax}
                onChange={(e) => setAprMax(e.target.value)}
                placeholder={maxApr !== undefined ? String(Math.ceil(maxApr)) : 'Any'}
                aria-label="Maximum APR percent"
                data-testid="pool-filter-apr-max"
                className="w-full bg-transparent text-body-3 outline-none tabular"
              />
              <span className="text-text-2">%</span>
            </label>
          </div>
          {aprInvalid && <p className="text-body-4 text-critical">Minimum APR must be below the maximum.</p>}
        </section>
        <section className="flex flex-col gap-2">
          <span className="text-body-2 font-semibold">TVL</span>
          <div className="flex flex-wrap gap-2">
            {TVL_BUCKETS.map((b) => (
              <Chip key={b.id} active={draft.tvl.includes(b.id)} onClick={() => setDraft((d) => ({ ...d, tvl: toggle(d.tvl, b.id) }))} testId={`pool-filter-tvl-${b.id}`}>
                {b.label}
              </Chip>
            ))}
          </div>
        </section>
        <div className="flex gap-3 border-t border-border pt-4">
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            data-testid="pool-filters-clear"
            onClick={() => {
              setDraft(EMPTY_POOL_FILTERS)
              setAprMin('')
              setAprMax('')
            }}
          >
            Clear all
          </Button>
          <Button
            size="lg"
            fullWidth
            disabled={aprInvalid}
            data-testid="pool-filters-apply"
            onClick={() => {
              onApply({ ...draft, aprMin: minN, aprMax: maxN })
              onOpenChange(false)
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  )
}
