import { getAddress, isAddress, zeroAddress } from 'viem'
import type { Token } from '@metaswap/sdk'

export type RecipientCheck =
  | { ok: true; address: `0x${string}`; warning?: 'self' | 'checksum' }
  | { ok: false; error: 'empty' | 'invalid' | 'zero' | 'token-contract' }

/** Recipient validation for Send (flows.md §8). */
export function checkRecipient(input: string, opts: { token?: Token; self?: string; knownTokens?: readonly Token[] } = {}): RecipientCheck {
  const v = input.trim()
  if (!v) return { ok: false, error: 'empty' }
  if (!isAddress(v, { strict: false })) return { ok: false, error: 'invalid' }
  const address = getAddress(v)
  if (address === zeroAddress) return { ok: false, error: 'zero' }
  const lower = address.toLowerCase()
  if (opts.token && !opts.token.isNative && opts.token.address.toLowerCase() === lower) return { ok: false, error: 'token-contract' }
  if (opts.knownTokens?.some((t) => !t.isNative && t.address.toLowerCase() === lower)) return { ok: false, error: 'token-contract' }
  // Mixed-case input with a wrong checksum is suspicious (likely a typo).
  const mixed = /[a-f]/.test(v.slice(2)) && /[A-F]/.test(v.slice(2))
  if (mixed && v !== address) return { ok: true, address, warning: 'checksum' }
  if (opts.self && opts.self.toLowerCase() === lower) return { ok: true, address, warning: 'self' }
  return { ok: true, address }
}

export const RECIPIENT_ERROR_TEXT: Record<Exclude<RecipientCheck, { ok: true }>['error'], string> = {
  empty: 'Enter a recipient address',
  invalid: 'Not a valid address',
  zero: 'Cannot send to the zero address',
  'token-contract': 'That is a token contract — tokens sent there are lost',
}
