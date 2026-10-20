import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PositionsList } from '@/features/positions/list/PositionsList'

export default function PositionsPage() {
  useDocumentTitle('Pool')
  return <PositionsList />
}
