import { ButtonLink } from '@/components/ui'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export default function NotFoundPage() {
  useDocumentTitle('Page not found')
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center px-4 pt-24 pb-24 text-center" data-testid="not-found">
      <div className="text-[96px] leading-none font-semibold tracking-[-0.04em] text-accent">404</div>
      <h1 className="mt-4 text-heading-3 font-semibold">This page does not exist</h1>
      <p className="mt-2 text-body-2 text-text-2">The link may be broken, or the page may have moved.</p>
      <ButtonLink to="/swap" size="lg" className="mt-8">
        Back to swap
      </ButtonLink>
    </div>
  )
}
