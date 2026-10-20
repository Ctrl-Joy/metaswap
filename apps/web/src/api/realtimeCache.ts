import type { Query, QueryClient, QueryKey } from '@tanstack/react-query'
import { NATIVE_ADDRESS, deployment } from '@metaswap/sdk'
import { normalizeTx } from '@/features/explore/transforms'
import type { TxRow } from '@/features/explore/types'
import { asList } from './client'
import type { RealtimeEvent } from './realtime'

// Bridge from WebSocket events to the TanStack Query cache. Small deltas (a price, a new tx row,
// the portfolio total, a block number) are written with setQueryData so the UI updates in place;
// everything else is invalidated (throttled) and refetched over REST. All API keys start with ['api', …].

type AnyKey = readonly unknown[]
const lc = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v)
const isAddr = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
const sameAddr = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

const WETH = (deployment.tokens ?? []).find((t) => t.symbol === 'WETH')?.address?.toLowerCase()
const NATIVE = NATIVE_ADDRESS.toLowerCase()

/** Queries whose key starts with `prefix` (strings compare case-insensitively; `undefined` matches anything). */
export function findQueries(qc: QueryClient, prefix: AnyKey): Query[] {
  return qc.getQueryCache().findAll({
    predicate: (q) => {
      const k = q.queryKey
      if (k.length < prefix.length) return false
      return prefix.every((p, i) => p === undefined || lc(k[i]) === lc(p))
    },
  })
}

function update<T>(qc: QueryClient, prefix: AnyKey, fn: (old: T, key: QueryKey) => T | undefined) {
  for (const q of findQueries(qc, prefix)) {
    const old = q.state.data as T | undefined
    if (old === undefined) continue
    const next = fn(old, q.queryKey)
    if (next !== undefined && next !== old) qc.setQueryData(q.queryKey, next)
  }
}

/** Invalidate queries matching a prefix, at most once per `ms` per prefix (bursty events). */
export class Throttler {
  private last = new Map<string, number>()
  private pending = new Map<string, ReturnType<typeof setTimeout>>()
  constructor(private now: () => number = Date.now) {}
  run(key: string, ms: number, fn: () => void) {
    const t = this.now()
    const prev = this.last.get(key)
    if (prev === undefined || t - prev >= ms) {
      this.last.set(key, t)
      fn()
      return
    }
    if (this.pending.has(key)) return
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key)
        this.last.set(key, this.now())
        fn()
      }, ms - (t - (prev ?? t))),
    )
  }
}

export interface BridgeContext {
  /** Connected wallet (wagmi balance reads are invalidated on its account events). */
  account?: string
  throttle: Throttler
}

const invalidate = (qc: QueryClient, ctx: BridgeContext, prefix: AnyKey, ms = 1_000) =>
  ctx.throttle.run(JSON.stringify(prefix.map(lc)), ms, () => void qc.invalidateQueries({ predicate: (q) => prefix.every((p, i) => p === undefined || lc(q.queryKey[i]) === lc(p)) }))

/** On-chain reads made through wagmi / our chain hooks. */
export function invalidateWalletReads(qc: QueryClient, ctx: BridgeContext) {
  for (const k of ['balances', 'balance', 'readContract', 'readContracts', 'allowance']) invalidate(qc, ctx, [k], 750)
}

/* ------------------------------------------------------------------ helpers on cached shapes */

type Point = { time: number; value: number }

/** Update the last point in place (same bucket) or append a newer one, so the chart's last point moves live. */
export function upsertLastPoint<P extends Record<string, unknown> & { time: number }>(series: P[], time: number, patch: Partial<P>): P[] {
  if (!series.length) return series
  const last = series[series.length - 1]!
  if (time <= last.time) return [...series.slice(0, -1), { ...last, ...patch }]
  const prev = series.length > 1 ? series[series.length - 2]!.time : last.time - 60
  const step = Math.max(1, last.time - prev)
  if (time - last.time < step) return [...series.slice(0, -1), { ...last, ...patch }]
  return [...series, { ...last, ...patch, time } as P]
}

function setPrice(row: Record<string, unknown>, prices: Record<string, number>): Record<string, unknown> {
  const addr = lc((row.address ?? (row.token as { address?: string } | undefined)?.address) as string | undefined) as string | undefined
  if (!addr) return row
  const p = prices[addr] ?? (addr === NATIVE && WETH ? prices[WETH] : undefined)
  return p === undefined || row.priceUsd === p ? row : { ...row, priceUsd: p }
}

function mapList<T>(old: unknown, fn: (row: T) => T): unknown {
  if (Array.isArray(old)) {
    let changed = false
    const next = old.map((r) => {
      const n = fn(r as T)
      if (n !== r) changed = true
      return n
    })
    return changed ? next : old
  }
  return old
}

