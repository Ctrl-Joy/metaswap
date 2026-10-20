import { Suspense, useEffect, type ReactNode } from 'react'
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { queryClient } from '@/api/queryClient'
import { wagmiConfig } from '@/wallet/wagmi'
import { ConnectModal } from '@/wallet/ConnectModal'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { StatusBanners } from '@/components/layout/StatusBanners'
import { Toaster } from '@/components/layout/Toaster'
import { TooltipProvider, Spinner } from '@/components/ui'
import { AccountDrawer } from '@/features/account/AccountDrawer'
import { useSettings } from '@/state/settings'
import { useTxStore, watchTx } from '@/state/transactions'
import { FOOTERLESS } from './routes'

function ThemeSync() {
  const theme = useSettings((s) => s.theme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0c10' : '#f5f6fa')
  }, [theme])
  return null
}

/** Resume watching transactions that were still pending when the page was closed. */
function TxResumer() {
  useEffect(() => {
    const { byAccount } = useTxStore.getState()
    for (const [account, txs] of Object.entries(byAccount)) for (const tx of txs) if (tx.status === 'pending') void watchTx(account, tx, { toast: false })
  }, [])
  return null
}

function PageFallback() {
  return (
    <div className="flex justify-center pt-32 text-text-3">
      <Spinner size={28} label="Loading page" />
    </div>
  )
}

export function Shell() {
  const { pathname } = useLocation()
  const showFooter = !FOOTERLESS.includes(pathname)
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[2000] focus:rounded-lg focus:bg-surface-1 focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Header />
      <StatusBanners />
      <main id="main" className="flex-1">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      {showFooter && <Footer />}
      <ConnectModal />
      <AccountDrawer />
      <Toaster />
      <ScrollRestoration />
    </div>
  )
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ThemeSync />
          <TxResumer />
          {children}
        </TooltipProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
