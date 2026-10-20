import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Address } from 'viem'
import { NATIVE_ETH, type Token } from '@metaswap/sdk'
import type { EarnVault } from '@/api/types'
import { erc20Abi, savingsVaultAbi } from '@/lib/abis'
import { useTokenList } from '@/features/tokens/useTokenList'

export interface VaultChainState {
  shares: bigint
  assets: bigint
  maxWithdraw: bigint
  assetBalance: bigint
  ethBalance: bigint
  allowance: bigint
  totalAssets: bigint
  fetchedAt: number
}

/** On-chain reads for one vault and account (shares, assets, max withdraw, wallet balances, allowance). */
export function useVaultChain(vault: Address | undefined, asset: Address | undefined, account: Address | undefined) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['vault', vault, account],
    enabled: !!client && !!vault && !!asset,
    refetchInterval: 8_000,
    queryFn: async (): Promise<VaultChainState> => {
      const c = client!
      const v = vault!
      const totalAssets = await c.readContract({ address: v, abi: savingsVaultAbi, functionName: 'totalAssets' })
      if (!account) return { shares: 0n, assets: 0n, maxWithdraw: 0n, assetBalance: 0n, ethBalance: 0n, allowance: 0n, totalAssets, fetchedAt: Date.now() }
      const [shares, maxWithdraw, assetBalance, ethBalance, allowance] = await Promise.all([
        c.readContract({ address: v, abi: savingsVaultAbi, functionName: 'balanceOf', args: [account] }),
        c.readContract({ address: v, abi: savingsVaultAbi, functionName: 'maxWithdraw', args: [account] }),
        c.readContract({ address: asset!, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
        c.getBalance({ address: account }),
        c.readContract({ address: asset!, abi: erc20Abi, functionName: 'allowance', args: [account, v] }),
      ])
      const assets = shares > 0n ? await c.readContract({ address: v, abi: savingsVaultAbi, functionName: 'convertToAssets', args: [shares] }) : 0n
      return { shares, assets, maxWithdraw, assetBalance, ethBalance, allowance, totalAssets, fetchedAt: Date.now() }
    },
  })
}

/**
 * Live accrual: the vault index grows continuously at the APY, so between reads we extrapolate
 * assets × (1 + apy)^(Δt / year) every 100ms. Each fresh on-chain read re-anchors it.
 */
export function useLiveAssets(assets: bigint | undefined, apyPct: number | undefined, anchorMs: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!assets || !apyPct) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [assets, apyPct])
  if (assets === undefined || anchorMs === undefined) return undefined
  const base = Number(assets)
  if (!apyPct) return base
  const dt = Math.max(0, now - anchorMs) / 1000
  return base * Math.pow(1 + apyPct / 100, dt / (365 * 86_400))
}

/** Is this the WETH vault (native ETH helpers available)? */
export function isEthVault(v: Pick<EarnVault, 'asset'> | undefined): boolean {
  return !!v && v.asset.symbol === 'WETH'
}

/** Token for the vault's asset, displayed as ETH for the WETH vault. */
export function useVaultAssetToken(v: EarnVault | undefined): { asset: Token | undefined; display: Token | undefined } {
  const { find } = useTokenList()
  if (!v) return { asset: undefined, display: undefined }
  const asset = find(v.asset.address) ?? { chainId: 31337, address: v.asset.address, symbol: v.asset.symbol, name: v.asset.name, decimals: v.asset.decimals, logoURI: `/tokens/${v.asset.symbol}.svg` }
  return { asset, display: isEthVault(v) ? NATIVE_ETH : asset }
}
