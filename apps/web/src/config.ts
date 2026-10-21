import { DEVNET_RPC_URL, metachainDevnet } from '@metaswap/sdk'

const env = import.meta.env

/**
 * Relative values (e.g. "/api", "/rpc") resolve against the page's own origin, so the hosted
 * single-port deployment (scripts/gateway.mjs) needs no hard-coded domain.
 */
function resolveUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  const v = value.replace(/\/$/, '')
  return v.startsWith('/') && typeof location !== 'undefined' ? `${location.origin}${v}` : v
}

/** Base URL of the MetaSwap API (services/api). */
export const API_URL: string = resolveUrl(env.VITE_API_URL as string | undefined) || 'http://127.0.0.1:8787'
/** JSON-RPC endpoint of MetaChain Devnet (Anvil). */
export const RPC_URL: string = resolveUrl(env.VITE_RPC_URL as string | undefined) || DEVNET_RPC_URL
export const WALLETCONNECT_PROJECT_ID: string | undefined = (env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) || undefined

export const DEVNET_CHAIN_ID = metachainDevnet.id
export const CHAIN_SLUG = 'metachain-devnet'

/** Anvil's well-known public dev accounts #0-#4 (unlocked on the local node; never real funds). */
export const ANVIL_ACCOUNTS = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
] as const

export const QUOTE_DEBOUNCE_MS = 300
export const QUOTE_REFRESH_MS = 15_000
/** API quotes expire after 30s (PLAN.md). */
export const QUOTE_TTL_MS = 30_000
