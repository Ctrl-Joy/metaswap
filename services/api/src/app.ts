import { Hono, type Context as HonoContext } from 'hono'
import { cors } from 'hono/cors'
import { verifyAgainstSdk } from './abis'
import { Accounts } from './accounts'
import { Analytics } from './analytics'
import { HttpError, createContext, hasDeployment, tokenJson, type Context } from './context'
import { loadConfig, type Config } from './config'
import { Filler } from './filler/filler'
import { Indexer } from './indexer/indexer'
import { jsonSafe } from './lib/json'
import { QuoteService } from './routing/quote'
import { XService } from './x/service'
import { deployment as sdkDeployment, metachainDevnet, METACHAIN_NETWORKS, type Deployment } from '@metaswap/sdk'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { API_ROOT } from './config'

/**
 * Deployment source: METASWAP_DEPLOYMENT_FILE, else the synced @metaswap/sdk copy, else (when the sdk
 * copy is still the empty placeholder) packages/contracts/deployments/31337.json.
 */
export function loadDeployment(): Deployment {
  const file = process.env.METASWAP_DEPLOYMENT_FILE
  if (file) return JSON.parse(readFileSync(file, 'utf8')) as Deployment
  if (sdkDeployment.contracts && Object.keys(sdkDeployment.contracts).length) return sdkDeployment
  const fallback = resolve(API_ROOT, '../../packages/contracts/deployments/31337.json')
  if (existsSync(fallback)) return JSON.parse(readFileSync(fallback, 'utf8')) as Deployment
  return sdkDeployment
}

export interface Services {
  ctx: Context
  indexer: Indexer
  analytics: Analytics
  quotes: QuoteService
  x: XService
  filler: Filler
  accounts: Accounts
}

export function createServices(overrides: Partial<Config> = {}, deployment?: Deployment): Services {
  const config = loadConfig(overrides)
  const ctx = createContext(config, deployment ?? loadDeployment())
  const indexer = new Indexer(ctx)
  const analytics = new Analytics(ctx, indexer)
  const quotes = new QuoteService(ctx, indexer)
  const x = new XService(ctx, indexer, quotes)
  const filler = new Filler(ctx, indexer, quotes.router, x)
  const accounts = new Accounts(ctx, indexer, analytics, quotes.router, x)
  return { ctx, indexer, analytics, quotes, x, filler, accounts }
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) throw new HttpError(400, `invalid number ${v}`)
  return n
}

