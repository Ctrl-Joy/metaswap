import { Settings } from 'lucide-react'
import { IconButton, InfoTip, Popover, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AUTO_SLIPPAGE_BPS, MAX_DEADLINE_MIN, slippageWarning, useSettings } from '@/state/settings'

/** Swap settings (ui-ux.md §4): max slippage, deadline, routing preference, MetaSwapX toggle. Persisted. */
export function SettingsPopover() {
  const s = useSettings()
  const warn = s.slippageMode === 'custom' ? slippageWarning(s.customSlippage) : null
  return (
    <Popover
      className="w-[min(340px,calc(100vw-24px))]"
      trigger={
        <IconButton label="Swap settings" size={36} data-testid="settings-button" className={cn(s.slippageMode === 'custom' && 'text-accent')}>
          <Settings size={20} />
        </IconButton>
      }
    >
      <div data-testid="settings-panel" className="flex flex-col gap-4">
        <section>
          <div className="mb-2 flex items-center gap-1 text-body-3 font-semibold">
            Max slippage
            <InfoTip content="Your transaction reverts if the price changes unfavourably by more than this percentage." />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={s.setSlippageAuto}
              data-testid="slippage-auto"
              aria-pressed={s.slippageMode === 'auto'}
              className={cn('h-10 rounded-full px-4 text-body-3 font-semibold transition-colors', s.slippageMode === 'auto' ? 'bg-accent-fill text-white' : 'bg-surface-2 text-text-2 hover:text-text-1')}
            >
              Auto
            </button>
            <label
              className={cn(
                'flex h-10 flex-1 items-center rounded-full border bg-surface-2 px-4 focus-within:border-accent',
                warn === 'invalid' ? 'border-critical' : warn ? 'border-warning' : 'border-transparent',
              )}
            >
              <input
                inputMode="decimal"
                placeholder={(AUTO_SLIPPAGE_BPS / 100).toFixed(2)}
                value={s.customSlippage}
                data-testid="slippage-input"
                aria-label="Custom max slippage percent"
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.')
                  if (/^\d{0,2}(\.\d{0,2})?$/.test(v)) s.setCustomSlippage(v)
                }}
                className="w-full bg-transparent text-right text-body-3 outline-none tabular"
              />
              <span className="ml-1 text-body-3 text-text-2">%</span>
            </label>
          </div>
          {warn && (
            <p className={cn('mt-2 text-body-4', warn === 'invalid' ? 'text-critical' : 'text-warning')} data-testid="slippage-warning">
              {warn === 'too-low' && 'Slippage below 0.05% may cause your transaction to fail.'}
              {warn === 'too-high' && 'High slippage: your trade may be front-run and you could receive much less.'}
              {warn === 'invalid' && 'Enter a value between 0 and 50%. Using Auto until fixed.'}
            </p>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center gap-1 text-body-3 font-semibold">
            Transaction deadline
            <InfoTip content="Your transaction reverts if it is pending for longer than this." />
          </div>
          <label className="flex h-10 w-40 items-center rounded-full bg-surface-2 px-4 focus-within:ring-1 focus-within:ring-accent">
            <input
              inputMode="numeric"
              value={String(s.deadlineMinutes)}
              data-testid="deadline-input"
              aria-label="Transaction deadline in minutes"
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, ''))
                if (Number.isFinite(n) && n > 0) s.setDeadline(Math.min(n, MAX_DEADLINE_MIN))
              }}
              className="w-full bg-transparent text-right text-body-3 outline-none tabular"
            />
            <span className="ml-1.5 text-body-3 text-text-2">minutes</span>
          </label>
          {s.deadlineMinutes < 2 && <p className="mt-2 text-body-4 text-warning">A very short deadline may make your swap fail.</p>}
        </section>

        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="text-body-3 font-semibold">Routing</div>
          <ToggleRow label="MetaSwap V2 pools" checked={s.routeV2} onChange={(v) => s.setRoute('routeV2', v)} disabled={s.routeV2 && !s.routeV3} testId="route-v2" />
          <ToggleRow label="MetaSwap V3 pools" checked={s.routeV3} onChange={(v) => s.setRoute('routeV3', v)} disabled={s.routeV3 && !s.routeV2} testId="route-v3" />
          <ToggleRow
            label="MetaSwapX gasless when available"
            tip="Fill trades as signed MetaSwapX intent orders (no gas, filled by competing fillers) when that beats the classic route. Limit orders always use MetaSwapX."
            checked={s.xGasless}
            onChange={s.setXGasless}
            testId="route-x"
          />
        </section>
      </div>
    </Popover>
  )
}

function ToggleRow({ label, checked, onChange, disabled, tip, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; tip?: string; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1 text-body-3 text-text-2">
        {label}
        {tip && <InfoTip content={tip} />}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} testId={testId} />
    </div>
  )
}
