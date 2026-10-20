// Formatting helpers. Number formatting rules live in @metaswap/sdk (shared with the API);
// this file re-exports them and adds a few UI-only helpers.
import { formatPrice as sdkFormatPrice } from '@metaswap/sdk'
export { formatUsd, formatAmount, formatTokenAmount, formatPercent, shortenAddress } from '@metaswap/sdk'

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

/** Token USD price: SDK rules, plus subscript zeros for prices below $0.0001. */
export function formatPrice(value: number | null | undefined): string {
  if (value !== null && value !== undefined) {
    const sub = formatSubscript(value)
    if (sub) return `$${sub}`
  }
  return sdkFormatPrice(value)
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
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
