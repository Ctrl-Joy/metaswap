import { SendForm } from '@/features/send/SendForm'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { TradeLayout } from './TradeLayout'

export default function SendPage() {
  useDocumentTitle('Send')
  return (
    <TradeLayout>
      <SendForm />
    </TradeLayout>
  )
}
