// On-chain reads for positions (pool state, pair reserves, NFT positions, allowances).
// Query keys start with 'readContracts' so trackTx's invalidateChainQueries() refreshes them.
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { erc20Abi, zeroAddress, type Address } from 'viem'
import { contractAddress, FEE_TIER_LIST, type Token } from './tokens'
import { nonfungiblePositionManagerAbi, v2FactoryAbi, v2PairAbi, v3FactoryAbi, v3PoolAbi } from '@metaswap/sdk/abis'
import { MAX_UINT128 } from './math'
import { liveInterval } from '@/api/realtime'

export interface V3PoolState {
  fee: number
  address: Address | null
  /** Pool exists and is initialized (sqrtPrice > 0). */
  initialized: boolean
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
}

/** All four fee-tier pools for a (pool-ordered) pair. */
export function useV3Pools(token0: Address | undefined, token1: Address | undefined) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['readContracts', 'lp', 'v3pools', token0, token1],
    enabled: !!client && !!token0 && !!token1 && token0.toLowerCase() !== token1.toLowerCase(),
    refetchInterval: liveInterval(6_000),
    queryFn: async (): Promise<Record<number, V3PoolState>> => {
      const factory = contractAddress('V3Factory')
      const out: Record<number, V3PoolState> = {}
      await Promise.all(
        FEE_TIER_LIST.map(async ({ fee }) => {
          const address = await client!.readContract({ address: factory, abi: v3FactoryAbi, functionName: 'getPool', args: [token0!, token1!, fee] })
          if (address === zeroAddress) {
            out[fee] = { fee, address: null, initialized: false, sqrtPriceX96: 0n, tick: 0, liquidity: 0n }
            return
          }
          const [slot0, liquidity] = await Promise.all([
            client!.readContract({ address, abi: v3PoolAbi, functionName: 'slot0' }),
            client!.readContract({ address, abi: v3PoolAbi, functionName: 'liquidity' }),
          ])
          const sqrtPriceX96 = slot0[0]
          out[fee] = { fee, address, initialized: sqrtPriceX96 > 0n, sqrtPriceX96, tick: Number(slot0[1]), liquidity }
        }),
      )
      return out
    },
  })
}

export interface V2PairState {
  address: Address | null
  token0: Address
  token1: Address
  reserve0: bigint
  reserve1: bigint
  totalSupply: bigint
  /** LP balance of the account (0 when disconnected). */
  balance: bigint
}

export function useV2Pair(tokenA: Address | undefined, tokenB: Address | undefined, account: Address | undefined) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['readContracts', 'lp', 'v2pair', tokenA, tokenB, account],
    enabled: !!client && !!tokenA && !!tokenB && tokenA.toLowerCase() !== tokenB.toLowerCase(),
    refetchInterval: liveInterval(6_000),
    queryFn: async (): Promise<V2PairState> => {
      const [t0, t1] = tokenA!.toLowerCase() < tokenB!.toLowerCase() ? [tokenA!, tokenB!] : [tokenB!, tokenA!]
      const address = await client!.readContract({ address: contractAddress('V2Factory'), abi: v2FactoryAbi, functionName: 'getPair', args: [t0, t1] })
      if (address === zeroAddress) return { address: null, token0: t0, token1: t1, reserve0: 0n, reserve1: 0n, totalSupply: 0n, balance: 0n }
      return readPair(client!, address, account)
    },
  })
}

type Client = NonNullable<ReturnType<typeof usePublicClient>>

async function readPair(client: Client, address: Address, account: Address | undefined): Promise<V2PairState> {
  const [token0, token1, reserves, totalSupply, balance] = await Promise.all([
    client.readContract({ address, abi: v2PairAbi, functionName: 'token0' }),
    client.readContract({ address, abi: v2PairAbi, functionName: 'token1' }),
    client.readContract({ address, abi: v2PairAbi, functionName: 'getReserves' }),
    client.readContract({ address, abi: v2PairAbi, functionName: 'totalSupply' }),
    account ? client.readContract({ address, abi: v2PairAbi, functionName: 'balanceOf', args: [account] }) : Promise.resolve(0n),
  ])
  return { address, token0, token1, reserve0: reserves[0], reserve1: reserves[1], totalSupply, balance }
}

