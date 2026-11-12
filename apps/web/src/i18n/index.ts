// Interface translation. Strings are written in English in the code and wrapped in t():
//
//   t('Connect wallet')                       → "Conectar wallet" in Spanish
//   t('Swap {from} for {to}', { from, to })   → placeholders are filled after translating
//
// Each feature area keeps its own catalogs in src/i18n/messages/<area>/<locale>.ts, mapping the
// English string to the translation. Only the chosen language is downloaded, and anything missing
// from a catalog falls back to English, so a partly translated screen never breaks.
//
// t() reads the current language synchronously (it also runs outside React, in toasts and error
// messages); the app re-renders from the top when the language changes.

export interface LanguageOption {
  /** BCP 47 code, also used for number and date formatting. */
  code: string
  /** English name. It is itself translated, so the list reads in the current language (as Uniswap does). */
  name: string
  /** Name in its own language, shown as a hint under the translated name. */
  native: string
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en-US', name: 'English', native: 'English' },
  { code: 'zh-CN', name: 'Chinese, Simplified', native: '简体中文' },
  { code: 'fr-FR', name: 'French', native: 'Français' },
  { code: 'id-ID', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ja-JP', name: 'Japanese', native: '日本語' },
  { code: 'ko-KR', name: 'Korean', native: '한국어' },
  { code: 'pt-PT', name: 'Portuguese', native: 'Português' },
  { code: 'ru-RU', name: 'Russian', native: 'Русский' },
  { code: 'es-ES', name: 'Spanish', native: 'Español' },
]

export const DEFAULT_LANGUAGE = 'en-US'

export function languageOption(code: string | null | undefined): LanguageOption {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]!
}

/** A supported language for a code such as "es", "es-MX" or "pt-BR", or null. */
export function matchLanguage(code: string | null | undefined): string | null {
  if (!code) return null
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === code.toLowerCase())
  if (exact) return exact.code
  const base = code.split('-')[0]!.toLowerCase()
  return LANGUAGES.find((l) => l.code.split('-')[0]!.toLowerCase() === base)?.code ?? null
}

type Catalog = Record<string, string>

// Every catalog file, split per area and language; loaded on demand.
const catalogFiles = import.meta.glob<{ default: Catalog }>('./messages/*/*.ts')

let current = DEFAULT_LANGUAGE
let messages: Catalog = {}
const loaded = new Map<string, Catalog>()

/** Download (once) and merge every area's catalog for a language. English needs none. */
export async function loadLanguage(code: string): Promise<void> {
  if (code === DEFAULT_LANGUAGE || loaded.has(code)) return
  const parts = await Promise.all(
    Object.entries(catalogFiles)
      .filter(([path]) => path.endsWith(`/${code}.ts`))
      .map(([, load]) => load().then((m) => m.default)),
  )
  loaded.set(code, Object.assign({}, ...parts))
}

/** Switch the language used by t(). Call loadLanguage() first. */
export function setLanguage(code: string): void {
  current = languageOption(code).code
  messages = loaded.get(current) ?? {}
  if (typeof document !== 'undefined') document.documentElement.lang = current
}

export function currentLanguage(): string {
  return current
}

/**
 * Translate an English interface string, filling {placeholders} from vars.
 * A word that means different things in different places can carry a context prefix, e.g.
 * t('realtime::Live') vs t('Live'): the prefix keeps the translations apart and is dropped in English.
 */
export function t(text: string, vars?: Record<string, string | number | null | undefined>): string {
  const out = messages[text] ?? text.replace(/^[a-z]+::/, '')
  if (!vars) return out
  return out.replace(/\{(\w+)\}/g, (m, key: string) => (vars[key] === undefined || vars[key] === null ? m : String(vars[key])))
}
