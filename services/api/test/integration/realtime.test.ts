import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { maxUint256, parseEther, type Address } from 'viem'
import { WebSocket } from 'ws'
import { swapRouter02Abi, weth9Abi } from '@metaswap/sdk'
import { RealtimeHub } from '../../src/realtime/hub'
import { chainAvailable, startHarness, testErc20Abi, type Harness } from './setup'

const available = await chainAvailable()

type Msg = { type: string; topic?: string; event?: string; block?: number; data?: any; topics?: string[]; snapshot?: boolean }

describe.skipIf(!available)('WebSocket push (/ws)', () => {
  let h: Harness
  let hub: RealtimeHub
  let server: ReturnType<typeof serve>
  let url: string

  beforeAll(async () => {
    h = await startHarness()
    hub = new RealtimeHub(h.s)
    server = serve({ fetch: h.app.fetch, hostname: '127.0.0.1', port: 0 })
    hub.attach(server as unknown as Server)
    await new Promise((r) => setTimeout(r, 100))
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`
    const head = Number(await h.client.getBlockNumber())
    expect(await h.s.indexer.waitFor(head, 120_000)).toBe(true)
  }, 240_000)
  afterAll(() => {
    hub?.close()
    server?.close()
    h?.stop()
  })

  function connect() {
    const ws = new WebSocket(url)
    const msgs: Msg[] = []
    ws.on('message', (m) => msgs.push(JSON.parse(m.toString())))
    const until = async (pred: (m: Msg) => boolean, timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const hit = msgs.find(pred)
        if (hit) return hit
        if (Date.now() > deadline) throw new Error(`no matching message; got ${msgs.map((m) => `${m.type}:${m.topic ?? ''}:${m.event ?? ''}`).join(', ')}`)
        await new Promise((r) => setTimeout(r, 50))
      }
    }
    return { ws, msgs, until, open: new Promise((r) => ws.once('open', r)) }
  }

  it('rejects bad topics, answers ping, and pushes block, price, token, pool, explore and account events for a swap', async () => {
    const c = connect()
    await c.open
    expect((await c.until((m) => m.type === 'hello')).topics).toContain('blocks')
    c.ws.send(JSON.stringify({ op: 'ping', id: 1 }))
    await c.until((m) => m.type === 'pong')
    c.ws.send('not json')
    await c.until((m) => m.type === 'error')

    const w = await h.freshWallet()
    const me = w.account.address.toLowerCase()
    const WETH = h.token('WETH')
    const USDC = h.token('mUSDC')
    // the deepest WETH/mUSDC pool sets the ETH price, so a swap there moves `prices`
    const candidates = h.s.ctx.deployment.pools.v3.filter((p) => [p.token0, p.token1].map((x) => x.toLowerCase()).sort().join() === [WETH, USDC].map((x) => x.toLowerCase()).sort().join())
    const tvl = await Promise.all(candidates.map(async (p) => (await h.get(`/pools/${p.address}`)).body.tvlUsd as number))
    const pool = candidates[tvl.indexOf(Math.max(...tvl))]
    c.ws.send(JSON.stringify({ op: 'subscribe', id: 2, topics: ['blocks', 'prices', 'explore', 'launches', 'x:orders', `account:${w.account.address}`, `token:${USDC}`, `pool:${pool.address}`, 'token:nope'] }))
    const sub = await c.until((m) => m.type === 'subscribed')
    expect(sub.topics).toContain(`account:${me}`)
    expect((sub as any).invalid).toEqual(['token:nope'])
    // snapshots for the new subscriptions
    await c.until((m) => m.topic === `account:${me}` && m.event === 'portfolio' && m.snapshot === true)
    await c.until((m) => m.topic === `pool:${pool.address.toLowerCase()}` && m.event === 'state' && m.snapshot === true)

    // wrap + swap WETH → mUSDC through SwapRouter02
    const router = h.s.ctx.deployment.contracts.SwapRouter02 as Address
    const send = async (to: Address, abi: unknown, functionName: string, args: unknown[], value = 0n) => {
      const hash = await w.writeContract({ address: to, abi: abi as never, functionName: functionName as never, args: args as never, value, account: w.account, chain: w.chain } as never)
      return h.client.waitForTransactionReceipt({ hash })
    }
    await send(WETH, weth9Abi, 'deposit', [], parseEther('2'))
    await send(WETH, testErc20Abi, 'approve', [router, maxUint256])
    const r = await send(router, swapRouter02Abi, 'exactInputSingle', [{ tokenIn: WETH, tokenOut: USDC, fee: pool.fee, recipient: w.account.address, amountIn: parseEther('1'), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }])
    expect(r.status).toBe('success')
    const block = Number(r.blockNumber)

    await c.until((m) => m.topic === 'blocks' && m.event === 'block' && Number(m.block) >= block)
    // WETH is priced through whichever WETH/stable pool holds the most stable value: nudge all of them
    const before = h.s.indexer.prices.get(WETH.toLowerCase())
    const stables = ['mUSDC', 'mUSDT', 'mDAI'].map((x) => h.token(x).toLowerCase())
    const isWethStable = (p: { token0: string; token1: string }) => [p.token0, p.token1].some((x) => x.toLowerCase() === WETH.toLowerCase()) && [p.token0, p.token1].some((x) => stables.includes(x.toLowerCase()))
    const other = (p: { token0: string; token1: string }) => ([p.token0, p.token1].find((x) => x.toLowerCase() !== WETH.toLowerCase()) as Address)
    for (const p of h.s.ctx.deployment.pools.v3.filter(isWethStable))
      await send(router, swapRouter02Abi, 'exactInputSingle', [{ tokenIn: WETH, tokenOut: other(p), fee: p.fee, recipient: w.account.address, amountIn: parseEther('0.1'), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }])
    let last = 0
    for (const p of h.s.ctx.deployment.pools.v2.filter(isWethStable)) {
      const rr = await send(router, swapRouter02Abi, 'swapExactTokensForTokens', [parseEther('0.1'), 0n, [WETH, other(p)], w.account.address])
      last = Number(rr.blockNumber)
    }
    await h.s.indexer.waitFor(last)
    expect(h.s.indexer.prices.get(WETH.toLowerCase())).not.toBe(before)
    const acct = await c.until((m) => m.topic === `account:${me}` && m.event === 'activity' && m.data.some((x: any) => x.type === 'swap'))
    expect(acct.data.find((x: any) => x.type === 'swap').txHash).toBe(r.transactionHash)
    const bal = await c.until((m) => m.topic === `account:${me}` && m.event === 'balances' && Number(m.block) >= block)
    expect(bal.data.balances.some((b: any) => b.token.symbol === 'mUSDC' && BigInt(b.balance) > 0n)).toBe(true)
    await c.until((m) => m.topic === `account:${me}` && m.event === 'portfolio' && !m.snapshot && m.data.totalUsd > 0)
    const poolTxs = await c.until((m) => m.topic === `pool:${pool.address.toLowerCase()}` && m.event === 'txs')
    expect(poolTxs.data.some((x: any) => x.txHash === r.transactionHash)).toBe(true)
    await c.until((m) => m.topic === `pool:${pool.address.toLowerCase()}` && m.event === 'state' && !m.snapshot)
    const tokTxs = await c.until((m) => m.topic === `token:${USDC.toLowerCase()}` && m.event === 'txs')
    expect(tokTxs.data.some((x: any) => x.txHash === r.transactionHash)).toBe(true)
    const ex = await c.until((m) => m.topic === 'explore' && m.event === 'txs')
    expect(ex.data.some((x: any) => x.txHash === r.transactionHash)).toBe(true)
    // a 1 ETH swap moves the WETH/mUSDC price → prices + token candle
    const prices = await c.until((m) => m.topic === 'prices' && m.event === 'prices' && !m.snapshot)
    expect(Object.keys(prices.data.prices).length).toBeGreaterThan(0)

    // unsubscribe stops delivery
    c.ws.send(JSON.stringify({ op: 'unsubscribe', topics: ['blocks'] }))
    const uns = await c.until((m) => m.type === 'unsubscribed')
    expect(uns.topics).not.toContain('blocks')
    c.ws.close()
  }, 120_000)
})
