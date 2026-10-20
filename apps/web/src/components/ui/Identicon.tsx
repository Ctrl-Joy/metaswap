import { useMemo } from 'react'
import { hueFrom } from './TokenLogo'

/** Original deterministic avatar: 5x5 mirrored grid on a two-tone gradient, from the address. */
export function Identicon({ address, size = 32 }: { address: string; size?: number }) {
  const { cells, h1, h2 } = useMemo(() => {
    const a = address.toLowerCase().replace(/^0x/, '')
    const h1 = hueFrom(a)
    const h2 = (h1 + 40 + (parseInt(a.slice(4, 6) || '0', 16) % 80)) % 360
    const cells: Array<[number, number]> = []
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 3; x++) {
        const nib = parseInt(a[(y * 3 + x) % a.length] ?? '0', 16)
        if (nib % 2 === 0) {
          cells.push([x, y])
          if (x < 2) cells.push([4 - x, y])
        }
      }
    return { cells, h1, h2 }
  }, [address])
  const id = `ic-${address.slice(2, 10)}`
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className="shrink-0 rounded-full" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${h1} 70% 55%)`} />
          <stop offset="1" stopColor={`hsl(${h2} 70% 40%)`} />
        </linearGradient>
      </defs>
      <rect width="10" height="10" fill={`url(#${id})`} />
      <g fill="white" fillOpacity="0.85" transform="translate(1.5 1.5) scale(1.4)">
        {cells.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />
        ))}
      </g>
    </svg>
  )
}
