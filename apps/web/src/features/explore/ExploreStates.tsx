import { useEffect, useState, type ReactNode } from 'react'
import { SearchX, WifiOff } from 'lucide-react'
import { ButtonLink, Button, EmptyState } from '@/components/ui'
import { ApiError } from '@/lib/errors'
import { CHAIN_SLUG } from '@/config'
import { cn } from '@/lib/cn'

/** Re-renders every `ms` so relative times ("14s ago") stay live. */
export function useNow(ms = 10_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404
}

/** Friendly message when the API is unreachable or returns an error. */
export function ApiErrorState({ error, onRetry, title = 'Could not load this data', className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  const offline = error instanceof ApiError && error.status === 0
  const message = error instanceof Error ? error.message : 'Unknown error'
  return (
    <div className={cn('rounded-2xl border border-border bg-surface-1', className)} role="alert" data-testid="api-error">
      <EmptyState
        icon={<WifiOff size={22} />}
        title={offline ? 'MetaSwap API is offline' : title}
        action={
          onRetry ? (
            <Button variant="secondary" size="md" onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      >
        {offline ? 'The explore data comes from the MetaSwap API on http://127.0.0.1:8787. Start it and this page will refresh on its own.' : message}
      </EmptyState>
    </div>
  )
}

/** Friendly 404-style page for an unknown token or pool. */
export function NotFoundState({ what, backTo, backLabel }: { what: string; backTo: string; backLabel: string }) {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center px-4 pt-20 pb-24 text-center" data-testid="explore-not-found">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-surface-3 text-text-2">
        <SearchX size={24} />
      </span>
      <h1 className="mt-5 text-heading-3 font-semibold">{what} not found</h1>
      <p className="mt-2 text-body-2 text-text-2">It is not listed on MetaChain Devnet. Check the address, or browse what is available in Explore.</p>
      <div className="mt-8 flex gap-2">
        <ButtonLink to={backTo} size="lg" variant="secondary">
          {backLabel}
        </ButtonLink>
        <ButtonLink to={`/explore/tokens`} size="lg">
          Explore tokens
        </ButtonLink>
      </div>
    </div>
  )
}

/** Shows a skeleton-style placeholder row (never fake zeros) while a section loads. */
export function SectionLoading({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border border-border bg-surface-1 p-4', className)} aria-busy="true" data-testid="section-loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-10 rounded-xl" />
      ))}
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-surface-2 px-4 py-3 text-body-3 text-text-2">{children}</div>
}

/** Explorer-style explore URLs use the chain slug from config. */
export const exploreChainSlug = CHAIN_SLUG
