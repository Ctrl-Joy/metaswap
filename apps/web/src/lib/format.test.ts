import { afterEach, describe, expect, it } from 'vitest'
import { setDisplayPrefs } from './displayPrefs'
import { formatAmount, formatPercent, formatPrice, formatRelativeTime, formatSubscript, formatUsd } from './format'

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

describe('display currency and language', () => {
  afterEach(() => setDisplayPrefs({ currency: 'USD', locale: 'en-US' }))

  it('keeps the USD / en-US output identical to the SDK rules', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50')
    expect(formatUsd(2_500_000, { compact: true })).toBe('$2.5M')
    expect(formatPrice(0.00004106)).toBe('$0.0₄4106')
  })

  it('converts USD to the chosen currency at its fixed rate', () => {
    setDisplayPrefs({ currency: 'INR' })
    expect(formatUsd(100)).toBe('₹8,400.00')
    setDisplayPrefs({ currency: 'JPY' })
    expect(formatUsd(10)).toBe('¥1,500')
  })

  it('writes numbers the way the chosen language does', () => {
    setDisplayPrefs({ currency: 'EUR', locale: 'de-DE' })
    // Intl separates the amount and "€" with a no-break space.
    expect(formatUsd(100)).toBe('92,00 €')
    expect(formatAmount(1234.5)).toBe('1.234,5')
    expect(formatPercent(1.5)).toBe('1,50%')
  })

  it('compacts launch-style figures from 1,000 in any currency', () => {
    setDisplayPrefs({ currency: 'GBP' })
    expect(formatUsd(1_000_000, { compactFrom: 1000 })).toBe('£780K')
    expect(formatUsd(500, { compactFrom: 1000 })).toBe('£390.00')
  })
})
