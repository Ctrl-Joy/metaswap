import type { ReactNode } from 'react'
import { Hammer } from 'lucide-react'
import { ButtonLink } from '@/components/ui'

/** Placeholder used for routes owned by later areas (explore the explore area, positions the positions/launches area). */
export function ComingSoon({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center px-4 pt-16 pb-24 text-center md:pt-24" data-testid="coming-soon">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-accent-tint text-accent">
        <Hammer size={28} />
      </span>
      <h1 className="mt-6 text-heading-3 font-semibold md:text-heading-2">{title}</h1>
      <p className="mt-3 max-w-[480px] text-body-2 text-text-2">{description ?? 'This part of MetaSwap is being built. Check back soon.'}</p>
      {children}
      <div className="mt-8 flex gap-2">
        <ButtonLink to="/swap" size="lg">
          Go to swap
        </ButtonLink>
        <ButtonLink to="/portfolio" size="lg" variant="secondary">
          Portfolio
        </ButtonLink>
      </div>
    </div>
  )
}
