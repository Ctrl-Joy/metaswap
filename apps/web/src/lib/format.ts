// Formatting helpers. Number formatting rules live in @metaswap/sdk (shared with the API). The app
// wraps them so fiat values follow the chosen display currency and numbers and dates follow the
// chosen language (see lib/displayPrefs). With the defaults (USD, en-US) the SDK output is returned
// unchanged.
import { formatUnits } from 'viem'
import {
  formatAmount as sdkFormatAmount,
  formatPercent as sdkFormatPercent,
  formatPrice as sdkFormatPrice,
  formatUsd as sdkFormatUsd,
} from '@metaswap/sdk'
import { currencySymbol, displayCurrency, displayLocale, isDefaultDisplay } from './displayPrefs'
export { shortenAddress } from '@metaswap/sdk'

const fmtCache = new Map<string, Intl.NumberFormat>()
function nf(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const loc = displayLocale()
  const key = loc + JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(loc, opts)
    fmtCache.set(key, f)
  }
  return f
}

/** The currency's usual number of decimals (2 for USD and EUR, 0 for JPY and KRW). */
function fiatDecimals(code: string): number {
  return nf({ style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2
}

/**
 * A USD value in the display currency: compact for large values (from `compactFrom`, default
 * 100,000), three significant digits below 1, the currency's usual decimals otherwise, and a
 * "<0.01" floor.
 */
export function formatUsd(value: number | null | undefined, opts: { compact?: boolean; compactFrom?: number } = {}): string {
  if (isDefaultDisplay() && opts.compactFrom === undefined) return sdkFormatUsd(value, opts)
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  const { code, rate } = displayCurrency()
  const v = value * rate
  const dec = fiatDecimals(code)
  const money = (o: Intl.NumberFormatOptions) => nf({ style: 'currency', currency: code, ...o })
  if (v === 0) return money({ minimumFractionDigits: dec, maximumFractionDigits: dec }).format(0)
  const abs = Math.abs(v)
  const floor = dec > 0 ? 10 ** -dec : 0.01
  if (abs < floor) return `${v < 0 ? '-' : ''}<${money({ maximumFractionDigits: Math.max(dec, 2) }).format(floor)}`
  const compactFrom = opts.compactFrom ?? 100_000
  if ((opts.compact || opts.compactFrom !== undefined) && abs >= compactFrom) return money({ notation: 'compact', maximumFractionDigits: 1 }).format(v)
  if (abs < 1) return money({ maximumSignificantDigits: 3 }).format(v)
  return money({ minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v)
}

/** Token amount with ~6 significant figures and thousands separators, in the display locale. */
export function formatAmount(value: number | string | null | undefined, maxSig = 6): string {
  if (displayLocale() === 'en-US') return sdkFormatAmount(value, maxSig)
  if (value === null || value === undefined || value === '') return '-'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '-'
  if (n === 0) return nf({}).format(0)
  if (Math.abs(n) < 0.000001) return `<${nf({ maximumFractionDigits: 6 }).format(0.000001)}`
  if (Math.abs(n) >= 1e9) return nf({ notation: 'compact', maximumFractionDigits: 2 }).format(n)
  if (Math.abs(n) >= 1) {
    const digitsBefore = Math.floor(Math.log10(Math.abs(n))) + 1
    return nf({ maximumFractionDigits: Math.max(0, maxSig - digitsBefore) }).format(n)
  }
  return nf({ maximumSignificantDigits: Math.max(1, maxSig - 2) }).format(n)
}

export function formatTokenAmount(raw: bigint, decimals: number, maxSig = 6): string {
  return formatAmount(formatUnits(raw, decimals), maxSig)
}

export function formatPercent(value: number | null | undefined, opts: { sign?: boolean; digits?: number } = {}): string {
  if (displayLocale() === 'en-US') return sdkFormatPercent(value, opts)
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  const digits = opts.digits ?? 2
  const s = `${nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value))}%`
  if (!opts.sign) return value < 0 ? `-${s}` : s
  return value > 0 ? `+${s}` : value < 0 ? `-${s}` : s
}

/** A plain number in the display locale. */
export function formatNumber(value: number, opts: Intl.NumberFormatOptions = {}): string {
  return nf(opts).format(value)
}

/** Date and time in the display locale. */
export function formatDate(date: Date | number, opts: Intl.DateTimeFormatOptions): string {
  return new Date(date).toLocaleString(displayLocale(), opts)
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'

/**
 * Subscript-zero notation for tiny numbers (Uniswap style): 0.00004106 → "0.0₄4106".
 * Returns null when the value is not tiny (>= 0.0001) so callers can fall back to normal formatting.
 * `sig` is the number of significant digits kept after the zero run.
 */
export function formatSubscript(value: number, sig = 4): string | null {
  if (!Number.isFinite(value) || value <= 0 || value >= 0.0001) return null
  const zeros = -Math.floor(Math.log10(value)) - 1
  if (zeros < 4 || zeros > 99) return null
  const digits = (value * 10 ** (zeros + sig)).toFixed(0).slice(0, sig).replace(/0+$/, '') || '0'
  const sub = String(zeros)
    .split('')
    .map((d) => SUBSCRIPT[Number(d)])
    .join('')
  return `0.0${sub}${digits}`
}

/** Token price: SDK rules, plus subscript zeros for prices below 0.0001, in the display currency. */
export function formatPrice(value: number | null | undefined): string {
  if (isDefaultDisplay()) {
    if (value !== null && value !== undefined) {
      const sub = formatSubscript(value)
      if (sub) return `$${sub}`
    }
    return sdkFormatPrice(value)
  }
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  const { code, rate } = displayCurrency()
  const v = value * rate
  const dec = Math.min(2, fiatDecimals(code))
  const money = (o: Intl.NumberFormatOptions) => nf({ style: 'currency', currency: code, ...o })
  if (v === 0) return money({}).format(0)
  if (v >= 1) return money({ minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v)
  const sub = displayLocale().startsWith('en') ? formatSubscript(v) : null
  if (sub) return `${currencySymbol(code)}${sub}`
  return money({ maximumSignificantDigits: 4 }).format(v)
}

/** "2m ago" for recent timestamps, a short date for older ones. */
export function formatRelativeTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms)
  const s = Math.floor(diff / 1000)
  if (s < 60) return s <= 5 ? 'just now' : `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString(displayLocale(), { month: 'short', day: 'numeric' })
}

/** "in 6d 23h" style countdown for expiries. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'now'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(seconds)}s`
}

/** Price-impact percent with Uniswap-style "<0.01%" floor. */
export function formatImpact(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return '-'
  const pct = bps / 100
  if (pct > 0 && pct < 0.01) return '<0.01%'
  return `${pct.toFixed(2)}%`
}
