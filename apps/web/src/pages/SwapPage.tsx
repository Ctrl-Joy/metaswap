import { SwapForm } from '@/features/swap/SwapForm'
import { TradeLayout } from './TradeLayout'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export default function SwapPage() {
  useDocumentTitle('Swap')
  return (
    <TradeLayout settings>
      <SwapForm />
    </TradeLayout>
  )
}
