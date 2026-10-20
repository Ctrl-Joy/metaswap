import type { ReactNode } from 'react'
import { CircleCheck } from 'lucide-react'
import { Banner, Button, Modal } from '@/components/ui'
import { StepList } from '@/features/swap/StepList'
import type { useStepRunner } from '../execute'

type Runner = ReturnType<typeof useStepRunner>

/**
 * Review → steps → success modal shared by every liquidity action. `children` is the review body
 * (amounts, range…). The confirm button calls `onConfirm`, which should call runner.run(plan).
 */
export function TxFlowModal({
  open,
  onOpenChange,
  title,
  runner,
  children,
  confirmLabel,
  onConfirm,
  confirmDisabled,
  success,
  testId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  runner: Runner
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  confirmDisabled?: boolean
  /** Rendered after success (links etc.). */
  success?: ReactNode
  testId: string
}) {
  const busy = runner.state === 'running'
  const close = (o: boolean) => {
    if (busy) return
    onOpenChange(o)
    if (!o) runner.reset()
  }
  return (
    <Modal open={open} onOpenChange={close} title={title} width={460} dismissible={!busy} testId={testId}>
      {runner.state === 'success' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid={`${testId}-success`}>
          <CircleCheck size={48} className="text-success" />
          <div className="text-body-1 font-semibold">Transaction confirmed</div>
          {success}
          <Button variant="secondary" fullWidth onClick={() => close(false)} data-testid={`${testId}-close`}>
            Close
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {children}
          {runner.steps.length > 0 && <StepList steps={runner.steps} />}
          {runner.error && (
            <Banner tone="critical" title={runner.error.title}>
              <span data-testid={`${testId}-error`}>{runner.error.message}</span>
            </Banner>
          )}
          <Button size="xl" fullWidth loading={busy} disabled={confirmDisabled || busy} onClick={onConfirm} data-testid={`${testId}-confirm`}>
            {busy ? 'Confirm in wallet…' : runner.state === 'error' ? 'Try again' : confirmLabel}
          </Button>
        </div>
      )}
    </Modal>
  )
}

/** Label/value line for review bodies. */
export function ReviewRow({ label, children, testId }: { label: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-body-3">
      <span className="text-text-2">{label}</span>
      <span className="text-right font-medium tabular" data-testid={testId}>
        {children}
      </span>
    </div>
  )
}
