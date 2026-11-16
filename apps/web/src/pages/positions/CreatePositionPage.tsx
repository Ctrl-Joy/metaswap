import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { CreatePosition } from '@/features/positions/create/CreatePosition'
import { t } from '@/i18n'

export default function CreatePositionPage() {
  useDocumentTitle(t('Create a Liquidity Position'))
  return <CreatePosition />
}
