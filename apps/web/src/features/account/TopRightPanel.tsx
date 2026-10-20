import { useEffect, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { cn } from '@/lib/cn'

/** True from Uniswap's `md` breakpoint up (768px): the panel is a dropdown; below it, a bottom sheet. */
export function useIsDesktopPanel(): boolean {
  const q = '(min-width: 768px)'
  const [m, setM] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia?.(q).matches ?? true))
  useEffect(() => {
    const mq = window.matchMedia?.(q)
    if (!mq) return
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

/**
 * Uniswap's AdaptiveDropdown as used by the account drawer and the connect panel (AccountDrawer/index.tsx):
 * 368px wide, fixed `right: 12px` directly under the 72px header, radius 20, 1px border, max height
 * `100vh − header − 16px`, no scrim on desktop (outside click / Esc close). Below 768px it becomes a
 * bottom sheet over a scrim.
 */
export function TopRightPanel({
  open,
  onOpenChange,
  title,
  testId,
  children,
  ignoreOutside = '[data-panel-trigger]',
  className,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  testId?: string
  children: ReactNode
  /** Clicks inside elements matching this selector don't count as "outside" (the header trigger toggles itself). */
  ignoreOutside?: string
  className?: string
}) {
  const desktop = useIsDesktopPanel()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={!desktop}>
      <Dialog.Portal>
        {!desktop && <Dialog.Overlay className="fixed inset-0 z-[1190] bg-scrim animate-fade-in" />}
        <Dialog.Content
          data-testid={testId}
          aria-describedby={undefined}
          onInteractOutside={(e) => {
            const t = e.target as HTMLElement | null
            if (t?.closest?.(ignoreOutside)) e.preventDefault()
            // Toasts and nested dialogs (e.g. the receive QR) should not close the panel.
            if (t?.closest?.('[role="dialog"], [data-sonner-toaster], [data-toast]')) e.preventDefault()
          }}
          className={cn(
            'fixed z-[1200] flex flex-col overflow-hidden border border-border bg-surface-1 outline-none',
            desktop
              ? 'top-[72px] right-3 max-h-[calc(100dvh-88px)] w-[368px] rounded-[20px] shadow-large animate-pop-in'
              : 'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-3xl border-b-0 animate-sheet-in-bottom',
            className,
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {!desktop && <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-surface-3" aria-hidden />}
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
