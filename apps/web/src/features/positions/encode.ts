// Pure calldata builders for liquidity transactions (docs/analysis/flows.md §9–§11).
// Every builder returns { to, data, value } so it can be unit-tested by decoding with viem.
import { encodeFunctionData, type Address, type Hex } from 'viem'
import { nonfungiblePositionManagerAbi, v2Router02Abi } from '@metaswap/sdk/abis'
import { MAX_UINT128 } from './math'

export interface TxRequest {
  to: Address
  data: Hex
  value: bigint
}

const npm = (functionName: string, args: readonly unknown[]): Hex =>
  encodeFunctionData({ abi: nonfungiblePositionManagerAbi, functionName, args } as Parameters<typeof encodeFunctionData>[0])

function multicall(to: Address, calls: Hex[], value: bigint): TxRequest {
  if (calls.length === 1) return { to, data: calls[0]!, value }
  return { to, data: encodeFunctionData({ abi: nonfungiblePositionManagerAbi, functionName: 'multicall', args: [calls] }), value }
}

/* ------------------------------------------------------------------ V3 */

export interface MintArgs {
  npm: Address
  token0: Address
  token1: Address
  fee: number
  tickLower: number
  tickUpper: number
  amount0Desired: bigint
  amount1Desired: bigint
  amount0Min: bigint
  amount1Min: bigint
  recipient: Address
  deadline: bigint
  /** Set when the pool does not exist yet → createAndInitializePoolIfNecessary first. */
  createPoolSqrtPriceX96?: bigint
  /** Native ETH paid for the WETH side (adds refundETH). */
  ethValue?: bigint
}

/** NPM.multicall([createAndInitializePoolIfNecessary?, mint, refundETH?]) */
export function buildMint(a: MintArgs): TxRequest {
  const calls: Hex[] = []
  if (a.createPoolSqrtPriceX96 !== undefined) calls.push(npm('createAndInitializePoolIfNecessary', [a.token0, a.token1, a.fee, a.createPoolSqrtPriceX96]))
  calls.push(
    npm('mint', [
      {
        token0: a.token0,
        token1: a.token1,
        fee: a.fee,
        tickLower: a.tickLower,
        tickUpper: a.tickUpper,
        amount0Desired: a.amount0Desired,
        amount1Desired: a.amount1Desired,
        amount0Min: a.amount0Min,
        amount1Min: a.amount1Min,
        recipient: a.recipient,
        deadline: a.deadline,
      },
    ]),
  )
  const value = a.ethValue ?? 0n
  if (value > 0n) calls.push(npm('refundETH', []))
  return multicall(a.npm, calls, value)
}

export interface IncreaseArgs {
  npm: Address
  tokenId: bigint
  amount0Desired: bigint
  amount1Desired: bigint
  amount0Min: bigint
  amount1Min: bigint
  deadline: bigint
  ethValue?: bigint
}

export function buildIncrease(a: IncreaseArgs): TxRequest {
  const calls: Hex[] = [
    npm('increaseLiquidity', [
      { tokenId: a.tokenId, amount0Desired: a.amount0Desired, amount1Desired: a.amount1Desired, amount0Min: a.amount0Min, amount1Min: a.amount1Min, deadline: a.deadline },
    ]),
  ]
  const value = a.ethValue ?? 0n
  if (value > 0n) calls.push(npm('refundETH', []))
  return multicall(a.npm, calls, value)
}

export interface CollectArgs {
  npm: Address
  tokenId: bigint
  recipient: Address
  token0: Address
  token1: Address
  /** WETH address; when one side is WETH and `receiveEth`, fees are unwrapped to ETH. */
  weth: Address
  receiveEth: boolean
  /** Expected amounts (used as minimums for unwrap/sweep; 0 is fine). */
  expected0?: bigint
  expected1?: bigint
}

/** collect(MaxUint128) to the user, or to the NPM + unwrapWETH9 + sweepToken when collecting as ETH. */
function collectCalls(a: CollectArgs): Hex[] {
  const wethSide = a.token0.toLowerCase() === a.weth.toLowerCase() ? 0 : a.token1.toLowerCase() === a.weth.toLowerCase() ? 1 : -1
  const unwrap = a.receiveEth && wethSide >= 0
  const calls: Hex[] = [npm('collect', [{ tokenId: a.tokenId, recipient: unwrap ? '0x0000000000000000000000000000000000000000' : a.recipient, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }])]
  if (unwrap) {
    const other = wethSide === 0 ? a.token1 : a.token0
    const wethMin = (wethSide === 0 ? a.expected0 : a.expected1) ?? 0n
    const otherMin = (wethSide === 0 ? a.expected1 : a.expected0) ?? 0n
    calls.push(npm('unwrapWETH9', [wethMin, a.recipient]))
    calls.push(npm('sweepToken', [other, otherMin, a.recipient]))
  }
  return calls
}

export function buildCollect(a: CollectArgs): TxRequest {
  return multicall(a.npm, collectCalls(a), 0n)
}

export interface DecreaseArgs extends CollectArgs {
  liquidity: bigint
  amount0Min: bigint
  amount1Min: bigint
  deadline: bigint
  /** Burn the NFT afterwards (only valid when removing all liquidity). */
  burn: boolean
}

