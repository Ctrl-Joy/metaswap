import { describe, expect, it } from 'vitest'
import type { ActivityItem } from '@/api/types'
import type { TrackedTx } from '@/state/transactions'
import { apiActivityRow, filterActivity, mergeActivity } from './activityModel'

const tok = (symbol: string, amountFormatted: number) => ({ chainId: 31337, address: `0x${symbol}`, symbol, name: symbol, decimals: 18, amountFormatted })
const swap = { type: 'swap', txHash: '0xaa', timestamp: 1000, tokenIn: tok('WETH', 0.5), tokenOut: tok('mUSDC', 1517), amountUsd: 1517 } as unknown as ActivityItem
const send = { type: 'send', txHash: '0xbb', timestamp: 2000, to: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', token: tok('mUSDC', -42.5), amountUsd: 42.5 } as unknown as ActivityItem
const mint = { type: 'mint', txHash: '0xcc', timestamp: 3000, token: tok('mUSDC', 100) } as unknown as ActivityItem

describe('activity model', () => {
  it('builds structured rows with Uniswap verbs and counterparts', () => {
    const r = apiActivityRow(swap)
    expect(r.label).toBe('Swapped')
    expect(r.legs.map((l) => `${l.amount} ${l.symbol}`)).toEqual(['0.5 WETH', '1517 mUSDC'])
    expect(r.counterpart?.label).toBe('Transaction')
    const s = apiActivityRow(send)
    expect(s.label).toBe('Sent')
    expect(s.legs[0]).toMatchObject({ symbol: 'mUSDC', amount: 42.5, usd: 42.5 })
    expect(s.counterpart).toMatchObject({ label: 'To', value: '0x90F7...b906' })
    expect(apiActivityRow(mint).kind).toBe('mint')
  })
  it('merges local and indexed rows: pending local stays, confirmed local is replaced by the indexed one', () => {
    const local: TrackedTx[] = [
      { hash: '0xaa', chainId: 31337, type: 'swap', status: 'confirmed', summary: 'Swapped', addedAt: 1_000_500 },
      { hash: '0xdd', chainId: 31337, type: 'send', status: 'pending', summary: 'Sending', addedAt: 4_000_000 },
    ]
    const rows = mergeActivity(local, [swap, send])
    expect(rows.map((r) => r.hash)).toEqual(['0xdd', '0xbb', '0xaa'])
    expect(rows.find((r) => r.hash === '0xaa')!.status).toBe('indexed')
  })
  it('filters by type, time window and text', () => {
    const rows = mergeActivity([], [swap, send, mint])
    expect(filterActivity(rows, { type: 'swaps' }).map((r) => r.kind)).toEqual(['swap'])
    expect(filterActivity(rows, { type: 'receives' }).map((r) => r.kind)).toEqual(['mint'])
    expect(filterActivity(rows, { time: '24h', now: 3000 * 1000 + 3_600_000 }).map((r) => r.hash)).toEqual(['0xcc', '0xbb', '0xaa'])
    expect(filterActivity(rows, { time: '24h', now: 3000 * 1000 + 90_000_000 })).toHaveLength(0)
    expect(filterActivity(rows, { query: 'weth' }).map((r) => r.hash)).toEqual(['0xaa'])
  })
})
