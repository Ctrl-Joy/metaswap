import { lazy } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'
import { exploreRoutes } from '@/pages/explore/routes'
import { positionsRoutes } from '@/pages/positions/routes'
import { launchesRoutes } from '@/pages/launches/routes'
import { portfolioRoutes } from '@/pages/portfolio/routes'
import { earnRoutes } from '@/pages/earn/routes'
import SwapPage from '@/pages/SwapPage'

// Route table (PLAN.md "Web app — routes"). Explore and positions subtrees are owned by feature areas
// and defined in their own folders (src/pages/explore/routes.tsx, src/pages/positions/routes.tsx);
// launches (the positions/launches area) in src/pages/launches/routes.tsx. Portfolio and Earn (the web shell) also live in sub-folders.
const LimitPage = lazy(() => import('@/pages/LimitPage'))
const SendPage = lazy(() => import('@/pages/SendPage'))
const BuyPage = lazy(() => import('@/pages/BuyPage'))
const MetaSwapXPage = lazy(() => import('@/pages/MetaSwapXPage'))
const MetaChainPage = lazy(() => import('@/pages/MetaChainPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

/** Routes rendered without the footer (trade pages keep the swap card alone, ui-ux.md §1.7). */
export const FOOTERLESS = ['/swap', '/limit', '/send', '/buy']

export const appRoutes: RouteObject[] = [
  { path: '/', element: <Navigate to="/swap" replace /> },
  { path: '/swap', element: <SwapPage /> },
  { path: '/limit', element: <LimitPage /> },
  { path: '/send', element: <SendPage /> },
  { path: '/buy', element: <BuyPage /> },
  ...exploreRoutes,
  ...positionsRoutes,
  ...launchesRoutes,
  ...portfolioRoutes,
  ...earnRoutes,
  { path: '/metaswapx', element: <MetaSwapXPage /> },
  { path: '/metachain', element: <MetaChainPage /> },
  { path: '*', element: <NotFoundPage /> },
]
