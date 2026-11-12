import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { t } from '@/i18n'
import { CreateLaunch } from '@/features/launches/CreateLaunch'

export default function CreateLaunchPage() {
  useDocumentTitle(t('Launch a token'))
  return <CreateLaunch />
}
