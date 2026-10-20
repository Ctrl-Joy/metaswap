import { describe, expect, it } from 'vitest'
import { nextIndex, pushRecent, sortByVolume, type RecentSearch } from './tokenSearch'

describe('search helpers', () => {
  it('sortByVolume orders by volume desc, unknown last, stable', () => {
    const t = [{ address: '0xA' }, { address: '0xB' }, { address: '0xC' }, { address: '0xD' }]
    const out = sortByVolume(t, { '0xa': 5, '0xb': null, '0xc': 50, '0xd': 5 })
    expect(out.map((x) => x.address)).toEqual(['0xC', '0xA', '0xD', '0xB'])
  })
  it('pushRecent dedupes case-insensitively and caps', () => {
    let list: RecentSearch[] = []
    for (const id of ['1', '2', '3', '4', '5', '6']) list = pushRecent(list, { kind: 'token', id: `0x${id}`, label: id })
    expect(list.map((r) => r.label)).toEqual(['6', '5', '4', '3', '2'])
    list = pushRecent(list, { kind: 'token', id: '0X3', label: '3' })
    expect(list.map((r) => r.label)).toEqual(['3', '6', '5', '4', '2'])
    expect(pushRecent(list, { kind: 'pool', id: '0x3', label: 'p' })[0]!.kind).toBe('pool')
  })
  it('nextIndex wraps', () => {
    expect(nextIndex(-1, 3, 'ArrowDown')).toBe(0)
    expect(nextIndex(2, 3, 'ArrowDown')).toBe(0)
    expect(nextIndex(0, 3, 'ArrowUp')).toBe(2)
    expect(nextIndex(-1, 3, 'ArrowUp')).toBe(2)
    expect(nextIndex(1, 3, 'End')).toBe(2)
    expect(nextIndex(1, 0, 'ArrowDown')).toBe(-1)
  })
})
