// Launch contract addresses + calldata builders (pure, unit tested).
import { encodeFunctionData, parseEventLogs, type Address, type Hex, type TransactionReceipt } from 'viem'
import { deployment } from '@metaswap/sdk'
import { launchAuctionAbi, launchpadAbi } from './abi'

export interface LaunchpadInfo {
  key: string
  name: string
  address: Address
}

/** Launchpads from deployments/31337.json (`contracts.Launchpad`, `contracts.DevnetPad`). */
export function launchpads(): LaunchpadInfo[] {
  const c = deployment.contracts as unknown as Record<string, Address | undefined>
  const out: LaunchpadInfo[] = []
  if (c.Launchpad) out.push({ key: 'Launchpad', name: 'MetaSwap Launchpad', address: c.Launchpad })
  if (c.DevnetPad) out.push({ key: 'DevnetPad', name: 'Devnet Pad', address: c.DevnetPad })
  // dev override for testing against a private chain: VITE_LAUNCHPADS="Name=0x…,Other=0x…"
  const extra = (import.meta.env?.VITE_LAUNCHPADS as string | undefined) ?? ''
  for (const part of extra.split(',').filter(Boolean)) {
    const [name, address] = part.split('=')
    if (name && address && /^0x[0-9a-fA-F]{40}$/.test(address)) out.push({ key: 'Launchpad', name, address: address as Address })
  }
  return out
}

export interface LaunchParamsInput {
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
}

export function buildCreateLaunch(launchpad: Address, p: LaunchParamsInput): { to: Address; data: Hex; value: bigint } {
  return { to: launchpad, data: encodeFunctionData({ abi: launchpadAbi, functionName: 'createLaunch', args: [p] }), value: 0n }
}

export function buildBid(auction: Address, amount: bigint, maxPrice: bigint, native: boolean): { to: Address; data: Hex; value: bigint } {
  return native
    ? { to: auction, data: encodeFunctionData({ abi: launchAuctionAbi, functionName: 'bidETH', args: [maxPrice] }), value: amount }
    : { to: auction, data: encodeFunctionData({ abi: launchAuctionAbi, functionName: 'bid', args: [amount, maxPrice] }), value: 0n }
}

export function buildSettle(auction: Address) {
  return { to: auction, data: encodeFunctionData({ abi: launchAuctionAbi, functionName: 'settle' }), value: 0n }
}

export function buildClaimAll(auction: Address) {
  return { to: auction, data: encodeFunctionData({ abi: launchAuctionAbi, functionName: 'claimAll' }), value: 0n }
}

/** Auction + token addresses from a createLaunch receipt. */
export function createdLaunch(receipt: TransactionReceipt | null | undefined): { token: Address; auction: Address } | null {
  if (!receipt) return null
  const logs = parseEventLogs({ abi: launchpadAbi, logs: receipt.logs, eventName: 'LaunchCreated', strict: false })
  const l = logs[0]
  if (!l?.args.auction || !l.args.token) return null
  return { token: l.args.token, auction: l.args.auction }
}

const INVALID_PARAMS: Record<number, string> = {
  1: 'Name and symbol are required.',
  2: 'Total supply must be between 1 and 1e18 whole tokens.',
  3: 'The auction share must be between 0.01% and 99.99%.',
  4: 'The liquidity share must be between 0.01% and 100%.',
  5: 'The quote token is not a deployed ERC20.',
  6: 'Floor price and tick size must be above zero.',
  7: 'The auction must end after it starts, and in the future.',
  8: 'That V3 fee tier is not enabled.',
}

/** Friendly message for MetaSwapLaunchpad.InvalidParams(code) (and other launch reverts), else null. */
export function launchRevertMessage(err: unknown): string | null {
  let e: unknown = err
  for (let i = 0; i < 6 && e; i++) {
    const x = e as { data?: { errorName?: string; args?: readonly unknown[] }; cause?: unknown }
    if (x.data?.errorName === 'InvalidParams') return INVALID_PARAMS[Number(x.data.args?.[0])] ?? 'The launch parameters are invalid.'
    if (x.data?.errorName) {
      const n = x.data.errorName
      if (n === 'AuctionNotActive') return 'The auction is not accepting bids right now.'
      if (n === 'InvalidPrice') return 'The max price must be at least the floor and a multiple of the tick size.'
      if (n === 'TooManyPriceLevels') return 'This auction already has 256 price levels; bid at an existing price.'
      if (n === 'AuctionNotEnded') return 'The auction has not ended yet.'
      if (n === 'AlreadySettled') return 'The auction is already settled.'
      if (n === 'NotSettled') return 'Settle the auction before claiming.'
      if (n === 'AlreadyClaimed') return 'This bid was already claimed.'
      return n
    }
    e = x.cause
  }
  return null
}
