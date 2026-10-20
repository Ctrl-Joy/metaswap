import { describe, expect, it } from 'vitest'
import {
  balanceShares,
  bucketSum,
  changeOver,
  depthCurve,
  feeLabel,
  filterRange,
  filterTokenRows,
  exploreStatTiles,
  liquidityBars,
  normalizeTokenRow,
  normalizeTx,
  percentDelta,
  rangeFrom,
  sortRows,
  toCandles,
  toSeries,
  txTitle,
  volumeOverTvl,
} from './transforms'
import type { TokenRow } from './types'

const NOW = 1_800_000_000

const row = (over: Partial<TokenRow>): TokenRow => ({
  address: '0x0000000000000000000000000000000000000001',
  symbol: 'AAA',
  name: 'Aaa',
  decimals: 18,
  tags: [],
  priceUsd: 1,
  change1h: 0,
  change24h: 0,
  volumeUsd: 0,
  tvlUsd: 0,
  fdvUsd: 0,
  marketCapUsd: 0,
  sparkline: [],
  ...over,
})

describe('sortRows', () => {
  const rows = [
    { n: 'a', v: 3 },
    { n: 'b', v: null },
    { n: 'c', v: 10 },
    { n: 'd', v: 1 },
  ]
  it('sorts descending with missing values last', () => {
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n)).toEqual(['c', 'a', 'd', 'b'])
  })
  it('sorts ascending and still keeps missing values last', () => {
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.n)).toEqual(['d', 'a', 'c', 'b'])
  })
  it('sorts strings with localeCompare and keeps ties in input order', () => {
    const r = [
      { n: 'x', s: 'beta' },
      { n: 'y', s: 'alpha' },
      { n: 'z', s: 'beta' },
    ]
    expect(sortRows(r, (x) => x.s, 'asc').map((x) => x.n)).toEqual(['y', 'x', 'z'])
  })
})

describe('token rows', () => {
  it('normalises the nested API row shape', () => {
    const n = normalizeTokenRow({
      token: { chainId: 31337, address: '0x8A79…', symbol: 'mUSDC', name: 'Meta USD Coin', decimals: 6, tags: ['stablecoin'] } as never,
      priceUsd: 1,
      change1h: 0,
      change24h: null,
      volume24hUsd: 5680470.5,
      tvlUsd: 19193473,
      fdvUsd: 83181200,
      sparkline: [{ time: 1, priceUsd: 1 }, 1.01],
    })
    expect(n).toMatchObject({ symbol: 'mUSDC', volumeUsd: 5680470.5, change24h: null, sparkline: [1, 1.01] })
  })

  it('returns null for a row with no address', () => {
    expect(normalizeTokenRow({ priceUsd: 1 })).toBeNull()
  })

  it('filters by query on symbol, name and address prefix', () => {
    const rows = [row({ symbol: 'WETH', name: 'Wrapped Ether', tags: ['wrapped'] }), row({ symbol: 'mUSDC', name: 'Meta USD Coin', tags: ['stablecoin'], address: '0xabc0000000000000000000000000000000000000' })]
    expect(filterTokenRows(rows, { query: 'usd' }).map((r) => r.symbol)).toEqual(['mUSDC'])
    expect(filterTokenRows(rows, { query: 'wrapped' }).map((r) => r.symbol)).toEqual(['WETH'])
    expect(filterTokenRows(rows, { query: '0xabc' }).map((r) => r.symbol)).toEqual(['mUSDC'])
  })

  it('applies the stablecoin and wrapped chips', () => {
    const rows = [row({ symbol: 'WETH', tags: ['wrapped'] }), row({ symbol: 'mDAI', tags: [] }), row({ symbol: 'META', tags: [] })]
    expect(filterTokenRows(rows, { chip: 'stablecoins' }).map((r) => r.symbol)).toEqual(['mDAI'])
    expect(filterTokenRows(rows, { chip: 'wrapped' }).map((r) => r.symbol)).toEqual(['WETH'])
    expect(filterTokenRows(rows, { chip: 'all' })).toHaveLength(3)
  })
})

describe('series mapping', () => {
  it('converts milliseconds to seconds, sorts, dedupes (last wins) and drops non-finite values', () => {
    const s = toSeries([
      { time: 1_800_000_200_000, value: 2 },
      { time: 1_800_000_100, value: 1 },
      { time: 1_800_000_100, value: 1.5 },
      { time: 1_800_000_300, value: Number.NaN },
    ])
    expect(s).toEqual([
      { time: 1_800_000_100, value: 1.5 },
      { time: 1_800_000_200, value: 2 },
    ])
  })

  it('builds candles and defaults volume to 0', () => {
    const c = toCandles([{ time: 10, open: 1, high: 2, low: 0.5, close: 1.5 }, { time: 5, open: 1, high: 1, low: 1, close: 1, volumeUsd: 9 }])
    expect(c.map((x) => x.time)).toEqual([5, 10])
    expect(c[1]!.volumeUsd).toBe(0)
  })

  it('computes percent delta and change over the window, null when history is too short', () => {
    expect(percentDelta([{ time: 1, value: 100 }])).toBeNull()
    expect(percentDelta([{ time: 1, value: 100 }, { time: 2, value: 110 }])).toBeCloseTo(10)
    expect(changeOver([{ time: 1, value: 2 }, { time: 2, value: 3 }])).toEqual({ abs: 1, pct: 50 })
  })
})

