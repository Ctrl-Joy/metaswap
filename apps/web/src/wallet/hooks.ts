import { useAccount, useBlockNumber, useSwitchChain } from 'wagmi'
import { numberToHex } from 'viem'
import { useCallback, useState } from 'react'
import { DEVNET_CHAIN_ID, RPC_URL } from '@/config'
import { parseTxError } from '@/lib/errors'
import { toast } from '@/state/toasts'

export interface WalletStatus {
  address: `0x${string}` | undefined
  isConnected: boolean
  isConnecting: boolean
  chainId: number | undefined
  wrongNetwork: boolean
  connectorName: string | undefined
  connectorId: string | undefined
}

export function useWallet(): WalletStatus {
  const { address, isConnected, isConnecting, isReconnecting, chainId, connector } = useAccount()
  return {
    address: isConnected ? address : undefined,
    isConnected,
    isConnecting: isConnecting || isReconnecting,
    chainId,
    wrongNetwork: isConnected && chainId !== undefined && chainId !== DEVNET_CHAIN_ID,
    connectorName: connector?.name,
    connectorId: connector?.id,
  }
}

/** wallet_addEthereumChain payload for MetaChain Devnet (flows.md §2). */
export const ADD_DEVNET_PARAMS = {
  chainId: numberToHex(DEVNET_CHAIN_ID),
  chainName: 'MetaChain Devnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [RPC_URL],
  blockExplorerUrls: null,
} as const

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }

/** Add MetaChain Devnet to an injected wallet (works without connecting first). */
export async function addDevnetToWallet(provider?: Eip1193): Promise<boolean> {
  const p = provider ?? ((globalThis as unknown as { ethereum?: Eip1193 }).ethereum)
  if (!p) {
    toast.error('No browser wallet found', 'Install a wallet extension, or use the Dev wallet on this devnet.')
    return false
  }
  try {
    await p.request({ method: 'wallet_addEthereumChain', params: [ADD_DEVNET_PARAMS] })
    toast.success('MetaChain Devnet added', 'Your wallet can now switch to chain 31337.')
    return true
  } catch (e) {
    const err = parseTxError(e)
    if (err.kind !== 'rejected') toast.error('Could not add network', err.message)
    return false
  }
}

/** Switch to the devnet; falls back to wallet_addEthereumChain on error 4902. */
export function useSwitchToDevnet() {
  const { switchChainAsync } = useSwitchChain()
  const { connector } = useAccount()
  const [pending, setPending] = useState(false)
  const run = useCallback(async () => {
    setPending(true)
    try {
      await switchChainAsync({ chainId: DEVNET_CHAIN_ID })
    } catch (e) {
      const code = (e as { code?: number; cause?: { code?: number } }).code ?? (e as { cause?: { code?: number } }).cause?.code
      if (code === 4902 || /unrecognized chain|not been added|unknown chain/i.test(String((e as Error).message))) {
        const provider = (await connector?.getProvider?.()) as Eip1193 | undefined
        await addDevnetToWallet(provider)
      } else {
        const err = parseTxError(e)
        if (err.kind !== 'rejected') toast.error('Could not switch network', err.message)
      }
    } finally {
      setPending(false)
    }
  }, [switchChainAsync, connector])
  return { switchToDevnet: run, pending }
}

/** True when the devnet RPC answers (block number polling). */
export function useDevnetReachable(): { reachable: boolean; checked: boolean; blockNumber?: bigint } {
  const q = useBlockNumber({ chainId: DEVNET_CHAIN_ID, query: { retry: 1, refetchInterval: 5_000 } })
  return { reachable: q.isSuccess && !q.isError, checked: !q.isLoading, blockNumber: q.data }
}
