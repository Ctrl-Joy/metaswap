import { cn } from '@/lib/cn'

/**
 * MetaSwap mark: two overlapping rounded squares (the "swap" metaphor) in the accent fill,
 * with the overlap cut out. Original artwork.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={cn('shrink-0', className)} aria-hidden>
      <rect x="3" y="3" width="17" height="17" rx="5.5" fill="#5B5BF0" />
      <rect x="12" y="12" width="17" height="17" rx="5.5" fill="#8B8CFF" />
      <path d="M12 17.5V12h5.5A2.5 2.5 0 0 1 20 14.5V20h-5.5A2.5 2.5 0 0 1 12 17.5Z" fill="#2E2EA8" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn('text-[20px] leading-none font-semibold tracking-[-0.02em] text-text-1', className)}>MetaSwap</span>
}
