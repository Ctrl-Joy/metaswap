import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { applyRealtimeEvent, prependUnique, splitTopic, Throttler, topicsForQueries, upsertLastPoint, type BridgeContext } from './realtimeCache'
import type { RealtimeEvent } from './realtime'

const A = '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199'
const T = '0x1111111111111111111111111111111111111111'
const P = '0x2222222222222222222222222222222222222222'
const ev = (topic: string, event: string, data: unknown, extra: Partial<RealtimeEvent> = {}): RealtimeEvent => ({ type: 'event', topic, event, data, ...extra })
const ctx = (account?: string): BridgeContext => ({ account, throttle: new Throttler() })

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
}

describe('pure helpers', () => {
  it('splitTopic', () => {
    expect(splitTopic('token:0xAB')).toEqual(['token', '0xab'])
    expect(splitTopic('blocks')).toEqual(['blocks', undefined])
  })
  it('upsertLastPoint replaces within the bucket and appends after it', () => {
    const s = [
      { time: 100, value: 1 },
      { time: 160, value: 2 },
    ]
    expect(upsertLastPoint(s, 170, { value: 3 })).toEqual([{ time: 100, value: 1 }, { time: 160, value: 3 }])
    expect(upsertLastPoint(s, 230, { value: 4 })).toEqual([...s, { time: 230, value: 4 }])
    expect(upsertLastPoint<{ time: number; value: number }>([], 1, { value: 1 })).toEqual([])
  })
  it('prependUnique dedupes and prepends', () => {
    expect(prependUnique([2, 1], [3, 2], String)).toEqual([3, 2, 1])
    expect(prependUnique([2, 1], [], String)).toEqual([2, 1])
  })
})

