import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, hashTypedData, keccak256, parseAbiParameters, recoverTypedDataAddress, toHex, zeroAddress, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { buildPermitSingle, permitMessage, permitTypedData, permitRequired } from '../../src/routing/permit2'
import { decay, decodeOrder, encodeOrder, orderHash, orderTypedData, resolveOrder, noncePosition, type ExclusiveDutchOrder } from '../../src/x/order'

// Anvil account #1 (public dev key)
const acct = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const PERMIT2 = '0x' + '22'.repeat(20) as Address
const ROUTER = '0x' + '33'.repeat(20) as Address
const TOKEN = '0x' + '44'.repeat(20) as Address
const k = (s: string) => keccak256(toHex(s))
const enc = (types: string, values: unknown[]) => encodeAbiParameters(parseAbiParameters(types), values as never)

const domainSeparator = keccak256(
  enc('bytes32, bytes32, uint256, address', [k('EIP712Domain(string name,uint256 chainId,address verifyingContract)'), k('Permit2'), 31337n, PERMIT2]),
)
const digest = (structHash: `0x${string}`) => keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}`)

describe('Permit2 PermitSingle typed data', () => {
  const permit = buildPermitSingle({ token: TOKEN, spender: ROUTER, nonce: 3, now: 1_000 })
  const td = permitTypedData(31337, PERMIT2, permit)

  it('hash equals the contract construction (PermitHash.sol)', () => {
    const detailsHash = keccak256(
      enc('bytes32, address, uint160, uint48, uint48', [k('PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)'), TOKEN, permit.details.amount, permit.details.expiration, permit.details.nonce]),
    )
    const structHash = keccak256(
      enc('bytes32, bytes32, address, uint256', [
        k('PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)'),
        detailsHash,
        ROUTER,
        permit.sigDeadline,
      ]),
    )
    const viemHash = hashTypedData({ domain: td.domain, types: td.types, primaryType: 'PermitSingle', message: permitMessage(td.values) })
    expect(viemHash).toBe(digest(structHash))
    expect(td.domain).toEqual({ name: 'Permit2', chainId: 31337, verifyingContract: PERMIT2 })
    expect(td.values.details.nonce).toBe('3')
    expect(BigInt(td.values.details.amount)).toBe((1n << 160n) - 1n)
  })

  it('a wallet signature over the JSON payload recovers to the signer', async () => {
    const message = permitMessage(td.values)
    const signature = await acct.signTypedData({ domain: td.domain, types: td.types, primaryType: 'PermitSingle', message })
    const rec = await recoverTypedDataAddress({ domain: td.domain, types: td.types, primaryType: 'PermitSingle', message, signature })
    expect(rec).toBe(acct.address)
  })

  it('requires a permit when the allowance is short or expiring', () => {
    expect(permitRequired({ amount: 0n, expiration: 0, nonce: 0 }, 1n, 10)).toBe(true)
    expect(permitRequired({ amount: 10n, expiration: 5, nonce: 0 }, 1n, 10)).toBe(true)
    expect(permitRequired({ amount: 10n, expiration: 50, nonce: 0 }, 1n, 10)).toBe(false)
  })
})

describe('ExclusiveDutchOrder', () => {
  const order: ExclusiveDutchOrder = {
    info: { reactor: ROUTER, swapper: acct.address, nonce: 1234567n, deadline: 2_000n, additionalValidationContract: zeroAddress, additionalValidationData: '0x' },
    decayStartTime: 1_000n,
    decayEndTime: 1_060n,
    exclusiveFiller: zeroAddress,
    exclusivityOverrideBps: 0n,
    input: { token: TOKEN, startAmount: 100n, endAmount: 100n },
    outputs: [{ token: PERMIT2, startAmount: 1_000n, endAmount: 900n, recipient: acct.address }],
  }

  it('abi encoding round-trips', () => {
    expect(decodeOrder(encodeOrder(order))).toEqual(order)
  })

  it('order hash matches ExclusiveDutchOrderLib.hash', () => {
    const ORDER_INFO = 'OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)'
    const DUTCH_OUTPUT = 'DutchOutput(address token,uint256 startAmount,uint256 endAmount,address recipient)'
    const EDO =
      'ExclusiveDutchOrder(OrderInfo info,uint256 decayStartTime,uint256 decayEndTime,address exclusiveFiller,uint256 exclusivityOverrideBps,address inputToken,uint256 inputStartAmount,uint256 inputEndAmount,DutchOutput[] outputs)'
    const infoHash = keccak256(enc('bytes32, address, address, uint256, uint256, address, bytes32', [k(ORDER_INFO), ROUTER, acct.address, 1234567n, 2000n, zeroAddress, keccak256('0x')]))
    const outHash = keccak256(enc('bytes32, address, uint256, uint256, address', [k(DUTCH_OUTPUT), PERMIT2, 1000n, 900n, acct.address]))
    const outputsHash = keccak256(outHash)
    const expected = keccak256(
      enc('bytes32, bytes32, uint256, uint256, address, uint256, address, uint256, uint256, bytes32', [k(EDO + DUTCH_OUTPUT + ORDER_INFO), infoHash, 1000n, 1060n, zeroAddress, 0n, TOKEN, 100n, 100n, outputsHash]),
    )
    expect(orderHash(order)).toBe(expected)

    // and the Permit2 witness digest (PERMIT2_ORDER_TYPE in the reactor)
    const witnessTypeString = 'ExclusiveDutchOrder witness)' + DUTCH_OUTPUT + EDO + ORDER_INFO + 'TokenPermissions(address token,uint256 amount)'
    const typeHash = k('PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,' + witnessTypeString)
    const tokenPerms = keccak256(enc('bytes32, address, uint256', [k('TokenPermissions(address token,uint256 amount)'), TOKEN, 100n]))
    const structHash = keccak256(enc('bytes32, bytes32, address, uint256, uint256, bytes32', [typeHash, tokenPerms, ROUTER, 1234567n, 2000n, expected]))
    const td = orderTypedData(order, 31337, PERMIT2)
    expect(hashTypedData(td)).toBe(digest(structHash))
  })

  it('signature recovers to the swapper', async () => {
    const td = orderTypedData(order, 31337, PERMIT2)
    const sig = await acct.signTypedData(td)
    expect(await recoverTypedDataAddress({ ...td, signature: sig })).toBe(acct.address)
  })

  it('decays outputs linearly like DutchDecayLib', () => {
    expect(decay(1000n, 900n, 1000n, 1060n, 999n)).toBe(1000n)
    expect(decay(1000n, 900n, 1000n, 1060n, 1030n)).toBe(950n)
    expect(decay(1000n, 900n, 1000n, 1060n, 2000n)).toBe(900n)
    expect(decay(100n, 200n, 0n, 10n, 5n)).toBe(150n)
    const r = resolveOrder(order, 1015n)
    expect(r.outputs[0].amount).toBe(975n)
    expect(r.input.amount).toBe(100n)
    expect(noncePosition(1234567n)).toEqual({ wordPos: 1234567n >> 8n, bitPos: 1234567n & 255n })
  })
})
