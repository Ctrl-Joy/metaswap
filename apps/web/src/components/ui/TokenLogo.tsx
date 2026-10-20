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

function initials(symbol: string): string {
  const s = symbol.replace(/^m(?=[A-Z])/, '')
  return s.slice(0, s.length > 3 ? 2 : 3).toUpperCase()
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
        <span
          aria-hidden
          className="flex size-full items-center justify-center rounded-full font-semibold text-white"
          style={{ background: `hsl(${hueFrom(token.address ?? token.symbol)} 55% 45%)`, fontSize: Math.max(8, size * 0.34) }}
        >
          {initials(token.symbol)}
        </span>
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