describe('range bucketing', () => {
  it('maps each range to a look-back window and candle interval', () => {
    expect(rangeFrom('1H', NOW)).toBe(NOW - 3600)
    expect(rangeFrom('1D', NOW)).toBe(NOW - 86400)
    expect(rangeFrom('ALL', NOW)).toBeUndefined()
  })

  it('keeps only points inside the window, ALL keeps everything', () => {
    const pts = [
      { time: NOW - 7200, value: 1 },
      { time: NOW - 1000, value: 2 },
      { time: NOW, value: 3 },
    ]
    expect(filterRange(pts, '1H', NOW).map((p) => p.value)).toEqual([2, 3])
    expect(filterRange(pts, 'ALL', NOW)).toHaveLength(3)
  })

  it('sums volume into hourly buckets anchored to the bucket start', () => {
    const hour = 3600
    const base = 1_800_000_000 - (1_800_000_000 % hour)
    const b = bucketSum(
      [
        { time: base + 10, value: 5 },
        { time: base + 3000, value: 7 },
        { time: base + hour + 5, value: 1 },
      ],
      hour,
    )
    expect(b).toEqual([
      { time: base, value: 12 },
      { time: base + hour, value: 1 },
    ])
  })
})

describe('pools and ticks', () => {
  it('formats fee tiers in basis points', () => {
    expect(feeLabel(100)).toBe('0.01%')
    expect(feeLabel(500)).toBe('0.05%')
    expect(feeLabel(3000)).toBe('0.3%')
    expect(feeLabel(10000)).toBe('1%')
    expect(feeLabel(null)).toBeNull()
  })

  it('computes volume over TVL and balance shares', () => {
    expect(volumeOverTvl(50, 1000)).toBeCloseTo(0.05)
    expect(volumeOverTvl(50, 0)).toBeNull()
    expect(balanceShares(3, 1)).toEqual([0.75, 0.25])
    expect(balanceShares(0, 0)).toEqual([0.5, 0.5])
  })

  const ticks = {
    currentTick: 0,
    ticks: [
      { tick: -100, liquidityNet: '0', liquidityGross: '5', liquidityActive: '5' },
      { tick: 0, liquidityNet: '0', liquidityGross: '3', liquidityActive: '3' },
      { tick: 100, liquidityNet: '0', liquidityGross: '2', liquidityActive: '2' },
    ],
  }

  it('marks the initialised range holding the current tick', () => {
    const bars = liquidityBars(ticks)
    expect(bars.map((b) => b.tick)).toEqual([-100, 0, 100])
    expect(bars.filter((b) => b.current).map((b) => b.tick)).toEqual([0])
  })

  it('computes cumulative depth away from the current price on each side', () => {
    const d = depthCurve(ticks)
    const left = d.filter((p) => p.left > 0).map((p) => p.left)
    const right = d.filter((p) => p.right > 0).map((p) => p.right)
    expect(left).toEqual([8, 3])
    expect(right).toEqual([2])
  })
})

describe('transactions and stats', () => {
  it('normalises swap, add and remove rows', () => {
    const swap = normalizeTx({
      type: 'swap',
      txHash: '0xaa',
      logIndex: 3,
      timestamp: 1_800_000_000,
      account: '0xf39',
      amountUsd: 12.5,
      tokenIn: { symbol: 'WETH', amountFormatted: 0.08 },
      tokenOut: { symbol: 'mUSDC', amountFormatted: 250 },
    })
    expect(swap).toMatchObject({ kind: 'swap', timeMs: 1_800_000_000_000, usd: 12.5, wallet: '0xf39' })
    expect(txTitle(swap!)).toBe('Swap WETH for mUSDC')
    expect(swap!.legs[1]).toEqual({ symbol: 'mUSDC', amount: 250 })

    const add = normalizeTx({ type: 'add', timestamp: 1_800_000_000, token0: { symbol: 'mUSDC', amountFormatted: 1 }, token1: { symbol: 'mDAI', amountFormatted: 2 }, amountUsd: 3 })
    expect(add!.kind).toBe('add')
    expect(add!.legs.map((l) => l.symbol)).toEqual(['mUSDC', 'mDAI'])
    expect(normalizeTx({ type: 'swap' })).toBeNull()
  })

  it('builds stat tiles with deltas only where history exists', () => {
    const tiles = exploreStatTiles({
      volume24hUsd: 100,
      tvlUsd: 1000,
      v2: { tvlUsd: 400 },
      v3: { tvlUsd: 600 },
      volumeHistory: [{ time: 1, volumeUsd: 50 }],
      tvlHistory: [{ time: 1, tvlUsd: 900 }, { time: 2, tvlUsd: 1000 }],
    })
    expect(tiles.map((t) => t.key)).toEqual(['volume', 'tvl', 'v2', 'v3'])
    expect(tiles[0]!.delta).toBeNull()
    expect(tiles[1]!.delta).toBeCloseTo(11.11, 1)
    expect(tiles[2]!.value).toBe(400)
  })
})
