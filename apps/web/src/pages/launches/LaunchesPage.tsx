import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { t } from '@/i18n'
import { LaunchesHome } from '@/features/launches/LaunchesHome'

export default function LaunchesPage() {
  useDocumentTitle(t('Launches'))
  return <LaunchesHome />
}
