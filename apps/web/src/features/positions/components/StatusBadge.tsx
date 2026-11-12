import { Badge } from '@/components/ui'
import { t } from '@/i18n'

export type PositionStatus = 'in-range' | 'out-of-range' | 'closed'

export function positionStatus(p: { closed?: boolean; inRange?: boolean; liquidity?: string | bigint }): PositionStatus {
  if (p.closed || (p.liquidity !== undefined && BigInt(p.liquidity) === 0n)) return 'closed'
  return p.inRange ? 'in-range' : 'out-of-range'
}

export function StatusBadge({ status, testId }: { status: PositionStatus; testId?: string }) {
  if (status === 'closed')
    return (
      <Badge tone="neutral">
        <span data-testid={testId} data-status={status}>{t('Closed')}</span>
      </Badge>
    )
  const inRange = status === 'in-range'
  return (
    <Badge tone={inRange ? 'success' : 'warning'}>
      <span className={inRange ? 'size-1.5 rounded-full bg-success' : 'size-1.5 rounded-full bg-warning'} aria-hidden />
      <span data-testid={testId} data-status={status}>{inRange ? t('In range') : t('Out of range')}</span>
    </Badge>
  )
}