const txKey = (t: Record<string, unknown>) => `${String(t.txHash ?? t.hash ?? '')}:${String(t.logIndex ?? '')}:${String(t.type ?? '')}`

/** Prepend new items (newest first) to a cached list, dedupe, keep the list length. */
export function prependUnique<T>(old: T[], incoming: T[], key: (t: T) => string): T[] {
  if (!incoming.length) return old
  const seen = new Set(old.map(key))
  const fresh = incoming.filter((t) => !seen.has(key(t)))
  if (!fresh.length) return old
  // grow up to 50 rows, never past the list's own size beyond that (memory stays bounded)
  return [...fresh, ...old].slice(0, Math.max(old.length, 50))
}

/** Raw API tx items arrive oldest first; lists are newest first. */
function newestFirst(items: unknown): Record<string, unknown>[] {
  return (Array.isArray(items) ? (items as Record<string, unknown>[]) : []).slice().reverse()
}

function txTouches(item: Record<string, unknown>, filter: { token?: string; pool?: string; type?: string }): boolean {
  if (filter.pool && !sameAddr(item.pool, filter.pool)) return false
  if (filter.type) {
    const t = String(item.type ?? '').toLowerCase()
    const kind = t === 'mint' ? 'add' : t === 'burn' ? 'remove' : t
    if (kind !== filter.type) return false
  }
  if (filter.token) {
    const want = filter.token.toLowerCase() === NATIVE && WETH ? WETH : filter.token.toLowerCase()
    const addrs = [item.tokenIn, item.tokenOut, item.token0, item.token1].map((t) => lc(typeof t === 'string' ? t : (t as { address?: string } | undefined)?.address))
    if (!addrs.includes(want)) return false
  }
  return true
}

/** Prepend pushed txs into every cached transactions list whose filter they match. */
export function prependTxs(qc: QueryClient, items: unknown) {
  const incoming = newestFirst(items)
  if (!incoming.length) return
  // features/explore: ['api','explore','transactions','rows', filter, limit] → TxRow[]
  update<TxRow[]>(qc, ['api', 'explore', 'transactions', 'rows'], (old, key) => {
    if (!Array.isArray(old)) return undefined
    const filter = (key[4] ?? {}) as { token?: string; pool?: string; type?: string }
    const rows = incoming.filter((i) => txTouches(i, filter)).map((i) => normalizeTx(i)).filter((t): t is TxRow => t !== null)
    return prependUnique(old, rows, (t) => t.id)
  })
  // api/hooks: ['api','explore','transactions', params] → raw items
  update<Record<string, unknown>[]>(qc, ['api', 'explore', 'transactions'], (old, key) => {
    if (!Array.isArray(old) || key[3] === 'rows') return undefined
    const filter = (key[3] ?? {}) as { token?: string; pool?: string; type?: string }
    return prependUnique(old, incoming.filter((i) => txTouches(i, filter)), txKey)
  })
}

/* ------------------------------------------------------------------ event → cache */

