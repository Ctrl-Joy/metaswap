import { Button } from '@/components/ui'

/**
 * Decorative layer for the portfolio connect banner: a fine grid plus scattered accent shapes, in the
 * spirit of Uniswap's banner art but drawn with MetaSwap's own geometry (stacked squares from the logo,
 * rings, petals). Pure SVG, coloured by `currentColor` (accent), so it follows the theme.
 */
function BannerPattern() {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full text-accent" aria-hidden preserveAspectRatio="xMidYMid slice" viewBox="0 0 1152 216">
      <defs>
        <pattern id="pf-grid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0V12" fill="none" stroke="currentColor" strokeOpacity="0.09" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="1152" height="216" fill="url(#pf-grid)" />
      <g fill="currentColor" fillOpacity="0.38">
        {/* left: half-square, petal flower, ring, stacked squares */}
        <path d="M0 28h28c14 0 26 12 26 26v0c0 14-12 26-26 26H0z" />
        <g transform="translate(152 66)">
          {[0, 72, 144, 216, 288].map((r) => (
            <ellipse key={r} cx="0" cy="-14" rx="10" ry="16" transform={`rotate(${r})`} />
          ))}
        </g>
        <circle cx="96" cy="150" r="26" />
        <circle cx="96" cy="150" r="10" fill="var(--color-bg, #0b0c10)" fillOpacity="0.55" />
        <rect x="184" y="128" width="30" height="30" rx="5" />
        <rect x="214" y="98" width="30" height="30" rx="5" />
        {/* right: logo-style stacked squares, cross, leaf, dots */}
        <rect x="1002" y="40" width="34" height="34" rx="9" />
        <rect x="1020" y="58" width="34" height="34" rx="9" fillOpacity="0.6" />
        <path d="M930 96l14-14 16 16 16-16 14 14-16 16 16 16-14 14-16-16-16 16-14-14 16-16z" />
        <path d="M1090 150c22-30 52-30 62-28-4 26-30 48-62 28z" />
        <g transform="translate(1016 196)">
          {[-26, 0, 26].map((x) => (
            <circle key={x} cx={x} cy={0} r="12" />
          ))}
          <circle cx="-13" cy="-20" r="12" />
          <circle cx="13" cy="-20" r="12" />
        </g>
        <path d="M842 -6c18 0 34 14 34 30H808c0-16 16-30 34-30z" />
      </g>
    </svg>
  )
}

/** Signed-out banner (Uniswap: 1152×216, radius 24, accent-tinted fill with art; 164×46 Connect button). */
export function ConnectBanner({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="relative mb-12 flex h-[216px] flex-col items-center justify-center gap-6 overflow-hidden rounded-3xl bg-accent-tint px-6 text-center" data-testid="portfolio-gate">
      <BannerPattern />
      <div className="relative text-body-2">
        <span className="font-semibold text-text-1">Connect a wallet</span> <span className="text-text-2">to view your portfolio</span>
      </div>
      <Button onClick={onConnect} className="relative h-[46px] w-[164px] rounded-2xl text-body-2" data-testid="portfolio-connect">
        Connect
      </Button>
    </div>
  )
}