/** Pair by address (V2 position detail). */
export function useV2PairByAddress(pair: Address | undefined, account: Address | undefined) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['readContracts', 'lp', 'v2pairAddr', pair, account],
    enabled: !!client && !!pair,
    refetchInterval: liveInterval(6_000),
    queryFn: () => readPair(client!, pair!, account),
  })
}

export interface V3PositionState {
  tokenId: bigint
  owner: Address
  token0: Address
  token1: Address
  fee: number
  tickLower: number
  tickUpper: number
  liquidity: bigint
  pool: Address
  sqrtPriceX96: bigint
  tick: number
  /** Uncollected fees incl. tokensOwed (static-called collect). */
  fees0: bigint
  fees1: bigint
  tokenURI: string | null
}

export function useV3Position(tokenId: bigint | undefined) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['readContracts', 'lp', 'v3position', tokenId?.toString()],
    enabled: !!client && tokenId !== undefined,
    refetchInterval: liveInterval(6_000),
    retry: 0,
    queryFn: async (): Promise<V3PositionState | null> => {
      const npm = contractAddress('NonfungiblePositionManager')
      let owner: Address
      try {
        owner = await client!.readContract({ address: npm, abi: nonfungiblePositionManagerAbi, functionName: 'ownerOf', args: [tokenId!] })
      } catch {
        return null // burned or never minted
      }
      const p = await client!.readContract({ address: npm, abi: nonfungiblePositionManagerAbi, functionName: 'positions', args: [tokenId!] })
      const [, , token0, token1, fee, tickLower, tickUpper, liquidity, , , owed0, owed1] = p
      const pool = await client!.readContract({ address: contractAddress('V3Factory'), abi: v3FactoryAbi, functionName: 'getPool', args: [token0, token1, fee] })
      const [slot0, fees, tokenURI] = await Promise.all([
        client!.readContract({ address: pool, abi: v3PoolAbi, functionName: 'slot0' }),
        client!
          .simulateContract({
            address: npm,
            abi: nonfungiblePositionManagerAbi,
            functionName: 'collect',
            args: [{ tokenId: tokenId!, recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
            account: owner,
          })
          .then((r) => r.result as readonly [bigint, bigint])
          .catch(() => [owed0, owed1] as const),
        client!.readContract({ address: npm, abi: nonfungiblePositionManagerAbi, functionName: 'tokenURI', args: [tokenId!] }).catch(() => null),
      ])
      return {
        tokenId: tokenId!,
        owner,
        token0,
        token1,
        fee: Number(fee),
        tickLower: Number(tickLower),
        tickUpper: Number(tickUpper),
        liquidity,
        pool,
        sqrtPriceX96: slot0[0],
        tick: Number(slot0[1]),
        fees0: fees[0],
        fees1: fees[1],
        tokenURI,
      }
    },
  })
}

/** ERC20 allowance(owner, spender); native → max. */
export function useAllowance(token: Token | undefined, owner: Address | undefined, spender: Address | undefined) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['readContracts', 'lp', 'allowance', token?.address, owner, spender],
    enabled: !!client && !!token && !!owner && !!spender,
    queryFn: async () => (token!.isNative ? 2n ** 256n - 1n : client!.readContract({ address: token!.address, abi: erc20Abi, functionName: 'allowance', args: [owner!, spender!] })),
  })
}

/** Decode an on-chain `data:application/json;base64,…` tokenURI to its image URL. */
export function tokenUriImage(uri: string | null | undefined): string | null {
  if (!uri) return null
  try {
    let json: string
    if (uri.startsWith('data:application/json;base64,')) json = atob(uri.slice('data:application/json;base64,'.length))
    else if (uri.startsWith('data:application/json,')) json = decodeURIComponent(uri.slice('data:application/json,'.length))
    else return null
    const meta = JSON.parse(json) as { image?: string }
    return meta.image ?? null
  } catch {
    return null
  }
}
