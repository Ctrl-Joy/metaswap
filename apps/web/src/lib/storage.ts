import { createJSONStorage, type StateStorage } from 'zustand/middleware'

/** localStorage wrapped in try/catch (private mode, blocked storage, SSR). */
const safeLocalStorage: StateStorage<void> & { getItem: (n: string) => string | null; setItem: (n: string, v: string) => void; removeItem: (n: string) => void } = {
  getItem: (name) => {
    try {
      return globalThis.localStorage?.getItem(name) ?? null
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      globalThis.localStorage?.setItem(name, value)
    } catch {
      /* ignore quota / privacy errors */
    }
  },
  removeItem: (name) => {
    try {
      globalThis.localStorage?.removeItem(name)
    } catch {
      /* ignore */
    }
  },
}

export const persistStorage = createJSONStorage(() => safeLocalStorage)
export const safeStorage = safeLocalStorage
