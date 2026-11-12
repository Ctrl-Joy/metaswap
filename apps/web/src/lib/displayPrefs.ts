// Display preferences: the currency fiat values are shown in, and the locale numbers and dates are
// formatted for (it follows the interface language). Formatting helpers read the current choice
// synchronously (they run during render, outside React), so the settings store pushes every change
// here with setDisplayPrefs().
//
// Every price on MetaChain Devnet is quoted in USD. Other currencies are converted with the latest
// daily exchange rates (open.er-api.com, cached for 12 hours), falling back to the built-in rates
// below when the rates cannot be fetched. Trades always settle in tokens.
import { create } from 'zustand'
import { safeStorage } from './storage'

export interface CurrencyOption {
  code: string
  /** Built-in fallback: units of this currency per 1 USD. */
  rate: number
}

/** The currencies Uniswap offers, in its order: USD first, then alphabetical. */
export const CURRENCIES: readonly CurrencyOption[] = [
  { code: 'USD', rate: 1 },
  { code: 'ARS', rate: 1_000 },
  { code: 'AUD', rate: 1.52 },
  { code: 'BRL', rate: 5.5 },
  { code: 'CAD', rate: 1.37 },
  { code: 'CNY', rate: 7.2 },
  { code: 'COP', rate: 4_000 },
  { code: 'EUR', rate: 0.92 },
  { code: 'GBP', rate: 0.78 },
  { code: 'HKD', rate: 7.8 },
  { code: 'IDR', rate: 16_000 },
  { code: 'INR', rate: 84 },
  { code: 'JPY', rate: 150 },
  { code: 'KRW', rate: 1_380 },
  { code: 'MXN', rate: 18.5 },
  { code: 'NZD', rate: 1.66 },
  { code: 'NGN', rate: 1_600 },
  { code: 'PKR', rate: 280 },
  { code: 'RUB', rate: 95 },
  { code: 'SGD', rate: 1.34 },
  { code: 'SEK', rate: 10.6 },
  { code: 'TRY', rate: 34 },
  { code: 'UAH', rate: 41 },
  { code: 'VND', rate: 25_000 },
]

export const DEFAULT_CURRENCY = 'USD'
export const DEFAULT_LOCALE = 'en-US'

const RATES_URL = 'https://open.er-api.com/v6/latest/USD'
const RATES_KEY = 'metaswap.fx'
const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000

let liveRates: Record<string, number> = {}
let currency: CurrencyOption = CURRENCIES[0]!
let locale = DEFAULT_LOCALE

/** Bumps when live rates arrive, so the page can re-render its converted figures. */
export const useFxRates = create<{ updatedAt: number }>(() => ({ updatedAt: 0 }))

export function currencyOption(code: string | null | undefined): CurrencyOption {
  return CURRENCIES.find((c) => c.code === code?.toUpperCase()) ?? CURRENCIES[0]!
}

/** Units of the currency per 1 USD: the live rate when known, else the built-in one. */
export function rateFor(code: string): number {
  return liveRates[code] ?? currencyOption(code).rate
}

/** Called by the settings store whenever the choice changes (and once on load). */
export function setDisplayPrefs(next: { currency?: string; locale?: string }): void {
  if (next.currency !== undefined) currency = currencyOption(next.currency)
  if (next.locale !== undefined) locale = next.locale || DEFAULT_LOCALE
}

export function displayCurrency(): { code: string; rate: number } {
  return { code: currency.code, rate: rateFor(currency.code) }
}

export function displayLocale(): string {
  return locale
}

/** True when nothing differs from the original USD / en-US formatting (fast path, identical output). */
export function isDefaultDisplay(): boolean {
  return currency.code === DEFAULT_CURRENCY && locale === DEFAULT_LOCALE
}

/** The currency's symbol as the current locale writes it ("$", "€", "₹", "CA$"…). */
export function currencySymbol(code: string = currency.code, loc: string = locale): string {
  try {
    return new Intl.NumberFormat(loc, { style: 'currency', currency: code }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? code
  } catch {
    return code
  }
}

/** Fetch the day's exchange rates (cached for 12 hours). Failures keep the built-in rates. */
export async function loadFxRates(): Promise<void> {
  try {
    const cached = JSON.parse(String(safeStorage.getItem(RATES_KEY) ?? 'null')) as { at: number; rates: Record<string, number> } | null
    if (cached && Date.now() - cached.at < RATES_MAX_AGE_MS && cached.rates) {
      liveRates = cached.rates
      useFxRates.setState({ updatedAt: cached.at })
      return
    }
  } catch {
    /* unreadable cache: fetch again */
  }
  try {
    const res = await fetch(RATES_URL, { headers: { accept: 'application/json' } })
    if (!res.ok) return
    const body = (await res.json()) as { result?: string; rates?: Record<string, number> }
    if (body.result !== 'success' || !body.rates) return
    const rates: Record<string, number> = {}
    for (const c of CURRENCIES) if (Number.isFinite(body.rates[c.code]) && body.rates[c.code]! > 0) rates[c.code] = body.rates[c.code]!
    liveRates = rates
    const at = Date.now()
    safeStorage.setItem(RATES_KEY, JSON.stringify({ at, rates }))
    useFxRates.setState({ updatedAt: at })
  } catch {
    /* offline or blocked: the built-in rates stay in use */
  }
}
