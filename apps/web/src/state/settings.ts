import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'

/** Resolved theme applied to <html data-theme>. */
export type ThemePref = 'dark' | 'light'
/** User choice; 'auto' follows prefers-color-scheme. */
export type ThemeChoice = 'auto' | ThemePref

export function systemTheme(): ThemePref {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function resolveTheme(choice: ThemeChoice, system: ThemePref = systemTheme()): ThemePref {
  return choice === 'auto' ? system : choice
}

/** Auto slippage used when the user has not set a custom value (0.5%). */
export const AUTO_SLIPPAGE_BPS = 50
export const MAX_SLIPPAGE_BPS = 5_000 // 50%
export const DEFAULT_DEADLINE_MIN = 30
export const MAX_DEADLINE_MIN = 4_320 // 3 days

export interface SettingsState {
  /** Resolved theme (derived from themeChoice; kept in state so the pre-paint script in index.html can read it). */
  theme: ThemePref
  themeChoice: ThemeChoice
  setThemeChoice: (t: ThemeChoice) => void
  /** Hidden token addresses (lower-case) per the portfolio "Hide token" action. */
  hiddenTokens: string[]
  toggleHiddenToken: (address: string) => void
  slippageMode: 'auto' | 'custom'
  /** Raw text of the custom slippage input in percent, e.g. "0.8". */
  customSlippage: string
  deadlineMinutes: number
  routeV2: boolean
  routeV3: boolean
  /** Prefer MetaSwapX (gasless intent orders) when available. */
  xGasless: boolean
  hideSmallBalances: boolean
  /** Mask USD values / balances on the portfolio (eye toggle). */
  hideBalances: boolean
  setHideBalances: (on: boolean) => void
  setTheme: (t: ThemePref) => void
  setSlippageAuto: () => void
  setCustomSlippage: (v: string) => void
  setDeadline: (m: number) => void
  setRoute: (key: 'routeV2' | 'routeV3', on: boolean) => void
  setXGasless: (on: boolean) => void
  setHideSmallBalances: (on: boolean) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: resolveTheme('auto'),
      themeChoice: 'auto',
      setThemeChoice: (themeChoice) => set({ themeChoice, theme: resolveTheme(themeChoice) }),
      hiddenTokens: [],
      toggleHiddenToken: (address) => {
        const a = address.toLowerCase()
        const cur = get().hiddenTokens
        set({ hiddenTokens: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] })
      },
      slippageMode: 'auto',
      customSlippage: '',
      deadlineMinutes: DEFAULT_DEADLINE_MIN,
      routeV2: true,
      routeV3: true,
      xGasless: false,
      hideSmallBalances: false,
      hideBalances: false,
      setHideBalances: (hideBalances) => set({ hideBalances }),
      setTheme: (theme) => set({ theme, themeChoice: theme }),
      setSlippageAuto: () => set({ slippageMode: 'auto', customSlippage: '' }),
      setCustomSlippage: (customSlippage) => set({ customSlippage, slippageMode: customSlippage === '' ? 'auto' : 'custom' }),
      setDeadline: (m) => set({ deadlineMinutes: Math.min(MAX_DEADLINE_MIN, Math.max(1, Math.round(m))) }),
      setRoute: (key, on) => {
        // At least one protocol must stay enabled.
        const other = key === 'routeV2' ? get().routeV3 : get().routeV2
        if (!on && !other) return
        set({ [key]: on } as Pick<SettingsState, typeof key>)
      },
      setXGasless: (xGasless) => set({ xGasless }),
      setHideSmallBalances: (hideSmallBalances) => set({ hideSmallBalances }),
    }),
    {
      name: 'metaswap.settings',
      storage: persistStorage,
      version: 2,
      // v1 stored only the resolved theme: keep it as an explicit choice.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        if (version < 2) return { ...p, themeChoice: p.theme ?? 'dark', hiddenTokens: [] } as SettingsState
        return p as SettingsState
      },
    },
  ),
)

export type SlippageWarning = 'too-low' | 'too-high' | 'invalid' | null

/** Validate a custom slippage string (percent). <0.05% may fail, >5% risks a bad trade, max 50%. */
export function slippageWarning(input: string): SlippageWarning {
  if (input === '') return null
  const n = Number(input)
  if (!Number.isFinite(n) || n < 0 || n * 100 > MAX_SLIPPAGE_BPS) return 'invalid'
  if (n < 0.05) return 'too-low'
  if (n > 5) return 'too-high'
  return null
}

/** Effective slippage in basis points (falls back to auto when the custom value is invalid). */
export function effectiveSlippageBps(s: Pick<SettingsState, 'slippageMode' | 'customSlippage'>): number {
  if (s.slippageMode !== 'custom') return AUTO_SLIPPAGE_BPS
  const n = Number(s.customSlippage)
  if (!Number.isFinite(n) || n <= 0 || n * 100 > MAX_SLIPPAGE_BPS) return AUTO_SLIPPAGE_BPS
  return Math.round(n * 100)
}

export function useSlippageBps(): number {
  const mode = useSettings((s) => s.slippageMode)
  const custom = useSettings((s) => s.customSlippage)
  return effectiveSlippageBps({ slippageMode: mode, customSlippage: custom })
}

/** `protocols` query param for /quote. */
export function protocolsParam(v2: boolean, v3: boolean): string {
  if (v2 && v3) return 'v2,v3,mixed'
  return v2 ? 'v2' : 'v3'
}

/** Keep `theme` in sync with the OS while the choice is Auto. */
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    // Re-resolve Auto after hydration (the OS theme may have changed since it was saved).
    const st0 = useSettings.getState()
    if (st0.themeChoice === 'auto' && st0.theme !== resolveTheme('auto')) useSettings.setState({ theme: resolveTheme('auto') })
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      const st = useSettings.getState()
      if (st.themeChoice === 'auto') useSettings.setState({ theme: resolveTheme('auto') })
    })
  } catch {
    /* old browsers */
  }
}