export function createApp(s: Services) {
  const app = new Hono()
  const { ctx } = s
  app.use('*', cors({ origin: ctx.config.corsOrigins, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['content-type'] }))

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...(err.details ? { details: jsonSafe(err.details) } : {}) }, err.status as 400)
    console.error('[api]', err)
    return c.json({ error: (err as Error).message?.split('\n')[0] ?? 'internal error' }, 500)
  })
  app.notFound((c) => c.json({ error: 'not found' }, 404))

  const json = (c: HonoContext, v: unknown) => c.json(jsonSafe(v) as object)
  const requireDeployment = () => {
    if (!hasDeployment(ctx)) throw new HttpError(503, 'Contracts are not deployed (run node scripts/dev.mjs --chain-only)')
  }

  app.get('/', (c) => c.json({ name: 'MetaSwap API', chain: metachainDevnet.name, docs: 'services/api/README.md' }))

  app.get('/health', async (c) => {
    let headBlock: number | null = null
    let chainId: number | null = null
    try {
      const [h, id] = await Promise.all([ctx.client.getBlockNumber({ cacheTime: 0 }), ctx.client.getChainId()])
      headBlock = Number(h)
      chainId = id
    } catch {}
    const deployed = hasDeployment(ctx)
    const ok = headBlock !== null && deployed && s.indexer.indexedBlock >= 0 && headBlock - s.indexer.indexedBlock <= 5
    return c.json({
      ok,
      chainId,
      indexedBlock: s.indexer.indexedBlock,
      headBlock,
      deployment: deployed ? { blockNumber: ctx.deployment.blockNumber, contracts: Object.keys(ctx.deployment.contracts).length } : null,
      indexerError: s.indexer.lastError,
      filler: s.filler.status(),
      networks: METACHAIN_NETWORKS,
    })
  })

  app.get('/tokens', (c) => {
    requireDeployment()
    return c.json({
      name: 'MetaSwap Devnet',
      timestamp: new Date().toISOString(),
      version: { major: 1, minor: 0, patch: 0 },
      keywords: ['metaswap', 'devnet'],
      tokens: [tokenJson(ctx, s.indexer.tokens.native()), ...s.analytics.tokenListJson()],
    })
  })
  app.get('/tokens/:address', async (c) => json(c, await s.analytics.tokenStats(c.req.param('address'))))
  app.get('/tokens/:address/candles', (c) =>
    json(c, s.analytics.candles(c.req.param('address'), c.req.query('interval') ?? '1h', num(c.req.query('from')), num(c.req.query('to')))),
  )
  app.get('/tokens/:address/price-history', (c) => json(c, s.analytics.priceHistory(c.req.param('address'), c.req.query('range') ?? '1D')))

  app.get('/explore/stats', (c) => json(c, s.analytics.exploreStats(c.req.query('interval') === 'day' ? 'day' : 'hour')))
  app.get('/explore/tokens', async (c) => json(c, await s.analytics.exploreTokens(c.req.query('sort') ?? 'volume', c.req.query('order') ?? 'desc')))
  app.get('/explore/pools', (c) => json(c, s.analytics.explorePools(c.req.query('sort') ?? 'tvl', c.req.query('order') ?? 'desc')))
  app.get('/explore/transactions', (c) =>
    json(
      c,
      s.analytics.transactions({
        type: c.req.query('type'),
        token: c.req.query('token'),
        pool: c.req.query('pool'),
        account: c.req.query('account'),
        limit: num(c.req.query('limit')),
        before: num(c.req.query('before')),
      }),
    ),
  )

  app.get('/pools/:address', (c) => json(c, s.analytics.poolDetail(c.req.param('address'))))
  app.get('/pools/:address/history', (c) => json(c, s.analytics.poolHistory(c.req.param('address'), c.req.query('interval') === 'day' ? 'day' : 'hour')))
  app.get('/pools/:address/ticks', (c) => json(c, s.analytics.poolTicks(c.req.param('address'))))
  app.get('/pools/:address/transactions', (c) => json(c, s.analytics.transactions({ pool: c.req.param('address'), type: c.req.query('type'), limit: num(c.req.query('limit')) })))

  app.get('/accounts/:address/activity', (c) => json(c, s.accounts.activity(c.req.param('address'), num(c.req.query('limit')) ?? 100)))
  app.get('/accounts/:address/positions', async (c) => json(c, await s.accounts.positions(c.req.param('address'))))
  app.get('/accounts/:address/balances', async (c) => json(c, await s.accounts.balances(c.req.param('address'))))

  app.get('/quote', async (c) => {
    requireDeployment()
    const q = c.req.query()
    return json(c, await s.quotes.quote({ ...q, tokenIn: q.tokenIn, tokenOut: q.tokenOut, amount: q.amount }))
  })
  app.post('/swap', async (c) => {
    requireDeployment()
    const body = await c.req.json().catch(() => {
      throw new HttpError(400, 'body must be JSON')
    })
    return json(c, await s.quotes.swap(body))
  })

  app.get('/x/quote', async (c) => {
    requireDeployment()
    return json(c, await s.x.quote(c.req.query()))
  })
  app.post('/x/orders', async (c) => {
    requireDeployment()
    const body = await c.req.json().catch(() => {
      throw new HttpError(400, 'body must be JSON')
    })
    const order = await s.x.submit(body)
    return c.json(jsonSafe(order) as object, 201)
  })
  app.get('/x/orders', (c) => json(c, s.x.list({ swapper: c.req.query('swapper'), status: c.req.query('status'), limit: c.req.query('limit') })))
  app.get('/x/orders/:hash', async (c) => json(c, await s.x.get(c.req.param('hash'))))
  app.get('/x/filler', (c) => json(c, s.filler.status()))

  return app
}

export async function startServices(s: Services) {
  const problems = verifyAgainstSdk()
  if (problems.length) console.warn(`[api] ABI check vs @metaswap/sdk:\n  ${problems.join('\n  ')}`)
  if (!hasDeployment(s.ctx)) console.warn('[api] deployment is empty — indexer/quotes idle until contracts are deployed and synced')
  s.x.watch()
  if (s.ctx.config.indexerEnabled) await s.indexer.start()
  await s.filler.start()
  if (s.filler.disabledReason) console.warn(`[filler] disabled: ${s.filler.disabledReason}`)
}

export function stopServices(s: Services) {
  s.filler.stop()
  s.indexer.stop()
}
