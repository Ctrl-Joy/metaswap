import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Providers, Shell } from './App'
import { appRoutes } from './routes'
import RouteError from './components/RouteError'
import { reloadOnce } from './lib/lazyRetry'
import './styles/index.css'

// Vite fires this when a preloaded chunk 404s (a stale tab after an update): load the fresh page once.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnce()) event.preventDefault()
})

const router = createBrowserRouter([{ element: <Shell />, errorElement: <RouteError />, children: appRoutes }])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
