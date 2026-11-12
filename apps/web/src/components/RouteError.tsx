import { useEffect } from 'react'
import { useRouteError } from 'react-router-dom'
import { isChunkLoadError, reloadOnce } from '@/lib/lazyRetry'
import { Button } from '@/components/ui'
import { t } from '@/i18n'

/** Router error page: a stale or failed page chunk reloads itself once; anything else gets a clear retry. */
export default function RouteError() {
  const error = useRouteError()
  const chunk = isChunkLoadError(error)
  useEffect(() => {
    if (!chunk) console.error('MetaSwap route error:', error)
  }, [error, chunk])
  useEffect(() => {
    if (chunk) reloadOnce()
  }, [chunk])
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center px-4 pt-24 pb-24 text-center" data-testid="route-error">
      <h1 className="text-heading-3 font-semibold">{chunk ? t('Updating MetaSwap…') : t('Something went wrong')}</h1>
      <p className="mt-2 text-body-2 text-text-2">
        {chunk ? t('A new version is available. Reloading the page.') : t('This page could not be shown. Reloading usually fixes it.')}
      </p>
      <Button size="lg" className="mt-8" onClick={() => window.location.reload()}>
        {t('Reload page')}
      </Button>
    </div>
  )
}
