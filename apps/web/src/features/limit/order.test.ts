import { describe, expect, it } from 'vitest'
import { concat, encodeAbiParameters, hashTypedData, keccak256, recoverTypedDataAddress, toHex, zeroAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  buildLimitOrder,
  cancelArgs,
  decayedAmount,
  decodeOrder,
  encodeOrder,
  minOutputFromPrice,
  orderHash,
  orderTypedData,
  type ExclusiveDutchOrder,
} from './order'

// Anvil account #0 — public dev key (never holds real funds).
const anvil0 = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const REACTOR = '0x1111111111111111111111111111111111111111'
const PERMIT2 = '0x2222222222222222222222222222222222222222'
const WETH = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const USDC = '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318'

const order = buildLimitOrder({
  reactor: REACTOR,
  swapper: anvil0.address,
  inputToken: WETH,
  outputToken: USDC,
  amountIn: 10n ** 18n,
  minAmountOut: 3_100_000_000n,
  nowSec: 1_700_000_000,
  expirySeconds: 7 * 86_400,
  nonce: 123456789n,
})

// Re-implementation of ExclusiveDutchOrderLib.hash / OrderInfoLib.hash exactly as the Solidity does it.
const s = (x: string) => keccak256(toHex(x))
const ORDER_INFO_TYPE = 'OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)'
const DUTCH_OUTPUT_TYPE = 'DutchOutput(address token,uint256 startAmount,uint256 endAmount,address recipient)'
const EDO_TYPE =
  'ExclusiveDutchOrder(OrderInfo info,uint256 decayStartTime,uint256 decayEndTime,address exclusiveFiller,uint256 exclusivityOverrideBps,address inputToken,uint256 inputStartAmount,uint256 inputEndAmount,DutchOutput[] outputs)'
function solidityOrderHash(o: ExclusiveDutchOrder): Hex {
  const info = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
      [s(ORDER_INFO_TYPE), o.info.reactor, o.info.swapper, o.info.nonce, o.info.deadline, o.info.additionalValidationContract, keccak256(o.info.additionalValidationData)],
    ),
  )
  const outs = keccak256(
    concat(
      o.outputs.map((x) =>
        keccak256(
          encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }], [s(DUTCH_OUTPUT_TYPE), x.token, x.startAmount, x.endAmount, x.recipient]),
        ),
      ),
    ),
  )
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
      [s(EDO_TYPE + DUTCH_OUTPUT_TYPE + ORDER_INFO_TYPE), info, o.decayStartTime, o.decayEndTime, o.exclusiveFiller, o.exclusivityOverrideBps, o.input.token, o.input.startAmount, o.input.endAmount, outs],
    ),
  )
}

// Permit2 digest for permitWitnessTransferFrom, built the way SignatureTransfer + PermitHash do.
function permit2Digest(o: ExclusiveDutchOrder, chainId: number): Hex {
  const witnessTypeString =
    'ExclusiveDutchOrder witness)' + DUTCH_OUTPUT_TYPE + EDO_TYPE + ORDER_INFO_TYPE + 'TokenPermissions(address token,uint256 amount)'
  const typeHash = s('PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,' + witnessTypeString)
  const tokenPerms = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }], [s('TokenPermissions(address token,uint256 amount)'), o.input.token, o.input.endAmount]))
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
      [typeHash, tokenPerms, o.info.reactor, o.info.nonce, o.info.deadline, solidityOrderHash(o)],
    ),
  )
  const domainSep = keccak256(
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }], [s('EIP712Domain(string name,uint256 chainId,address verifyingContract)'), s('Permit2'), BigInt(chainId), PERMIT2]),
  )
  return keccak256(concat(['0x1901', domainSep, structHash]))
}

