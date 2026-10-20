import { createConfig, createStorage, http, type CreateConnectorFn } from 'wagmi'
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors'
import { deployment, metachainDevnet } from '@metaswap/sdk'
import { RPC_URL, WALLETCONNECT_PROJECT_ID } from '@/config'
import { safeStorage } from '@/lib/storage'
import { devWallet, DEV_WALLET_COUNT } from './devWallet'
import { localAccountConnector } from './localAccount'

const multicall3 = deployment.contracts?.Multicall3

/** MetaChain Devnet with the deployed Multicall3 attached (enables batched reads). */
export const devnet = {
  ...metachainDevnet,
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: multicall3 ? { multicall3: { address: multicall3 } } : {},
} as typeof metachainDevnet

const connectors: CreateConnectorFn[] = []
// The generic injected connector is a fallback for wallets that don't announce via EIP-6963;
// EIP-6963 wallets are discovered automatically (multiInjectedProviderDiscovery).
connectors.push(injected({ shimDisconnect: true }))
if (WALLETCONNECT_PROJECT_ID) {
  connectors.push(
    walletConnect({
      projectId: WALLETCONNECT_PROJECT_ID,
      showQrModal: true,
      metadata: { name: 'MetaSwap', description: 'MetaSwap on MetaChain Devnet', url: globalThis.location?.origin ?? '', icons: [] },
    }),
  )
}
connectors.push(coinbaseWallet({ appName: 'MetaSwap', preference: { options: 'all' } }))
// Dev wallets only make sense on the local Anvil chain.
if (devnet.id === 31337) {
  for (let i = 0; i < DEV_WALLET_COUNT; i++) connectors.push(devWallet(i))
  // "Create account": devnet-only key kept in this browser.
  connectors.push(localAccountConnector())
}

export const wagmiConfig = createConfig({
  chains: [devnet],
  connectors,
  multiInjectedProviderDiscovery: true,
  storage: createStorage({ storage: safeStorage, key: 'metaswap.wagmi' }),
  transports: { [devnet.id]: http(RPC_URL, { batch: { wait: 16 } }) },
  pollingInterval: 1_000,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
