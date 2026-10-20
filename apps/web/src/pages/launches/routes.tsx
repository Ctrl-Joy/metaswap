import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'

// Owned by the positions/launches area (launches: list, create, auction). Mounted by src/routes.tsx (the web shell).
const LaunchesPage = lazy(() => import('./LaunchesPage'))
const CreateLaunchPage = lazy(() => import('./CreateLaunchPage'))
const AuctionPage = lazy(() => import('./AuctionPage'))

export const launchesRoutes: RouteObject[] = [
  { path: '/launches', element: <LaunchesPage /> },
  { path: '/launches/create', element: <CreateLaunchPage /> },
  { path: '/launches/:auction', element: <AuctionPage /> },
]
