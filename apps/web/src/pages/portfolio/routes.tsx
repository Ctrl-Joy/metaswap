import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'

const PortfolioLayout = lazy(() => import('./PortfolioLayout'))
const OverviewPage = lazy(() => import('./OverviewPage'))
const TokensPage = lazy(() => import('./SubPages').then((m) => ({ default: m.TokensPage })))
const NftsPage = lazy(() => import('./SubPages').then((m) => ({ default: m.NftsPage })))
const ActivityPage = lazy(() => import('./SubPages').then((m) => ({ default: m.ActivityPage })))

/** /portfolio with sub-route tabs (STAGE5 §4d). */
export const portfolioRoutes: RouteObject[] = [
  {
    path: '/portfolio',
    element: <PortfolioLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'tokens', element: <TokensPage /> },
      { path: 'nfts', element: <NftsPage /> },
      { path: 'activity', element: <ActivityPage /> },
    ],
  },
]
