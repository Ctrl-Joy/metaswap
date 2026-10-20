import { createPublicClient, defineChain, getAddress, http, type Address, type PublicClient } from 'viem'
import { deployment as sdkDeployment, metachainDevnet, NATIVE_ADDRESS, type Deployment } from '@metaswap/sdk'
import { erc20Abi } from './abis'
import type { Config } from './config'
import { Db } from './db'

export interface TokenInfo {
  address: Address
  symbol: string
  name: string
  decimals: number
  isNative?: boolean
}

export const STABLE_SYMBOLS = new Set((process.env.STABLE_SYMBOLS ?? 'mUSDC,mUSDT,mDAI').split(','))

export const lc = (a: string) => a.toLowerCase()

export function isNativeAddress(a: string): boolean {
  const l = a.toLowerCase()
  return l === NATIVE_ADDRESS.toLowerCase() || l === '0x0000000000000000000000000000000000000000' || l === 'eth'
}

export interface Context {
  config: Config
  db: Db
  client: PublicClient
  deployment: Deployment
  chain: ReturnType<typeof defineChain>
}

export function createContext(config: Config, deployment: Deployment = sdkDeployment, db?: Db): Context {
  const chain = defineChain({ ...metachainDevnet, rpcUrls: { default: { http: [config.rpcUrl] } } })
  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl, { batch: { batchSize: 500, wait: 0 }, retryCount: 2, timeout: 30_000 }),
    pollingInterval: 500,
    cacheTime: 0,
  }) as PublicClient
  return { config, db: db ?? new Db(config.dbPath), client, deployment, chain }
}

export function hasDeployment(ctx: Context): boolean {
  return Boolean(ctx.deployment.contracts?.V2Factory && ctx.deployment.contracts?.V3Factory && ctx.deployment.tokens?.length)
}

export function addr(ctx: Context, name: keyof Deployment['contracts']): Address {
  const a = ctx.deployment.contracts[name]
  if (!a) throw new HttpError(503, `Contract ${name} is not deployed (deployment file has no address)`)
  return getAddress(a)
}

export function wethAddress(ctx: Context): Address {
  return addr(ctx, 'WETH9')
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

/** Token metadata lookup: DB (indexed) → deployment → on-chain ERC20 reads (cached into DB). */
export class TokenRegistry {
  private cache = new Map<string, TokenInfo>()
  constructor(private ctx: Context) {}

  native(): TokenInfo {
    return { address: NATIVE_ADDRESS, symbol: 'ETH', name: 'Ether', decimals: 18, isNative: true }
  }

  getSync(address: string): TokenInfo | undefined {
    if (isNativeAddress(address)) return this.native()
    const key = lc(address)
    const hit = this.cache.get(key)
    if (hit) return hit
    const dep = this.ctx.deployment.tokens.find((t) => lc(t.address) === key)
    if (dep) {
      const t = { address: getAddress(dep.address), symbol: dep.symbol, name: dep.name, decimals: dep.decimals }
      this.cache.set(key, t)
      return t
    }
    const row = this.ctx.db.get<{ address: string; symbol: string; name: string; decimals: number }>(
      'SELECT * FROM tokens WHERE address = ?',
      key,
    )
    if (row) {
      const t = { address: getAddress(row.address), symbol: row.symbol, name: row.name, decimals: Number(row.decimals) }
      this.cache.set(key, t)
      return t
    }
    return undefined
  }

  /** Resolve by address or symbol (case-insensitive). */
  resolve(addressOrSymbol: string): TokenInfo | undefined {
    if (/^0x[0-9a-fA-F]{40}$/.test(addressOrSymbol)) return this.getSync(addressOrSymbol)
    if (addressOrSymbol.toUpperCase() === 'ETH') return this.native()
    const dep = this.ctx.deployment.tokens.find((t) => t.symbol.toLowerCase() === addressOrSymbol.toLowerCase())
    return dep ? this.getSync(dep.address) : undefined
  }

  async get(address: string): Promise<TokenInfo | undefined> {
    const known = this.getSync(address)
    if (known) return known
    try {
      const a = getAddress(address)
      const [symbol, name, decimals] = await Promise.all([
        this.ctx.client.readContract({ address: a, abi: erc20Abi, functionName: 'symbol' }),
        this.ctx.client.readContract({ address: a, abi: erc20Abi, functionName: 'name' }),
        this.ctx.client.readContract({ address: a, abi: erc20Abi, functionName: 'decimals' }),
      ])
      const t = { address: a, symbol, name, decimals: Number(decimals) }
      this.ctx.db.insert('tokens', { address: lc(a), symbol, name, decimals: Number(decimals) }, 'REPLACE')
      this.cache.set(lc(a), t)
      return t
    } catch {
      return undefined
    }
  }

  /** All tokens known to the deployment plus any discovered via pools. */
  all(): TokenInfo[] {
    const seen = new Set<string>()
    const out: TokenInfo[] = []
    for (const t of this.ctx.deployment.tokens) {
      const info = this.getSync(t.address)!
      seen.add(lc(t.address))
      out.push(info)
    }
    for (const row of this.ctx.db.all<{ address: string }>('SELECT address FROM tokens')) {
      if (seen.has(row.address)) continue
      const info = this.getSync(row.address)
      if (info) out.push(info)
    }
    return out
  }

  clear() {
    this.cache.clear()
  }
}

export function tokenJson(ctx: Context, t: TokenInfo) {
  const isStable = STABLE_SYMBOLS.has(t.symbol)
  return {
    chainId: ctx.deployment.chainId ?? metachainDevnet.id,
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logoURI: `/tokens/${t.symbol}.svg`,
    ...(t.isNative ? { isNative: true } : {}),
    tags: t.isNative ? ['native'] : isStable ? ['stablecoin'] : t.symbol === 'WETH' ? ['wrapped'] : [],
  }
}
