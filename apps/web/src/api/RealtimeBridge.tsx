import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@/wallet/hooks'
import { getRealtime } from './realtime'
import { applyRealtimeEvent, invalidateWalletReads, Throttler, topicsForQueries, type BridgeContext } from './realtimeCache'

const noop = () => {}

/**
 * Mounted once in the app providers. Keeps the WebSocket subscribed to what is on screen and writes
 * pushed events into the query cache:
 * - always `blocks` and `prices`, plus `account:<connected wallet>`;
 * - topics implied by the active queries (explore, launches, x:orders, token:, pool:, account:<shown>).
 * After a reconnect, or when the socket drops, active API queries are refetched over REST.
 */
export function RealtimeBridge() {
  const qc = useQueryClient()
  const { address } = useWallet()
  const ctx = useRef<BridgeContext>({ throttle: new Throttler() })
  ctx.current.account = address

  useEffect(() => {
    const rt = getRealtime()
    const offEvent = rt.onEvent((ev) => applyRealtimeEvent(qc, ev, ctx.current))
    const refetchAll = () => {
      void qc.invalidateQueries({ queryKey: ['api'] })
      invalidateWalletReads(qc, ctx.current)
    }
    const offReconnect = rt.onReconnect(refetchAll)
    // when the socket drops, refetch once so polling intervals switch back to their fast fallback
    let prev = rt.status
    const offStatus = rt.onStatus(() => {
      if (prev === 'open' && rt.status === 'closed') void qc.invalidateQueries({ queryKey: ['api'], refetchType: 'active' })
      prev = rt.status
    })
    const base = ['blocks', 'prices'].map((t) => rt.subscribe(t, noop))
    return () => {
      offEvent()
      offReconnect()
      offStatus()
      base.forEach((off) => off())
    }
  }, [qc])

  useEffect(() => {
    const rt = getRealtime()
    const subs = new Map<string, () => void>()
    const sync = () => {
      const want = topicsForQueries(qc)
      if (address) want.add(`account:${address.toLowerCase()}`)
      for (const [t, off] of subs)
        if (!want.has(t)) {
          off()
          subs.delete(t)
        }
      for (const t of want) if (!subs.has(t)) subs.set(t, rt.subscribe(t, noop))
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const offCache = qc.getQueryCache().subscribe((e) => {
      // only observer changes (mount / unmount) alter what is on screen
      if (e.type !== 'observerAdded' && e.type !== 'observerRemoved' && e.type !== 'added' && e.type !== 'removed') return
      clearTimeout(timer)
      timer = setTimeout(sync, 150)
    })
    sync()
    return () => {
      clearTimeout(timer)
      offCache()
      for (const off of subs.values()) off()
    }
  }, [qc, address])

  return null
}
