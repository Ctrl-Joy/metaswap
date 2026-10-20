import { BuyForm } from '@/features/buy/BuyForm'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { TradeLayout } from './TradeLayout'

export default function BuyPage() {
  useDocumentTitle('Buy')
  return (
    <TradeLayout>
      <BuyForm />
    </TradeLayout>
  )
}
