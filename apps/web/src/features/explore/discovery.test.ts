import { describe, expect, it } from 'vitest'
import {
  auctionSecondsLeft,
  auctionTimeProgress,
  filterAuctions,
  listFrom,
  matchesCategory,
  normalizeAuction,
  normalizeVault,
  parseCategory,
  tokenBadges,
  type AuctionRow,
} from './discovery'
import type { TokenRow } from './types'

const token = (over: Partial<TokenRow>): TokenRow => ({
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

describe('categories and badges', () => {
  it('derives badges from API tags and symbols', () => {
    expect(tokenBadges(token({ symbol: 'mUSDC', tags: [] }))).toEqual(['Stablecoins'])
    expect(tokenBadges(token({ symbol: 'WETH', tags: ['wrapped'] }))).toEqual(expect.arrayContaining(['Wrapped', 'Majors']))
    expect(tokenBadges(token({ symbol: 'WETH', tags: ['wrapped'] }))).toContain('Wrapped')
    expect(tokenBadges(token({ symbol: 'META', tags: ['defi', 'unknown-tag'] }))).toEqual(['DeFi'])
  })

  it('matches category chips', () => {
    const trending = new Set(['0x0000000000000000000000000000000000000002'])
    const usdc = token({ symbol: 'mUSDC', tags: ['stablecoin'] })
    const hot = token({ symbol: 'HOT', address: '0x0000000000000000000000000000000000000002', change24h: 12 })
    const cold = token({ symbol: 'COLD', change24h: -3 })
    expect(matchesCategory(usdc, 'stablecoins', trending)).toBe(true)
    expect(matchesCategory(hot, 'trending', trending)).toBe(true)
    expect(matchesCategory(cold, 'trending', trending)).toBe(false)
    expect(matchesCategory(hot, 'gainers', trending)).toBe(true)
    expect(matchesCategory(cold, 'gainers', trending)).toBe(false)
    expect(matchesCategory(token({ symbol: 'WETH' }), 'wrapped', trending)).toBe(true)
    expect(matchesCategory(cold, 'all', trending)).toBe(true)
  })

  it('parses an unknown or missing category as All', () => {
    expect(parseCategory('trending')).toBe('trending')
    expect(parseCategory('nope')).toBe('all')
    expect(parseCategory(null)).toBe('all')
  })
})

describe('discovery payloads', () => {
  it('accepts a bare list or a wrapped list', () => {
    expect(listFrom([1, 2], ['tokens'])).toEqual([1, 2])
    expect(listFrom({ tokens: [3] }, ['tokens'])).toEqual([3])
    expect(listFrom({ error: 'x' }, ['tokens'])).toEqual([])
  })

  it('normalises vaults and drops rows without an id or symbol', () => {
    expect(normalizeVault({ slug: 'usdt', token: { symbol: 'USDT' }, apy: 4.78 })).toMatchObject({ id: 'usdt', symbol: 'USDT', apyPct: 4.78 })
    expect(normalizeVault({ address: '0xabc', symbol: 'ETH', apyPct: 1.5 })).toMatchObject({ id: '0xabc', apyPct: 1.5 })
    expect(normalizeVault({ apy: 2 })).toBeNull()
  })

  it('normalises auctions, with unknown numbers as null rather than zero', () => {
    const a = normalizeAuction({ slug: 'balances', symbol: 'BALANCE', verified: true, status: 'active', bidVolumeUsd: 410500, endsAt: 1_800_000_000 })
    expect(a).toMatchObject({ id: 'balances', verified: true, status: 'live', bidVolumeUsd: 410500, thresholdUsd: null, endsAtMs: 1_800_000_000_000 })
    expect(normalizeAuction({ slug: 'x', symbol: 'X', status: 'settled' })).toMatchObject({ status: 'launched' })
    expect(normalizeAuction({ slug: 'x', symbol: 'X' })?.fdvAtFloorUsd).toBeNull()
  })

  it('computes countdown and time progress', () => {
    const a = { startsAtMs: 0, endsAtMs: 100_000 }
    expect(auctionTimeProgress(a, 25_000)).toBe(25)
    expect(auctionTimeProgress({ startsAtMs: null, endsAtMs: 1 }, 5)).toBeNull()
    expect(auctionSecondsLeft({ endsAtMs: 100_000 }, 40_000)).toBe(60)
    expect(auctionSecondsLeft({ endsAtMs: 100_000 }, 200_000)).toBe(0)
  })

  it('filters auctions by chip, status and search', () => {
    const base = { id: '', name: '', symbol: '', address: null, isNew: false, fdvAtFloorUsd: null, bidVolumeUsd: null, thresholdUsd: null, thresholdMetPct: null, startsAtMs: null, endsAtMs: null, logoURI: null }
    const rows: AuctionRow[] = [
      { ...base, id: 'a', name: 'Balances', symbol: 'BAL', verified: true, status: 'live' },
      { ...base, id: 'b', name: 'STRAT', symbol: 'STRAT', verified: false, status: 'launched', isNew: true },
    ]
    expect(filterAuctions(rows, 'verified', 'all', '').map((r) => r.id)).toEqual(['a'])
    expect(filterAuctions(rows, 'launched', 'all', '').map((r) => r.id)).toEqual(['b'])
    expect(filterAuctions(rows, 'new', 'all', '').map((r) => r.id)).toEqual(['b'])
    expect(filterAuctions(rows, 'all', 'live', '').map((r) => r.id)).toEqual(['a'])
    expect(filterAuctions(rows, 'all', 'all', 'strat').map((r) => r.id)).toEqual(['b'])
  })
})