describe('applyRealtimeEvent', () => {
  it('blocks: moves the footer block forward only', () => {
    const c = qc()
    c.setQueryData(['api', 'health', {}], { ok: true, indexedBlock: 10 })
    applyRealtimeEvent(c, ev('blocks', 'block', { number: 12 }), ctx())
    expect(c.getQueryData(['api', 'health', {}])).toMatchObject({ indexedBlock: 12 })
    applyRealtimeEvent(c, ev('blocks', 'block', { number: 11 }), ctx())
    expect(c.getQueryData(['api', 'health', {}])).toMatchObject({ indexedBlock: 12 })
  })

  it('blocks reset: invalidates every API query', () => {
    const c = qc()
    c.setQueryData(['api', 'explore', 'stats', {}], { tvlUsd: 1 })
    applyRealtimeEvent(c, ev('blocks', 'reset', {}), ctx())
    expect(c.getQueryState(['api', 'explore', 'stats', {}])!.isInvalidated).toBe(true)
  })

  it('prices: patches explore rows, token detail and the price line in place', () => {
    const c = qc()
    c.setQueryData(['api', 'explore', 'tokens', 'rows', '1D'], [{ address: T, symbol: 'X', priceUsd: 1 }, { address: P, symbol: 'Y', priceUsd: 5 }])
    c.setQueryData(['api', 'explore', 'tokens', 'volume', 'desc'], [{ address: T.toUpperCase().replace('0X', '0x'), priceUsd: 1 }])
    c.setQueryData(['api', 'tokens', 'detail', T, {}], { priceUsd: 1, change24h: 0 })
    c.setQueryData(['api', 'tokens', T, 'price-line', '1D'], [{ time: 100, value: 1 }, { time: 400, value: 1 }])
    applyRealtimeEvent(c, ev('prices', 'prices', { timestamp: 500, prices: { [T]: 2 } }), ctx())
    expect(c.getQueryData<Array<{ priceUsd: number }>>(['api', 'explore', 'tokens', 'rows', '1D'])!.map((r) => r.priceUsd)).toEqual([2, 5])
    expect(c.getQueryData<Array<{ priceUsd: number }>>(['api', 'explore', 'tokens', 'volume', 'desc'])![0]!.priceUsd).toBe(2)
    expect(c.getQueryData(['api', 'tokens', 'detail', T, {}])).toEqual({ priceUsd: 2, change24h: 0 })
    // 100s after the last point (≥ LIVE_STEP): a new live point is appended so the chart moves
    expect(c.getQueryData(['api', 'tokens', T, 'price-line', '1D'])).toEqual([{ time: 100, value: 1 }, { time: 400, value: 1 }, { time: 500, value: 2 }])
    // within LIVE_STEP of the last point: the last point is updated in place
    applyRealtimeEvent(c, ev('prices', 'prices', { timestamp: 510, prices: { [T]: 3 } }), ctx())
    expect(c.getQueryData(['api', 'tokens', T, 'price-line', '1D'])).toEqual([{ time: 100, value: 1 }, { time: 400, value: 1 }, { time: 500, value: 3 }])
  })

  it('explore txs: prepends normalised rows into unfiltered and matching filtered lists only', () => {
    const c = qc()
    const old = { id: 'old:1:swap', kind: 'swap', timeMs: 1, usd: 1, legs: [], wallet: null, txHash: 'old', pool: P }
    c.setQueryData(['api', 'explore', 'transactions', 'rows', {}, 50], [old])
    c.setQueryData(['api', 'explore', 'transactions', 'rows', { pool: P }, 50], [old])
    c.setQueryData(['api', 'explore', 'transactions', 'rows', { pool: T }, 50], [old])
    c.setQueryData(['api', 'explore', 'transactions', 'rows', { type: 'add' }, 50], [old])
    const tx = { type: 'swap', txHash: '0xnew', logIndex: 3, timestamp: 1000, pool: P, tokenIn: { address: T, symbol: 'X' }, tokenOut: { symbol: 'Y' }, amountUsd: 5, account: A }
    applyRealtimeEvent(c, ev('explore', 'txs', [tx]), ctx())
    const ids = (k: unknown[]) => c.getQueryData<Array<{ id: string }>>(k)!.map((r) => r.id)
    expect(ids(['api', 'explore', 'transactions', 'rows', {}, 50])).toEqual(['0xnew:3:swap', 'old:1:swap'])
    expect(ids(['api', 'explore', 'transactions', 'rows', { pool: P }, 50])).toEqual(['0xnew:3:swap', 'old:1:swap'])
    expect(ids(['api', 'explore', 'transactions', 'rows', { pool: T }, 50])).toEqual(['old:1:swap'])
    expect(ids(['api', 'explore', 'transactions', 'rows', { type: 'add' }, 50])).toEqual(['old:1:swap'])
    // the same tx arriving again (token topic) is not duplicated
    applyRealtimeEvent(c, ev(`token:${T.toLowerCase()}`, 'txs', [tx]), ctx())
    expect(ids(['api', 'explore', 'transactions', 'rows', {}, 50])).toEqual(['0xnew:3:swap', 'old:1:swap'])
  })

  it('account portfolio: merges the total (keeping nfts) and moves the history last point; key casing does not matter', () => {
    const c = qc()
    c.setQueryData(['api', 'accounts', A, 'portfolio'], { address: A, totalUsd: 100, nfts: [{ id: 1 }] })
    const now = Math.floor(Date.now() / 1000)
    c.setQueryData(['api', 'accounts', A, 'portfolio-history', '1D'], [{ time: now - 600, valueUsd: 90 }, { time: now - 300, valueUsd: 100 }])
    applyRealtimeEvent(c, ev(`account:${A.toLowerCase()}`, 'portfolio', { address: A, totalUsd: 150, change24hUsd: 5 }), ctx())
    expect(c.getQueryData(['api', 'accounts', A, 'portfolio'])).toMatchObject({ totalUsd: 150, change24hUsd: 5, nfts: [{ id: 1 }] })
    expect(c.getQueryData<Array<{ valueUsd: number }>>(['api', 'accounts', A, 'portfolio-history', '1D'])!.at(-1)!.valueUsd).toBe(150)
  })

  it('account activity/balances: prepends activity, replaces balances, invalidates wallet reads for the connected account', () => {
    const c = qc()
    c.setQueryData(['api', 'accounts', A, 'activity'], [{ type: 'swap', txHash: '0x1' }])
    c.setQueryData(['api', 'accounts', A, 'balances'], [])
    c.setQueryData(['balances', A, 'k'], { x: 1 })
    applyRealtimeEvent(c, ev(`account:${A}`, 'activity', [{ type: 'send', txHash: '0x2' }]), ctx(A))
    applyRealtimeEvent(c, ev(`account:${A}`, 'balances', { balances: [{ token: T, balance: '1' }] }), ctx(A))
    expect(c.getQueryData<Array<{ txHash: string }>>(['api', 'accounts', A, 'activity'])!.map((a) => a.txHash)).toEqual(['0x2', '0x1'])
    expect(c.getQueryData(['api', 'accounts', A, 'balances'])).toEqual([{ token: T, balance: '1' }])
    expect(c.getQueryState(['balances', A, 'k'])!.isInvalidated).toBe(true)
  })

  it('x:orders: updates a known order in place and drops it from a status-filtered list', () => {
    const c = qc()
    c.setQueryData(['api', 'x', 'orders', A, 'all'], [{ orderHash: '0xAA', status: 'open' }])
    c.setQueryData(['api', 'x', 'orders', A, 'open'], [{ orderHash: '0xaa', status: 'open' }])
    applyRealtimeEvent(c, ev('x:orders', 'order', { orderHash: '0xaa', status: 'filled' }), ctx())
    expect(c.getQueryData(['api', 'x', 'orders', A, 'all'])).toEqual([{ orderHash: '0xaa', status: 'filled' }])
    expect(c.getQueryData(['api', 'x', 'orders', A, 'open'])).toEqual([])
  })

  it('pool state: merges into pool detail', () => {
    const c = qc()
    c.setQueryData(['api', 'pools', 'detail', P, {}], { address: P, tvlUsd: 1, token0: { symbol: 'X' } })
    applyRealtimeEvent(c, ev(`pool:${P.toLowerCase()}`, 'state', { address: P, tvlUsd: 9, tick: 5 }), ctx())
    expect(c.getQueryData(['api', 'pools', 'detail', P, {}])).toEqual({ address: P, tvlUsd: 9, tick: 5, token0: { symbol: 'X' } })
  })
})

