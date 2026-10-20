import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeFunctionData, maxUint256, parseEther, parseUnits, type Address, type Hex } from 'viem'
import { permit2Abi, universalRouterAbi } from '../../src/abis'
import { permitMessage, PERMIT_SINGLE_TYPES } from '../../src/routing/permit2'
import { COMMAND } from '../../src/routing/encode'
import { decodeOrder, orderTypedData } from '../../src/x/order'
import { KEYS, chainAvailable, startHarness, testErc20Abi, type Harness } from './setup'

const available = await chainAvailable()
if (!available) console.warn('[integration] skipped: no MetaSwap deployment reachable at METASWAP_RPC')

describe.skipIf(!available)('MetaSwap API against the live devnet', () => {
  let h: Harness
  let USDC: Address
  let WETH: Address
  let META: Address
  let xUser: ReturnType<Harness['wallet']> | undefined
  let swapperWallet: ReturnType<Harness['wallet']>
  const swapper = () => swapperWallet

  beforeAll(async () => {
    h = await startHarness()
    USDC = h.token('mUSDC')
    WETH = h.token('WETH')
    META = h.token('META')
    swapperWallet = await h.freshWallet()
    // wait for the backfill to reach the head
    const head = Number(await h.client.getBlockNumber())
    expect(await h.s.indexer.waitFor(head, 60_000)).toBe(true)
  })
  afterAll(() => h?.stop())

  async function send(w: ReturnType<Harness['wallet']>, tx: { to: Address; data: Hex; value?: bigint; gas?: bigint }) {
    const hash = await w.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n, gas: tx.gas, chain: w.chain, account: w.account! })
    const r = await h.client.waitForTransactionReceipt({ hash })
    if (r.status !== 'success') {
      const reason = await h.client.call({ account: w.account!, to: tx.to, data: tx.data, value: tx.value ?? 0n, blockNumber: r.blockNumber - 1n }).then(() => 'replay ok', (e) => (e as Error).message.split('\n').slice(0, 3).join(' '))
      const txd = await h.client.getTransaction({ hash })
      throw new Error(`tx reverted: ${reason} gasUsed=${r.gasUsed} limit=${txd.gas}`)
    }
    return r
  }

  async function erc20(token: Address, who: Address) {
    return (await h.client.readContract({ address: token, abi: testErc20Abi, functionName: 'balanceOf', args: [who] })) as bigint
  }

  /** quote → (approve Permit2) → sign PermitSingle → POST /swap → send */
  async function quoteAndSwap(w: ReturnType<Harness['wallet']>, params: Record<string, string>) {
    const me = w.account!.address
    const qs = new URLSearchParams({ ...params, swapper: me }).toString()
    const q = await h.get(`/quote?${qs}`)
    expect(q.status, JSON.stringify(q.body)).toBe(200)
    if (q.body.approval?.required) {
      const { request } = await h.client.simulateContract({ address: q.body.approval.token, abi: testErc20Abi, functionName: 'approve', args: [q.body.approval.spender, maxUint256], account: w.account! })
      await h.client.waitForTransactionReceipt({ hash: await w.writeContract(request) })
    }
    let methodParameters = q.body.methodParameters
    if (q.body.permit2?.required) {
      const pd = q.body.permitData
      expect(pd.domain.name).toBe('Permit2')
      expect(pd.domain.verifyingContract).toBe(h.s.ctx.deployment.contracts.Permit2)
      const signature = await w.signTypedData({ account: w.account!, domain: pd.domain, types: PERMIT_SINGLE_TYPES, primaryType: 'PermitSingle', message: permitMessage(pd.values) })
      const sw = await h.post('/swap', { quote: q.body, permitSignature: signature })
      expect(sw.status, JSON.stringify(sw.body)).toBe(200)
      expect(sw.body.permitIncluded).toBe(true)
      expect(sw.body.simulation?.ok, JSON.stringify(sw.body.simulation)).toBe(true)
      methodParameters = sw.body.methodParameters
      const { args } = decodeFunctionData({ abi: universalRouterAbi, data: methodParameters.calldata })
      expect((args[0] as Hex).slice(0, 4)).toBe('0x0a') // PERMIT2_PERMIT first
    }
    expect(methodParameters.gasLimit, 'API returns a simulated gas limit').toBeTruthy()
    const receipt = await send(w, { to: methodParameters.to, data: methodParameters.calldata, value: BigInt(methodParameters.value), gas: BigInt(methodParameters.gasLimit) })
    return { q: q.body, receipt }
  }

  it('GET /health reports the indexed chain', async () => {
    const r = await h.get('/health')
    expect(r.body.ok).toBe(true)
    expect(r.body.chainId).toBe(31337)
    expect(r.body.indexedBlock).toBeGreaterThan(0)
  })

  it('mUSDC → WETH with approve + Permit2 signature via /swap', async () => {
    const w = swapper()
    const me = w.account!.address
    await send(w, { to: USDC, data: '0x40c10f19' + me.slice(2).padStart(64, '0') + parseUnits('50000', 6).toString(16).padStart(64, '0') as Hex })
    const before = await erc20(WETH, me)
    const { q } = await quoteAndSwap(w, { tokenIn: USDC, tokenOut: WETH, amount: parseUnits('3000', 6).toString(), type: 'EXACT_INPUT' })
    expect(q.permit2.required).toBe(true)
    const received = (await erc20(WETH, me)) - before
    expect(received).toBeGreaterThanOrEqual(BigInt(q.amountOutMin))
    expect(Number(received) / 1e18).toBeGreaterThan(0.5) // ~1 WETH at $3000
    // allowance now in place → no permit needed
    const again = await h.get(`/quote?tokenIn=${USDC}&tokenOut=${WETH}&amount=1000000&swapper=${me}`)
    expect(again.body.permit2.required).toBe(false)
    expect(again.body.approval.required).toBe(false)
  })

  it('ETH → mUSDC uses WRAP_ETH with msg.value', async () => {
    const w = swapper()
    const me = w.account!.address
    const before = await erc20(USDC, me)
    const { q } = await quoteAndSwap(w, { tokenIn: 'ETH', tokenOut: USDC, amount: parseEther('1').toString() })
    const { args } = decodeFunctionData({ abi: universalRouterAbi, data: q.methodParameters.calldata })
    expect(parseInt((args[0] as Hex).slice(2, 4), 16)).toBe(COMMAND.WRAP_ETH)
    expect(q.methodParameters.value).toBe(parseEther('1').toString())
    expect((await erc20(USDC, me)) - before).toBeGreaterThanOrEqual(BigInt(q.amountOutMin))
  })

  it('mUSDC → ETH unwraps to the sender', async () => {
    const w = swapper()
    const me = w.account!.address
    const before = await h.client.getBalance({ address: me })
    const { q, receipt } = await quoteAndSwap(w, { tokenIn: USDC, tokenOut: 'ETH', amount: parseUnits('3000', 6).toString() })
    const { args } = decodeFunctionData({ abi: universalRouterAbi, data: q.methodParameters.calldata })
    expect((args[0] as Hex).endsWith('0c')).toBe(true) // UNWRAP_WETH last
    const gas = receipt.gasUsed * receipt.effectiveGasPrice
    expect((await h.client.getBalance({ address: me })) - before + gas).toBeGreaterThanOrEqual(BigInt(q.amountOutMin))
  })

  it('2-hop route META → mUSDC', async () => {
    const w = swapper()
    const me = w.account!.address
    await send(w, { to: META, data: '0x40c10f19' + me.slice(2).padStart(64, '0') + parseEther('1000').toString(16).padStart(64, '0') as Hex })
    const before = await erc20(USDC, me)
    const { q } = await quoteAndSwap(w, { tokenIn: META, tokenOut: USDC, amount: parseEther('100').toString(), maxHops: '2' })
    expect(q.route.some((leg: unknown[]) => leg.length === 2), q.routeString).toBe(true)
    expect(q.routeString).toContain('WETH')
    const received = (await erc20(USDC, me)) - before
    expect(received).toBeGreaterThanOrEqual(BigInt(q.amountOutMin))
    expect(received).toBeGreaterThan(0n)
    // trade back so reruns on the same chain see similar prices
    await quoteAndSwap(w, { tokenIn: USDC, tokenOut: META, amount: received.toString() })
  })

  it('large WETH → mUSDC trade is split across routes', async () => {
    const w = await h.freshWallet()
    const me = w.account!.address
    await send(w, { to: WETH, data: '0xd0e30db0', value: parseEther('400') })
    const before = await erc20(USDC, me)
    const { q } = await quoteAndSwap(w, { tokenIn: WETH, tokenOut: USDC, amount: parseEther('300').toString() })
    expect(q.routes.length).toBeGreaterThan(1)
    expect(q.routes.reduce((a: number, r: { percent: number }) => a + r.percent, 0)).toBe(100)
    const got = (await erc20(USDC, me)) - before
    expect(got).toBeGreaterThanOrEqual(BigInt(q.amountOutMin))
    await quoteAndSwap(w, { tokenIn: USDC, tokenOut: WETH, amount: got.toString() })
  })

  it('exact output: receive exactly amountOut, pay ≤ amountInMax', async () => {
    const w = swapper()
    const me = w.account!.address
    const [usdcBefore, wethBefore] = await Promise.all([erc20(USDC, me), erc20(WETH, me)])
    const out = parseEther('0.5')
    const { q } = await quoteAndSwap(w, { tokenIn: USDC, tokenOut: WETH, amount: out.toString(), type: 'EXACT_OUTPUT' })
    expect((await erc20(WETH, me)) - wethBefore).toBe(out)
    expect(usdcBefore - (await erc20(USDC, me))).toBeLessThanOrEqual(BigInt(q.amountInMax))
  })

  it('indexer picks up the swap and /explore/transactions + activity show it', async () => {
    const w = swapper()
    const { receipt } = await quoteAndSwap(w, { tokenIn: 'ETH', tokenOut: USDC, amount: parseEther('0.1').toString() })
    const t0 = Date.now()
    expect(await h.s.indexer.waitFor(Number(receipt.blockNumber), 10_000)).toBe(true)
    expect(Date.now() - t0).toBeLessThan(10_000)
    const txs = await h.get('/explore/transactions?type=swap&limit=50')
    const hit = txs.body.find((t: { txHash: string }) => t.txHash === receipt.transactionHash)
    expect(hit).toBeTruthy()
    expect(hit.account).toBe(w.account!.address)
    expect(hit.amountUsd).toBeGreaterThan(10)
    const act = await h.get(`/accounts/${w.account!.address}/activity`)
    expect(act.body.some((a: { txHash: string; type: string }) => a.txHash === receipt.transactionHash && a.type === 'swap')).toBe(true)
  })

  it('token, candle, price, explore and pool endpoints return data for seeded tokens', async () => {
    const tok = await h.get(`/tokens/${WETH}`)
    expect(tok.status).toBe(200)
    expect(tok.body.priceUsd).toBeGreaterThan(1000)
    expect(tok.body.priceUsd).toBeLessThan(10000)
    expect(tok.body.tvlUsd).toBeGreaterThan(0)
    expect(tok.body.fdvUsd).toBeGreaterThan(0)
    const meta = await h.get(`/tokens/${META}`)
    expect(meta.body.priceUsd).toBeGreaterThan(2)
    expect(meta.body.priceUsd).toBeLessThan(30)
    const candles = await h.get(`/tokens/${WETH}/candles?interval=1m`)
    expect(candles.body.length).toBeGreaterThan(0)
    expect(candles.body[0]).toHaveProperty('open')
    for (const iv of ['5m', '1h', '1d']) expect((await h.get(`/tokens/${WETH}/candles?interval=${iv}`)).body.length).toBeGreaterThan(0)
    const hist = await h.get(`/tokens/${USDC}/price-history?range=1D`)
    expect(hist.body.length).toBeGreaterThan(0)
    expect(hist.body.at(-1).priceUsd).toBe(1)
    const list = await h.get('/tokens')
    expect(list.body.tokens.length).toBeGreaterThanOrEqual(9)
    const et = await h.get('/explore/tokens?sort=volume')
    expect(et.body.length).toBeGreaterThanOrEqual(8)
    expect(et.body[0].sparkline.length).toBeGreaterThan(0)
    const stats = await h.get('/explore/stats')
    expect(stats.body.tvlUsd).toBeGreaterThan(100_000)
    expect(stats.body.volume24hUsd).toBeGreaterThan(0)
    expect(stats.body.v3.poolCount).toBeGreaterThan(0)
    expect(stats.body.tvlHistory.length).toBeGreaterThan(0)
    const pools = await h.get('/explore/pools?sort=tvl')
    expect(pools.body.length).toBe(h.s.ctx.deployment.pools.v2.length + h.s.ctx.deployment.pools.v3.length)
    const v3 = pools.body.find((p: { version: string }) => p.version === 'v3')
    const detail = await h.get(`/pools/${v3.address}`)
    expect(detail.body.sqrtPriceX96).toBeTruthy()
    expect((await h.get(`/pools/${v3.address}/history`)).body.length).toBeGreaterThan(0)
    const ticks = await h.get(`/pools/${v3.address}/ticks`)
    expect(ticks.body.ticks.length).toBeGreaterThan(0)
  })

  it('balances and positions for accounts', async () => {
    const me = swapper().account!.address
    const b = await h.get(`/accounts/${me}/balances`)
    expect(b.body.totalValueUsd).toBeGreaterThan(0)
    expect(b.body.balances.find((x: { token: { symbol: string } }) => x.token.symbol === 'ETH').balance).not.toBe('0')
    // the seeder (#0) provides liquidity
    const p = await h.get('/accounts/0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266/positions')
    expect(p.status).toBe(200)
    expect(p.body.v2.length + p.body.v3.length).toBeGreaterThan(0)
    for (const pos of p.body.v3) {
      expect(typeof pos.inRange).toBe('boolean')
      expect(pos.uncollectedFees).toHaveProperty('amount0')
    }
  })

  it('MetaSwapX: signed Dutch order is filled by the filler bot', async () => {
    expect(h.s.filler.enabled, h.s.filler.disabledReason ?? '').toBe(true)
    const w = xUser ?? (xUser = await h.freshWallet())
    const me = w.account!.address
    await send(w, { to: USDC, data: '0x40c10f19' + me.slice(2).padStart(64, '0') + parseUnits('10000', 6).toString(16).padStart(64, '0') as Hex })
    const permit2 = h.s.ctx.deployment.contracts.Permit2
    const { request } = await h.client.simulateContract({ address: USDC, abi: testErc20Abi, functionName: 'approve', args: [permit2, maxUint256], account: w.account! })
    await h.client.waitForTransactionReceipt({ hash: await w.writeContract(request) })
    const wethBefore = await erc20(WETH, me)
    const q = await h.get(`/x/quote?tokenIn=${USDC}&tokenOut=${WETH}&amount=${parseUnits('2000', 6)}&swapper=${me}&decaySeconds=20&startDelaySeconds=1`)
    expect(q.status, JSON.stringify(q.body)).toBe(200)
    const order = decodeOrder(q.body.encodedOrder)
    const signature = await w.signTypedData({ account: w.account!, ...orderTypedData(order, 31337, permit2) })
    const posted = await h.post('/x/orders', { encodedOrder: q.body.encodedOrder, signature })
    expect(posted.status, JSON.stringify(posted.body)).toBe(201)
    expect(posted.body.status).toBe('open')
    expect(posted.body.orderHash).toBe(q.body.orderHash.toLowerCase())
    // bad signature rejected
    const bad = await h.post('/x/orders', { encodedOrder: q.body.encodedOrder, signature: signature.slice(0, -2) + (signature.endsWith('1b') ? '1c' : '1b') })
    expect(bad.status).toBeGreaterThanOrEqual(400)
    let status = 'open'
    let body: any
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline && status === 'open') {
      await new Promise((r) => setTimeout(r, 1000))
      body = (await h.get(`/x/orders/${posted.body.orderHash}`)).body
      status = body.status
    }
    expect(status, JSON.stringify(h.s.filler.status().recent.slice(-3))).toBe('filled')
    expect(body.fillTx).toMatch(/^0x/)
    expect((await erc20(WETH, me)) - wethBefore).toBeGreaterThanOrEqual(order.outputs[0].endAmount)
    const listed = await h.get(`/x/orders?swapper=${me}&status=filled`)
    expect(listed.body.some((o: { orderHash: string }) => o.orderHash === posted.body.orderHash)).toBe(true)
  }, 90_000)

  it('MetaSwapX: invalidating the nonce on Permit2 cancels a resting limit order', async () => {
    const w = xUser ?? (xUser = await h.freshWallet())
    const me = w.account!.address
    // limit price far above market: never fillable
    const q = await h.get(`/x/quote?tokenIn=${USDC}&tokenOut=${WETH}&amount=${parseUnits('100', 6)}&swapper=${me}&mode=limit&limitPrice=1&expirySeconds=3600`)
    expect(q.status, JSON.stringify(q.body)).toBe(200)
    const order = decodeOrder(q.body.encodedOrder)
    const permit2 = h.s.ctx.deployment.contracts.Permit2
    const signature = await w.signTypedData({ account: w.account!, ...orderTypedData(order, 31337, permit2) })
    const posted = await h.post('/x/orders', { encodedOrder: q.body.encodedOrder, signature })
    expect(posted.status).toBe(201)
    const nonce = order.info.nonce
    const { request } = await h.client.simulateContract({ address: permit2, abi: permit2Abi, functionName: 'invalidateUnorderedNonces', args: [nonce >> 8n, 1n << (nonce & 0xffn)], account: w.account! })
    await h.client.waitForTransactionReceipt({ hash: await w.writeContract(request) })
    let status = 'open'
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline && status === 'open') {
      await new Promise((r) => setTimeout(r, 500))
      status = (await h.get(`/x/orders/${posted.body.orderHash}`)).body.status
    }
    expect(status).toBe('cancelled')
  })
})
