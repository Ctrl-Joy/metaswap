import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'

// Owned by the explore area (explore + token/pool detail + charts). The root router mounts these as-is,
// so the explore area can add/replace routes here without touching src/routes.tsx.
const ExplorePage = lazy(() => import('./ExplorePage'))
const TokenDetailPage = lazy(() => import('./TokenDetailPage'))
const PoolDetailPage = lazy(() => import('./PoolDetailPage'))

export const exploreRoutes: RouteObject[] = [
  { path: '/explore', element: <ExplorePage /> },
  { path: '/explore/tokens', element: <ExplorePage tab="tokens" /> },
  { path: '/explore/pools', element: <ExplorePage tab="pools" /> },
  { path: '/explore/transactions', element: <ExplorePage tab="transactions" /> },
  { path: '/explore/tokens/:chain/:address', element: <TokenDetailPage /> },
  { path: '/explore/pools/:chain/:address', element: <PoolDetailPage /> },
]
