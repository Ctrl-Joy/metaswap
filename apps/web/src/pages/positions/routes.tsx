import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'

// Owned by the positions/launches area (positions: create/add/remove/collect, v2 + v3). Mounted by src/routes.tsx.
const PositionsPage = lazy(() => import('./PositionsPage'))
const CreatePositionPage = lazy(() => import('./CreatePositionPage'))
const PositionDetailPage = lazy(() => import('./PositionDetailPage'))

export const positionsRoutes: RouteObject[] = [
  { path: '/positions', element: <PositionsPage /> },
  { path: '/positions/create', element: <CreatePositionPage /> },
  { path: '/positions/v2/:pair', element: <PositionDetailPage version="v2" /> },
  { path: '/positions/v3/:tokenId', element: <PositionDetailPage version="v3" /> },
]
