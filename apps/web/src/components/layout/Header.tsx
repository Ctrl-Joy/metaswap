import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, Menu, MoreHorizontal, Search, Moon, Sun, X, Zap, Layers, ArrowLeftRight, BookOpen } from 'lucide-react'
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
  { to: '/positions', label: 'Pool', match: ['/positions'] },
  { to: '/portfolio', label: 'Portfolio', match: ['/portfolio'] },
  // `wide`: shown inline only from xl (1280px); between lg and xl they live in the product menu
  // and mobile nav so the Connect button never overflows the header.
  { to: '/metaswapx', label: 'MetaSwapX', match: ['/metaswapx'], wide: true },
  { to: '/metachain', label: 'MetaChain', match: ['/metachain'], wide: true },
] as const satisfies ReadonlyArray<{ to: string; label: string; match: readonly string[]; wide?: boolean }>

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
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                'rounded-xl px-3 py-2 text-body-1 font-medium transition-colors',
                'wide' in item && item.wide && 'hidden xl:block',
                isActive(item.match) ? 'text-text-1' : 'text-text-2 hover:text-text-1',
              )}
            >
              {item.label}
            </NavLink>
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

export function ThemeToggle() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-full bg-surface-2 p-0.5">
      {(['light', 'dark'] as const).map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={theme === t}
          aria-label={t === 'dark' ? 'Dark theme' : 'Light theme'}
          data-testid={`theme-${t}`}
          onClick={() => setTheme(t)}
          className={cn('inline-flex h-7 w-9 items-center justify-center rounded-full transition-colors', theme === t ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:text-text-1')}
        >
          {t === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
        </button>
      ))}
    </div>
  )
}

function MoreMenu() {
  const hide = useSettings((s) => s.hideSmallBalances)
  const setHide = useSettings((s) => s.setHideSmallBalances)
  return (
    <Popover
      className="w-[290px]"
      trigger={
        <IconButton label="More" data-testid="more-button">
          <MoreHorizontal size={20} />
        </IconButton>
      }
    >
      <div className="mb-3 text-body-2 font-semibold">Global preferences</div>
      <div className="flex items-center justify-between py-1.5">
        <span className="text-body-3 text-text-2">Theme</span>
        <ThemeToggle />
      </div>
      <div className="flex items-center justify-between py-1.5">
        <span className="text-body-3 text-text-2">Hide small balances</span>
        <Switch checked={hide} onChange={setHide} label="Hide small balances" />
      </div>
      <div className="flex items-center justify-between py-1.5">
        <span className="text-body-3 text-text-2">Currency</span>
        <span className="text-body-3 font-medium">USD</span>
      </div>
    </Popover>
  )
}

function NetworkPill() {
  return (
    <Link
      to="/metachain"
      className="mr-1 hidden h-9 items-center gap-2 rounded-full bg-surface-2 px-3 text-body-3 font-medium text-text-2 transition-colors hover:text-text-1 tablet:inline-flex"
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
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => onOpenChange(false)}
                className={cn('rounded-xl px-3 py-3 text-body-1 font-medium', isActive(item.match) ? 'bg-surface-2 text-text-1' : 'text-text-2 hover:bg-surface-2')}
              >
                {item.label}
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
