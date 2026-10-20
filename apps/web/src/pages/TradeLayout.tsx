import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { SettingsPopover } from '@/features/settings/SettingsPopover'

const TABS = [
  { to: '/swap', label: 'Swap' },
  { to: '/limit', label: 'Limit' },
  { to: '/send', label: 'Send' },
  { to: '/buy', label: 'Buy' },
] as const

export interface TradeChartSlot {
  open: boolean
  onToggle: () => void
  node: ReactNode
}

/**
 * Card frame shared by /swap, /limit, /send, /buy: tab row + chart toggle + settings gear (ui-ux.md §2.1–2.2).
 * With `chart`, a trend icon toggles a price chart: left of the card on desktop (lg+), below it on mobile.
 */
export function TradeLayout({ children, settings = false, below, wide, chart }: { children: ReactNode; settings?: boolean; below?: ReactNode; wide?: boolean; chart?: TradeChartSlot }) {
  const showChart = !!chart?.open
  return (
    <div className="flex flex-col items-center px-4 pt-6 pb-24 md:pt-[min(10vh,96px)]">
      <div className={cn('flex w-full flex-col items-center gap-6', showChart && 'lg:max-w-[1200px] lg:flex-row-reverse lg:items-start lg:justify-center')}>
        <div className={cn('w-full shrink-0', wide ? 'max-w-[480px]' : 'max-w-[480px]')}>
          <div className="mb-2 flex items-center justify-between">
            <nav aria-label="Trade" className="flex items-center gap-1">
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  data-testid={`tab-${t.label.toLowerCase()}`}
                  className={({ isActive }) =>
                    cn(
                      'rounded-full px-3.5 py-2 text-body-2 font-semibold transition-colors duration-150',
                      isActive ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:bg-surface-2-hover hover:text-text-1',
                    )
                  }
                >
                  {t.label}
                </NavLink>
              ))}
            </nav>
            <div className="flex items-center gap-0.5">
              {chart && (
                <IconButton
                  label={chart.open ? 'Hide price chart' : 'Show price chart'}
                  size={36}
                  aria-pressed={chart.open}
                  onClick={chart.onToggle}
                  data-testid="chart-toggle"
                  className={cn(chart.open && 'text-accent')}
                >
                  <TrendingUp size={20} />
                </IconButton>
              )}
              {settings && <SettingsPopover />}
            </div>
          </div>
          {children}
        </div>
        {showChart && <div className="w-full max-w-[480px] min-w-0 lg:max-w-none lg:flex-1 lg:pt-12">{chart!.node}</div>}
      </div>
      {below && <div className="mt-8 w-full max-w-[480px]">{below}</div>}
    </div>
  )
}
