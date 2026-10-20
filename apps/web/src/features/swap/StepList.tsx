import { Check, Circle, X } from 'lucide-react'
import { Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { StepStatus } from './executeSwap'

export interface StepView {
  id: string
  title: string
  description?: string
  status: StepStatus
}

/** Vertical progress list: idle (hollow), active (spinner), done (check), error (x). ui-ux.md §2.8 */
export function StepList({ steps }: { steps: StepView[] }) {
  const visible = steps.filter((s) => s.status !== 'skipped')
  return (
    <ol className="flex flex-col gap-1" aria-label="Transaction steps" data-testid="step-list">
      {visible.map((s, i) => (
        <li key={s.id} data-testid={`step-${s.id}`} data-status={s.status} className="flex items-center gap-3 rounded-xl px-1 py-2">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-full',
              s.status === 'done' && 'bg-success-tint text-success',
              s.status === 'active' && 'bg-accent-tint text-accent',
              s.status === 'error' && 'bg-critical-tint text-critical',
              s.status === 'idle' && 'bg-surface-2 text-text-3',
            )}
          >
            {s.status === 'done' ? <Check size={16} /> : s.status === 'active' ? <Spinner size={16} /> : s.status === 'error' ? <X size={16} /> : <Circle size={10} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('block text-body-3 font-semibold', s.status === 'idle' && 'text-text-2')}>{s.title}</span>
            {s.status === 'active' && s.description && <span className="block text-body-4 text-text-2">{s.description}</span>}
          </span>
          <span className="text-body-4 text-text-3">
            Step {i + 1} of {visible.length}
          </span>
        </li>
      ))}
    </ol>
  )
}
