import { useState } from 'react'
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { IconButton, InfoTip, Popover, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AUTO_SLIPPAGE_BPS, MAX_DEADLINE_MIN, slippageWarning, useSettings } from '@/state/settings'

/**
 * Swap settings (ui-ux.md §4), laid out like Uniswap's settings popover: compact rows for max slippage
 * (Auto chip + % input) and swap deadline, plus a "Trade options" sub-view holding the routing toggles
 * (V2 / V3 pools, MetaSwapX gasless). Persisted.
 */
export function SettingsPopover() {
  const s = useSettings()
  const [view, setView] = useState<'main' | 'trade'>('main')
  const warn = s.slippageMode === 'custom' ? slippageWarning(s.customSlippage) : null
  const auto = s.slippageMode === 'auto'
  const tradeDefault = s.routeV2 && s.routeV3 && !s.xGasless
  return (
    <Popover
      onOpenChange={(o) => !o && setView('main')}
      autoFocus={false}
      sideOffset={2}
      className="w-[min(320px,calc(100vw-24px))] rounded-3xl px-3 py-1 shadow-medium"
      trigger={
        <IconButton label="Swap settings" size={32} data-testid="settings-button" className={cn('w-7 rounded-full', s.slippageMode === 'custom' ? 'text-accent' : 'text-text-2')}>
          <Settings size={20} />
        </IconButton>
      }
    >
      <div data-testid="settings-panel">
        {view === 'main' ? (
          <div className="flex flex-col">
            <Row
              label="Max slippage"
              tip="Your transaction reverts if the price changes unfavourably by more than this percentage."
              below={
                warn && (
                  <p className={cn('pb-2 text-body-4', warn === 'invalid' ? 'text-critical' : 'text-warning')} data-testid="slippage-warning">
                    {warn === 'too-low' && 'Slippage below 0.05% may cause your transaction to fail.'}
                    {warn === 'too-high' && 'High slippage: your trade may be front-run and you could receive much less.'}
                    {warn === 'invalid' && 'Enter a value between 0 and 50%. Using Auto until fixed.'}
                  </p>
                )
              }
            >
              <label
                className={cn(
                  'flex h-[30px] items-center gap-2 rounded-2xl border bg-surface-1 py-1 pr-2 pl-1',
                  warn === 'invalid' ? 'border-critical' : warn ? 'border-warning' : 'border-border focus-within:border-surface-3-solid',
                )}
              >
                <button
                  type="button"
                  onClick={s.setSlippageAuto}
                  data-testid="slippage-auto"
                  aria-pressed={auto}
                  className={cn(
                    'h-[21px] rounded-full px-2 text-body-3 leading-4 font-semibold transition-colors',
                    auto ? 'bg-accent-tint text-accent' : 'text-text-2 hover:text-text-1',
                  )}
                >
                  Auto
                </button>
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
                  className="w-10 bg-transparent text-right text-body-2 leading-5 outline-none tabular placeholder:text-text-1"
                />
                <span className="text-body-2 leading-5">%</span>
              </label>
            </Row>

            <Row
              label="Swap deadline"
              tip="Your transaction reverts if it is pending for longer than this."
              below={s.deadlineMinutes < 2 && <p className="pb-2 text-body-4 text-warning">A very short deadline may make your swap fail.</p>}
            >
              <label className="flex h-[30px] items-center gap-2 rounded-2xl border border-border bg-surface-1 p-1 pr-3 focus-within:border-surface-3-solid">
                <input
                  inputMode="numeric"
                  value={String(s.deadlineMinutes)}
                  data-testid="deadline-input"
                  aria-label="Transaction deadline in minutes"
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/\D/g, ''))
                    if (Number.isFinite(n) && n > 0) s.setDeadline(Math.min(n, MAX_DEADLINE_MIN))
                  }}
                  className="w-11 bg-transparent text-right text-body-2 leading-5 font-semibold outline-none tabular"
                />
                <span className="text-body-2 leading-5 text-text-2">minutes</span>
              </label>
            </Row>

            <button
              type="button"
              onClick={() => setView('trade')}
              data-testid="settings-trade-options"
              className="flex h-[52px] items-center justify-between gap-3 px-1 text-left text-body-2 leading-5 font-medium"
            >
              Trade options
              <span className="flex items-center gap-1 text-text-2">
                {tradeDefault ? 'Default' : 'Custom'}
                <ChevronRight size={20} />
              </span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col pb-2">
            <div className="flex h-[52px] items-center gap-2 px-1">
              <button
                type="button"
                aria-label="Back"
                onClick={() => setView('main')}
                className="-ml-1 inline-flex size-7 items-center justify-center rounded-full text-text-2 hover:bg-surface-3 hover:text-text-1"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="flex-1 text-center text-body-2 leading-5 font-medium">Trade options</span>
              <span className="w-6" aria-hidden />
            </div>
            <ToggleRow label="MetaSwap V2 pools" checked={s.routeV2} onChange={(v) => s.setRoute('routeV2', v)} disabled={s.routeV2 && !s.routeV3} testId="route-v2" />
            <ToggleRow label="MetaSwap V3 pools" checked={s.routeV3} onChange={(v) => s.setRoute('routeV3', v)} disabled={s.routeV3 && !s.routeV2} testId="route-v3" />
            <ToggleRow
              label="MetaSwapX gasless"
              tip="Fill trades as signed MetaSwapX intent orders (no gas, filled by competing fillers) when that beats the classic route. Limit orders always use MetaSwapX."
              checked={s.xGasless}
              onChange={s.setXGasless}
              testId="route-x"
            />
          </div>
        )}
      </div>
    </Popover>
  )
}

function Row({ label, tip, children, below }: { label: string; tip: string; children: React.ReactNode; below?: React.ReactNode }) {
  return (
    <div className="px-1">
      <div className="flex h-[52px] items-center justify-between gap-3">
        <span className="flex items-center gap-1 text-body-2 leading-5 font-medium">
          {label}
          <InfoTip content={tip} />
        </span>
        {children}
      </div>
      {below}
    </div>
  )
}

function ToggleRow({ label, checked, onChange, disabled, tip, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; tip?: string; testId?: string }) {
  return (
    <div className="flex h-12 items-center justify-between gap-3 px-1">
      <span className="flex items-center gap-1 text-body-2 leading-5">
        {label}
        {tip && <InfoTip content={tip} />}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} testId={testId} />
    </div>
  )
}
