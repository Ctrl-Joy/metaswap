import { Button } from '@/components/ui'

/**
 * Backdrop for the connect panels: a fine ruled grid only, so the message and the button are the
 * whole composition. Pure SVG, coloured by `currentColor`, so it follows the theme.
 */
export function BannerPattern() {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full text-text-1" aria-hidden preserveAspectRatio="xMidYMid slice" viewBox="0 0 1152 216">
      <defs>
        <pattern id="pf-grid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0V12" fill="none" stroke="currentColor" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="1152" height="216" fill="url(#pf-grid)" />
    </svg>
  )
}

/** Signed-out banner: a quiet neutral panel with one line and one action. */
export function ConnectBanner({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="relative mb-10 flex flex-col items-center justify-center gap-5 overflow-hidden rounded-3xl border border-border bg-surface-2 px-6 py-10 text-center md:py-12" data-testid="portfolio-gate">
      <BannerPattern />
      <div className="relative text-body-2">
        <span className="font-semibold text-text-1">Connect a wallet</span> <span className="text-text-2">to view your portfolio</span>
      </div>
      <Button onClick={onConnect} className="relative h-11 w-[164px] text-body-2" data-testid="portfolio-connect">
        Connect
      </Button>
    </div>
  )
}
