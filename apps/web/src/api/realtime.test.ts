import { describe, expect, it, vi } from 'vitest'
import { RealtimeClient, normalizeTopic, wsUrlFromApi, liveInterval, setRealtimeClientForTests, LIVE_SAFETY_MS, type RealtimeEvent } from './realtime'

/** Minimal controllable WebSocket stand-in. */
class MockSocket {
  static all: MockSocket[] = []
  readyState = 0
  sent: Array<{ op: string; topics?: string[] }> = []
  onopen: ((e: Event) => unknown) | null = null
  onclose: ((e: CloseEvent) => unknown) | null = null
  onerror: ((e: Event) => unknown) | null = null
  onmessage: ((e: MessageEvent) => unknown) | null = null
  constructor(public url: string) {
    MockSocket.all.push(this)
  }
  send(s: string) {
    this.sent.push(JSON.parse(s))
  }
  close() {
    this.readyState = 3
    this.onclose?.({} as CloseEvent)
  }
  open() {
    this.readyState = 1
    this.onopen?.({} as Event)
  }
  drop() {
    this.readyState = 3
    this.onclose?.({} as CloseEvent)
  }
  push(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) } as MessageEvent)
  }
}

function setup() {
  MockSocket.all = []
  const timers: Array<{ fn: () => void; ms: number }> = []
  const client = new RealtimeClient({
    url: 'ws://x/ws',
    createSocket: (u) => new MockSocket(u),
    random: () => 0.5,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimer: () => {},
  })
  const sock = () => MockSocket.all.at(-1)!
  const fire = () => timers.shift()!.fn()
  return { client, sock, timers, fire }
}

const ev = (topic: string, event: string, data: unknown = {}): RealtimeEvent => ({ type: 'event', topic, event, data })

describe('realtime helpers', () => {
  it('derives the ws URL from the REST base', () => {
    expect(wsUrlFromApi('http://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787/ws')
    expect(wsUrlFromApi('https://api.example.com/')).toBe('wss://api.example.com/ws')
  })
  it('lower-cases topic addresses only', () => {
    expect(normalizeTopic('token:0xAbC')).toBe('token:0xabc')
    expect(normalizeTopic('x:orders')).toBe('x:orders')
    expect(normalizeTopic('blocks')).toBe('blocks')
  })
})

describe('RealtimeClient', () => {
  it('connects lazily and subscribes all topics once open', () => {
    const { client, sock } = setup()
    expect(MockSocket.all).toHaveLength(0)
    client.subscribe('blocks', () => {})
    client.subscribe('token:0xABC', () => {})
    expect(MockSocket.all).toHaveLength(1)
    expect(client.status).toBe('connecting')
    sock().open()
    expect(client.status).toBe('open')
    expect(sock().sent).toEqual([{ op: 'subscribe', topics: ['blocks', 'token:0xabc'], id: 1 }])
  })

  it('ref-counts topics: one subscribe for many handlers, unsubscribe after the last', () => {
    const { client, sock } = setup()
    client.subscribe('prices', () => {})
    sock().open()
    sock().sent = []
    const off1 = client.subscribe('pool:0x1', () => {})
    const off2 = client.subscribe('pool:0X1', () => {})
    expect(sock().sent.filter((m) => m.op === 'subscribe')).toHaveLength(1)
    off1()
    expect(sock().sent.filter((m) => m.op === 'unsubscribe')).toHaveLength(0)
    off2()
    expect(sock().sent.at(-1)).toMatchObject({ op: 'unsubscribe', topics: ['pool:0x1'] })
    off2() // idempotent
    expect(sock().sent.filter((m) => m.op === 'unsubscribe')).toHaveLength(1)
  })

  it('dispatches events to topic handlers (case-insensitive) and to onEvent listeners', () => {
    const { client, sock } = setup()
    const a = vi.fn()
    const any = vi.fn()
    client.subscribe('account:0xAAA', a)
    client.onEvent(any)
    sock().open()
    sock().push({ ...ev('account:0xaaa', 'portfolio', { totalUsd: 1 }), block: 7 })
    sock().push(ev('blocks', 'block', { number: 8 }))
    sock().push({ type: 'pong', id: 1 })
    sock().push('not json')
    expect(a).toHaveBeenCalledTimes(1)
    expect(a.mock.calls[0]![0]).toMatchObject({ event: 'portfolio', data: { totalUsd: 1 } })
    expect(any).toHaveBeenCalledTimes(2)
    expect(client.lastBlock).toBe(7)
  })

  it('a throwing handler does not stop the others', () => {
    const { client, sock } = setup()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = vi.fn()
    client.subscribe('prices', () => {
      throw new Error('boom')
    })
    client.subscribe('prices', ok)
    sock().open()
    sock().push(ev('prices', 'prices'))
    expect(ok).toHaveBeenCalled()
    err.mockRestore()
  })

  it('reconnects with exponential backoff, resubscribes and reports the reconnect', () => {
    const { client, sock, timers, fire } = setup()
    const onRe = vi.fn()
    client.onReconnect(onRe)
    client.subscribe('explore', () => {})
    sock().open()
    expect(onRe).not.toHaveBeenCalled()
    sock().drop()
    expect(client.status).toBe('closed')
    expect(timers.map((t) => t.ms)).toEqual([500])
    fire()
    expect(MockSocket.all).toHaveLength(2)
    sock().drop() // failed attempt
    expect(timers.map((t) => t.ms)).toEqual([1000])
    fire()
    sock().drop()
    expect(timers.map((t) => t.ms)).toEqual([2000])
    fire()
    sock().open()
    expect(sock().sent).toEqual([{ op: 'subscribe', topics: ['explore'], id: expect.any(Number) }])
    expect(onRe).toHaveBeenCalledTimes(1)
    // backoff resets after a successful open
    sock().drop()
    expect(timers.at(-1)!.ms).toBe(500)
  })

  it('caps the backoff', () => {
    const { client, sock, timers, fire } = setup()
    client.subscribe('blocks', () => {})
    for (let i = 0; i < 10; i++) {
      sock().drop()
      fire()
    }
    sock().drop()
    expect(timers.at(-1)!.ms).toBe(15_000)
  })

  it('reports status changes and stops after close()', () => {
    const { client, sock, timers } = setup()
    const seen: string[] = []
    client.onStatus(() => seen.push(client.status))
    client.subscribe('blocks', () => {})
    sock().open()
    client.close()
    expect(seen).toEqual(['connecting', 'open', 'closed'])
    expect(timers).toHaveLength(0)
  })
})

describe('liveInterval', () => {
  it('slows polling while the socket is open and falls back when it is down', () => {
    const { client, sock } = setup()
    setRealtimeClientForTests(client)
    const f = liveInterval(10_000)
    expect(f()).toBe(10_000)
    client.subscribe('blocks', () => {})
    sock().open()
    expect(f()).toBe(LIVE_SAFETY_MS)
    sock().drop()
    expect(f()).toBe(10_000)
    setRealtimeClientForTests(null)
  })
})