describe('topicsForQueries', () => {
  it('derives topics from queries that are on screen only', () => {
    const c = qc()
    const watch = (key: unknown[]) => new QueryObserver(c, { queryKey: key, queryFn: () => null, enabled: false }).subscribe(() => {})
    watch(['api', 'tokens', 'detail', T, {}])
    watch(['api', 'pools', P, 'ticks'])
    watch(['api', 'accounts', A, 'portfolio'])
    watch(['api', 'explore', 'transactions', 'rows', { token: T }, 50])
    watch(['api', 'launches', 'list', {}])
    watch(['api', 'x', 'orders', A, 'all'])
    c.setQueryData(['api', 'pools', 'detail', '0x3333333333333333333333333333333333333333', {}], {}) // no observer
    expect([...topicsForQueries(c)].sort()).toEqual(
      ['account:' + A.toLowerCase(), 'explore', 'launches', 'pool:' + P.toLowerCase(), 'token:' + T.toLowerCase(), 'x:orders'].sort(),
    )
  })
})

describe('Throttler', () => {
  it('runs immediately, then at most once per window (trailing call kept)', () => {
    vi.useFakeTimers()
    let t = 0
    const th = new Throttler(() => t)
    const fn = vi.fn()
    th.run('k', 1000, fn)
    th.run('k', 1000, fn)
    th.run('k', 1000, fn)
    expect(fn).toHaveBeenCalledTimes(1)
    t = 1000
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
