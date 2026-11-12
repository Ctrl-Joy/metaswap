// Display preferences: the currency fiat values are shown in, and the locale that numbers and dates
// are formatted for. Formatting helpers read the current choice synchronously (they run during
// render, outside React), so the settings store pushes every change here with setDisplayPrefs().
//
// Every price on MetaChain Devnet is quoted in USD. Other currencies are a display conversion at the
// fixed indicative rates below; trades always settle in tokens.

export interface CurrencyOption {
  code: string
  name: string
  /** Units of this currency per 1 USD (fixed indicative rate, not a live feed). */
  rate: number
}

export const CURRENCIES: readonly CurrencyOption[] = [
  { code: 'USD', name: 'US dollar', rate: 1 },
  { code: 'EUR', name: 'Euro', rate: 0.92 },
  { code: 'GBP', name: 'British pound', rate: 0.78 },
  { code: 'INR', name: 'Indian rupee', rate: 84 },
  { code: 'JPY', name: 'Japanese yen', rate: 150 },
  { code: 'CNY', name: 'Chinese yuan', rate: 7.2 },
  { code: 'KRW', name: 'South Korean won', rate: 1380 },
  { code: 'AUD', name: 'Australian dollar', rate: 1.52 },
  { code: 'CAD', name: 'Canadian dollar', rate: 1.37 },
  { code: 'CHF', name: 'Swiss franc', rate: 0.88 },
  { code: 'SGD', name: 'Singapore dollar', rate: 1.34 },
  { code: 'HKD', name: 'Hong Kong dollar', rate: 7.8 },
  { code: 'AED', name: 'UAE dirham', rate: 3.67 },
  { code: 'IDR', name: 'Indonesian rupiah', rate: 16_000 },
  { code: 'BRL', name: 'Brazilian real', rate: 5.5 },
  { code: 'MXN', name: 'Mexican peso', rate: 18.5 },
  { code: 'TRY', name: 'Turkish lira', rate: 34 },
  { code: 'NGN', name: 'Nigerian naira', rate: 1_600 },
  { code: 'PKR', name: 'Pakistani rupee', rate: 280 },
  { code: 'NZD', name: 'New Zealand dollar', rate: 1.66 },
  { code: 'SEK', name: 'Swedish krona', rate: 10.6 },
  { code: 'ZAR', name: 'South African rand', rate: 18.2 },
]

export interface LanguageOption {
  /** BCP 47 locale used for number and date formatting. */
  code: string
  /** Name in its own language. */
  label: string
  /** English name, shown as a hint. */
  english: string
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en-US', label: 'English (US)', english: 'English, United States' },
  { code: 'en-GB', label: 'English (UK)', english: 'English, United Kingdom' },
  { code: 'zh-CN', label: '简体中文', english: 'Chinese, Simplified' },
  { code: 'zh-TW', label: '繁體中文', english: 'Chinese, Traditional' },
  { code: 'nl-NL', label: 'Nederlands', english: 'Dutch' },
  { code: 'fr-FR', label: 'Français', english: 'French' },
  { code: 'de-DE', label: 'Deutsch', english: 'German' },
  { code: 'hi-IN', label: 'हिन्दी', english: 'Hindi' },
  { code: 'id-ID', label: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'it-IT', label: 'Italiano', english: 'Italian' },
  { code: 'ja-JP', label: '日本語', english: 'Japanese' },
  { code: 'ko-KR', label: '한국어', english: 'Korean' },
  { code: 'pt-BR', label: 'Português (Brasil)', english: 'Portuguese, Brazil' },
  { code: 'ru-RU', label: 'Русский', english: 'Russian' },
  { code: 'es-ES', label: 'Español (España)', english: 'Spanish, Spain' },
  { code: 'es-419', label: 'Español (Latinoamérica)', english: 'Spanish, Latin America' },
  { code: 'tr-TR', label: 'Türkçe', english: 'Turkish' },
  { code: 'vi-VN', label: 'Tiếng Việt', english: 'Vietnamese' },
]

export const DEFAULT_CURRENCY = 'USD'
export const DEFAULT_LOCALE = 'en-US'

let currency: CurrencyOption = CURRENCIES[0]!
let locale = DEFAULT_LOCALE

export function currencyOption(code: string | undefined): CurrencyOption {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]!
}

export function languageOption(code: string | undefined): LanguageOption {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]!
}

/** Called by the settings store whenever the choice changes (and once on load). */
export function setDisplayPrefs(next: { currency?: string; locale?: string }): void {
  if (next.currency !== undefined) currency = currencyOption(next.currency)
  if (next.locale !== undefined) locale = languageOption(next.locale).code
  if (typeof document !== 'undefined') document.documentElement.lang = locale.split('-')[0] ?? 'en'
}

export function displayCurrency(): CurrencyOption {
  return currency
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
