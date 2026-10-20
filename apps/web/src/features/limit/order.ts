import { decodeAbiParameters, encodeAbiParameters, hashStruct, zeroAddress, type Address, type Hex } from 'viem'

// MetaSwapX ExclusiveDutchOrder — field order, type strings and encoding match
// packages/contracts/src/x/metaswapx/lib/ExclusiveDutchOrderLib.sol and the "EIP-712" section of
// packages/contracts/README.md. Orders are signed as a Permit2 PermitWitnessTransferFrom with
// spender = reactor, permitted = {inputToken, inputEndAmount}, nonce = info.nonce,
// deadline = info.deadline, witness = the order.

export interface OrderInfo {
  reactor: Address
  swapper: Address
  nonce: bigint
  deadline: bigint
  additionalValidationContract: Address
  additionalValidationData: Hex
}

export interface DutchOutput {
  token: Address
  startAmount: bigint
  endAmount: bigint
  recipient: Address
}

export interface ExclusiveDutchOrder {
  info: OrderInfo
  decayStartTime: bigint
  decayEndTime: bigint
  exclusiveFiller: Address
  exclusivityOverrideBps: bigint
  input: { token: Address; startAmount: bigint; endAmount: bigint }
  outputs: DutchOutput[]
}

export const ORDER_ABI_PARAMS = [
  {
    type: 'tuple',
    components: [
      {
        name: 'info',
        type: 'tuple',
        components: [
          { name: 'reactor', type: 'address' },
          { name: 'swapper', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'additionalValidationContract', type: 'address' },
          { name: 'additionalValidationData', type: 'bytes' },
        ],
      },
      { name: 'decayStartTime', type: 'uint256' },
      { name: 'decayEndTime', type: 'uint256' },
      { name: 'exclusiveFiller', type: 'address' },
      { name: 'exclusivityOverrideBps', type: 'uint256' },
      {
        name: 'input',
        type: 'tuple',
        components: [
          { name: 'token', type: 'address' },
          { name: 'startAmount', type: 'uint256' },
          { name: 'endAmount', type: 'uint256' },
        ],
      },
      {
        name: 'outputs',
        type: 'tuple[]',
        components: [
          { name: 'token', type: 'address' },
          { name: 'startAmount', type: 'uint256' },
          { name: 'endAmount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
        ],
      },
    ],
  },
] as const

/** EIP-712 types for Permit2's PermitWitnessTransferFrom with an ExclusiveDutchOrder witness. */
export const ORDER_TYPES = {
  PermitWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'ExclusiveDutchOrder' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  ExclusiveDutchOrder: [
    { name: 'info', type: 'OrderInfo' },
    { name: 'decayStartTime', type: 'uint256' },
    { name: 'decayEndTime', type: 'uint256' },
    { name: 'exclusiveFiller', type: 'address' },
    { name: 'exclusivityOverrideBps', type: 'uint256' },
    { name: 'inputToken', type: 'address' },
    { name: 'inputStartAmount', type: 'uint256' },
    { name: 'inputEndAmount', type: 'uint256' },
    { name: 'outputs', type: 'DutchOutput[]' },
  ],
  OrderInfo: [
    { name: 'reactor', type: 'address' },
    { name: 'swapper', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'additionalValidationContract', type: 'address' },
    { name: 'additionalValidationData', type: 'bytes' },
  ],
  DutchOutput: [
    { name: 'token', type: 'address' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
    { name: 'recipient', type: 'address' },
  ],
} as const

/** The order as the EIP-712 `ExclusiveDutchOrder` witness (input flattened). */
export function orderWitness(o: ExclusiveDutchOrder) {
  return {
    info: o.info,
    decayStartTime: o.decayStartTime,
    decayEndTime: o.decayEndTime,
    exclusiveFiller: o.exclusiveFiller,
    exclusivityOverrideBps: o.exclusivityOverrideBps,
    inputToken: o.input.token,
    inputStartAmount: o.input.startAmount,
    inputEndAmount: o.input.endAmount,
    outputs: o.outputs,
  }
}

/** Order hash = EIP-712 struct hash of the order (the reactor's Fill event `orderHash`). */
export function orderHash(o: ExclusiveDutchOrder): Hex {
  return hashStruct({ data: orderWitness(o), primaryType: 'ExclusiveDutchOrder', types: ORDER_TYPES })
}

export function encodeOrder(o: ExclusiveDutchOrder): Hex {
  return encodeAbiParameters(ORDER_ABI_PARAMS, [o])
}

export function decodeOrder(encoded: Hex): ExclusiveDutchOrder {
  const [o] = decodeAbiParameters(ORDER_ABI_PARAMS, encoded)
  return {
    info: { ...o.info },
    decayStartTime: o.decayStartTime,
    decayEndTime: o.decayEndTime,
    exclusiveFiller: o.exclusiveFiller,
    exclusivityOverrideBps: o.exclusivityOverrideBps,
    input: { ...o.input },
    outputs: o.outputs.map((x) => ({ ...x })),
  }
}

/** Typed data for wagmi/viem signTypedData. */
export function orderTypedData(o: ExclusiveDutchOrder, permit2: Address, chainId: number) {
  return {
    domain: { name: 'Permit2', chainId, verifyingContract: permit2 },
    types: ORDER_TYPES,
    primaryType: 'PermitWitnessTransferFrom' as const,
    message: {
      permitted: { token: o.input.token, amount: o.input.endAmount },
      spender: o.info.reactor,
      nonce: o.info.nonce,
      deadline: o.info.deadline,
      witness: orderWitness(o),
    },
  }
}

/** Random Permit2 unordered nonce (uint248 so wordPos stays sane). */
export function randomNonce(): bigint {
  const bytes = new Uint8Array(31)
  crypto.getRandomValues(bytes)
  return BigInt(`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`)
}

/** Permit2.invalidateUnorderedNonces(wordPos, mask) arguments for cancelling `nonce`. */
export function cancelArgs(nonce: bigint): readonly [bigint, bigint] {
  return [nonce >> 8n, 1n << (nonce & 0xffn)] as const
}

export const EXPIRY_OPTIONS = [
  { key: '1d', label: '1 day', seconds: 86_400 },
  { key: '1w', label: '1 week', seconds: 7 * 86_400 },
  { key: '1m', label: '1 month', seconds: 30 * 86_400 },
  { key: '1y', label: '1 year', seconds: 365 * 86_400 },
] as const
export type ExpiryKey = (typeof EXPIRY_OPTIONS)[number]['key']

export interface BuildLimitOrderArgs {
  reactor: Address
  swapper: Address
  inputToken: Address
  outputToken: Address
  amountIn: bigint
  /** Minimum output the swapper accepts (limit price × amountIn). */
  minAmountOut: bigint
  /** Optional better starting output for a short Dutch decay toward the limit (defaults to minAmountOut = static limit). */
  startAmountOut?: bigint
  nowSec: number
  expirySeconds: number
  nonce: bigint
  /** Seconds of output decay from startAmountOut to minAmountOut (0 = static). */
  decaySeconds?: number
  exclusiveFiller?: Address
  exclusivityOverrideBps?: bigint
}

/**
 * Limit order = ExclusiveDutchOrder whose output never drops below the limit:
 * input fixed (start = end = amountIn), output decays from `startAmountOut` (≥ limit) to the
 * limit over `decaySeconds`, then stays at the limit until the deadline.
 * Invariants checked by the reactor: deadline ≥ decayEndTime ≥ decayStartTime, and inputs/outputs
 * don't both decay.
 */
export function buildLimitOrder(a: BuildLimitOrderArgs): ExclusiveDutchOrder {
  if (a.amountIn <= 0n) throw new Error('Sell amount must be greater than 0')
  if (a.minAmountOut <= 0n) throw new Error('Limit price must be greater than 0')
  if (a.expirySeconds <= 0) throw new Error('Expiry must be in the future')
  const start = BigInt(a.nowSec)
  const deadline = start + BigInt(a.expirySeconds)
  const decay = BigInt(Math.max(0, Math.min(a.decaySeconds ?? 0, a.expirySeconds)))
  const startOut = a.startAmountOut && a.startAmountOut > a.minAmountOut ? a.startAmountOut : a.minAmountOut
  return {
    info: {
      reactor: a.reactor,
      swapper: a.swapper,
      nonce: a.nonce,
      deadline,
      additionalValidationContract: zeroAddress,
      additionalValidationData: '0x',
    },
    decayStartTime: start,
    decayEndTime: start + decay,
    exclusiveFiller: a.exclusiveFiller ?? zeroAddress,
    exclusivityOverrideBps: a.exclusivityOverrideBps ?? 0n,
    input: { token: a.inputToken, startAmount: a.amountIn, endAmount: a.amountIn },
    outputs: [{ token: a.outputToken, startAmount: startOut, endAmount: a.minAmountOut, recipient: a.swapper }],
  }
}

/** Output amount at time t (DutchDecayLib.decay, floor). */
export function decayedAmount(start: bigint, end: bigint, decayStart: bigint, decayEnd: bigint, t: bigint): bigint {
  if (t <= decayStart || decayEnd <= decayStart) return t <= decayStart ? start : end
  if (t >= decayEnd) return end
  const elapsed = t - decayStart
  const duration = decayEnd - decayStart
  if (end < start) return start - ((start - end) * elapsed) / duration
  return start + ((end - start) * elapsed) / duration
}

/**
 * Limit price → minimum output. `price` is "1 input = price output" as a decimal string;
 * returns floor(amountIn × price) in output base units.
 */
export function minOutputFromPrice(amountIn: bigint, inDecimals: number, price: string, outDecimals: number): bigint | null {
  const m = /^(\d*)\.?(\d*)$/.exec(price.trim())
  if (!m || (!m[1] && !m[2])) return null
  const frac = (m[2] ?? '').slice(0, 36)
  const scaled = BigInt(`${m[1] || '0'}${frac}` || '0') // price × 10^frac.length
  if (scaled === 0n) return null
  return (amountIn * scaled * 10n ** BigInt(outDecimals)) / (10n ** BigInt(frac.length) * 10n ** BigInt(inDecimals))
}
