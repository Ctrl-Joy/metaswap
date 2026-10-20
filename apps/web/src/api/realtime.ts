import { useEffect, useRef, useSyncExternalStore } from 'react'
import { API_URL } from '@/config'

// Real-time client for the API's WebSocket hub (services/api/README.md "WebSocket").
// One shared connection per tab: ref-counted topic subscriptions, reconnect with exponential
// backoff, resubscribe on reconnect, and a tiny status store for the UI and polling fallbacks.

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed'

export interface RealtimeEvent<T = unknown> {
  type: 'event'
  topic: string
  event: string
  block?: number
  data: T
  snapshot?: boolean
}

export type RealtimeHandler = (e: RealtimeEvent) => void

type WsLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((ev: Event) => unknown) | null
  onclose: ((ev: CloseEvent) => unknown) | null
  onerror: ((ev: Event) => unknown) | null
  onmessage: ((ev: MessageEvent) => unknown) | null
}
export type WebSocketFactory = (url: string) => WsLike

export interface RealtimeClientOptions {
  url: string
  /** Defaults to the browser WebSocket. Tests pass a mock. */
  createSocket?: WebSocketFactory
  /** Backoff bounds in ms (doubling with jitter). */
  minDelay?: number
  maxDelay?: number
  /** Injected for tests. */
  random?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

const OPEN = 1

/** `token:0xAbC…` → `token:0xabc…` (the server stores and echoes topic addresses lower-case). */
export function normalizeTopic(topic: string): string {
  const i = topic.indexOf(':')
  return i < 0 ? topic : `${topic.slice(0, i)}:${topic.slice(i + 1).toLowerCase()}`
}

/** ws(s)://host/ws derived from the REST base URL (VITE_API_URL). */
export function wsUrlFromApi(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, '').replace(/^http/i, 'ws')}/ws`
}

export class RealtimeClient {
  private readonly opts: Required<Omit<RealtimeClientOptions, 'createSocket'>> & { createSocket?: WebSocketFactory }
  private ws: WsLike | null = null
  private readonly handlers = new Map<string, Set<RealtimeHandler>>()
  private readonly anyHandlers = new Set<RealtimeHandler>()
  private readonly reconnectHandlers = new Set<() => void>()
  private readonly statusListeners = new Set<() => void>()
  private timer: unknown = null
  private attempts = 0
  private everOpened = false
  private stopped = false
  private msgId = 0
  status: RealtimeStatus = 'idle'
  /** Last block number seen on any event (also from `hello`). */
  lastBlock: number | undefined

  constructor(opts: RealtimeClientOptions) {
    this.opts = {
      minDelay: 500,
      maxDelay: 15_000,
      random: Math.random,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      ...opts,
    }
  }

  /** Subscribe `handler` to `topic`. The topic is sent to the server on its first handler, and dropped with its last. */
  subscribe(topic: string, handler: RealtimeHandler): () => void {
    const t = normalizeTopic(topic)
    let set = this.handlers.get(t)
    const first = !set
    if (!set) {
      set = new Set()
      this.handlers.set(t, set)
    }
    set.add(handler)
    if (first) this.sendOp('subscribe', [t])
    this.ensureConnected()
    return () => {
      const s = this.handlers.get(t)
      if (!s || !s.delete(handler)) return
      if (s.size === 0) {
        this.handlers.delete(t)
        this.sendOp('unsubscribe', [t])
      }
    }
  }

  /** Receive every event (any topic). Does not by itself subscribe to anything. */
  onEvent(handler: RealtimeHandler): () => void {
    this.anyHandlers.add(handler)
    return () => void this.anyHandlers.delete(handler)
  }

  /** Called after a *re*connect (not the first open): refetch anything that may have been missed. */
  onReconnect(fn: () => void): () => void {
    this.reconnectHandlers.add(fn)
    return () => void this.reconnectHandlers.delete(fn)
  }

  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn)
    return () => void this.statusListeners.delete(fn)
  }

  /** Topics with at least one handler (normalised). */
  get topics(): string[] {
    return [...this.handlers.keys()]
  }

  connect() {
    this.stopped = false
    this.ensureConnected()
  }

  close() {
    this.stopped = true
    if (this.timer !== null) this.opts.clearTimer(this.timer)
    this.timer = null
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onclose = null
      ws.close()
    }
    this.setStatus('closed')
  }

  private ensureConnected() {
    if (this.stopped || this.ws || this.timer !== null) return
    const factory = this.opts.createSocket ?? (typeof WebSocket !== 'undefined' ? (u: string) => new WebSocket(u) as unknown as WsLike : undefined)
    if (!factory) return
    this.setStatus('connecting')
    let ws: WsLike
    try {
      ws = factory(this.opts.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      const reconnect = this.everOpened
      this.everOpened = true
      this.attempts = 0
      this.setStatus('open')
      if (this.handlers.size) this.sendOp('subscribe', this.topics)
      if (reconnect) for (const fn of this.reconnectHandlers) fn()
    }
    ws.onmessage = (ev) => this.handleMessage(ev.data)
    ws.onerror = () => {
      /* onclose follows */
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.setStatus('closed')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.timer !== null) return
    const base = Math.min(this.opts.maxDelay, this.opts.minDelay * 2 ** this.attempts)
    const delay = Math.round(base * (0.75 + this.opts.random() * 0.5))
    this.attempts++
    this.timer = this.opts.setTimer(() => {
      this.timer = null
      this.ensureConnected()
    }, delay)
  }

  private sendOp(op: 'subscribe' | 'unsubscribe', topics: string[]) {
    const ws = this.ws
    if (!ws || ws.readyState !== OPEN || topics.length === 0) return
    // the server accepts up to 200 topics per connection; batch to keep frames small
    for (let i = 0; i < topics.length; i += 100) ws.send(JSON.stringify({ op, topics: topics.slice(i, i + 100), id: ++this.msgId }))
  }

  private handleMessage(raw: unknown) {
    let m: { type?: string; topic?: string; block?: number; indexedBlock?: number } & Record<string, unknown>
    try {
      m = JSON.parse(String(raw))
    } catch {
      return
    }
    if (m.type === 'hello' && typeof m.indexedBlock === 'number') this.lastBlock = m.indexedBlock
    if (m.type !== 'event' || typeof m.topic !== 'string') return
    const ev = m as unknown as RealtimeEvent
    if (typeof ev.block === 'number') this.lastBlock = Math.max(this.lastBlock ?? 0, ev.block)
    for (const h of [...this.anyHandlers]) safeCall(h, ev)
    const set = this.handlers.get(normalizeTopic(ev.topic))
    if (set) for (const h of [...set]) safeCall(h, ev)
  }

  private setStatus(s: RealtimeStatus) {
    if (this.status === s) return
    this.status = s
    for (const fn of [...this.statusListeners]) fn()
  }
}

function safeCall(h: RealtimeHandler, ev: RealtimeEvent) {
  try {
    h(ev)
  } catch (e) {
    console.error('[realtime] handler failed', ev.topic, ev.event, e)
  }
}

/* ------------------------------------------------------------------ app singleton */

let client: RealtimeClient | null = null

/** The app-wide client (lazy). Connects on the first subscription. */
export function getRealtime(): RealtimeClient {
  if (!client) client = new RealtimeClient({ url: wsUrlFromApi(API_URL) })
  return client
}

/** For tests: replace the singleton. */
export function setRealtimeClientForTests(c: RealtimeClient | null) {
  client = c
}

export function isRealtimeOpen(): boolean {
  return client?.status === 'open'
}

/** Connection status, re-rendering on change. */
export function useRealtimeStatus(): RealtimeStatus {
  const c = getRealtime()
  return useSyncExternalStore(
    (fn) => c.onStatus(fn),
    () => c.status,
    () => 'idle',
  )
}

/**
 * Subscribe to a topic for the lifetime of the component. `onMessage` may change between renders
 * without resubscribing. A falsy topic subscribes to nothing.
 */
export function useRealtime(topic: string | null | undefined | false, onMessage: RealtimeHandler) {
  const ref = useRef(onMessage)
  ref.current = onMessage
  useEffect(() => {
    if (!topic) return
    return getRealtime().subscribe(topic, (e) => ref.current(e))
  }, [topic])
}

/** Polling interval for a query that the socket keeps fresh: slow safety net while connected, `fallbackMs` while down. */
export const LIVE_SAFETY_MS = 60_000
export function liveInterval(fallbackMs: number): () => number {
  return () => (isRealtimeOpen() ? Math.max(fallbackMs, LIVE_SAFETY_MS) : fallbackMs)
}
