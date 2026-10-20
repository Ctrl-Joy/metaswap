import { create } from 'zustand'

export type ToastKind = 'success' | 'error' | 'pending' | 'info' | 'warning'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  message?: string
  /** Optional tx hash shown (shortened) with a copy affordance. */
  hash?: string
  /** ms; 0 = sticky. Defaults: 5s, pending sticky. */
  duration?: number
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'> & { id?: string }) => string
  update: (id: string, patch: Partial<Toast>) => void
  dismiss: (id: string) => void
}

let seq = 0

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  push: (t) => {
    const id = t.id ?? `t${Date.now()}-${seq++}`
    set((s) => ({ toasts: [...s.toasts.filter((x) => x.id !== id), { ...t, id }].slice(-5) }))
    return id
  },
  update: (id, patch) => set((s) => ({ toasts: s.toasts.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

/** Imperative helper usable outside React. */
export const toast = {
  success: (title: string, message?: string, extra: Partial<Toast> = {}) => useToasts.getState().push({ kind: 'success', title, message, ...extra }),
  error: (title: string, message?: string, extra: Partial<Toast> = {}) => useToasts.getState().push({ kind: 'error', title, message, duration: 8000, ...extra }),
  info: (title: string, message?: string, extra: Partial<Toast> = {}) => useToasts.getState().push({ kind: 'info', title, message, ...extra }),
  pending: (title: string, message?: string, extra: Partial<Toast> = {}) => useToasts.getState().push({ kind: 'pending', title, message, duration: 0, ...extra }),
  update: (id: string, patch: Partial<Toast>) => useToasts.getState().update(id, patch),
  dismiss: (id: string) => useToasts.getState().dismiss(id),
}