export function applyRealtimeEvent(qc: QueryClient, ev: RealtimeEvent, ctx: BridgeContext) {
  const [kind, arg] = splitTopic(ev.topic)
  const data = ev.data as Record<string, unknown>
  switch (kind) {
    case 'blocks':
      if (ev.event === 'block' && typeof data?.number === 'number') {
        update<Record<string, unknown>>(qc, ['api', 'health'], (old) => (typeof old === 'object' && old && (old.indexedBlock as number) < (data.number as number) ? { ...old, indexedBlock: data.number } : undefined))
      } else if (ev.event === 'reorg' || ev.event === 'reset') {
        void qc.invalidateQueries({ queryKey: ['api'] })
        invalidateWalletReads(qc, ctx)
      }
      return
    case 'prices': {
      const raw = (data?.prices ?? {}) as Record<string, number>
      const prices: Record<string, number> = {}
      for (const [a, p] of Object.entries(raw)) if (typeof p === 'number') prices[a.toLowerCase()] = p
      if (WETH && prices[WETH] !== undefined) prices[NATIVE] = prices[WETH]
      applyPrices(qc, prices, Number(data?.timestamp) || Math.floor(Date.now() / 1000))
      return
    }
    case 'token':
      if (!arg) return
      if (ev.event === 'price' && typeof data?.priceUsd === 'number') {
        const prices: Record<string, number> = { [arg]: data.priceUsd }
        if (arg === WETH) prices[NATIVE] = data.priceUsd
        applyPrices(qc, prices, Number(data.timestamp) || Math.floor(Date.now() / 1000))
      } else if (ev.event === 'candle') {
        invalidate(qc, ctx, ['api', 'tokens', arg, 'candles'], 5_000)
      } else if (ev.event === 'txs') {
        prependTxs(qc, ev.data)
        invalidate(qc, ctx, ['api', 'tokens', arg, 'tvl'], 10_000)
      }
      return
    case 'pool':
      if (!arg) return
      if (ev.event === 'state' && data) {
        const merge = (old: Record<string, unknown>) => (typeof old === 'object' && old && !Array.isArray(old) ? { ...old, ...pickDefined(data) } : undefined)
        update(qc, ['api', 'pools', 'detail', arg], merge)
        update(qc, ['api', 'pools', arg], (old: Record<string, unknown>, key) => (key[3] === 'history' || key[3] === 'ticks' ? undefined : merge(old)))
        invalidate(qc, ctx, ['api', 'pools', arg, 'ticks'], 3_000)
        invalidate(qc, ctx, ['api', 'pools', arg, 'history'], 10_000)
        invalidate(qc, ctx, ['readContracts', 'lp'], 2_000)
      } else if (ev.event === 'txs') {
        prependTxs(qc, ev.data)
      }
      return
    case 'explore':
      if (ev.event === 'txs') prependTxs(qc, ev.data)
      else if (ev.event === 'stats' && data) update<Record<string, unknown>>(qc, ['api', 'explore', 'stats'], (old) => (typeof old === 'object' && old ? { ...old, ...pickDefined(data) } : undefined))
      // pool / token rows carry volumes and TVL that the push does not; refresh them gently
      if (ev.event === 'txs') {
        invalidate(qc, ctx, ['api', 'explore', 'pools'], 5_000)
        invalidate(qc, ctx, ['api', 'explore', 'tokens'], 5_000)
      }
      return
    case 'account':
      if (arg) applyAccountEvent(qc, arg, ev, ctx)
      return
    case 'launches':
      invalidate(qc, ctx, ['api', 'launches'], 1_000)
      invalidate(qc, ctx, ['readContracts', 'lp', 'auction'], 1_000)
      if (ev.event === 'claim' || ev.event === 'settled') invalidateWalletReads(qc, ctx)
      return
    case 'x':
      if (arg === 'orders' && ev.event === 'order') applyOrder(qc, data, ctx)
      return
  }
}

function applyPrices(qc: QueryClient, prices: Record<string, number>, ts: number) {
  // explore token lists (raw rows and normalised rows)
  update(qc, ['api', 'explore', 'tokens'], (old) => mapList<Record<string, unknown>>(old, (r) => setPrice(r, prices)))
  // token detail / stats
  for (const [addr, p] of Object.entries(prices)) {
    const patch = (old: Record<string, unknown>) => (typeof old === 'object' && old && !Array.isArray(old) && 'priceUsd' in old && old.priceUsd !== p ? { ...old, priceUsd: p } : undefined)
    update(qc, ['api', 'tokens', 'detail', addr], patch)
    update(qc, ['api', 'tokens', addr], (old: Record<string, unknown>, key) => (key.length <= 3 || (typeof key[3] === 'object' && !Array.isArray(key[3])) ? patch(old) : undefined))
    // live price line: move the last point
    update<Point[]>(qc, ['api', 'tokens', addr, 'price-line'], (old) => (Array.isArray(old) && old.length ? upsertLastPoint(old, ts, { value: p }) : undefined))
    update<Array<{ time: number; priceUsd: number }>>(qc, ['api', 'tokens', addr, 'price-history'], (old) =>
      Array.isArray(old) && old.length ? upsertLastPoint(old, ts, { priceUsd: p }) : undefined,
    )
  }
}

