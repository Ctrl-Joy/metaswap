import { AlertTriangle, ServerCrash } from 'lucide-react'
import { Button } from '@/components/ui'
import { useDevnetReachable, useSwitchToDevnet, useWallet } from '@/wallet/hooks'
import { RPC_URL, DEVNET_CHAIN_ID } from '@/config'

/** Wrong-network and devnet-down banners under the header (flows.md §2). */
export function StatusBanners() {
  const { wrongNetwork, chainId } = useWallet()
  const { switchToDevnet, pending } = useSwitchToDevnet()
  const { reachable, checked } = useDevnetReachable()
  return (
    <>
      {wrongNetwork && (
        <div role="alert" data-testid="wrong-network-banner" className="mx-auto mt-1 flex w-[calc(100%-32px)] max-w-[960px] flex-wrap items-center gap-3 rounded-2xl bg-warning-tint px-4 py-3 text-body-3">
          <AlertTriangle size={18} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            Your wallet is on chain {chainId}. MetaSwap runs on <strong>MetaChain Devnet</strong> (chain {DEVNET_CHAIN_ID}).
          </span>
          <Button size="sm" variant="warning" onClick={switchToDevnet} loading={pending} data-testid="switch-network">
            Switch to MetaChain Devnet
          </Button>
        </div>
      )}
      {checked && !reachable && (
        <div role="status" data-testid="devnet-down-banner" className="mx-auto mt-1 flex w-[calc(100%-32px)] max-w-[960px] items-center gap-3 rounded-2xl bg-critical-tint px-4 py-3 text-body-3">
          <ServerCrash size={18} className="shrink-0 text-critical" />
          <span>
            MetaChain Devnet is not reachable at <span className="font-mono">{RPC_URL}</span>. Start it with <span className="font-mono">npm run dev</span> from the repo root.
          </span>
        </div>
      )}
    </>
  )
}
