import * as Dialog from '@radix-ui/react-dialog'
import { X, ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Visually hidden description for screen readers (or shown under the title). */
  description?: ReactNode
  showDescription?: boolean
  children: ReactNode
  /** Max width on desktop (px). Default 420. */
  width?: number
  hideClose?: boolean
  onBack?: () => void
  /** Prevent closing by outside click (e.g. while a tx is pending). */
  dismissible?: boolean
  className?: string
  /** Stretch to most of the viewport height on desktop (token selector). */
  tall?: boolean
  testId?: string
  /** false: no dimming scrim (dropdown-style panels such as the connect-wallet panel). */
  overlay?: boolean
}

/**
 * Accessible dialog (Radix): centred card on desktop, bottom sheet under 640px.
 * Focus is trapped, Escape closes, focus returns to the trigger.
 */
export function Modal({ open, onOpenChange, title, description, showDescription, children, width = 420, hideClose, onBack, dismissible = true, className, tall, testId, overlay = true }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn('fixed inset-0 z-[1190] animate-fade-in', overlay ? 'bg-scrim' : 'bg-scrim md:bg-transparent')} />
        <Dialog.Content
          data-testid={testId}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          style={{ ['--modal-w' as string]: `${width}px` }}
          className={cn(
            'fixed z-[1200] flex flex-col border border-border bg-surface-1 shadow-large outline-none',
            // mobile: bottom sheet
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl animate-sheet-in-bottom',
            // desktop: centred dialog
            'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[min(var(--modal-w),calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:animate-pop-in',
            tall ? 'md:h-[min(720px,calc(100dvh-64px))] md:max-h-none' : 'md:max-h-[calc(100dvh-64px)]',
            className,
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-surface-3 md:hidden" aria-hidden />
          <div className="flex shrink-0 items-center gap-2 px-5 pt-4 pb-3">
            {onBack && (
              <button onClick={onBack} aria-label="Back" className="-ml-1.5 inline-flex size-8 items-center justify-center rounded-full text-text-2 hover:bg-surface-3 hover:text-text-1">
                <ChevronLeft size={20} />
              </button>
            )}
            <Dialog.Title className="flex-1 truncate text-body-1 font-semibold">{title}</Dialog.Title>
            {!hideClose && (
              <Dialog.Close aria-label="Close" className="-mr-1.5 inline-flex size-8 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1">
                <X size={20} />
              </Dialog.Close>
            )}
          </div>
          {description ? (
            <Dialog.Description className={showDescription ? 'px-5 pb-2 text-body-3 text-text-2' : 'sr-only'}>{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</Dialog.Description>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 scrollbar-thin">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  testId?: string
}

/** Right-side drawer on desktop (≈420px), full screen on phones. Used by the account drawer. */
export function Sheet({ open, onOpenChange, title, children, testId }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1190] bg-scrim animate-fade-in md:bg-scrim/40" />
        <Dialog.Content
          data-testid={testId}
          className="fixed inset-y-0 right-0 z-[1200] flex w-full flex-col bg-surface-1 shadow-large outline-none animate-sheet-in-right md:inset-y-2 md:right-2 md:w-[420px] md:rounded-2xl md:border md:border-border"
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export const ModalClose = Dialog.Close
