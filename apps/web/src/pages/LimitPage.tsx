import { LimitForm } from '@/features/limit/LimitForm'
import { OrdersList } from '@/features/limit/OrdersList'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useWallet } from '@/wallet/hooks'
import { TradeLayout } from './TradeLayout'

export default function LimitPage() {
  useDocumentTitle('Limit order')
  const { address } = useWallet()
  return (
    <TradeLayout
      below={
        address ? (
          <section aria-labelledby="your-orders">
            <h2 id="your-orders" className="mb-3 text-body-1 font-semibold">
              Your orders
            </h2>
            <OrdersList />
          </section>
        ) : undefined
      }
    >
      <LimitForm />
    </TradeLayout>
  )
}
