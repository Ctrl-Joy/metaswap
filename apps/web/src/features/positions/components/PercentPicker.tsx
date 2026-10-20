import { cn } from '@/lib/cn'

/** Big percentage readout + range slider + 25/50/75/Max presets (remove liquidity). */
export function PercentPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="rounded-2xl border border-border p-4" data-testid="percent-picker">
      <div className="text-body-3 text-text-2">Amount to remove</div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[44px] leading-none font-semibold tabular" data-testid="percent-value">
          {value}%
        </span>
        <div className="flex gap-1.5">
          {[25, 50, 75, 100].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              data-testid={`percent-${p}`}
              className={cn('h-8 rounded-full px-3 text-body-4 font-semibold transition-colors', value === p ? 'bg-accent-fill text-white' : 'bg-surface-2 text-text-2 hover:text-text-1')}
            >
              {p === 100 ? 'Max' : `${p}%`}
            </button>
          ))}
        </div>
      </div>
      <input
        type="range"
        min={1}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Percentage to remove"
        data-testid="percent-slider"
        className="mt-4 w-full accent-[var(--ms-accent)]"
      />
    </div>
  )
}
