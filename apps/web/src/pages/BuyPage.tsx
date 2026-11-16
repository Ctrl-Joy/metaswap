import { BuyForm } from '@/features/buy/BuyForm'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { TradeLayout } from './TradeLayout'
import { t } from '@/i18n'

export default function BuyPage() {
  useDocumentTitle(t('Free Test ETH and Token Faucet'))
  return (
    <TradeLayout>
      <BuyForm />
    </TradeLayout>
  )
}
