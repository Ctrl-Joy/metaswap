import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, Menu, MoreHorizontal, Search, Moon, Sun, X, Zap, Layers, ArrowLeftRight, BookOpen, PiggyBank, Rocket, ChartNoAxesColumn, Send, CreditCard, Coins, Droplets, ListOrdered, Gavel, Plus, LayoutGrid, Clock } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { cn } from '@/lib/cn'
import { Button, IconButton, Identicon, Popover, Spinner, Switch } from '@/components/ui'
import { useUi } from '@/state/ui'
import { useSettings } from '@/state/settings'
import { usePendingCount } from '@/state/transactions'
import { useWallet } from '@/wallet/hooks'
import { shortenAddress } from '@/lib/format'
import { API_URL } from '@/config'
import { LogoMark, Wordmark } from './Logo'
import { SearchModal } from './SearchModal'

export const NAV_ITEMS = [
  { to: '/swap', label: 'Trade', match: ['/swap', '/limit', '/send', '/buy'] },
  { to: '/explore', label: 'Explore', match: ['/explore'] },
  { to: '/launches', label: 'Launches', match: ['/launches'], beta: true },
  { to: '/positions', label: 'Pool', match: ['/positions'] },
  { to: '/portfolio', label: 'Portfolio', match: ['/portfolio'] },
  // `wide`: shown inline only from xl (1280px); between lg and xl they live in the product menu
  // and mobile nav so the Connect button never overflows the header.
  { to: '/metaswapx', label: 'MetaSwapX', match: ['/metaswapx'], wide: true },
  { to: '/metachain', label: 'MetaChain', match: ['/metachain'], wide: true },
] as const satisfies ReadonlyArray<{ to: string; label: string; match: readonly string[]; wide?: boolean; beta?: boolean }>

/** Hover / focus sub-menus under the main nav items (Uniswap-style). The top-level item still navigates. */
export const NAV_MENUS: Record<string, Array<{ to: string; label: string; icon?: React.ReactNode }>> = {
  '/swap': [
    { to: '/swap', label: 'Swap', icon: <ArrowLeftRight size={18} /> },
    { to: '/limit', label: 'Limit', icon: <ChartNoAxesColumn size={18} /> },
    { to: '/send', label: 'Send', icon: <Send size={18} /> },
    { to: '/buy', label: 'Buy', icon: <CreditCard size={18} /> },
  ],
  '/explore': [
    { to: '/explore/tokens', label: 'Tokens', icon: <Coins size={18} /> },
    { to: '/explore/pools', label: 'Pools', icon: <Droplets size={18} /> },
    { to: '/explore/transactions', label: 'Transactions', icon: <ListOrdered size={18} /> },
    { to: '/explore/auctions', label: 'Auctions', icon: <Gavel size={18} /> },
  ],
  '/launches': [
    { to: '/launches', label: 'All launches', icon: <Rocket size={18} /> },
    { to: '/launches/create', label: 'Create launch', icon: <Plus size={18} /> },
  ],
  '/positions': [
    { to: '/positions', label: 'View positions', icon: <Layers size={18} /> },
    { to: '/positions/create', label: 'Create position', icon: <Plus size={18} /> },
  ],
  '/portfolio': [
    { to: '/portfolio', label: 'Overview', icon: <LayoutGrid size={18} /> },
    { to: '/portfolio/tokens', label: 'Tokens', icon: <Coins size={18} /> },
    { to: '/portfolio/activity', label: 'Activity', icon: <Clock size={18} /> },
  ],
}

function BetaBadge() {
  return <span className="ml-1.5 rounded-md bg-accent-tint px-1.5 py-0.5 align-middle text-[11px] leading-none font-semibold text-accent">Beta</span>
}

function useActive() {
  const { pathname } = useLocation()
  return (match: readonly string[]) => match.some((m) => pathname === m || pathname.startsWith(`${m}/`))
}

export function Header() {
  const isActive = useActive()
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <header className="sticky top-0 z-[980] h-[72px] bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1920px] items-center gap-2 px-4 tablet:px-3 lg:px-4">
        <IconButton label="Open menu" className="lg:hidden" onClick={() => setMobileOpen(true)} data-testid="mobile-menu-button">
          <Menu size={22} />
        </IconButton>
        <ProductMenu />
        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} item={item} active={isActive(item.match)} />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Search tokens and pools" onClick={() => setSearchOpen(true)} data-testid="search-button">
            <Search size={20} />
          </IconButton>
          <MoreMenu />
          <NetworkPill />
          <AccountButton />
        </div>
      </div>
      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} />
    </header>
  )
}

type NavItemDef = (typeof NAV_ITEMS)[number]

/**
 * Main-nav item with a hover/focus dropdown. Opens on pointer hover (desktop) and on keyboard focus
 * (Tab into the item, then Tab / ↓ through the entries; Esc closes). A tap still follows the link, so
 * touch devices keep plain click-through. The menu is absolutely positioned, so it never widens the header.
 */
