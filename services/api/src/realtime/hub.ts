import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { getAddress, isAddress } from 'viem'
import { WebSocket, WebSocketServer } from 'ws'
import type { Services } from '../app'
import { lc } from '../context'
import type { Row, WriteBatch } from '../db'
import { jsonSafe } from '../lib/json'

/**
 * Real-time push at ws://<host>:<port>/ws (client contract: README "WebSocket").
 *
 * Client → server: {"op":"subscribe","topics":[...]}, {"op":"unsubscribe","topics":[...]}, {"op":"ping"}
 * Server → client: {"type":"hello"|"subscribed"|"unsubscribed"|"pong"|"error", ...}
 *                  {"type":"event","topic":"<topic>","event":"<name>","block":<n>,"data":{...}}
 *
 * Topics: blocks · prices · explore · launches · x:orders · token:<addr> · pool:<addr> · account:<addr>
 * Events are produced from the indexer as it commits each block range, so they always agree with
 * what the REST endpoints return at that moment.
 */

const STATIC_TOPICS = new Set(['blocks', 'prices', 'explore', 'launches', 'x:orders'])
const PREFIXES = ['token:', 'pool:', 'account:']
const ZERO = '0x0000000000000000000000000000000000000000'
/** min seconds between throttled pushes (explore stats, untouched-account portfolio values) */
const THROTTLE_MS = 5_000
const MAX_TOPICS_PER_CLIENT = 200

export function normalizeTopic(t: unknown): string | null {
  if (typeof t !== 'string') return null
  const s = t.trim()
  if (STATIC_TOPICS.has(s)) return s
  for (const p of PREFIXES) {
    if (s.startsWith(p)) {
      const a = s.slice(p.length)
      return isAddress(a, { strict: false }) ? p + lc(a) : null
    }
  }
  return null
}

interface Client {
  ws: WebSocket
  topics: Set<string>
  alive: boolean
}

