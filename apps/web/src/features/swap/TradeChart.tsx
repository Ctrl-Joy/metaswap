import { useCallback, useState } from 'react'
import { NATIVE_ADDRESS, type Token } from '@metaswap/sdk'
import { Card, Skeleton, TokenLogo } from '@/components/ui'
import { safeStorage } from '@/lib/storage'
import { useTokenDetail } from '@/features/explore/api'
import { TokenChartPanel } from '@/features/explore/token/TokenChartPanel'

const KEY = 'metaswap.tradeChart.open'

/** Persisted show/hide state of the price chart next to the swap/limit card (default: shown). */
export function useTradeChartOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => safeStorage.getItem(KEY) !== '0')
  const toggle = useCallback(() => {
    setOpen((o) => {
      safeStorage.setItem(KEY, o ? '0' : '1')
      return !o
    })
  }, [])
  return [open, toggle]
}

/** Which token the trade chart follows: the buy token when chosen, otherwise the sell token. */
export function chartTokenFor(input: Token | undefined, output: Token | undefined): Token | undefined {
  return output ?? input
}

/**
 * Price chart shown beside the trade card (Uniswap's trend-icon chart). Reuses the explore token chart
 * (price / volume / TVL, ranges, line ↔ candles) for the selected token.
 */
export function TradeChart({ token }: { token: Token | undefined }) {
  const address = token ? (token.isNative ? NATIVE_ADDRESS : token.address) : undefined
  const detail = useTokenDetail(address)
  const d = detail.data
  return (
    <Card className="w-full p-4 md:p-5" data-testid="trade-chart">
      {!token ? (
        <p className="py-16 text-center text-body-2 text-text-2">Select a token to see its chart.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2" data-testid="trade-chart-token">
            <TokenLogo token={token} size={28} />
            <span className="text-body-1 font-semibold">{token.symbol}</span>
            <span className="truncate text-body-3 text-text-2">{token.name}</span>
          </div>
          {d ? (
            <TokenChartPanel key={address} address={address!} symbol={token.symbol} latestPriceUsd={d.priceUsd} apiChange24h={d.change24h} />
          ) : detail.isError ? (
            <p className="py-16 text-center text-body-2 text-text-2" data-testid="trade-chart-unavailable">
              Chart unavailable
            </p>
          ) : (
            <Skeleton width="100%" height={360} rounded="lg" />
          )}
        </div>
      )}
    </Card>
  )
}
