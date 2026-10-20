import { formatUnits, parseUnits } from 'viem'

// Number formatting rules shared by the app and API, modelled on Uniswap's conventions:
// compact USD for large values, "<$0.01" floors, significant figures for token amounts.

const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatUsd(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  if (value === 0) return '$0.00'
  const abs = Math.abs(value)
  if (abs < 0.01) return value < 0 ? '-<$0.01' : '<$0.01'
  if (opts.compact && abs >= 100_000) return compactUsd.format(value)
  if (abs < 1) return `$${value.toPrecision(3).replace(/0+$/, '').replace(/\.$/, '')}`
  return usd2.format(value)
}

/** Token price display: more precision for small prices. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  if (value === 0) return '$0.00'
  if (value < 0.00000001) return '<$0.00000001'
  if (value < 1) return `$${Number(value.toPrecision(4))}`
  return usd2.format(value)
}

/** Token amount with ~6 significant figures, "<0.000001" floor, thousands separators. */
export function formatAmount(value: number | string | null | undefined, maxSig = 6): string {
  if (value === null || value === undefined || value === '') return '-'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '-'
  if (n === 0) return '0'
  if (Math.abs(n) < 0.000001) return '<0.000001'
  if (Math.abs(n) >= 1e9) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
  if (Math.abs(n) >= 1) {
    const digitsBefore = Math.floor(Math.log10(Math.abs(n))) + 1
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.max(0, maxSig - digitsBefore) }).format(n)
  }
  return String(Number(n.toPrecision(maxSig - 2)))
}

export function formatTokenAmount(raw: bigint, decimals: number, maxSig = 6): string {
  return formatAmount(formatUnits(raw, decimals), maxSig)
}

export function formatPercent(value: number | null | undefined, opts: { sign?: boolean; digits?: number } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  const digits = opts.digits ?? 2
  const s = `${Math.abs(value).toFixed(digits)}%`
  if (!opts.sign) return value < 0 ? `-${s}` : s
  return value > 0 ? `+${s}` : value < 0 ? `-${s}` : s
}

/** Parse user input like "1,234.5" safely; returns null for invalid/empty input. */
export function safeParseUnits(input: string, decimals: number): bigint | null {
  const cleaned = input.replace(/,/g, '').trim()
  if (!cleaned || cleaned === '.' || !/^\d*\.?\d*$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  try {
    return parseUnits(`${whole || '0'}.${frac.slice(0, decimals) || '0'}`, decimals)
  } catch {
    return null
  }
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}
