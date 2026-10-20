import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'

const EarnPage = lazy(() => import('./EarnPage'))
const VaultPage = lazy(() => import('./VaultPage'))

export const earnRoutes: RouteObject[] = [
  { path: '/earn', element: <EarnPage /> },
  { path: '/earn/:vault', element: <VaultPage /> },
]
