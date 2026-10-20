import { describe, expect, it } from 'vitest'
import { formatPrice, formatRelativeTime, formatSubscript } from './format'

describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000
  it('keeps seconds until a full minute has passed (no "0m ago")', () => {
    expect(formatRelativeTime(now - 3_000, now)).toBe('just now')
    expect(formatRelativeTime(now - 30_000, now)).toBe('30s ago')
    expect(formatRelativeTime(now - 50_000, now)).toBe('50s ago')
    expect(formatRelativeTime(now - 59_999, now)).toBe('59s ago')
    expect(formatRelativeTime(now - 60_000, now)).toBe('1m ago')
    expect(formatRelativeTime(now - 2 * 3600_000, now)).toBe('2h ago')
  })
})

describe('formatSubscript / formatPrice', () => {
  it('uses subscript zeros below 0.0001', () => {
    expect(formatSubscript(0.00004106)).toBe('0.0₄4106')
    expect(formatSubscript(0.0000000123)).toBe('0.0₇123')
    expect(formatSubscript(1.5e-15)).toBe('0.0₁₄15')
  })
  it('returns null for normal values', () => {
    expect(formatSubscript(0.0001)).toBeNull()
    expect(formatSubscript(0.5)).toBeNull()
    expect(formatSubscript(0)).toBeNull()
    expect(formatSubscript(-1)).toBeNull()
  })
  it('formatPrice prefixes $ and falls back to SDK rules', () => {
    expect(formatPrice(0.00004106)).toBe('$0.0₄4106')
    expect(formatPrice(3065.54)).toBe('$3,065.54')
    expect(formatPrice(0.7878)).toBe('$0.7878')
    expect(formatPrice(null)).toBe('-')
  })
})
