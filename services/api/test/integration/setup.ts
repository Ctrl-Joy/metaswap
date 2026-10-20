import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createApp, createServices, loadDeployment, startServices, stopServices, type Services } from '../../src/app'
import { metachainDevnet } from '@metaswap/sdk'

export const RPC = process.env.METASWAP_RPC ?? 'http://127.0.0.1:8545'

// Anvil dev keys (public, local devnet only). #0 deploys/seeds, #9 is the filler.
export const KEYS = {
  swapper: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // #3
  trader: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // #4
  xUser: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // #5
} as const

export const testErc20Abi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function deposit() payable',
])

/** True when METASWAP_RPC answers and the deployment's UniversalRouter + reactor have code there. */
export async function chainAvailable(): Promise<boolean> {
  try {
    const d = loadDeployment()
    if (!d.contracts?.UniversalRouter || !d.contracts?.ExclusiveDutchOrderReactor || !d.pools?.v3?.length) return false
    const client = createPublicClient({ transport: http(RPC, { timeout: 2000, retryCount: 0 }) })
    const [code, xcode] = await Promise.all([client.getCode({ address: d.contracts.UniversalRouter }), client.getCode({ address: d.contracts.ExclusiveDutchOrderReactor })])
    return Boolean(code && code !== '0x' && xcode && xcode !== '0x')
  } catch {
    return false
  }
}

export interface Harness {
  s: Services
  app: ReturnType<typeof createApp>
  client: PublicClient
  get: <T = any>(path: string) => Promise<{ status: number; body: T }>
  post: <T = any>(path: string, body: unknown) => Promise<{ status: number; body: T }>
  token: (symbol: string) => Address
  wallet: (key: Hex) => ReturnType<typeof walletFor>
  /** a brand-new account funded with 1000 ETH (anvil_setBalance) so reruns start from a clean state */
  freshWallet: () => Promise<ReturnType<typeof walletFor>>
  stop: () => void
}

function walletFor(key: Hex) {
  const account = privateKeyToAccount(key)
  const chain = { ...metachainDevnet, rpcUrls: { default: { http: [RPC] } } }
  return createWalletClient({ account, chain, transport: http(RPC) })
}

export async function startHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'metaswap-api-'))
  const s = createServices({ rpcUrl: RPC, dbPath: join(dir, 'test.sqlite'), pollMs: 250, fillerEnabled: process.env.FILLER_ENABLED !== 'false' })
  const app = createApp(s)
  await startServices(s)
  const client = s.ctx.client
  const req = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init)
    return { status: res.status, body: (await res.json()) as any }
  }
  return {
    s,
    app,
    client,
    get: (path) => req(path),
    post: (path, body) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    token: (symbol) => getAddress(s.ctx.deployment.tokens.find((t) => t.symbol === symbol)!.address),
    wallet: walletFor,
    freshWallet: async () => {
      const w = walletFor(generatePrivateKey())
      await client.request({ method: 'anvil_setBalance' as never, params: [w.account.address, '0x3635c9adc5dea00000'] as never })
      return w
    },
    stop: () => {
      stopServices(s)
      s.ctx.db.close()
    },
  }
}
