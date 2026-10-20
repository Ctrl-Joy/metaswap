import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { erc20Abi, zeroAddress, type Address } from 'viem'
import { launchAuctionAbi } from './abi'
import { STATUS_BY_INDEX, type LaunchStatus } from './types'

export interface AuctionBid {
  id: bigint
  bidder: Address
  amount: bigint
  maxPrice: bigint
  native: boolean
  claimed: boolean
  /** previewClaim(): tokens and refund at the current (or final) clearing price. */
  previewTokens?: bigint
  previewRefund?: bigint
}

export interface AuctionState {
  auction: Address
  status: LaunchStatus
  name: string
  symbol: string
  totalSupply: bigint
  auctionSupply: bigint
  auctionSupplyBps: bigint
  quoteToken: Address
  quoteSymbol: string
  quoteDecimals: number
  floorPrice: bigint
  tickSize: bigint
  startTime: number
  endTime: number
  launchThreshold: bigint
  liquidityBps: bigint
  poolFee: number
  description: string
  website: string
  clearingPrice: bigint
  raised: bigint
  totalBids: bigint
  thresholdProgressBps: number
  levels: Array<{ price: bigint; demand: bigint }>
  token: Address
  pool: Address | null
  myBids: AuctionBid[]
  /** Account's launch-token balance (after claims). */
  myTokenBalance: bigint
  blockTime: number
}

/** Everything the auction page needs, straight from chain (refreshes every 3s and after txs). */
export function useAuctionState(auction: Address | undefined, account: Address | undefined) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['readContracts', 'lp', 'auction', auction, account],
    enabled: !!client && !!auction,
    refetchInterval: 3_000,
    retry: 0,
    queryFn: async (): Promise<AuctionState> => {
      const c = client!
      const a = auction!
      const read = <T,>(functionName: string, args: readonly unknown[] = []) =>
        c.readContract({ address: a, abi: launchAuctionAbi, functionName, args } as Parameters<typeof c.readContract>[0]) as Promise<T>
      const [status, params, clearing, raised, totalBids, progress, levels, token, pool, block] = await Promise.all([
        read<number>('status'),
        read<{
          name: string
          symbol: string
          totalSupply: bigint
          auctionSupplyBps: bigint
          quoteToken: Address
          floorPrice: bigint
          tickSize: bigint
          startTime: bigint
          endTime: bigint
          launchThreshold: bigint
          liquidityBps: bigint
          poolFee: number
          description: string
          website: string
        }>('params'),
        read<bigint>('clearingPrice'),
        read<bigint>('raised'),
        read<bigint>('totalBids'),
        read<bigint>('thresholdProgressBps'),
        read<readonly [readonly bigint[], readonly bigint[]]>('priceLevels'),
        read<Address>('token'),
        read<Address>('pool').catch(() => zeroAddress),
        c.getBlock(),
      ])
      const [quoteSymbol, quoteDecimals, myBids, myTokenBalance] = await Promise.all([
        c.readContract({ address: params.quoteToken, abi: erc20Abi, functionName: 'symbol' }),
        c.readContract({ address: params.quoteToken, abi: erc20Abi, functionName: 'decimals' }),
        account ? read<readonly AuctionBid[]>('bidsOf', [account]) : Promise.resolve([] as AuctionBid[]),
        account ? c.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account] }) : Promise.resolve(0n),
      ])
      const previews = await Promise.all(
        myBids.map((b) => read<readonly [bigint, bigint]>('previewClaim', [b.id]).catch(() => null)),
      )
      const bidsWithPreview: AuctionBid[] = myBids.map((b, i) => ({ ...b, previewTokens: previews[i]?.[0], previewRefund: previews[i]?.[1] }))
      return {
        auction: a,
        status: STATUS_BY_INDEX[Number(status)] ?? 'upcoming',
        name: params.name,
        symbol: params.symbol,
        totalSupply: params.totalSupply,
        auctionSupplyBps: params.auctionSupplyBps,
        auctionSupply: (params.totalSupply * params.auctionSupplyBps) / 10_000n,
        quoteToken: params.quoteToken,
        quoteSymbol,
        quoteDecimals,
        floorPrice: params.floorPrice,
        tickSize: params.tickSize,
        startTime: Number(params.startTime),
        endTime: Number(params.endTime),
        launchThreshold: params.launchThreshold,
        liquidityBps: params.liquidityBps,
        poolFee: Number(params.poolFee),
        description: params.description,
        website: params.website,
        clearingPrice: clearing,
        raised,
        totalBids,
        thresholdProgressBps: Number(progress),
        levels: levels[0].map((p, i) => ({ price: p, demand: levels[1][i] ?? 0n })),
        token,
        pool: pool === zeroAddress ? null : pool,
        myBids: bidsWithPreview,
        myTokenBalance,
        blockTime: Number(block.timestamp),
      }
    },
  })
}
