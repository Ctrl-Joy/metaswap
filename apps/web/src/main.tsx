import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Providers, Shell } from './App'
import { appRoutes } from './routes'
import './styles/index.css'

const router = createBrowserRouter([{ element: <Shell />, children: appRoutes }])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