describe('buildLimitOrder', () => {
  it('builds a static limit order with the reactor invariants', () => {
    expect(order.info).toMatchObject({ reactor: REACTOR, swapper: anvil0.address, nonce: 123456789n, deadline: 1_700_000_000n + 604_800n, additionalValidationContract: zeroAddress, additionalValidationData: '0x' })
    expect(order.decayStartTime).toBe(1_700_000_000n)
    expect(order.decayEndTime).toBe(1_700_000_000n)
    expect(order.info.deadline >= order.decayEndTime && order.decayEndTime >= order.decayStartTime).toBe(true)
    expect(order.input).toEqual({ token: WETH, startAmount: 10n ** 18n, endAmount: 10n ** 18n })
    expect(order.outputs).toEqual([{ token: USDC, startAmount: 3_100_000_000n, endAmount: 3_100_000_000n, recipient: anvil0.address }])
    expect(order.exclusiveFiller).toBe(zeroAddress)
  })
  it('supports a Dutch decay from a better start down to the limit', () => {
    const o = buildLimitOrder({ reactor: REACTOR, swapper: anvil0.address, inputToken: WETH, outputToken: USDC, amountIn: 1n, minAmountOut: 100n, startAmountOut: 120n, nowSec: 10, expirySeconds: 600, decaySeconds: 60, nonce: 1n })
    expect(o.outputs[0]).toMatchObject({ startAmount: 120n, endAmount: 100n })
    expect(o.decayEndTime - o.decayStartTime).toBe(60n)
  })
  it('rejects bad input', () => {
    const args = { reactor: REACTOR, swapper: anvil0.address, inputToken: WETH, outputToken: USDC, amountIn: 1n, minAmountOut: 1n, nowSec: 1, expirySeconds: 1, nonce: 1n } as const
    expect(() => buildLimitOrder({ ...args, amountIn: 0n })).toThrow()
    expect(() => buildLimitOrder({ ...args, minAmountOut: 0n })).toThrow()
    expect(() => buildLimitOrder({ ...args, expirySeconds: 0 })).toThrow()
  })
})

describe('order encoding and hashing', () => {
  it('abi round-trips', () => {
    expect(decodeOrder(encodeOrder(order))).toEqual(order)
  })
  it('order hash matches ExclusiveDutchOrderLib.hash', () => {
    expect(orderHash(order)).toBe(solidityOrderHash(order))
  })
  it('EIP-712 typed data digest matches the Permit2 witness digest', () => {
    const td = orderTypedData(order, PERMIT2, 31337)
    expect(hashTypedData(td)).toBe(permit2Digest(order, 31337))
  })
  it('signature recovers the swapper', async () => {
    const td = orderTypedData(order, PERMIT2, 31337)
    const sig = await anvil0.signTypedData(td)
    expect(await recoverTypedDataAddress({ ...td, signature: sig })).toBe(anvil0.address)
  })
  it('permitted amount is the input end amount and spender is the reactor', () => {
    const td = orderTypedData(order, PERMIT2, 31337)
    expect(td.message.permitted).toEqual({ token: WETH, amount: order.input.endAmount })
    expect(td.message.spender).toBe(REACTOR)
  })
})

describe('helpers', () => {
  it('cancel args target the nonce bit', () => {
    expect(cancelArgs(0n)).toEqual([0n, 1n])
    expect(cancelArgs(255n)).toEqual([0n, 1n << 255n])
    expect(cancelArgs(256n + 3n)).toEqual([1n, 8n])
  })
  it('decays like DutchDecayLib', () => {
    expect(decayedAmount(200n, 100n, 10n, 20n, 5n)).toBe(200n)
    expect(decayedAmount(200n, 100n, 10n, 20n, 15n)).toBe(150n)
    expect(decayedAmount(200n, 100n, 10n, 20n, 25n)).toBe(100n)
    expect(decayedAmount(100n, 200n, 10n, 20n, 13n)).toBe(130n)
  })
  it('converts a limit price to a minimum output', () => {
    expect(minOutputFromPrice(10n ** 18n, 18, '3100.5', 6)).toBe(3_100_500_000n)
    expect(minOutputFromPrice(2n * 10n ** 6n, 6, '0.0003', 18)).toBe(6n * 10n ** 14n)
    expect(minOutputFromPrice(10n ** 18n, 18, '0', 6)).toBeNull()
    expect(minOutputFromPrice(10n ** 18n, 18, 'abc', 6)).toBeNull()
  })
})
