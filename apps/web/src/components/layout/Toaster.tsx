import { useEffect } from 'react'
import { CircleCheck, OctagonAlert, Info, AlertTriangle, X } from 'lucide-react'
import { Spinner, CopyButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useToasts, type Toast } from '@/state/toasts'
import { shortenAddress } from '@/lib/format'

/** Toast stack: top-right on desktop, bottom on mobile (ui-ux.md §12.2). Pending toasts stay. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div
      aria-live="polite"
      aria-relevant="additions text"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[1300] flex flex-col-reverse gap-2 md:inset-x-auto md:top-[84px] md:right-4 md:bottom-auto md:w-[360px] md:flex-col"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss)
  const duration = toast.duration ?? (toast.kind === 'pending' ? 0 : 5000)
  useEffect(() => {
    if (!duration) return
    const id = setTimeout(() => dismiss(toast.id), duration)
    return () => clearTimeout(id)
  }, [duration, toast.id, toast.kind, dismiss])
  const Icon = toast.kind === 'success' ? CircleCheck : toast.kind === 'error' ? OctagonAlert : toast.kind === 'warning' ? AlertTriangle : Info
  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      data-testid={`toast-${toast.kind}`}
      className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-border bg-surface-1 p-4 shadow-large animate-toast-in"
    >
      <span className={cn('mt-0.5 shrink-0', toast.kind === 'success' && 'text-success', toast.kind === 'error' && 'text-critical', toast.kind === 'warning' && 'text-warning', (toast.kind === 'info' || toast.kind === 'pending') && 'text-accent')}>
        {toast.kind === 'pending' ? <Spinner size={20} /> : <Icon size={20} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-body-3 font-semibold">{toast.title}</div>
        {toast.message && <div className="mt-0.5 text-body-3 break-words text-text-2">{toast.message}</div>}
        {toast.hash && (
          <CopyButton value={toast.hash} label="Copy transaction hash" className="mt-1 font-mono text-body-4">
            {shortenAddress(toast.hash, 6)}
          </CopyButton>
        )}
      </div>
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="shrink-0 text-text-3 hover:text-text-1">
        <X size={16} />
      </button>
    </div>
  )
}
