import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ChevronDown, Code, Droplets, Layers, PiggyBank, Rocket, Zap, ArrowLeftRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { API_URL } from '@/config'
import { t } from '@/i18n'
import { LogoMark, Wordmark } from './Logo'

const REPO = 'https://github.com/Ctrl-Joy/metaswap'

/** GitHub mark (lucide no longer ships brand icons). */
function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function Product({ to, href, icon, title, subtitle, onPick }: { to?: string; href?: string; icon: ReactNode; title: string; subtitle: string; onPick: () => void }) {
  const body = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="block text-body-3 font-semibold text-text-1">{title}</span>
        <span className="block truncate text-body-4 text-text-2">{subtitle}</span>
      </span>
    </>
  )
  const cls = 'flex items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-surface-2'
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" role="menuitem" className={cls} onClick={onPick}>
      {body}
    </a>
  ) : (
    <Link to={to!} role="menuitem" className={cls} onClick={onPick}>
      {body}
    </Link>
  )
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="px-2 pb-1 text-body-4 text-text-3">{title}</div>
      {children}
    </div>
  )
}

function PlainLink({ to, href, children, onPick }: { to?: string; href?: string; children: ReactNode; onPick: () => void }) {
  const cls = 'rounded-lg px-2 py-1.5 text-body-3 font-medium text-text-1 transition-colors hover:bg-surface-2'
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" role="menuitem" className={cls} onClick={onPick}>
      {children}
    </a>
  ) : (
    <Link to={to!} role="menuitem" className={cls} onClick={onPick}>
      {children}
    </Link>
  )
}

/**
 * Logo and its menu, laid out like Uniswap's: the mark and name go home, the chevron area opens a
 * panel (on hover, focus or tap) with the products, protocol pages and resources, a "Legal & Privacy"
 * note and the GitHub link. Every entry points to something MetaSwap really has.
 */
export function ProductMenu() {
  const [open, setOpen] = useState(false)
  const [legal, setLegal] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(true)
  }
  const hide = (delay = 150) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), delay)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const close = () => setOpen(false)

  return (
    <div
      className="relative flex items-center"
      onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && hide()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide(0)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <Link to="/" className="flex items-center gap-2 rounded-xl py-1 pr-1" aria-label={t('MetaSwap home')} onClick={close}>
        <LogoMark size={28} />
        <Wordmark className="hidden sm:inline" />
      </Link>
      <button
        type="button"
        aria-label={t('MetaSwap products')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="product-menu-button"
        // A mouse has already opened it on hover, so a click keeps it open; taps and keys toggle it.
        onClick={(e) => setOpen((o) => ((e.nativeEvent as PointerEvent).pointerType === 'mouse' ? true : !o))}
        className="ml-0.5 inline-flex size-7 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1"
      >
        <ChevronDown size={16} className={cn('transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {/* Phones: pinned inside the screen under the header; from 640px it hangs from the logo. */}
      <div className={cn('fixed inset-x-3 top-[64px] z-[990] pt-2 transition-opacity duration-100 sm:absolute sm:inset-x-auto sm:top-full sm:left-0', open ? 'visible opacity-100' : 'invisible opacity-0')}>
        <div role="menu" aria-label={t('MetaSwap products')} data-testid="product-menu" className="max-h-[calc(100dvh-88px)] w-full overflow-y-auto rounded-2xl sm:w-[420px] border border-surface-2 bg-surface-1 p-3 shadow-large">
          <Column title={t('Products')}>
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
              <Product to="/swap" icon={<ArrowLeftRight size={16} />} title="MetaSwap" subtitle={t('Swap, explore and earn')} onPick={close} />
              <Product to="/metaswapx" icon={<Zap size={16} />} title="MetaSwapX" subtitle={t('Gasless intent orders')} onPick={close} />
              <Product href={`${REPO}/tree/main/services/api`} icon={<Code size={16} />} title="API" subtitle={t('Integrate the protocol')} onPick={close} />
              <Product to="/metachain" icon={<Layers size={16} />} title="MetaChain" subtitle={t('The planned MetaSwap chain')} onPick={close} />
              <Product to="/earn" icon={<PiggyBank size={16} />} title={t('Earn')} subtitle={t('Savings vaults, no lockup')} onPick={close} />
              <Product to="/launches" icon={<Rocket size={16} />} title={t('Launches')} subtitle={t('Token auctions (beta)')} onPick={close} />
            </div>
          </Column>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
            <Column title={t('Protocol')}>
              <PlainLink to="/explore/pools" onPick={close}>
                {t('Pools')}
              </PlainLink>
              <PlainLink to="/positions/create" onPick={close}>
                {t('Create position')}
              </PlainLink>
              <PlainLink href={REPO} onPick={close}>
                {t('Developers')}
              </PlainLink>
            </Column>
            <Column title={t('Resources')}>
              <PlainLink href={`${API_URL}/health`} onPick={close}>
                {t('API status')}
              </PlainLink>
              <PlainLink to="/buy" onPick={close}>
                {t('Devnet faucet')}
              </PlainLink>
              <PlainLink href={`${REPO}#readme`} onPick={close}>
                {t('Documentation')}
              </PlainLink>
            </Column>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border px-2 pt-2.5">
            <button type="button" onClick={() => setLegal((v) => !v)} aria-expanded={legal} className="inline-flex items-center gap-1 text-body-4 text-text-2 hover:text-text-1">
              {t('Legal & Privacy')} <ChevronDown size={14} className={cn('transition-transform', legal && 'rotate-180')} />
            </button>
            <span className="flex items-center gap-3 text-text-2">
              <a href={REPO} target="_blank" rel="noreferrer" aria-label="GitHub" className="hover:text-text-1" onClick={close}>
                <GithubMark />
              </a>
              <a href={`${API_URL}/health`} target="_blank" rel="noreferrer" aria-label={t('API status')} className="hover:text-text-1" onClick={close}>
                <Activity size={16} />
              </a>
              <Link to="/explore/pools" aria-label={t('Pools')} className="hover:text-text-1" onClick={close}>
                <Droplets size={16} />
              </Link>
            </span>
          </div>
          {legal && (
            <p className="mt-2 px-2 text-body-4 text-text-2" data-testid="product-menu-legal">
              {t('MetaSwap runs on MetaChain Devnet, a test network. Tokens have no value and no real funds are used. Open source under GPL-3.0.')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
