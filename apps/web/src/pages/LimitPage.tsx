import { useCallback, useState } from 'react'
import type { Token } from '@metaswap/sdk'
import { LimitForm } from '@/features/limit/LimitForm'
import { OrdersList } from '@/features/limit/OrdersList'
import { TradeChart, chartTokenFor, useTradeChartOpen } from '@/features/swap/TradeChart'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useWallet } from '@/wallet/hooks'
import { TradeLayout } from './TradeLayout'
import { t } from '@/i18n'

export default function LimitPage() {
  useDocumentTitle(t('Limit order'))
  const { address } = useWallet()
  const [open, toggle] = useTradeChartOpen()
  // The limit chart follows the sell token (the price the order is set against).
  const [chartToken, setChartToken] = useState<Token | undefined>()
  const onTokens = useCallback((input: Token | undefined, output: Token | undefined) => setChartToken(chartTokenFor(undefined, input ?? output)), [])
  return (
    <TradeLayout
      chart={{ open, onToggle: toggle, node: <TradeChart token={chartToken} /> }}
      below={
        address ? (
          <section aria-labelledby="your-orders">
            <h2 id="your-orders" className="mb-3 text-body-1 font-semibold">
              {t('Your orders')}
            </h2>
            <OrdersList />
          </section>
        ) : undefined
      }
    >
      <LimitForm onTokensChange={onTokens} />
    </TradeLayout>
  )
}
