import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { CreateLaunch } from '@/features/launches/CreateLaunch'

export default function CreateLaunchPage() {
  useDocumentTitle('Launch a token')
  return <CreateLaunch />
}