function NavItem({ item, active }: { item: NavItemDef; active: boolean }) {
  const menu = NAV_MENUS[item.to]
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(true)
  }
  const hide = (delay = 120) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), delay)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const wide = 'wide' in item && item.wide
  const link = (
    <NavLink
      to={item.to}
      aria-haspopup={menu ? 'menu' : undefined}
      aria-expanded={menu ? open : undefined}
      data-testid={`nav-${item.label.toLowerCase()}`}
      onClick={() => setOpen(false)}
      onKeyDown={(e) => {
        if (!menu) return
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setOpen(true)
          const host = e.currentTarget.parentElement
          requestAnimationFrame(() => (host?.querySelector('[role=menuitem]') as HTMLElement | null)?.focus())
        } else if (e.key === 'Escape') setOpen(false)
      }}
      className={cn('block rounded-xl px-3 py-2 text-body-1 font-medium transition-colors', active ? 'text-text-1' : 'text-text-2 hover:text-text-1')}
    >
      {item.label}
      {'beta' in item && item.beta && <BetaBadge />}
    </NavLink>
  )
  if (!menu) return <div className={cn(wide && 'hidden xl:block')}>{link}</div>
  return (
    <div
      className={cn('relative', wide && 'hidden xl:block')}
      onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && hide()}
      onFocus={show}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide(0)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setOpen(false)
          ;(e.currentTarget.querySelector('a') as HTMLElement | null)?.focus()
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]')]
          const i = items.indexOf(document.activeElement as HTMLElement)
          if (i < 0) return
          e.preventDefault()
          items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
        }
      }}
    >
      {link}
      <div className={cn('absolute top-full left-1/2 z-[990] -translate-x-1/2 pt-2.5 transition-opacity duration-100', open ? 'visible opacity-100' : 'invisible opacity-0')}>
        <div role="menu" aria-label={`${item.label} menu`} data-testid={`nav-menu-${item.label.toLowerCase()}`} className="flex w-[182px] flex-col gap-1 rounded-2xl border border-surface-2 bg-surface-1 p-[5px] shadow-large">
          {menu.map((m) => (
            <Link
              key={m.to}
              to={m.to}
              role="menuitem"
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
              className="flex h-12 items-center gap-2 rounded-xl bg-surface-2 px-3 text-body-2 font-semibold text-text-2 transition-colors hover:bg-surface-2-hover hover:text-text-1 focus-visible:text-text-1 focus-visible:outline-none"
            >
              {m.icon}
              {m.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProductMenu() {
  return (
    <div className="flex items-center">
      <Link to="/swap" className="flex items-center gap-2 rounded-xl py-1 pr-1" aria-label="MetaSwap home">
        <LogoMark size={28} />
        <Wordmark className="hidden sm:inline" />
      </Link>
      <Popover
        align="start"
        className="w-[300px] p-2"
        trigger={
          <button type="button" aria-label="MetaSwap products" className="ml-0.5 inline-flex size-7 items-center justify-center rounded-full text-text-2 hover:bg-surface-3 hover:text-text-1">
            <ChevronDown size={16} />
          </button>
        }
      >
        <MenuSection title="Products">
          <MenuLink to="/swap" icon={<ArrowLeftRight size={18} />} title="MetaSwap" subtitle="Swap, pool and explore" />
          <MenuLink to="/earn" icon={<PiggyBank size={18} />} title="Earn" subtitle="Savings vaults, no lockup" />
          <MenuLink to="/launches" icon={<Rocket size={18} />} title="Launches" subtitle="Token auctions (beta)" />
          <MenuLink to="/metaswapx" icon={<Zap size={18} />} title="MetaSwapX" subtitle="Gasless intent orders" />
          <MenuLink to="/metachain" icon={<Layers size={18} />} title="MetaChain" subtitle="The planned MetaSwap chain" />
        </MenuSection>
        <MenuSection title="Developers">
          <a href={`${API_URL}/health`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl px-2 py-2 text-body-3 text-text-2 hover:bg-surface-2 hover:text-text-1">
            <BookOpen size={18} /> API status
          </a>
        </MenuSection>
        <div className="border-t border-border px-2 pt-2 pb-1 text-body-4 text-text-3">MetaSwap devnet build · test funds only</div>
      </Popover>
    </div>
  )
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-2 pt-2 pb-1 text-body-4 font-semibold text-text-3">{title}</div>
      {children}
    </div>
  )
}

function MenuLink({ to, icon, title, subtitle }: { to: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
      <span className="flex size-9 items-center justify-center rounded-lg bg-accent-tint text-accent">{icon}</span>
      <span>
        <span className="block text-body-3 font-semibold">{title}</span>
        <span className="block text-body-4 text-text-2">{subtitle}</span>
      </span>
    </Link>
  )
}

const THEME_OPTIONS = [
  { value: 'auto', label: 'Auto (follow system)', icon: <span className="text-body-4 font-semibold">Auto</span> },
  { value: 'light', label: 'Light theme', icon: <Sun size={16} /> },
  { value: 'dark', label: 'Dark theme', icon: <Moon size={16} /> },
] as const

export function ThemeToggle() {
  const choice = useSettings((s) => s.themeChoice)
  const setChoice = useSettings((s) => s.setThemeChoice)
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex h-[34px] items-center gap-2 rounded-[20px] border border-border p-1">
      {THEME_OPTIONS.map((t) => (
        <button
          key={t.value}
          role="radio"
          aria-checked={choice === t.value}
          aria-label={t.label}
          title={t.label}
          data-testid={`theme-${t.value}`}
          onClick={() => setChoice(t.value)}
          className={cn('inline-flex h-6 min-w-9 items-center justify-center rounded-full px-2 transition-colors', choice === t.value ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:text-text-1')}
        >
          {t.icon}
        </button>
      ))}
    </div>
  )
}

function PrefRow({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3" data-testid={testId}>
      <span className="text-body-2 text-text-2">{label}</span>
      {children}
    </div>
  )
}

/** Single-option row (Language, Currency): value + chevron like Uniswap; the devnet build has one option. */
function ChoiceRow({ label, value, hint, testId }: { label: string; value: string; hint: string; testId: string }) {
  return (
    <PrefRow label={label} testId={testId}>
      <span className="inline-flex items-center gap-1 text-body-2 font-semibold text-text-1" title={hint}>
        {value} <ChevronRight size={20} className="text-text-2" aria-hidden />
      </span>
    </PrefRow>
  )
}

/** "⋯" Global preferences (Uniswap: 325px, radius 16, 12/4/12/16 padding; Theme · Language · Currency). */
function MoreMenu() {
  const hide = useSettings((s) => s.hideSmallBalances)
  const setHide = useSettings((s) => s.setHideSmallBalances)
  return (
    <Popover
      className="w-[325px] border-surface-2 py-3 pr-1 pl-4"
      trigger={
        <IconButton label="More" data-testid="more-button" className="data-[state=open]:bg-surface-2">
          <MoreHorizontal size={20} />
        </IconButton>
      }
    >
      <div className="pt-2 pb-2 text-body-1 font-medium">Global preferences</div>
      <div className="flex flex-col gap-1 pr-2" data-testid="global-preferences">
        <PrefRow label="Theme" testId="pref-theme">
          <ThemeToggle />
        </PrefRow>
        <ChoiceRow label="Language" value="English" hint="Only English is available on the devnet build" testId="pref-language" />
        <ChoiceRow label="Currency" value="USD" hint="Prices are quoted in USD on the devnet build" testId="pref-currency" />
        <PrefRow label="Hide small balances">
          <Switch checked={hide} onChange={setHide} label="Hide small balances" testId="pref-hide-small" />
        </PrefRow>
      </div>
    </Popover>
  )
}

function NetworkPill() {
  return (
    <Link
      to="/metachain"
      className="mr-1 hidden h-9 items-center gap-2 rounded-full bg-surface-2 px-3 text-body-3 font-medium text-text-2 transition-colors hover:text-text-1 tablet:inline-flex lg:hidden xl:inline-flex"
      title="MetaChain Devnet (chain 31337)"
    >
      <span className="size-2 rounded-full bg-success" aria-hidden />
      MetaChain Devnet
    </Link>
  )
}

function AccountButton() {
  const { address, isConnecting } = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const openDrawer = useUi((s) => s.openDrawer)
  const pending = usePendingCount(address)
  if (!address)
    return (
      <Button size="md" onClick={openConnect} loading={isConnecting} data-testid="connect-button" className="h-10 px-4">
        Connect
      </Button>
    )
  return (
    <button
      type="button"
      onClick={openDrawer}
      data-testid="account-button"
      className="flex h-10 items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-body-3 font-semibold transition-colors hover:bg-surface-2-hover"
    >
      {pending > 0 ? (
        <span className="flex h-8 items-center gap-1.5 rounded-full bg-accent-tint px-2.5 text-accent">
          <Spinner size={14} /> {pending} pending
        </span>
      ) : (
        <Identicon address={address} size={32} />
      )}
      <span className="hidden font-mono sm:inline">{shortenAddress(address)}</span>
    </button>
  )
}

function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const isActive = useActive()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1190] bg-scrim animate-fade-in" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-[1200] flex w-[min(320px,85vw)] flex-col bg-surface-1 p-4 shadow-large outline-none animate-fade-in">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2">
              <LogoMark size={26} /> <Wordmark />
            </Dialog.Title>
            <Dialog.Description className="sr-only">Site navigation</Dialog.Description>
            <Dialog.Close asChild>
              <IconButton label="Close menu">
                <X size={20} />
              </IconButton>
            </Dialog.Close>
          </div>
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {[...NAV_ITEMS.slice(0, 5), { to: '/earn', label: 'Earn', match: ['/earn'] } as const, ...NAV_ITEMS.slice(5)].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => onOpenChange(false)}
                className={cn('rounded-xl px-3 py-3 text-body-1 font-medium', isActive(item.match) ? 'bg-surface-2 text-text-1' : 'text-text-2 hover:bg-surface-2')}
              >
                {item.label}
                {'beta' in item && item.beta && <BetaBadge />}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
            <span className="text-body-3 text-text-2">Theme</span>
            <ThemeToggle />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
