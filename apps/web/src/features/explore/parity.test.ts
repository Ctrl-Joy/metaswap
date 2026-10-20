import { describe, expect, it } from 'vitest'
import { NATIVE_ADDRESS } from '@metaswap/sdk'
import { txLabel, withNativeEthRow } from './transforms'
import type { TokenRow, TxRow } from './types'

const tx = (kind: TxRow['kind'], a: string, b: string): TxRow => ({ id: '1', kind, timeMs: 0, usd: 1, legs: [{ symbol: a, amount: 1 }, { symbol: b, amount: 2 }], wallet: null, txHash: null, pool: null })

describe('txLabel', () => {
  it('reads like Uniswap without a perspective', () => {
    expect(txLabel(tx('swap', 'WETH', 'mUSDC')).text).toBe('Swap WETH for mUSDC')
    expect(txLabel(tx('add', 'WETH', 'mUSDC')).text).toBe('Add WETH and mUSDC')
    expect(txLabel(tx('remove', 'WETH', 'mUSDC')).text).toBe('Remove WETH and mUSDC')
  })
  it('uses Buy / Sell from the page token perspective (ETH == WETH)', () => {
    expect(txLabel(tx('swap', 'mUSDC', 'WETH'), 'ETH')).toEqual({ text: 'Buy WETH', verb: 'buy' })
    expect(txLabel(tx('swap', 'WETH', 'mUSDC'), 'WETH')).toEqual({ text: 'Sell WETH', verb: 'sell' })
    expect(txLabel(tx('swap', 'META', 'mUSDC'), 'WETH').verb).toBe('swap')
  })
})

describe('withNativeEthRow', () => {
  const row = (symbol: string, address: string, tags: string[] = []): TokenRow => ({ address, symbol, name: symbol, decimals: 18, tags, priceUsd: 3000, change1h: 0, change24h: 1, volumeUsd: 10, tvlUsd: 1, fdvUsd: 1, marketCapUsd: 1, sparkline: [] })
  it('inserts ETH before WETH with WETH data', () => {
    const out = withNativeEthRow([row('mUSDC', '0x1'), row('WETH', '0x2', ['wrapped', 'majors'])])
    expect(out.map((r) => r.symbol)).toEqual(['mUSDC', 'ETH', 'WETH'])
    expect(out[1]!.address).toBe(NATIVE_ADDRESS)
    expect(out[1]!.tags).toEqual(['majors'])
    expect(out[1]!.priceUsd).toBe(3000)
  })
  it('is a no-op without WETH or when native already exists', () => {
    const a = [row('mUSDC', '0x1')]
    expect(withNativeEthRow(a)).toBe(a)
    const b = [row('ETH', NATIVE_ADDRESS), row('WETH', '0x2')]
    expect(withNativeEthRow(b)).toBe(b)
  })
})
