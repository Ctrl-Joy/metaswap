import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const API_ROOT = resolve(here, '..')

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === '') return dflt
  return !['0', 'false', 'no', 'off'].includes(v.toLowerCase())
}

function int(v: string | undefined, dflt: number): number {
  const n = v === undefined ? NaN : Number(v)
  return Number.isFinite(n) ? n : dflt
}

export interface Config {
  host: string
  port: number
  rpcUrl: string
  dbPath: string
  pollMs: number
  /** blocks per eth_getLogs during backfill */
  batchSize: number
  /** how far back the indexer looks for a common ancestor before doing a full re-index */
  reorgDepth: number
  indexerEnabled: boolean
  fillerEnabled: boolean
  /** Anvil account #9 — public, well-known dev key. Local devnet only. */
  fillerKey: `0x${string}`
  /** minimum profit (in USD) the filler bot wants on top of gas before it fills */
  fillerMinProfitUsd: number
  quoteTtlMs: number
  corsOrigins: string[]
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env
  return {
    host: env.HOST ?? '127.0.0.1',
    port: int(env.PORT, 8787),
    rpcUrl: env.METASWAP_RPC ?? env.RPC_URL ?? 'http://127.0.0.1:8545',
    dbPath: env.DB_PATH ?? resolve(API_ROOT, 'data/metaswap.sqlite'),
    pollMs: int(env.INDEXER_POLL_MS, 1000),
    batchSize: int(env.INDEXER_BATCH_SIZE, 2000),
    reorgDepth: int(env.INDEXER_REORG_DEPTH, 32),
    indexerEnabled: bool(env.INDEXER_ENABLED, true),
    fillerEnabled: bool(env.FILLER_ENABLED, true),
    fillerKey: (env.FILLER_PRIVATE_KEY ??
      '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6') as `0x${string}`,
    fillerMinProfitUsd: Number(env.FILLER_MIN_PROFIT_USD ?? '0'),
    quoteTtlMs: int(env.QUOTE_TTL_MS, 30_000),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',').map((s) => s.trim()),
    ...overrides,
  }
}
