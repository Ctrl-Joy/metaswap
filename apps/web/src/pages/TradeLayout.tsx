import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { SettingsPopover } from '@/features/settings/SettingsPopover'
import { t } from '@/i18n'

const TABS = [
  { to: '/swap', label: 'Swap' },
  { to: '/limit', label: 'Limit' },
  { to: '/send', label: 'Send' },
  { to: '/buy', label: 'Buy' },
] as const

/** Translated tab label (TABS keeps English labels, which also form the test ids). */
function tabText(label: (typeof TABS)[number]['label']): string {
  switch (label) {
    case 'Swap':
      return t('Swap')
    case 'Limit':
      return t('Limit')
    case 'Send':
      return t('Send')
    case 'Buy':
      return t('Buy')
  }
}

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
  // The home page (/) is the swap page, so its Swap tab reads as selected there.
  const { pathname } = useLocation()
  return (
    <div className="flex flex-col items-center px-4 pt-4 pb-24 md:pt-[60px]">
      <div className={cn('flex w-full flex-col items-center gap-6', showChart && 'lg:max-w-[1200px] lg:flex-row-reverse lg:items-start lg:justify-center')}>
        <div className={cn('w-full shrink-0', wide ? 'max-w-[480px]' : 'max-w-[480px]')}>
          <div className="mb-0.5 flex h-[46px] items-center justify-between gap-2">
            {/* Longer tab names (Spanish, French, Russian…) can outgrow a phone screen: the row then scrolls on its own instead of widening the page. */}
            <nav aria-label={t('Trade')} className="flex min-w-0 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] sm:gap-3 [&::-webkit-scrollbar]:hidden">
              {TABS.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  data-testid={`tab-${tab.label.toLowerCase()}`}
                  className={({ isActive: routeActive }) => {
                    const isActive = routeActive || (pathname === '/' && tab.to === '/swap')
                    return cn(
                      'flex h-9 shrink-0 items-center rounded-full px-2.5 text-body-3 leading-4 font-semibold whitespace-nowrap transition-colors duration-150 sm:px-3',
                      isActive ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:text-text-1',
                    )
                  }}
                >
                  {tabText(tab.label)}
                </NavLink>
              ))}
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              {chart && (
                <IconButton
                  label={chart.open ? t('Hide price chart') : t('Show price chart')}
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
