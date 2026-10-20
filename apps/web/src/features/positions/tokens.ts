import { contractAddress, NATIVE_ETH, v3Math, wrappedNative, type Token } from '@metaswap/sdk'

export { contractAddress, NATIVE_ETH, wrappedNative, type Token }

export const FEE_TIER_LIST = v3Math.FEE_TIERS

export function feeLabel(fee: number | null | undefined): string {
  if (fee === null || fee === undefined) return ''
  return `${Number((fee / 10_000).toFixed(4))}%`
}

/** Native ETH → WETH for pool purposes. */
export function poolToken(t: Token): Token {
  return t.isNative ? wrappedNative() : t
}

export function sameToken(a: Token | undefined, b: Token | undefined): boolean {
  if (!a || !b) return false
  return poolToken(a).address.toLowerCase() === poolToken(b).address.toLowerCase()
}

export function isWeth(address: string): boolean {
  return address.toLowerCase() === wrappedNative().address.toLowerCase()
}
