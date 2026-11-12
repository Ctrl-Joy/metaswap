import { SendForm } from '@/features/send/SendForm'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { TradeLayout } from './TradeLayout'
import { t } from '@/i18n'

export default function SendPage() {
  useDocumentTitle(t('Send'))
  return (
    <TradeLayout>
      <SendForm />
    </TradeLayout>
  )
}
