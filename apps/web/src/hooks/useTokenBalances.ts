import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Address } from 'viem'
import { erc20Abi } from '@/lib/abis'
import type { Token } from '@metaswap/sdk'
import { liveInterval } from '@/api/realtime'

export type Balances = Record<string, bigint>

/**
 * Balances for a set of tokens (native ETH via eth_getBalance, ERC20s via Multicall3 when
 * deployed, else individual eth_calls). Keyed by lower-cased token address.
 * Query key ['balances', account, ...] — invalidated automatically after every tracked tx.
 */
export function useTokenBalances(tokens: readonly Token[], account: Address | undefined) {
  const client = usePublicClient()
  const key = useMemo(() => tokens.map((t) => t.address.toLowerCase()).sort().join(','), [tokens])
  const q = useQuery({
    queryKey: ['balances', account, key],
    enabled: !!account && !!client && tokens.length > 0,
    refetchInterval: liveInterval(4_000),
    queryFn: async (): Promise<Balances> => {
      if (!client || !account) return {}
      const out: Balances = {}
      const native = tokens.filter((t) => t.isNative)
      const erc20 = tokens.filter((t) => !t.isNative)
      const tasks: Promise<void>[] = []
      if (native.length)
        tasks.push(
          client.getBalance({ address: account }).then((b) => {
            for (const t of native) out[t.address.toLowerCase()] = b
          }),
        )
      if (erc20.length) {
        const contracts = erc20.map((t) => ({ address: t.address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [account] as const }))
        tasks.push(
          (async () => {
            let results: Array<bigint | undefined>
            if ((client.chain?.contracts as { multicall3?: unknown } | undefined)?.multicall3) {
              const r = await client.multicall({ contracts, allowFailure: true })
              results = r.map((x) => (x.status === 'success' ? (x.result as bigint) : undefined))
            } else {
              results = await Promise.all(contracts.map((c) => client.readContract(c).catch(() => undefined)))
            }
            erc20.forEach((t, i) => {
              const v = results[i]
              if (v !== undefined) out[t.address.toLowerCase()] = v
            })
          })(),
        )
      }
      await Promise.all(tasks)
      return out
    },
  })
  return { balances: q.data ?? {}, isLoading: q.isLoading && !!account, refetch: q.refetch, isError: q.isError }
}

/** Balance of a single token (undefined while loading / disconnected). */
export function useTokenBalance(token: Token | undefined, account: Address | undefined): bigint | undefined {
  const tokens = useMemo(() => (token ? [token] : []), [token])
  const { balances } = useTokenBalances(tokens, account)
  return token ? balances[token.address.toLowerCase()] : undefined
}
