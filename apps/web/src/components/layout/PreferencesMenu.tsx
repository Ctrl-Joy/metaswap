import { useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { CURRENCIES, LANGUAGES, currencyOption, languageOption } from '@/lib/displayPrefs'
import { useSettings } from '@/state/settings'

type View = 'main' | 'language' | 'currency'

/** Short sign for the currency chip: "$", "€", "₹", "kr", "Rp" (at most three characters). */
function narrowSymbol(code: string): string {
  try {
    const sym = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value
    return (sym ?? code).slice(0, 3)
  } catch {
    return code.slice(0, 3)
  }
}

function PrefRow({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 touch:min-h-11" data-testid={testId}>
      <span className="text-body-2 text-text-2">{label}</span>
      {children}
    </div>
  )
}

/** A row that opens a sub-list: label on the left, current value and a chevron on the right. */
function OpenRow({ label, value, onOpen, testId }: { label: string; value: string; onOpen: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={testId}
      aria-haspopup="listbox"
      className="-mx-2 flex min-h-9 items-center justify-between gap-3 rounded-lg px-2 text-left transition-colors hover:bg-surface-2 touch:min-h-11"
    >
      <span className="text-body-2 text-text-2">{label}</span>
      <span className="inline-flex min-w-0 items-center gap-1 text-body-2 font-semibold text-text-1">
        <span className="truncate">{value}</span>
        <ChevronRight size={20} className="shrink-0 text-text-2" aria-hidden />
      </span>
    </button>
  )
}

/** Sub-list with a back arrow and a check on the current choice (one tap picks and returns). */
function OptionList<T extends { code: string }>({
  title,
  items,
  value,
  onPick,
  onBack,
  render,
  note,
  testId,
}: {
  title: string
  items: readonly T[]
  value: string
  onPick: (code: string) => void
  onBack: () => void
  render: (item: T) => ReactNode
  note?: ReactNode
  testId: string
}) {
  return (
    <div className="flex flex-col" data-testid={testId}>
      <div className="flex items-center gap-1 pt-1 pb-2">
        <button type="button" onClick={onBack} aria-label="Back to preferences" data-testid={`${testId}-back`} className="-ml-2 inline-flex size-8 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 touch:size-11">
          <ChevronLeft size={20} />
        </button>
        <span className="text-body-1 font-medium">{title}</span>
      </div>
      <div role="listbox" aria-label={title} className="-mr-1 max-h-[min(400px,60dvh)] overflow-y-auto overscroll-contain pr-2 scrollbar-thin">
        {items.map((it) => {
          const selected = it.code === value
          return (
            <button
              key={it.code}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onPick(it.code)}
              data-testid={`${testId}-${it.code}`}
              className={cn('flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-surface-2', selected && 'bg-surface-2')}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">{render(it)}</span>
              {selected && <Check size={18} className="shrink-0 text-accent" aria-hidden />}
            </button>
          )
        })}
      </div>
      {note && <p className="mt-2 border-t border-border pt-2 pr-2 text-body-4 text-text-3">{note}</p>}
    </div>
  )
}

/**
 * Body of the "⋯" Global preferences popover: Theme, Language, Currency and Hide small balances.
 * Language and Currency open their own lists in place, with a back arrow, like a settings stack.
 * The popover unmounts on close, so it always reopens on the main list.
 */
export function GlobalPreferences({ themeControl }: { themeControl: ReactNode }) {
  const [view, setView] = useState<View>('main')
  const hide = useSettings((s) => s.hideSmallBalances)
  const setHide = useSettings((s) => s.setHideSmallBalances)
  const currency = useSettings((s) => s.currency)
  const setCurrency = useSettings((s) => s.setCurrency)
  const language = useSettings((s) => s.language)
  const setLanguage = useSettings((s) => s.setLanguage)

  if (view === 'language')
    return (
      <OptionList
        title="Language"
        testId="pref-language-list"
        items={LANGUAGES}
        value={languageOption(language).code}
        onBack={() => setView('main')}
        onPick={(code) => {
          setLanguage(code)
          setView('main')
        }}
        render={(l) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body-2 font-medium text-text-1" lang={l.code}>
              {l.label}
            </span>
            <span className="truncate text-body-4 text-text-2">{l.english}</span>
          </span>
        )}
        note="Sets how numbers and dates are written. Interface text stays in English for now."
      />
    )

  if (view === 'currency')
    return (
      <OptionList
        title="Currency"
        testId="pref-currency-list"
        items={CURRENCIES}
        value={currencyOption(currency).code}
        onBack={() => setView('main')}
        onPick={(code) => {
          setCurrency(code)
          setView('main')
        }}
        render={(c) => (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold text-text-1" aria-hidden>
              {narrowSymbol(c.code)}
            </span>
            <span className="text-body-2 font-semibold text-text-1">{c.code}</span>
            <span className="truncate text-body-3 text-text-2">{c.name}</span>
          </>
        )}
        note="Prices on MetaChain Devnet are quoted in USD and converted at fixed indicative rates. Trades settle in tokens."
      />
    )

  return (
    <>
      <div className="pt-2 pb-2 text-body-1 font-medium">Global preferences</div>
      <div className="flex flex-col gap-1 pr-2" data-testid="global-preferences">
        <PrefRow label="Theme" testId="pref-theme">
          {themeControl}
        </PrefRow>
        <OpenRow label="Language" value={languageOption(language).label} onOpen={() => setView('language')} testId="pref-language" />
        <OpenRow label="Currency" value={currencyOption(currency).code} onOpen={() => setView('currency')} testId="pref-currency" />
        <PrefRow label="Hide small balances">
          <Switch checked={hide} onChange={setHide} label="Hide small balances" testId="pref-hide-small" />
        </PrefRow>
      </div>
    </>
  )
}
