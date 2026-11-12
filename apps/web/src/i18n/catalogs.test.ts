import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LANGUAGES } from './index'

// Every English string passed to t() must have a translation in every language's catalog for the
// same area, with the same {placeholders}. Run one area with:  npx vitest run src/i18n -t "explore"

const SRC = fileURLToPath(new URL('..', import.meta.url))

/** Which source files each catalog area covers (paths relative to src/, folders include subfolders). */
export const AREAS: Record<string, string[]> = {
  preferences: ['components/layout/PreferencesMenu.tsx'],
  core: ['App.tsx', 'components', 'wallet', 'features/account', 'features/settings', 'state', 'lib/errors.ts', 'lib/format.ts', 'hooks', 'api', 'pages/NotFoundPage.tsx'],
  trade: ['features/swap', 'features/limit', 'features/send', 'features/buy', 'features/tokens', 'pages/SwapPage.tsx', 'pages/LimitPage.tsx', 'pages/SendPage.tsx', 'pages/BuyPage.tsx', 'pages/TradeLayout.tsx'],
  explore: ['features/explore', 'pages/explore'],
  positions: ['features/positions', 'pages/positions'],
  launches: ['features/launches', 'pages/launches'],
  portfolio: ['features/portfolio', 'features/earn', 'pages/portfolio', 'pages/earn', 'pages/MetaSwapXPage.tsx', 'pages/MetaChainPage.tsx', 'pages/useXFiller.ts'],
}

const catalogs = import.meta.glob<{ default: Record<string, string> }>('./messages/*/*.ts', { eager: true })

function files(entry: string): string[] {
  const abs = join(SRC, entry)
  let st
  try {
    st = statSync(abs)
  } catch {
    return []
  }
  if (st.isFile()) return [abs]
  return readdirSync(abs).flatMap((n) => files(relative(SRC, join(abs, n))))
}

/** Static first arguments of t('…') / t("…") calls. */
function keysIn(file: string): string[] {
  if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) return []
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  const re = /(?<![\w.$])t\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out.push(m[2]!.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n'))
  return out
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

/** The preferences menu lists every language's name, so all areas share those keys. */
const SHARED = new Set(['English', ...LANGUAGES.map((l) => l.name)])

// Coverage is checked against the merged catalog of the language: a string used in one area may be
// translated in another area's file (shared words such as "Swap" or "Connect wallet").
for (const [area, entries] of Object.entries(AREAS)) {
  describe(area, () => {
    const keys = [...new Set(entries.flatMap(files).flatMap(keysIn))]
    for (const lang of LANGUAGES.filter((l) => l.code !== 'en-US')) {
      it(`${lang.code} has every string`, () => {
        const merged: Record<string, string> = {}
        for (const [path, mod] of Object.entries(catalogs)) if (path.endsWith(`/${lang.code}.ts`)) Object.assign(merged, mod.default)
        const missing = keys.filter((k) => !SHARED.has(k) && !(k in merged))
        expect(missing, `${missing.length} untranslated in ${area}/${lang.code}`).toEqual([])
        const badVars = keys.filter((k) => k in merged && placeholders(k) !== placeholders(merged[k]!))
        expect(badVars, `placeholders differ in ${area}/${lang.code}`).toEqual([])
        const empty = keys.filter((k) => k in merged && !merged[k]!.trim())
        expect(empty).toEqual([])
      })
    }
  })
}
