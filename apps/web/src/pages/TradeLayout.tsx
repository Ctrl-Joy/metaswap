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
    <div className="flex flex-col items-center px-4 pt-4 pb-24 md:pt-[60px]">
      <div className={cn('flex w-full flex-col items-center gap-6', showChart && 'lg:max-w-[1200px] lg:flex-row-reverse lg:items-start lg:justify-center')}>
        <div className={cn('w-full shrink-0', wide ? 'max-w-[480px]' : 'max-w-[480px]')}>
          <div className="mb-0.5 flex h-[46px] items-center justify-between">
            <nav aria-label="Trade" className="flex items-center gap-3 p-1">
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  data-testid={`tab-${t.label.toLowerCase()}`}
                  className={({ isActive }) =>
                    cn(
                      'flex h-9 items-center rounded-full px-3 text-body-3 leading-4 font-semibold transition-colors duration-150',
                      isActive ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:text-text-1',
                    )
                  }
                >
                  {t.label}
                </NavLink>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              {chart && (
                <IconButton
                  label={chart.open ? 'Hide price chart' : 'Show price chart'}
                  size={32}
                  aria-pressed={chart.open}
                  onClick={chart.onToggle}
                  data-testid="chart-toggle"
                  className={cn('rounded-lg', chart.open ? 'text-text-1' : 'text-text-2')}
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
