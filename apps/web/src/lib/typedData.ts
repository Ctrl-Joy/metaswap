import type { TypedDataDomain } from 'viem'

type Field = { name: string; type: string }
type Types = Record<string, Field[]>

export interface NormalizedTypedData {
  domain: TypedDataDomain
  types: Types
  primaryType: string
  message: Record<string, unknown>
}

/** Pick the primary type: the one no other type references. */
export function inferPrimaryType(types: Types): string {
  const names = Object.keys(types).filter((n) => n !== 'EIP712Domain')
  const referenced = new Set<string>()
  for (const n of names) for (const f of types[n]!) referenced.add(f.type.replace(/\[\d*\]$/, ''))
  const roots = names.filter((n) => !referenced.has(n))
  if (roots.length !== 1) throw new Error(`Cannot infer EIP-712 primary type from [${names.join(', ')}]`)
  return roots[0]!
}

function coerce(value: unknown, type: string, types: Types): unknown {
  if (type.endsWith(']')) {
    const inner = type.replace(/\[\d*\]$/, '')
    return Array.isArray(value) ? value.map((v) => coerce(v, inner, types)) : value
  }
  if (types[type]) return coerceStruct(value as Record<string, unknown>, type, types)
  if (/^u?int\d*$/.test(type)) {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number') return BigInt(value)
    if (typeof value === 'string' && value !== '') return BigInt(value)
  }
  return value
}

function coerceStruct(value: Record<string, unknown> | undefined, type: string, types: Types): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(value ?? {}) }
  for (const f of types[type]!) out[f.name] = coerce(value?.[f.name], f.type, types)
  return out
}

/**
 * Turn a JSON typed-data payload from the API ({ domain, types, values|message, primaryType? })
 * into what viem's signTypedData expects: numeric strings → bigint (per field type),
 * chainId → number, EIP712Domain removed.
 */
export function normalizeTypedData(payload: {
  domain: Record<string, unknown>
  types: Record<string, Field[]>
  values?: Record<string, unknown>
  message?: Record<string, unknown>
  primaryType?: string
}): NormalizedTypedData {
  const types: Types = {}
  for (const [k, v] of Object.entries(payload.types)) if (k !== 'EIP712Domain') types[k] = v
  const primaryType = payload.primaryType && types[payload.primaryType] ? payload.primaryType : inferPrimaryType(types)
  const raw = payload.values ?? payload.message ?? {}
  const d = payload.domain
  const domain: TypedDataDomain = {}
  if (d.name !== undefined) domain.name = String(d.name)
  if (d.version !== undefined) domain.version = String(d.version)
  if (d.chainId !== undefined) domain.chainId = Number(d.chainId)
  if (d.verifyingContract !== undefined) domain.verifyingContract = d.verifyingContract as `0x${string}`
  if (d.salt !== undefined) domain.salt = d.salt as `0x${string}`
  return { domain, types, primaryType, message: coerceStruct(raw, primaryType, types) }
}
