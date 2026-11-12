import { useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { CURRENCIES, currencyOption } from '@/lib/displayPrefs'
import { LANGUAGES, languageOption, t } from '@/i18n'
import { useSettings } from '@/state/settings'

type View = 'main' | 'language' | 'currency'

/** Put the choice in the address bar (?lng=… / ?cur=…) so the page can be shared as seen, like Uniswap. */
function setUrlParam(name: 'lng' | 'cur', value: string) {
  try {
    const url = new URL(window.location.href)
    url.searchParams.set(name, value)
    window.history.replaceState(window.history.state, '', url)
  } catch {
    /* non-browser */
  }
}

function PrefRow({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3" data-testid={testId}>
      <span className="text-body-2 text-text-2">{label}</span>
      {children}
    </div>
  )
}

/** A row that opens a sub-list: label on the left, current value and a chevron on the right. */
function OpenRow({ label, value, onOpen, testId }: { label: string; value: string; onOpen: () => void; testId: string }) {
  return (
    <button type="button" onClick={onOpen} data-testid={testId} aria-haspopup="listbox" className="group flex min-h-9 items-center justify-between gap-3 text-left">
      <span className="text-body-2 text-text-2">{label}</span>
      <span className="inline-flex min-w-0 items-center gap-1 text-body-2 text-text-2 transition-colors group-hover:text-text-1">
        <span className="truncate">{value}</span>
        <ChevronRight size={20} className="shrink-0" aria-hidden />
      </span>
    </button>
  )
}

/** Sub-list with a back arrow and a check on the current choice; picking returns to the main list. */
function OptionList({ title, testId, onBack, children }: { title: string; testId: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col" data-testid={testId}>
      <div className="flex items-center gap-2 pt-1 pb-2">
        <button type="button" onClick={onBack} aria-label={t('Back')} data-testid={`${testId}-back`} className="-ml-1 inline-flex size-7 items-center justify-center rounded-full text-text-1 transition-colors hover:bg-surface-2">
          <ChevronLeft size={20} />
        </button>
        <span className="text-body-1 font-medium">{title}</span>
      </div>
      <div role="listbox" aria-label={title} className="-mr-1 max-h-[min(560px,70dvh)] overflow-y-auto overscroll-contain pr-2 scrollbar-thin">
        {children}
      </div>
    </div>
  )
}

function OptionRow({ selected, onPick, testId, children }: { selected: boolean; onPick: () => void; testId: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      data-testid={testId}
      className={cn('flex h-[42px] w-full items-center gap-3 rounded-lg text-left text-body-3 transition-colors hover:text-text-1', selected ? 'text-text-1' : 'text-text-1/90')}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2.5">{children}</span>
      {selected && <Check size={20} className="shrink-0 text-accent" aria-hidden />}
    </button>
  )
}

/**
 * Body of the "⋯" Global preferences popover (Theme, Language, Currency, Hide small balances),
 * laid out like Uniswap's: Language and Currency open their own lists in place, with a back arrow.
 * Language translates the whole interface and number formats; Currency converts every fiat figure.
 * The popover unmounts on close, so it always reopens on the main list.
 */
export function GlobalPreferences({ themeControl }: { themeControl: ReactNode }) {
  const [view, setView] = useState<View>('main')
  const [busy, setBusy] = useState(false)
  const hide = useSettings((s) => s.hideSmallBalances)
  const setHide = useSettings((s) => s.setHideSmallBalances)
  const currency = currencyOption(useSettings((s) => s.currency)).code
  const setCurrency = useSettings((s) => s.setCurrency)
  const language = languageOption(useSettings((s) => s.language)).code
  const setLanguage = useSettings((s) => s.setLanguage)

  if (view === 'language')
    return (
      <OptionList title={t('Language')} testId="pref-language-list" onBack={() => setView('main')}>
        {LANGUAGES.map((l) => (
          <OptionRow
            key={l.code}
            selected={l.code === language}
            testId={`pref-language-list-${l.code}`}
            onPick={async () => {
              if (busy) return
              setBusy(true)
              setUrlParam('lng', l.code)
              try {
                await setLanguage(l.code)
              } finally {
                setBusy(false)
              }
            }}
          >
            <span className="truncate">{t(l.name)}</span>
            {l.code !== language && t(l.name) !== l.native && (
              <span className="truncate text-body-4 text-text-3" lang={l.code}>
                {l.native}
              </span>
            )}
          </OptionRow>
        ))}
      </OptionList>
    )

  if (view === 'currency')
    return (
      <OptionList title={t('Currency')} testId="pref-currency-list" onBack={() => setView('main')}>
        {CURRENCIES.map((c) => (
          <OptionRow
            key={c.code}
            selected={c.code === currency}
            testId={`pref-currency-list-${c.code}`}
            onPick={() => {
              setUrlParam('cur', c.code)
              setCurrency(c.code)
              setView('main')
            }}
          >
            <img src={`/flags/${c.code}.svg`} alt="" width={20} height={20} className="size-5 shrink-0 rounded-full" loading="lazy" />
            <span>{c.code}</span>
          </OptionRow>
        ))}
      </OptionList>
    )

  return (
    <>
      <div className="pt-2 pb-2 text-body-1 font-medium">{t('Global preferences')}</div>
      <div className="flex flex-col gap-1 pr-2" data-testid="global-preferences">
        <PrefRow label={t('Theme')} testId="pref-theme">
          {themeControl}
        </PrefRow>
        <OpenRow label={t('Language')} value={t(languageOption(language).name)} onOpen={() => setView('language')} testId="pref-language" />
        <OpenRow label={t('Currency')} value={currency} onOpen={() => setView('currency')} testId="pref-currency" />
        <PrefRow label={t('Hide small balances')}>
          <Switch checked={hide} onChange={setHide} label={t('Hide small balances')} testId="pref-hide-small" />
        </PrefRow>
      </div>
    </>
  )
}
