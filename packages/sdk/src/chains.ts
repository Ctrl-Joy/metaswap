import { defineChain } from 'viem'

export const DEVNET_RPC_URL = 'http://127.0.0.1:8545'

/** Local Anvil chain, branded as the MetaChain developer network. */
export const metachainDevnet = defineChain({
  id: 31337,
  name: 'MetaChain Devnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEVNET_RPC_URL] } },
  blockExplorers: undefined,
  contracts: {},
  testnet: true,
})

export type ChainStatus = 'live' | 'planned'

export interface MetaChainNetwork {
  key: 'devnet' | 'testnet' | 'mainnet'
  name: string
  chainId: number | null
  status: ChainStatus
  rpcUrl: string | null
  blockTimeMs: number
  description: string
}

/** The MetaChain ecosystem. Only the devnet exists today; the others are roadmap items. */
export const METACHAIN_NETWORKS: MetaChainNetwork[] = [
  {
    key: 'devnet',
    name: 'MetaChain Devnet',
    chainId: metachainDevnet.id,
    status: 'live',
    rpcUrl: DEVNET_RPC_URL,
    blockTimeMs: 1000,
    description: 'Local developer network (Anvil) with the full MetaSwap and MetaSwapX contract suite deployed.',
  },
  {
    key: 'testnet',
    name: 'MetaChain Testnet',
    chainId: null,
    status: 'planned',
    rpcUrl: null,
    blockTimeMs: 1000,
    description: 'Public OP Stack test network with 1s blocks and sub-second preconfirmations.',
  },
  {
    key: 'mainnet',
    name: 'MetaChain',
    chainId: null,
    status: 'planned',
    rpcUrl: null,
    blockTimeMs: 1000,
    description: 'DeFi-native Ethereum L2 for MetaSwap liquidity with verifiable block building.',
  },
]

export const SUPPORTED_CHAIN_IDS = [metachainDevnet.id] as const
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number]

/** Path segment used in explore URLs, e.g. /explore/tokens/metachain-devnet/0x… */
export const CHAIN_SLUGS: Record<SupportedChainId, string> = { 31337: 'metachain-devnet' }
export function chainIdFromSlug(slug: string): SupportedChainId | undefined {
  const hit = Object.entries(CHAIN_SLUGS).find(([, s]) => s === slug)
  return hit ? (Number(hit[0]) as SupportedChainId) : undefined
}
