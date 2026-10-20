import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'

export type ThemePref = 'dark' | 'light'

/** Auto slippage used when the user has not set a custom value (0.5%). */
export const AUTO_SLIPPAGE_BPS = 50
export const MAX_SLIPPAGE_BPS = 5_000 // 50%
export const DEFAULT_DEADLINE_MIN = 30
export const MAX_DEADLINE_MIN = 4_320 // 3 days

export interface SettingsState {
  theme: ThemePref
  slippageMode: 'auto' | 'custom'
  /** Raw text of the custom slippage input in percent, e.g. "0.8". */
  customSlippage: string
  deadlineMinutes: number
  routeV2: boolean
  routeV3: boolean
  /** Prefer MetaSwapX (gasless intent orders) when available. */
  xGasless: boolean
  hideSmallBalances: boolean
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
      theme: 'dark',
      slippageMode: 'auto',
      customSlippage: '',
      deadlineMinutes: DEFAULT_DEADLINE_MIN,
      routeV2: true,
      routeV3: true,
      xGasless: false,
      hideSmallBalances: false,
      setTheme: (theme) => set({ theme }),
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
    { name: 'metaswap.settings', storage: persistStorage, version: 1 },
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
