import { describe, expect, it } from 'vitest'
import { applyBps, maxSpendable, NATIVE_GAS_RESERVE, parseAmount, sanitizeAmountInput, toInputString } from './amount'

describe('sanitizeAmountInput', () => {
  it.each([
    ['', ''],
    ['1', '1'],
    ['0', '0'],
    ['007', '7'],
    ['00.5', '0.5'],
    ['.', '0.'],
    ['.5', '0.5'],
    ['1,5', '1.5'],
    ['1.', '1.'],
    ['12.345', '12.345'],
    [' 3 ', '3'],
  ])('%j → %j', (raw, out) => expect(sanitizeAmountInput(raw, 18)).toBe(out))

  it.each(['abc', '1.2.3', '-1', '1e5', '1..', '$5'])('rejects %j', (raw) => expect(sanitizeAmountInput(raw, 18)).toBeNull())

  it('caps fraction digits at token decimals', () => {
    expect(sanitizeAmountInput('1.123456', 6)).toBe('1.123456')
    expect(sanitizeAmountInput('1.1234567', 6)).toBeNull()
    expect(sanitizeAmountInput('5.', 0)).toBe('5.')
  })
})

describe('parseAmount', () => {
  it('parses to base units', () => {
    expect(parseAmount('1.5', 6)).toBe(1_500_000n)
    expect(parseAmount('0.000001', 6)).toBe(1n)
    expect(parseAmount('1', 18)).toBe(10n ** 18n)
  })
  it('returns null for empty / dot', () => {
    expect(parseAmount('', 18)).toBeNull()
    expect(parseAmount('.', 18)).toBeNull()
  })
  it('parses "0." as zero', () => expect(parseAmount('0.', 18)).toBe(0n))
})

describe('toInputString', () => {
  it('trims trailing zeros and limits fraction', () => {
    expect(toInputString(1_500_000n, 6)).toBe('1.5')
    expect(toInputString(10n ** 18n, 18)).toBe('1')
    expect(toInputString(123456789n, 8, 4)).toBe('1.2345')
    expect(toInputString(0n, 18)).toBe('0')
  })
})

describe('applyBps / maxSpendable', () => {
  it('applies slippage down (floor) and up (ceil)', () => {
    expect(applyBps(10_000n, 50, 'down')).toBe(9_950n)
    expect(applyBps(10_001n, 50, 'up')).toBe(10_052n)
  })
  it('keeps a gas reserve on native ETH only', () => {
    expect(maxSpendable(10n ** 18n, true)).toBe(10n ** 18n - NATIVE_GAS_RESERVE)
    expect(maxSpendable(1n, true)).toBe(0n)
    expect(maxSpendable(5n, false)).toBe(5n)
  })
})
