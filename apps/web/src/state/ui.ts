import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Token } from '@metaswap/sdk'
import { persistStorage } from '@/lib/storage'

interface UiState {
  connectOpen: boolean
  drawerOpen: boolean
  openConnect: () => void
  closeConnect: () => void
  setConnectOpen: (o: boolean) => void
  openDrawer: () => void
  setDrawerOpen: (o: boolean) => void
}

/** Global modal/drawer visibility (connect modal, account drawer). */
export const useUi = create<UiState>()((set) => ({
  connectOpen: false,
  drawerOpen: false,
  openConnect: () => set({ connectOpen: true }),
  closeConnect: () => set({ connectOpen: false }),
  setConnectOpen: (connectOpen) => set({ connectOpen }),
  openDrawer: () => set({ drawerOpen: true }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
}))

interface ImportedTokensState {
  tokens: Token[]
  add: (t: Token) => void
  remove: (address: string) => void
}

/** Tokens the user imported by address (not on the MetaSwap list). Persisted. */
export const useImportedTokens = create<ImportedTokensState>()(
  persist(
    (set) => ({
      tokens: [],
      add: (t) => set((s) => ({ tokens: [...s.tokens.filter((x) => x.address.toLowerCase() !== t.address.toLowerCase()), t] })),
      remove: (address) => set((s) => ({ tokens: s.tokens.filter((x) => x.address.toLowerCase() !== address.toLowerCase()) })),
    }),
    { name: 'metaswap.importedTokens', storage: persistStorage, version: 1 },
  ),
)