function applyAccountEvent(qc: QueryClient, addr: string, ev: RealtimeEvent, ctx: BridgeContext) {
  const data = ev.data as Record<string, unknown>
  const mine = !!ctx.account && sameAddr(ctx.account, addr)
  switch (ev.event) {
    case 'activity': {
      const items = Array.isArray(ev.data) ? newestFirst(ev.data) : asList<Record<string, unknown>>(ev.data, 'activity').slice().reverse()
      update<Record<string, unknown>[]>(qc, ['api', 'accounts', addr, 'activity'], (old) => (Array.isArray(old) ? prependUnique(old, items, txKey) : undefined))
      invalidate(qc, ctx, ['api', 'accounts', addr, 'earn'], 2_000)
      invalidate(qc, ctx, ['api', 'accounts', addr, 'positions', 'lp'], 1_000)
      if (mine) invalidateWalletReads(qc, ctx)
      return
    }
    case 'balances':
      qc.setQueriesData({ predicate: (q) => keyIs(q.queryKey, ['api', 'accounts', addr, 'balances']) }, () => asList(ev.data, 'balances'))
      if (mine) invalidateWalletReads(qc, ctx)
      return
    case 'positions':
      qc.setQueriesData({ predicate: (q) => keyIs(q.queryKey, ['api', 'accounts', addr, 'positions']) && q.queryKey[4] !== 'lp' && q.queryKey.length <= 5 }, () => asList(ev.data, 'positions'))
      invalidate(qc, ctx, ['api', 'accounts', addr, 'positions', 'lp'], 1_000)
      return
    case 'portfolio': {
      update<Record<string, unknown>>(qc, ['api', 'accounts', addr, 'portfolio'], (old, key) => (key[4] === undefined || typeof key[4] === 'object' ? (typeof old === 'object' && old && !Array.isArray(old) ? { ...old, ...pickDefined(data) } : undefined) : undefined))
      const total = Number(data?.totalUsd)
      if (Number.isFinite(total)) {
        const now = Math.floor(Date.now() / 1000)
        update<Array<{ time: number; valueUsd: number }>>(qc, ['api', 'accounts', addr, 'portfolio-history'], (old) => (Array.isArray(old) && old.length ? upsertLastPoint(old, now, { valueUsd: total }) : undefined))
      }
      if (!ev.snapshot) invalidate(qc, ctx, ['api', 'accounts', addr, 'portfolio-history'], 30_000)
      return
    }
    case 'order':
      applyOrder(qc, data, ctx)
      return
  }
}

function applyOrder(qc: QueryClient, order: Record<string, unknown>, ctx: BridgeContext) {
  const hash = lc(order?.orderHash ?? order?.hash)
  let found = false
  update<Record<string, unknown>[]>(qc, ['api', 'x', 'orders'], (old, key) => {
    if (!Array.isArray(old)) return undefined
    const i = old.findIndex((o) => lc(o.orderHash ?? o.hash) === hash)
    if (i < 0) return undefined
    found = true
    const statusFilter = key[4]
    if (statusFilter && statusFilter !== 'all' && order.status !== statusFilter) return old.filter((_, j) => j !== i)
    return old.map((o, j) => (j === i ? { ...o, ...pickDefined(order) } : o))
  })
  if (!found) invalidate(qc, ctx, ['api', 'x', 'orders'], 500)
}

function keyIs(key: QueryKey, prefix: AnyKey) {
  return prefix.every((p, i) => lc(key[i]) === lc(p))
}

function pickDefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o ?? {})) if (v !== undefined && v !== null) out[k] = v
  return out
}

export function splitTopic(topic: string): [string, string | undefined] {
  const i = topic.indexOf(':')
  return i < 0 ? [topic, undefined] : [topic.slice(0, i), topic.slice(i + 1).toLowerCase()]
}

/* ------------------------------------------------------------------ which topics the UI needs */

/**
 * Topics implied by the queries currently on screen (queries with observers), so no feature has to
 * subscribe by hand: token/pool pages, explore, launches, orders and any account being shown.
 */
export function topicsForQueries(qc: QueryClient): Set<string> {
  const out = new Set<string>()
  for (const q of qc.getQueryCache().getAll()) {
    if (q.getObserversCount() === 0) continue
    const k = q.queryKey
    if (k[0] !== 'api') continue
    if (k[1] === 'explore') out.add('explore')
    else if (k[1] === 'launches') out.add('launches')
    else if (k[1] === 'x' && k[2] === 'orders') out.add('x:orders')
    else if (k[1] === 'tokens') {
      const a = k[2] === 'detail' ? k[3] : k[2]
      // native ETH pages read WETH data; the hub only knows the WETH address
      if (isAddr(a)) out.add(`token:${a.toLowerCase() === NATIVE && WETH ? WETH : a.toLowerCase()}`)
    } else if (k[1] === 'pools') {
      const a = k[2] === 'detail' ? k[3] : k[2]
      if (isAddr(a)) out.add(`pool:${a.toLowerCase()}`)
    } else if (k[1] === 'accounts' && isAddr(k[2])) out.add(`account:${k[2].toLowerCase()}`)
    // explore transactions filtered by token / pool: the token/pool topics carry those txs
    if (k[1] === 'explore' && k[2] === 'transactions') {
      const f = (k[3] === 'rows' ? k[4] : k[3]) as { token?: string; pool?: string } | undefined
      if (f && isAddr(f.token)) out.add(`token:${(f.token.toLowerCase() === NATIVE && WETH ? WETH : f.token).toLowerCase()}`)
      if (f && isAddr(f.pool)) out.add(`pool:${f.pool.toLowerCase()}`)
    }
  }
  return out
}
