import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Providers, Shell } from './App'
import { appRoutes } from './routes'
import RouteError from './components/RouteError'
import { reloadOnce } from './lib/lazyRetry'
import { safeStorage } from './lib/storage'
import { CURRENCIES, loadFxRates } from './lib/displayPrefs'
import { DEFAULT_LANGUAGE, matchLanguage } from './i18n'
import { useSettings } from './state/settings'
import './styles/index.css'

// Vite fires this when a preloaded chunk 404s (a stale tab after an update): load the fresh page once.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnce()) event.preventDefault()
})

const router = createBrowserRouter([{ element: <Shell />, errorElement: <RouteError />, children: appRoutes }])

/**
 * Language and currency before the first render. A link may carry them as ?lng=es-ES&cur=EUR
 * (as on Uniswap); otherwise the saved choice is used, then the browser's language on a first
 * visit. The chosen language's translations are downloaded before anything is drawn, so the page
 * never flashes English first.
 */
async function applyDisplayPreferences() {
  const params = new URLSearchParams(window.location.search)
  const settings = useSettings.getState()
  const fromUrl = matchLanguage(params.get('lng'))
  const firstVisit = !safeStorage.getItem('metaswap.settings')
  const language = fromUrl ?? (firstVisit ? matchLanguage(navigator.language) : null) ?? settings.language
  const cur = params.get('cur')
  if (cur && CURRENCIES.some((c) => c.code === cur.toUpperCase())) settings.setCurrency(cur)
  try {
    await settings.setLanguage(language)
  } catch {
    // Translations could not be downloaded (offline): stay in English rather than not starting.
    await settings.setLanguage(DEFAULT_LANGUAGE)
  }
  void loadFxRates()
}

void applyDisplayPreferences().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  )
})
