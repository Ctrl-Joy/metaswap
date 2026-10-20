import { useState } from 'react'
import { cn } from '@/lib/cn'

interface LogoToken {
  symbol: string
  logoURI?: string
  address?: string
}

/** Deterministic hue from a string (for fallback logos and identicons). */
export function hueFrom(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

function initial(symbol: string): string {
  return (symbol.replace(/^m(?=[A-Z])/, '').replace(/^\$/, '')[0] ?? '?').toUpperCase()
}

/**
 * Generated avatar for tokens without artwork (e.g. freshly launched tokens): a two-tone gradient
 * and one of several geometric motifs, both derived from the address, plus a single initial. Every
 * token gets a distinct, stable logo that stays legible down to 16px.
 */
function GeneratedLogo({ seed, symbol }: { seed: string; symbol: string }) {
  const h = hueFrom(seed)
  const h2 = (h + 40 + (hueFrom(seed + 'b') % 80)) % 360
  const motif = hueFrom(seed + 'm') % 5
  const id = `g${hueFrom(seed + 'id')}`
  return (
    <svg viewBox="0 0 40 40" className="size-full rounded-full" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${h} 70% 58%)`} />
          <stop offset="1" stopColor={`hsl(${h2} 65% 38%)`} />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill={`url(#${id})`} />
      <g fill="white" fillOpacity="0.16">
        {motif === 0 && <circle cx="31" cy="9" r="11" />}
        {motif === 1 && <path d="M0 30 L20 12 L40 30 L40 40 L0 40Z" />}
        {motif === 2 && <rect x="22" y="-4" width="20" height="20" rx="5" transform="rotate(20 32 6)" />}
        {motif === 3 && <path d="M20 2 L24 14 L37 14 L27 22 L31 35 L20 27 L9 35 L13 22 L3 14 L16 14Z" />}
        {motif === 4 && <ellipse cx="8" cy="34" rx="18" ry="11" />}
      </g>
      <text x="20" y="20" dy="0.36em" textAnchor="middle" fontSize="17" fontWeight="700" fill="white" fontFamily="Inter, ui-sans-serif, system-ui, sans-serif">
        {initial(symbol)}
      </text>
    </svg>
  )
}

/**
 * Token logo: `/tokens/<SYMBOL>.svg` (generated, see scripts/gen-token-logos.mjs) with a
 * coloured-initials fallback for imported tokens. Optional chain badge (bottom-right).
 */
export function TokenLogo({ token, size = 36, className, chainBadge }: { token: LogoToken | undefined; size?: number; className?: string; chainBadge?: boolean }) {
  const [failed, setFailed] = useState(false)
  const src = token?.logoURI ?? (token ? `/tokens/${token.symbol}.svg` : undefined)
  const style = { width: size, height: size }
  if (!token) return <span className={cn('inline-block shrink-0 rounded-full bg-surface-3', className)} style={style} aria-hidden />
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={style}>
      {src && !failed ? (
        <img src={src} alt="" width={size} height={size} className="size-full rounded-full" onError={() => setFailed(true)} draggable={false} />
      ) : (
        <GeneratedLogo seed={(token.address ?? token.symbol).toLowerCase()} symbol={token.symbol} />
      )}
      {chainBadge && (
        <span className="absolute -right-0.5 -bottom-0.5 rounded-[4px] border-2 border-surface-1 bg-accent-fill" style={{ width: size * 0.38, height: size * 0.38 }} aria-hidden>
          <MetaChainGlyph />
        </span>
      )}
    </span>
  )
}

function MetaChainGlyph() {
  return (
    <svg viewBox="0 0 10 10" className="size-full">
      <path d="M2 7.5V3l3 2.4L8 3v4.5" fill="none" stroke="white" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Two overlapping logos for pairs/pools. */
export function DoubleLogo({ token0, token1, size = 28, className }: { token0: LogoToken | undefined; token1: LogoToken | undefined; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)} style={{ width: size * 1.6, height: size }}>
      <TokenLogo token={token0} size={size} className="z-[1]" />
      <span className="inline-flex rounded-full ring-2 ring-surface-1" style={{ marginLeft: -size * 0.4 }}>
        <TokenLogo token={token1} size={size} />
      </span>
    </span>
  )
}