/** multicall([decreaseLiquidity, collect(+unwrap/sweep), burn?]) */
export function buildDecrease(a: DecreaseArgs): TxRequest {
  const calls: Hex[] = [
    npm('decreaseLiquidity', [{ tokenId: a.tokenId, liquidity: a.liquidity, amount0Min: a.amount0Min, amount1Min: a.amount1Min, deadline: a.deadline }]),
    ...collectCalls({ ...a, expected0: a.amount0Min, expected1: a.amount1Min }),
  ]
  if (a.burn) calls.push(npm('burn', [a.tokenId]))
  return { to: a.npm, data: encodeFunctionData({ abi: nonfungiblePositionManagerAbi, functionName: 'multicall', args: [calls] }), value: 0n }
}

/* ------------------------------------------------------------------ V2 */

export interface V2AddArgs {
  router: Address
  tokenA: Address
  tokenB: Address
  amountADesired: bigint
  amountBDesired: bigint
  amountAMin: bigint
  amountBMin: bigint
  to: Address
  deadline: bigint
  /** When one side is native ETH: which side (A/B). */
  nativeSide?: 'A' | 'B'
}

export function buildV2Add(a: V2AddArgs): TxRequest {
  if (a.nativeSide) {
    const tokenSide = a.nativeSide === 'A' ? 'B' : 'A'
    const token = tokenSide === 'A' ? a.tokenA : a.tokenB
    const amountToken = tokenSide === 'A' ? a.amountADesired : a.amountBDesired
    const amountTokenMin = tokenSide === 'A' ? a.amountAMin : a.amountBMin
    const amountETH = a.nativeSide === 'A' ? a.amountADesired : a.amountBDesired
    const amountETHMin = a.nativeSide === 'A' ? a.amountAMin : a.amountBMin
    return {
      to: a.router,
      data: encodeFunctionData({ abi: v2Router02Abi, functionName: 'addLiquidityETH', args: [token, amountToken, amountTokenMin, amountETHMin, a.to, a.deadline] }),
      value: amountETH,
    }
  }
  return {
    to: a.router,
    data: encodeFunctionData({
      abi: v2Router02Abi,
      functionName: 'addLiquidity',
      args: [a.tokenA, a.tokenB, a.amountADesired, a.amountBDesired, a.amountAMin, a.amountBMin, a.to, a.deadline],
    }),
    value: 0n,
  }
}

export interface PermitSig {
  v: number
  r: Hex
  s: Hex
  /** permit deadline (must equal the router deadline). */
  approveMax: boolean
}

export interface V2RemoveArgs {
  router: Address
  tokenA: Address
  tokenB: Address
  liquidity: bigint
  amountAMin: bigint
  amountBMin: bigint
  to: Address
  deadline: bigint
  /** Receive ETH instead of WETH for this side. */
  nativeSide?: 'A' | 'B'
  permit?: PermitSig
}

export function buildV2Remove(a: V2RemoveArgs): TxRequest {
  const value = 0n
  if (a.nativeSide) {
    const token = a.nativeSide === 'A' ? a.tokenB : a.tokenA
    const amountTokenMin = a.nativeSide === 'A' ? a.amountBMin : a.amountAMin
    const amountETHMin = a.nativeSide === 'A' ? a.amountAMin : a.amountBMin
    if (a.permit)
      return {
        to: a.router,
        value,
        data: encodeFunctionData({
          abi: v2Router02Abi,
          functionName: 'removeLiquidityETHWithPermit',
          args: [token, a.liquidity, amountTokenMin, amountETHMin, a.to, a.deadline, a.permit.approveMax, a.permit.v, a.permit.r, a.permit.s],
        }),
      }
    return {
      to: a.router,
      value,
      data: encodeFunctionData({ abi: v2Router02Abi, functionName: 'removeLiquidityETH', args: [token, a.liquidity, amountTokenMin, amountETHMin, a.to, a.deadline] }),
    }
  }
  if (a.permit)
    return {
      to: a.router,
      value,
      data: encodeFunctionData({
        abi: v2Router02Abi,
        functionName: 'removeLiquidityWithPermit',
        args: [a.tokenA, a.tokenB, a.liquidity, a.amountAMin, a.amountBMin, a.to, a.deadline, a.permit.approveMax, a.permit.v, a.permit.r, a.permit.s],
      }),
    }
  return {
    to: a.router,
    value,
    data: encodeFunctionData({ abi: v2Router02Abi, functionName: 'removeLiquidity', args: [a.tokenA, a.tokenB, a.liquidity, a.amountAMin, a.amountBMin, a.to, a.deadline] }),
  }
}

/** EIP-2612 typed data for the V2 pair LP token (domain name "MetaSwap V2", version "1"). */
export function v2PermitTypedData(o: { pair: Address; chainId: number; owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint; name?: string }) {
  return {
    domain: { name: o.name ?? 'MetaSwap V2', version: '1', chainId: o.chainId, verifyingContract: o.pair },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit' as const,
    message: { owner: o.owner, spender: o.spender, value: o.value, nonce: o.nonce, deadline: o.deadline },
  }
}

/** Deadline (unix seconds) from settings minutes. */
export function deadlineFromNow(minutes: number, nowMs = Date.now()): bigint {
  return BigInt(Math.floor(nowMs / 1000) + Math.max(1, Math.round(minutes)) * 60)
}
