import { formatUnits } from 'viem'
import { safeParseUnits } from '@metaswap/sdk'

/**
 * Normalise a keystroke-level amount input (docs/analysis/ui-ux.md §2.4):
 * - accepts digits and a single decimal separator ("," is treated as ".")
 * - collapses leading zeros ("007" -> "7", "00.5" -> "0.5")
 * - "." alone becomes "0."
 * - caps fraction digits at `decimals`
 * Returns `null` when the keystroke should be rejected (the field keeps its previous value).
 */
export function sanitizeAmountInput(raw: string, decimals = 18): string | null {
  let v = raw.replace(/,/g, '.').replace(/\s/g, '')
  if (v === '') return ''
  if (!/^\d*\.?\d*$/.test(v)) return null
  if (v.startsWith('.')) v = `0${v}`
  const [whole, frac] = v.split('.') as [string, string | undefined]
  const wholeClean = whole.replace(/^0+(?=\d)/, '')
  if (frac !== undefined && frac.length > decimals) return null
  return frac === undefined ? wholeClean : `${wholeClean}.${frac}`
}

/** Parse a sanitised input into base units; `null` for empty / invalid / zero-less garbage. */
export function parseAmount(value: string, decimals: number): bigint | null {
  if (!value || value === '.' ) return null
  return safeParseUnits(value, decimals)
}

/** bigint base units -> a plain decimal string suitable for an input (no grouping, trimmed). */
export function toInputString(raw: bigint, decimals: number, maxFraction = 8): string {
  const s = formatUnits(raw, decimals)
  if (!s.includes('.')) return s
  const [w, f = ''] = s.split('.')
  const trimmed = f.slice(0, Math.min(maxFraction, decimals)).replace(/0+$/, '')
  return trimmed ? `${w}.${trimmed}` : w!
}

/** Number value of base units (lossy; for display and USD maths only). */
export function toNumber(raw: bigint | null | undefined, decimals: number): number {
  if (raw === null || raw === undefined) return 0
  return Number(formatUnits(raw, decimals))
}

/** Apply basis points: amount * (10000 ± bps) / 10000. */
export function applyBps(amount: bigint, bps: number, direction: 'up' | 'down'): bigint {
  const b = BigInt(Math.round(bps))
  return direction === 'down' ? (amount * (10_000n - b)) / 10_000n : (amount * (10_000n + b) + 9_999n) / 10_000n
}

/** Leave some ETH for gas when the user hits Max on native ETH. */
export const NATIVE_GAS_RESERVE = 10n ** 16n // 0.01 ETH

export function maxSpendable(balance: bigint, isNative: boolean): bigint {
  if (!isNative) return balance
  return balance > NATIVE_GAS_RESERVE ? balance - NATIVE_GAS_RESERVE : 0n
}
