import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PositionsList } from '@/features/positions/list/PositionsList'
import { t } from '@/i18n'

export default function PositionsPage() {
  useDocumentTitle(t('Pool'))
  return <PositionsList />
}
