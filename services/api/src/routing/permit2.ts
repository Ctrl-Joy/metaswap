import { getAddress, type Address } from 'viem'
import type { PermitSingle } from './encode'

export const MAX_UINT160 = (1n << 160n) - 1n
export const MAX_UINT48 = (1n << 48n) - 1n
/** Allowance validity requested in a new permit (Uniswap uses 30 days). */
export const PERMIT_EXPIRATION_SEC = 30 * 86400
/** Signature validity (Uniswap uses 30 minutes). */
export const PERMIT_SIG_DEADLINE_SEC = 30 * 60

export function permit2Domain(chainId: number, permit2: Address) {
  return { name: 'Permit2', chainId, verifyingContract: getAddress(permit2) } as const
}

export const PERMIT_SINGLE_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
} as const

export interface Permit2Allowance {
  amount: bigint
  expiration: number
  nonce: number
}

/** True when the router can't pull `needed` through Permit2 before `validUntil` (unix seconds). */
export function permitRequired(allowance: Permit2Allowance, needed: bigint, validUntil: number): boolean {
  return allowance.amount < needed || allowance.expiration < validUntil
}

export function buildPermitSingle(opts: { token: Address; spender: Address; nonce: number; now: number }): PermitSingle {
  return {
    details: {
      token: getAddress(opts.token),
      amount: MAX_UINT160,
      expiration: opts.now + PERMIT_EXPIRATION_SEC,
      nonce: opts.nonce,
    },
    spender: getAddress(opts.spender),
    sigDeadline: BigInt(opts.now + PERMIT_SIG_DEADLINE_SEC),
  }
}

/** EIP-712 payload for wallets; numbers as decimal strings in `values` (JSON-safe). */
export function permitTypedData(chainId: number, permit2: Address, permit: PermitSingle) {
  return {
    domain: permit2Domain(chainId, permit2),
    types: PERMIT_SINGLE_TYPES,
    primaryType: 'PermitSingle' as const,
    values: {
      details: {
        token: permit.details.token,
        amount: permit.details.amount.toString(),
        expiration: permit.details.expiration.toString(),
        nonce: permit.details.nonce.toString(),
      },
      spender: permit.spender,
      sigDeadline: permit.sigDeadline.toString(),
    },
  }
}

/** Convert the JSON `values` back to the bigint message viem's signTypedData expects. */
export function permitMessage(values: ReturnType<typeof permitTypedData>['values']) {
  return {
    details: {
      token: values.details.token,
      amount: BigInt(values.details.amount),
      expiration: Number(values.details.expiration),
      nonce: Number(values.details.nonce),
    },
    spender: values.spender,
    sigDeadline: BigInt(values.sigDeadline),
  }
}
