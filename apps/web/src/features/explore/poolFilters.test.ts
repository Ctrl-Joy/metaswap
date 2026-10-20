import { describe, expect, it } from 'vitest'
import type { PoolApiRow } from './types'
import { activeFilterCount, applyPoolFilters, EMPTY_POOL_FILTERS, poolMatchesQuery, sumRecentVolume } from './poolFilters'
import { formatRatio } from './PoolsTable'

const tok = (symbol: string, address: string) => ({ chainId: 31337, address: address as `0x${string}`, symbol, name: symbol, decimals: 18 })
const pool = (address: string, version: 'v2' | 'v3', a: string, b: string, fee: number | null, tvl: number, apr: number): PoolApiRow => ({
  address,
  version,
  token0: tok(a, `0x${a}`),
  token1: tok(b, `0x${b}`),
  fee,
  tvlUsd: tvl,
  volume24hUsd: 1,
  volume7dUsd: 7,
  apr,
})
const pools = [
  pool('0xaaa1', 'v3', 'WETH', 'mUSDC', 500, 7_000_000, 24),
  pool('0xbbb2', 'v2', 'WETH', 'mUSDC', 3000, 6_000_000, 21),
  pool('0xccc3', 'v3', 'mUSDC', 'mDAI', 100, 8_000_000, 4.5),
  pool('0xddd4', 'v3', 'mARB', 'mLINK', 3000, 300, 0),
]

describe('pool filters', () => {
  it('searches pairs, single symbols without the m prefix, fees and addresses', () => {
    expect(applyPoolFilters(pools, EMPTY_POOL_FILTERS, 'weth/usdc').map((p) => p.address)).toEqual(['0xaaa1', '0xbbb2'])
    expect(applyPoolFilters(pools, EMPTY_POOL_FILTERS, 'dai').map((p) => p.address)).toEqual(['0xccc3'])
    expect(applyPoolFilters(pools, EMPTY_POOL_FILTERS, 'weth 0.05').map((p) => p.address)).toEqual(['0xaaa1'])
    expect(poolMatchesQuery(pools[3]!, '0xddd')).toBe(true)
    expect(poolMatchesQuery(pools[3]!, 'xyz')).toBe(false)
  })
  it('filters by protocol, APR range and TVL bucket', () => {
    expect(applyPoolFilters(pools, { ...EMPTY_POOL_FILTERS, versions: ['v2'] }).map((p) => p.address)).toEqual(['0xbbb2'])
    expect(applyPoolFilters(pools, { ...EMPTY_POOL_FILTERS, aprMin: 5, aprMax: 22 }).map((p) => p.address)).toEqual(['0xbbb2'])
    expect(applyPoolFilters(pools, { ...EMPTY_POOL_FILTERS, tvl: ['lt100k'] }).map((p) => p.address)).toEqual(['0xddd4'])
    expect(applyPoolFilters(pools, { ...EMPTY_POOL_FILTERS, tvl: ['1m-10m'], versions: ['v3'] }).map((p) => p.address)).toEqual(['0xaaa1', '0xccc3'])
    expect(activeFilterCount({ versions: ['v3'], aprMin: 1, aprMax: null, tvl: ['gt10m'] })).toBe(3)
    expect(activeFilterCount(EMPTY_POOL_FILTERS)).toBe(0)
  })
  it('sums the last 30 days of volume', () => {
    const now = 100 * 86_400
    const hist = [
      { time: now - 40 * 86_400, volumeUsd: 1000 },
      { time: now - 29 * 86_400, volumeUsd: 10 },
      { time: now - 86_400, volumeUsd: 5 },
    ]
    expect(sumRecentVolume(hist, 30, now)).toBe(15)
    expect(sumRecentVolume([], 30, now)).toBeNull()
  })
  it('formats vol/TVL as a ratio', () => {
    expect(formatRatio(12.554)).toBe('12.55')
    expect(formatRatio(0.004)).toBe('<0.01')
    expect(formatRatio(null)).toBe('-')
  })
})