export class RealtimeHub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
  private clients = new Set<Client>()
  private queue: Promise<void> = Promise.resolve()
  private lastPrices = new Map<string, number>()
  private lastStatsAt = 0
  private lastAccountPush = new Map<string, number>()
  private launchStatus = new Map<string, string>()
  private lastLaunchPoll = 0
  private heartbeat: NodeJS.Timeout | null = null
  /** published events (tests / diagnostics) */
  sent = 0

  constructor(private s: Services) {
    this.wss.on('connection', (ws) => this.onConnection(ws))
    s.indexer.on('indexed', (to: number, ts: number, batch?: WriteBatch, from?: number) => {
      // publish strictly in order; a slow publish delays the next one instead of interleaving
      this.queue = this.queue.then(() => this.publish(to, ts, batch, from ?? to).catch((e) => console.error('[ws] publish', (e as Error).message)))
    })
    s.indexer.on('reset', () => {
      this.lastPrices.clear()
      this.launchStatus.clear()
      this.broadcast('blocks', 'reset', s.indexer.indexedBlock, {})
    })
    s.indexer.on('reorg', (block: number) => this.broadcast('blocks', 'reorg', block, { rolledBackTo: block }))
    s.x.events.on('order', (order: { swapper: string; orderHash: string }) => {
      this.broadcast('x:orders', 'order', s.indexer.indexedBlock, order)
      this.broadcast(`account:${lc(order.swapper)}`, 'order', s.indexer.indexedBlock, order)
    })
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate()
          continue
        }
        c.alive = false
        c.ws.ping()
      }
    }, 30_000)
  }

  /** Route `GET /ws` upgrades on the HTTP server to this hub. */
  attach(server: Server) {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (req.url ?? '').split('?')[0]
      if (path !== '/ws') {
        socket.destroy()
        return
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req))
    })
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    for (const c of this.clients) c.ws.terminate()
    this.wss.close()
  }

  get subscriberCount() {
    return this.clients.size
  }

  private onConnection(ws: WebSocket) {
    const c: Client = { ws, topics: new Set(), alive: true }
    this.clients.add(c)
    ws.on('pong', () => (c.alive = true))
    ws.on('close', () => this.clients.delete(c))
    ws.on('error', () => this.clients.delete(c))
    ws.on('message', (raw) => this.onMessage(c, raw.toString()))
    this.send(c, { type: 'hello', indexedBlock: this.s.indexer.indexedBlock, indexedTimestamp: this.s.indexer.indexedTimestamp, topics: [...STATIC_TOPICS, 'token:<address>', 'pool:<address>', 'account:<address>'] })
  }

  private onMessage(c: Client, raw: string) {
    let msg: { op?: string; topics?: unknown; id?: unknown }
    try {
      msg = JSON.parse(raw)
    } catch {
      return this.send(c, { type: 'error', message: 'messages must be JSON' })
    }
    const id = msg.id
    if (msg.op === 'ping') return this.send(c, { type: 'pong', id })
    if (msg.op !== 'subscribe' && msg.op !== 'unsubscribe') return this.send(c, { type: 'error', id, message: 'op must be subscribe|unsubscribe|ping' })
    const list = Array.isArray(msg.topics) ? msg.topics : [msg.topics]
    const ok: string[] = []
    const bad: unknown[] = []
    for (const t of list) {
      const n = normalizeTopic(t)
      if (n) ok.push(n)
      else bad.push(t)
    }
    if (msg.op === 'subscribe') {
      for (const t of ok) if (c.topics.size < MAX_TOPICS_PER_CLIENT) c.topics.add(t)
      this.send(c, { type: 'subscribed', id, topics: [...c.topics], ...(bad.length ? { invalid: bad } : {}) })
      // initial snapshots so a fresh subscriber renders without a REST round trip
      void this.snapshot(c, ok).catch(() => {})
    } else {
      for (const t of ok) c.topics.delete(t)
      this.send(c, { type: 'unsubscribed', id, topics: [...c.topics], ...(bad.length ? { invalid: bad } : {}) })
    }
  }

  private send(c: Client, msg: unknown) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(jsonSafe(msg)))
  }

  private subscribed(topic: string): boolean {
    for (const c of this.clients) if (c.topics.has(topic)) return true
    return false
  }

  /** Subscribed topics with a prefix, e.g. every `account:*`. */
  private subscribedWith(prefix: string): Set<string> {
    const out = new Set<string>()
    for (const c of this.clients) for (const t of c.topics) if (t.startsWith(prefix)) out.add(t.slice(prefix.length))
    return out
  }

  broadcast(topic: string, event: string, block: number, data: unknown) {
    let msg: string | null = null
    for (const c of this.clients) {
      if (!c.topics.has(topic) || c.ws.readyState !== WebSocket.OPEN) continue
      msg ??= JSON.stringify(jsonSafe({ type: 'event', topic, event, block, data }))
      c.ws.send(msg)
      this.sent++
    }
  }

  private async snapshot(c: Client, topics: string[]) {
    const { analytics, indexer } = this.s
    const block = indexer.indexedBlock
    for (const t of topics) {
      const msg = (event: string, data: unknown) => this.send(c, { type: 'event', topic: t, event, block, data, snapshot: true })
      if (t === 'blocks') msg('block', { number: block, timestamp: indexer.indexedTimestamp })
      else if (t === 'prices') msg('prices', { timestamp: indexer.indexedTimestamp, prices: this.priceMap() })
      else if (t === 'explore') msg('stats', await this.statsSummary())
      else if (t.startsWith('pool:') && indexer.pools.has(t.slice(5))) msg('state', await this.poolState(t.slice(5)))
      else if (t.startsWith('token:')) {
        const tok = indexer.tokens.getSync(t.slice(6))
        if (tok) msg('price', { token: tok.address, priceUsd: analytics.priceUsd(tok.address) })
      } else if (t.startsWith('account:')) msg('portfolio', await this.portfolioSummary(t.slice(8)))
    }
  }

  private priceMap(only?: Set<string>) {
    const out: Record<string, number> = {}
    for (const [k, v] of this.s.indexer.prices) if (!only || only.has(k)) out[getAddress(k)] = v
    return out
  }

  private async statsSummary() {
    const st = await this.s.analytics.exploreStats('hour')
    return { tvlUsd: st.tvlUsd, volume24hUsd: st.volume24hUsd, volume7dUsd: st.volume7dUsd, txCount24h: st.txCount24h, v2: st.v2, v3: st.v3 }
  }

  private async poolState(address: string) {
    const d = await this.s.analytics.poolDetail(address)
    return {
      address: d.address,
      version: d.version,
      reserve0: d.reserve0,
      reserve1: d.reserve1,
      sqrtPriceX96: d.sqrtPriceX96,
      tick: d.tick,
      liquidity: d.liquidity,
      token0Price: d.token0Price,
      token1Price: d.token1Price,
      tvlUsd: d.tvlUsd,
      volume24hUsd: d.volume24hUsd,
      fees24hUsd: d.fees24hUsd,
      apr: d.apr,
    }
  }

  private async portfolioSummary(address: string) {
    const p = await this.s.portfolio.portfolio(address)
    return {
      address: p.address,
      totalUsd: p.totalUsd,
      tokensUsd: p.tokensUsd,
      earnUsd: p.earnUsd,
      poolsUsd: p.poolsUsd,
      change24hUsd: p.change24hUsd,
      change24hPct: p.change24hPct,
      tokens: p.tokens,
      pools: p.pools,
      earn: p.earn,
    }
  }

  /** Format swap / liquidity rows from a batch like /explore/transactions does. */
  private txRows(batch: WriteBatch) {
    const { analytics, indexer } = this.s
    const out: { pool: string; token0: string; token1: string; origin: string; tx: Record<string, unknown> }[] = []
    const add = (r: Row, kind: 'swap' | 'liq') => {
      const pool = indexer.pools.get(String(r.pool))
      if (!pool) return
      const row = { ...r, token0: pool.token0, token1: pool.token1, fee: pool.fee } as Record<string, string | number | null>
      if (kind === 'liq' && row.amount0 === '0' && row.amount1 === '0') return
      try {
        out.push({ pool: pool.address, token0: pool.token0, token1: pool.token1, origin: String(r.origin), tx: kind === 'swap' ? analytics.swapTx(row) : analytics.liqTx(row) })
      } catch {
        /* unknown token metadata */
      }
    }
    for (const r of batch.rows('swaps')) add(r, 'swap')
    for (const r of batch.rows('liquidity_events')) add(r, 'liq')
    return out.sort((a, b) => Number(a.tx.blockNumber) - Number(b.tx.blockNumber) || Number(a.tx.logIndex) - Number(b.tx.logIndex))
  }

  /** Accounts that appear in a batch (as origin, sender/receiver, bidder, owner, ...). */
  private touchedAccounts(batch: WriteBatch): Set<string> {
    const out = new Set<string>()
    const cols: Record<string, string[]> = {
      swaps: ['origin', 'recipient'],
      liquidity_events: ['origin', 'owner'],
      transfers: ['from_addr', 'to_addr'],
      weth_events: ['account', 'origin'],
      native_transfers: ['from_addr', 'to_addr'],
      tx_values: ['from_addr', 'to_addr'],
      nft_transfers: ['from_addr', 'to_addr'],
      nft_events: ['origin'],
      earn_events: ['owner', 'receiver'],
      bids: ['bidder'],
      claims: ['bidder'],
      fills: ['swapper', 'filler'],
    }
    for (const [table, cs] of Object.entries(cols)) for (const r of batch.rows(table)) for (const c of cs) if (r[c] && r[c] !== ZERO) out.add(String(r[c]))
    return out
  }

  private async publish(to: number, ts: number, batch: WriteBatch | undefined, from: number) {
    if (!this.clients.size || !batch) {
      // keep the price baseline current so the first subscriber gets real diffs
      this.lastPrices = new Map(this.s.indexer.prices)
      return
    }
    const { analytics, indexer, accounts, launches } = this.s
    const lastBlock = batch.rows('blocks').at(-1)

    // blocks
    this.broadcast('blocks', 'block', to, { number: to, hash: lastBlock?.hash ?? null, timestamp: ts })

    // prices (changed only)
    const changed = new Set<string>()
    for (const [k, v] of indexer.prices) if (this.lastPrices.get(k) !== v) changed.add(k)
    this.lastPrices = new Map(indexer.prices)
    if (changed.size) this.broadcast('prices', 'prices', to, { timestamp: ts, prices: this.priceMap(changed) })

    const txs = this.txRows(batch)

    // explore: new txs every range, stats throttled
    if (this.subscribed('explore')) {
      if (txs.length) this.broadcast('explore', 'txs', to, txs.slice(-100).map((x) => x.tx))
      if (Date.now() - this.lastStatsAt > THROTTLE_MS) {
        this.lastStatsAt = Date.now()
        this.broadcast('explore', 'stats', to, await this.statsSummary())
      }
    }

    // token:<addr>
    for (const token of this.subscribedWith('token:')) {
      const key = analytics.poolKey(token)
      const own = txs.filter((x) => x.token0 === key || x.token1 === key).map((x) => x.tx)
      if (!changed.has(key) && !own.length) continue
      const topic = `token:${token}`
      if (changed.has(key)) {
        const candles = await analytics.candles(token, '1m', ts - 120, ts).catch(() => [])
        this.broadcast(topic, 'price', to, { token: getAddress(token), priceUsd: analytics.priceUsd(token), timestamp: ts })
        if (candles.length) this.broadcast(topic, 'candle', to, { interval: '1m', candle: candles[candles.length - 1] })
      }
      if (own.length) this.broadcast(topic, 'txs', to, own)
    }

    // pool:<addr>
    const snapPools = new Set(batch.rows('pool_snapshots').map((r) => String(r.pool)))
    for (const pool of this.subscribedWith('pool:')) {
      const own = txs.filter((x) => x.pool === pool).map((x) => x.tx)
      if (!own.length && !snapPools.has(pool)) continue
      const topic = `pool:${pool}`
      if (indexer.pools.has(pool)) this.broadcast(topic, 'state', to, await this.poolState(pool))
      if (own.length) this.broadcast(topic, 'txs', to, own)
    }

    // account:<addr>
    const accountsSubscribed = this.subscribedWith('account:')
    if (accountsSubscribed.size) {
      const touched = this.touchedAccounts(batch)
      for (const a of accountsSubscribed) {
        const topic = `account:${a}`
        if (touched.has(a)) {
          const [activity, balances, positions, portfolio] = await Promise.all([
            accounts.activity(a, 50),
            accounts.balances(a),
            accounts.positions(a),
            this.portfolioSummary(a),
          ])
          this.broadcast(topic, 'activity', to, activity.filter((x) => x.blockNumber !== null && Number(x.blockNumber) >= from && Number(x.blockNumber) <= to))
          this.broadcast(topic, 'balances', to, balances)
          this.broadcast(topic, 'positions', to, positions)
          this.broadcast(topic, 'portfolio', to, portfolio)
          this.lastAccountPush.set(a, Date.now())
        } else if (changed.size && Date.now() - (this.lastAccountPush.get(a) ?? 0) > THROTTLE_MS) {
          // prices moved: the value changes even without account activity
          this.lastAccountPush.set(a, Date.now())
          this.broadcast(topic, 'portfolio', to, await this.portfolioSummary(a))
        }
      }
    }

    // launches
    if (this.subscribed('launches')) {
      for (const r of batch.rows('launches')) this.broadcast('launches', 'launch', to, { auction: getAddress(String(r.auction)), token: getAddress(String(r.token)), name: r.name, symbol: r.symbol, launchpad: getAddress(String(r.launchpad)) })
      for (const r of batch.rows('bids'))
        this.broadcast('launches', 'bid', to, { auction: getAddress(String(r.auction)), bidId: r.bid_id, bidder: getAddress(String(r.bidder)), amount: r.amount, maxPrice: r.max_price, txHash: r.tx_hash, blockNumber: r.block, timestamp: r.timestamp })
      for (const r of batch.rows('settlements'))
        this.broadcast('launches', 'settled', to, { auction: getAddress(String(r.auction)), launched: Boolean(r.launched), clearingPrice: r.clearing_price, raised: r.raised, pool: r.pool ? getAddress(String(r.pool)) : null, txHash: r.tx_hash })
      for (const r of batch.rows('claims')) this.broadcast('launches', 'claim', to, { auction: getAddress(String(r.auction)), bidId: r.bid_id, bidder: getAddress(String(r.bidder)), tokens: r.tokens, refund: r.refund, txHash: r.tx_hash })
      // status transitions (upcoming → active → ended happen by time, not by events)
      const activity = batch.rows('launches').length + batch.rows('bids').length + batch.rows('settlements').length
      if (activity || Date.now() - this.lastLaunchPoll > THROTTLE_MS) {
        this.lastLaunchPoll = Date.now()
        const rows = await launches.list({})
        const bidAuctions = new Set(batch.rows('bids').map((r) => String(r.auction)))
        for (const row of rows) {
          const k = lc(row.auction)
          const prev = this.launchStatus.get(k)
          if (prev !== row.status || bidAuctions.has(k)) this.broadcast('launches', 'update', to, { ...row, previousStatus: prev ?? null })
          this.launchStatus.set(k, row.status)
        }
      }
    }
  }
}
