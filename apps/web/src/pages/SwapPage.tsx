import { useCallback, useState } from 'react'
import type { Token } from '@metaswap/sdk'
import { SwapForm } from '@/features/swap/SwapForm'
import { TradeChart, chartTokenFor, useTradeChartOpen } from '@/features/swap/TradeChart'
import { TradeLayout } from './TradeLayout'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export default function SwapPage() {
  useDocumentTitle('Swap')
  const [open, toggle] = useTradeChartOpen()
  const [chartToken, setChartToken] = useState<Token | undefined>()
  const onTokens = useCallback((input: Token | undefined, output: Token | undefined) => setChartToken(chartTokenFor(input, output)), [])
  return (
    <TradeLayout settings chart={{ open, onToggle: toggle, node: <TradeChart token={chartToken} /> }}>
      <SwapForm onTokensChange={onTokens} />
    </TradeLayout>
  )
}
