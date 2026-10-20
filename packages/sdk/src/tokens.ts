import { getAddress, zeroAddress, type Address } from 'viem'
import { metachainDevnet } from './chains'
import { deployment } from './deployment'

/** Sentinel used across MetaSwap (app, API, URLs) for the chain's native currency. */
export const NATIVE_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const satisfies Address

export interface Token {
  chainId: number
  address: Address
  symbol: string
  name: string
  decimals: number
  logoURI: string
  isNative?: boolean
  tags?: string[]
}

export const NATIVE_ETH: Token = {
  chainId: metachainDevnet.id,
  address: NATIVE_ADDRESS,
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  logoURI: '/tokens/ETH.svg',
  isNative: true,
  tags: ['native'],
}

const STABLES = new Set(['mUSDC', 'mUSDT', 'mDAI'])

/** Tokens deployed on the devnet, in Uniswap token-list shape. */
export const DEVNET_TOKENS: Token[] = deployment.tokens.map((t) => ({
  chainId: metachainDevnet.id,
  address: getAddress(t.address),
  symbol: t.symbol,
  name: t.name,
  decimals: t.decimals,
  logoURI: `/tokens/${t.symbol}.svg`,
  tags: STABLES.has(t.symbol) ? ['stablecoin'] : t.symbol === 'WETH' ? ['wrapped'] : [],
}))

export const ALL_TOKENS: Token[] = [NATIVE_ETH, ...DEVNET_TOKENS]

/** Quick-pick chips in the token selector (Uniswap's "common bases"). */
export const COMMON_BASE_SYMBOLS = ['ETH', 'mUSDC', 'mUSDT', 'mWBTC', 'WETH', 'META'] as const

export function isNative(address: string): boolean {
  return address.toLowerCase() === NATIVE_ADDRESS.toLowerCase() || address === zeroAddress
}

export function getToken(addressOrSymbol: string): Token | undefined {
  const needle = addressOrSymbol.toLowerCase()
  return ALL_TOKENS.find((t) => t.address.toLowerCase() === needle || t.symbol.toLowerCase() === needle)
}

export function wrappedNative(): Token {
  const weth = DEVNET_TOKENS.find((t) => t.symbol === 'WETH')
  if (!weth) throw new Error('WETH missing from deployment')
  return weth
}

/** Native ETH maps to WETH for pool/routing purposes. */
export function toPoolToken(token: Token): Token {
  return token.isNative ? wrappedNative() : token
}

/** https://uniswap.org/tokenlist.schema.json compatible list. */
export function tokenList(timestamp = new Date().toISOString()) {
  return {
    name: 'MetaSwap Devnet',
    timestamp,
    version: { major: 1, minor: 0, patch: 0 },
    keywords: ['metaswap', 'devnet'],
    tokens: DEVNET_TOKENS,
  }
}
