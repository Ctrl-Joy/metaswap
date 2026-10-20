import { describe, expect, it } from 'vitest'
import type { Token } from '@metaswap/sdk'
import { splitHoldings, type HoldingRow } from './usePortfolioData'

const row = (symbol: string, valueUsd: number | null, unlisted = false, balance = 1n): HoldingRow => ({
  token: { chainId: 31337, address: `0x${symbol}`, symbol, name: symbol, decimals: 18, logoURI: '' } as Token,
  balance,
  priceUsd: 1,
  valueUsd,
  unrealizedPnlUsd: null,
  unrealizedPnlPct: null,
  change24h: null,
  avgCostUsd: null,
  unlisted,
})

describe('splitHoldings', () => {
  it('moves user-hidden, unlisted and (optionally) small rows to the hidden section', () => {
    const rows = [row('A', 100), row('B', 0.5), row('SPAM', 1000, true), row('C', 50), row('ZERO', 0, false, 0n)]
    const off = splitHoldings(rows, { hideSmall: false, hidden: ['0xc'] })
    expect(off.visible.map((r) => r.token.symbol)).toEqual(['A', 'B'])
    expect(off.hidden.map((r) => `${r.token.symbol}:${r.reason}`)).toEqual(['SPAM:spam', 'C:hidden'])
    const on = splitHoldings(rows, { hideSmall: true, hidden: [] })
    expect(on.visible.map((r) => r.token.symbol)).toEqual(['A', 'C'])
    expect(on.hidden.map((r) => r.reason)).toEqual(['small', 'spam'])
  })
})
