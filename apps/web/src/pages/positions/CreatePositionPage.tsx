import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { CreatePosition } from '@/features/positions/create/CreatePosition'

export default function CreatePositionPage() {
  useDocumentTitle('New position')
  return <CreatePosition />
}
