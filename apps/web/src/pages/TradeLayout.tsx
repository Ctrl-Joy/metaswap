import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { SettingsPopover } from '@/features/settings/SettingsPopover'

const TABS = [
  { to: '/swap', label: 'Swap' },
  { to: '/limit', label: 'Limit' },
  { to: '/send', label: 'Send' },
  { to: '/buy', label: 'Buy' },
] as const

/** Card frame shared by /swap, /limit, /send, /buy: tab row + settings gear (ui-ux.md §2.1–2.2). */
export function TradeLayout({ children, settings = false, below, wide }: { children: ReactNode; settings?: boolean; below?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex flex-col items-center px-4 pt-6 pb-24 md:pt-[min(10vh,96px)]">
      <div className={cn('w-full', wide ? 'max-w-[480px]' : 'max-w-[480px]')}>
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
          {settings && <SettingsPopover />}
        </div>
        {children}
      </div>
      {below && <div className="mt-8 w-full max-w-[480px]">{below}</div>}
    </div>
  )
}
