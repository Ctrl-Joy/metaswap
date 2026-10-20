import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { LaunchesHome } from '@/features/launches/LaunchesHome'

export default function LaunchesPage() {
  useDocumentTitle('Launches')
  return <LaunchesHome />
}
