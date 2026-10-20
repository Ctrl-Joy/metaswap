import { describe, expect, it } from 'vitest'
import { maxUsableTick, minUsableTick, pctFromCurrent, strategyTicks } from './math'

const cur = -196_251
const sp = 60

describe('range strategies', () => {
  it('stable is ± 3 spacings around the current tick', () => {
    const [lo, hi] = strategyTicks('stable', cur, sp)
    expect(Math.abs(lo % sp)).toBe(0)
    expect(Math.abs(hi % sp)).toBe(0)
    expect(cur).toBeGreaterThanOrEqual(lo)
    expect(cur).toBeLessThan(hi)
    expect((hi - lo) / sp).toBe(7)
  })
  it('wide spans about −50% … +100% of price', () => {
    const [lo, hi] = strategyTicks('wide', cur, sp)
    const ratioLo = 1.0001 ** (lo - cur)
    const ratioHi = 1.0001 ** (hi - cur)
    expect(ratioLo).toBeGreaterThan(0.49)
    expect(ratioLo).toBeLessThanOrEqual(0.5)
    expect(ratioHi).toBeGreaterThanOrEqual(2)
    expect(ratioHi).toBeLessThan(2.02)
  })
  it('one-sided ranges sit entirely below / above the current tick', () => {
    const [l1, u1] = strategyTicks('lower', cur, sp)
    expect(u1).toBeLessThanOrEqual(cur)
    expect(1.0001 ** (l1 - cur)).toBeLessThanOrEqual(0.5)
    const [l2, u2] = strategyTicks('upper', cur, sp)
    expect(l2).toBeGreaterThan(cur)
    expect(1.0001 ** (u2 - cur)).toBeGreaterThanOrEqual(2)
  })
  it('inverting the displayed price swaps the one-sided pool side', () => {
    expect(strategyTicks('lower', cur, sp, true)).toEqual(strategyTicks('upper', cur, sp, false))
    expect(strategyTicks('upper', cur, sp, true)).toEqual(strategyTicks('lower', cur, sp, false))
  })
  it('clamps near the tick limits', () => {
    const [lo, hi] = strategyTicks('wide', minUsableTick(sp) + 10, sp)
    expect(lo).toBe(minUsableTick(sp))
    expect(hi).toBeLessThanOrEqual(maxUsableTick(sp))
    expect(hi).toBeGreaterThan(lo)
  })
  it('pctFromCurrent', () => {
    expect(pctFromCurrent(110, 100)).toBeCloseTo(10)
    expect(pctFromCurrent(0, 100)).toBe(-100)
    expect(pctFromCurrent(Infinity, 100)).toBeNull()
    expect(pctFromCurrent(1, undefined)).toBeNull()
  })
})

import { displayHistory, historyDomain } from './components/PriceHistoryRange'

describe('range price history', () => {
  const now = 10_000_000
  const hist = [
    { time: now - 10 * 86_400, token0Price: 1000 },
    { time: now - 2 * 86_400, token0Price: 2000 },
    { time: now - 3600, token0Price: null },
    { time: now - 60, token0Price: 4000 },
  ]
  it('clips to the window, drops gaps and inverts', () => {
    expect(displayHistory(hist, false, 7 * 86_400, now).map((p) => p.price)).toEqual([2000, 4000])
    expect(displayHistory(hist, true, Infinity, now).map((p) => p.price)).toEqual([0.001, 0.0005, 0.00025])
  })
  it('domain covers line, current price and a finite band with padding', () => {
    const pts = displayHistory(hist, false, Infinity, now)
    const [lo, hi] = historyDomain(pts, 3000, 500, 5000)!
    expect(lo).toBeLessThan(500)
    expect(hi).toBeGreaterThan(5000)
    // an infinite max (full-range side) is ignored
    const [, hi2] = historyDomain(pts, 3000, 500, Infinity)!
    expect(hi2).toBeLessThan(5000)
    expect(historyDomain([], undefined)).toBeNull()
  })
})
