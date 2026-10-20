// ExclusiveDutchOrder encoding, hashing and EIP-712 typed data — mirrors
// packages/contracts/src/x/metaswapx/lib/ExclusiveDutchOrderLib.sol + Permit2 witness transfer.
import {
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  hashStruct,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem'

export interface OrderInfo {
  reactor: Address
  swapper: Address
  nonce: bigint
  deadline: bigint
  additionalValidationContract: Address
  additionalValidationData: Hex
}

export interface DutchInput {
  token: Address
  startAmount: bigint
  endAmount: bigint
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
  input: DutchInput
  outputs: DutchOutput[]
}

export const ORDER_ABI = parseAbiParameters([
  'ExclusiveDutchOrder order',
  'struct ExclusiveDutchOrder { OrderInfo info; uint256 decayStartTime; uint256 decayEndTime; address exclusiveFiller; uint256 exclusivityOverrideBps; DutchInput input; DutchOutput[] outputs; }',
  'struct OrderInfo { address reactor; address swapper; uint256 nonce; uint256 deadline; address additionalValidationContract; bytes additionalValidationData; }',
  'struct DutchInput { address token; uint256 startAmount; uint256 endAmount; }',
  'struct DutchOutput { address token; uint256 startAmount; uint256 endAmount; address recipient; }',
])

export function encodeOrder(order: ExclusiveDutchOrder): Hex {
  return encodeAbiParameters(ORDER_ABI, [order])
}

export function decodeOrder(encoded: Hex): ExclusiveDutchOrder {
  const [o] = decodeAbiParameters(ORDER_ABI, encoded)
  return {
    info: {
      reactor: getAddress(o.info.reactor),
      swapper: getAddress(o.info.swapper),
      nonce: o.info.nonce,
      deadline: o.info.deadline,
      additionalValidationContract: getAddress(o.info.additionalValidationContract),
      additionalValidationData: o.info.additionalValidationData,
    },
    decayStartTime: o.decayStartTime,
    decayEndTime: o.decayEndTime,
    exclusiveFiller: getAddress(o.exclusiveFiller),
    exclusivityOverrideBps: o.exclusivityOverrideBps,
    input: { token: getAddress(o.input.token), startAmount: o.input.startAmount, endAmount: o.input.endAmount },
    outputs: o.outputs.map((x) => ({ token: getAddress(x.token), startAmount: x.startAmount, endAmount: x.endAmount, recipient: getAddress(x.recipient) })),
  }
}

/** EIP-712 types of the Permit2 witness transfer (viem sorts referenced types alphabetically, as the contract does). */
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

export function witnessOf(order: ExclusiveDutchOrder) {
  return {
    info: order.info,
    decayStartTime: order.decayStartTime,
    decayEndTime: order.decayEndTime,
    exclusiveFiller: order.exclusiveFiller,
    exclusivityOverrideBps: order.exclusivityOverrideBps,
    inputToken: order.input.token,
    inputStartAmount: order.input.startAmount,
    inputEndAmount: order.input.endAmount,
    outputs: order.outputs,
  }
}

/** Order hash = ExclusiveDutchOrderLib.hash(order) (the struct hash; emitted in Fill events). */
export function orderHash(order: ExclusiveDutchOrder): Hex {
  return hashStruct({ data: witnessOf(order), primaryType: 'ExclusiveDutchOrder', types: ORDER_TYPES })
}

/** Typed data the swapper signs (Permit2 PermitWitnessTransferFrom, spender = reactor). */
export function orderTypedData(order: ExclusiveDutchOrder, chainId: number, permit2: Address) {
  return {
    domain: { name: 'Permit2', chainId, verifyingContract: getAddress(permit2) },
    types: ORDER_TYPES,
    primaryType: 'PermitWitnessTransferFrom' as const,
    message: {
      permitted: { token: order.input.token, amount: order.input.endAmount },
      spender: order.info.reactor,
      nonce: order.info.nonce,
      deadline: order.info.deadline,
      witness: witnessOf(order),
    },
  }
}

/** DutchDecayLib.decay */
export function decay(start: bigint, end: bigint, decayStart: bigint, decayEnd: bigint, now: bigint): bigint {
  if (decayEnd <= now) return end
  if (decayStart >= now) return start
  const elapsed = now - decayStart
  const duration = decayEnd - decayStart
  if (end < start) return start - ((start - end) * elapsed) / duration
  return start + ((end - start) * elapsed) / duration
}

/** Input/outputs as the reactor resolves them at `now` (ignores exclusivity override). */
export function resolveOrder(order: ExclusiveDutchOrder, now: bigint) {
  return {
    input: { token: order.input.token, amount: decay(order.input.startAmount, order.input.endAmount, order.decayStartTime, order.decayEndTime, now), maxAmount: order.input.endAmount },
    outputs: order.outputs.map((o) => ({ token: o.token, recipient: o.recipient, amount: decay(o.startAmount, o.endAmount, order.decayStartTime, order.decayEndTime, now) })),
  }
}

/** Permit2 unordered nonce position. */
export function noncePosition(nonce: bigint): { wordPos: bigint; bitPos: bigint } {
  return { wordPos: nonce >> 8n, bitPos: nonce & 0xffn }
}

export function orderJson(order: ExclusiveDutchOrder) {
  return {
    info: { ...order.info, nonce: order.info.nonce.toString(), deadline: Number(order.info.deadline) },
    decayStartTime: Number(order.decayStartTime),
    decayEndTime: Number(order.decayEndTime),
    exclusiveFiller: order.exclusiveFiller,
    exclusivityOverrideBps: order.exclusivityOverrideBps.toString(),
    input: { token: order.input.token, startAmount: order.input.startAmount.toString(), endAmount: order.input.endAmount.toString() },
    outputs: order.outputs.map((o) => ({ token: o.token, startAmount: o.startAmount.toString(), endAmount: o.endAmount.toString(), recipient: o.recipient })),
  }
}
