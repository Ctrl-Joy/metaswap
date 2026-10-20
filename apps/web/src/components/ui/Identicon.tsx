import { useMemo } from 'react'

/**
 * MetaSwap account avatar ("Metamark"): an original, deterministic emblem derived from the address.
 * A soft tinted disc carries a rounded star-blob (3–7 lobes, varying depth and twist) in a saturated
 * hue, with a small inner core. Built from smooth curves so it reads at 16–48px, in the spirit of
 * Uniswap's Unicon (colour + emblem) without reusing any of its artwork.
 */
export function avatarSpec(address: string) {
  const a = (address || '0x0').toLowerCase().replace(/^0x/, '').padEnd(40, '0')
  const byte = (i: number) => parseInt(a.slice((i * 2) % 40, (i * 2) % 40 + 2), 16) || 0
  const hue = Math.round((byte(0) * 256 + byte(1)) % 360)
  const hue2 = (hue + 25 + (byte(2) % 70)) % 360
  const lobes = 3 + (byte(3) % 5) // 3..7
  const depth = 0.18 + (byte(4) / 255) * 0.22 // 0.18..0.40 of radius
  const twist = (byte(5) / 255) * Math.PI * 2
  const core = byte(6) % 3 // 0 dot, 1 ring, 2 none
  return { hue, hue2, lobes, depth, twist, core }
}

/** Closed smooth path of an r(θ) = R·(1 − depth·(1 − cos(nθ))/2) blob, sampled and joined with quadratic curves. */
export function blobPath(cx: number, cy: number, R: number, lobes: number, depth: number, twist: number, steps = 72): string {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const r = R * (1 - (depth * (1 - Math.cos(lobes * t))) / 2)
    pts.push([cx + r * Math.cos(t + twist), cy + r * Math.sin(t + twist)])
  }
  const mid = (p: [number, number], q: [number, number]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const
  const m0 = mid(pts[steps - 1]!, pts[0]!)
  let d = `M${m0[0].toFixed(2)} ${m0[1].toFixed(2)}`
  for (let i = 0; i < steps; i++) {
    const p = pts[i]!
    const m = mid(p, pts[(i + 1) % steps]!)
    d += `Q${p[0].toFixed(2)} ${p[1].toFixed(2)} ${m[0].toFixed(2)} ${m[1].toFixed(2)}`
  }
  return `${d}Z`
}

export function Identicon({ address, size = 32, className }: { address: string; size?: number; className?: string }) {
  const s = useMemo(() => avatarSpec(address), [address])
  const path = useMemo(() => blobPath(20, 20, 13.5, s.lobes, s.depth, s.twist), [s])
  const id = `mm-${(address || '').slice(2, 12)}`
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className ? `shrink-0 ${className}` : 'shrink-0'} aria-hidden data-testid="account-avatar">
      <defs>
        <linearGradient id={id} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
          <stop offset="0" stopColor={`hsl(${s.hue} 88% 62%)`} />
          <stop offset="1" stopColor={`hsl(${s.hue2} 82% 48%)`} />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill={`hsl(${s.hue} 80% 60% / 0.16)`} />
      <path d={path} fill={`url(#${id})`} />
      {s.core === 0 && <circle cx="20" cy="20" r="3.4" fill="white" fillOpacity="0.9" />}
      {s.core === 1 && <circle cx="20" cy="20" r="4" fill="none" stroke="white" strokeOpacity="0.9" strokeWidth="2.2" />}
    </svg>
  )
}
