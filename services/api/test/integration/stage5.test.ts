import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getAddress, maxUint256, parseUnits, type Address } from 'viem'
import { launchAuctionAbi, launchpadAbi, vaultAbi } from '../../src/abis'
import { vaultsOf } from '../../src/indexer/indexer'
import { chainAvailable, startHarness, testErc20Abi, type Harness } from './setup'

const available = await chainAvailable()

/** True when the deployment includes the Stage 5 contracts (vaults + launchpads). */
async function hasStage5(h: Harness) {
  return vaultsOf(h.s.ctx.deployment).length > 0 && Boolean((h.s.ctx.deployment.contracts as Record<string, string>).Launchpad)
}

describe.skipIf(!available)('Stage 5: earn, launches, discovery, portfolio', () => {
  let h: Harness
  let USDC: Address
  let stage5 = false

  beforeAll(async () => {
    h = await startHarness()
    USDC = h.token('mUSDC')
    stage5 = await hasStage5(h)
    const head = Number(await h.client.getBlockNumber())
    expect(await h.s.indexer.waitFor(head, 120_000)).toBe(true)
  }, 240_000)
  afterAll(() => h?.stop())

  async function tx(w: ReturnType<Harness['wallet']>, to: Address, abi: unknown, functionName: string, args: unknown[], value = 0n) {
    const hash = await w.writeContract({ address: to, abi: abi as never, functionName: functionName as never, args: args as never, value, account: w.account!, chain: w.chain, gas: 12_000_000n } as never)
    const r = await h.client.waitForTransactionReceipt({ hash })
    expect(r.status, `${functionName} ${hash}`).toBe('success')
    return r
  }
  const chainNow = async () => Number((await h.client.getBlock()).timestamp)
  async function waitUntilChainTime(ts: number, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs
    while ((await chainNow()) < ts) {
      if (Date.now() > deadline) throw new Error('chain time did not advance')
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  it('explore discovery: trending, categories and tags', async () => {
    const trending = await h.get('/explore/trending')
    expect(trending.status).toBe(200)
    expect(trending.body.length).toBeGreaterThanOrEqual(4)
    expect(trending.body.length).toBeLessThanOrEqual(8)
    for (const r of trending.body) expect(Array.isArray(r.sparkline)).toBe(true)
    const scores = trending.body.map((r: { trendingScore: number }) => r.trendingScore)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    const stables = (await h.get('/explore/tokens?category=stablecoins')).body
    expect(stables.map((r: { token: { symbol: string } }) => r.token.symbol).sort()).toEqual(['mDAI', 'mUSDC', 'mUSDT'])
    const weth = (await h.get('/explore/tokens?category=wrapped')).body
    expect(weth[0].tags).toEqual(['majors', 'wrapped'])
    const gainers = (await h.get('/explore/tokens?category=gainers')).body
    for (const g of gainers) expect(g.change24h).toBeGreaterThan(0)
    expect((await h.get('/explore/tokens?category=nope')).status).toBe(400)
  })

  it('earn: deposit shows up in /accounts/:a/earn and earnings accrue', async () => {
    if (!stage5) return
    const vaults = (await h.get('/earn/vaults')).body
    expect(vaults.map((v: { symbol: string }) => v.symbol).sort()).toEqual(['meETH', 'meUSDC', 'meUSDT'])
    const vault = vaults.find((v: { symbol: string }) => v.symbol === 'meUSDC')
    expect(vault.apyPct).toBeCloseTo(4.41, 5)
    const w = await h.freshWallet()
    const me = w.account!.address
    const amount = parseUnits('1000000', 6)
    await tx(w, USDC, testErc20Abi, 'mint', [me, amount])
    await tx(w, USDC, testErc20Abi, 'approve', [vault.address, maxUint256])
    const r = await tx(w, vault.address, vaultAbi, 'deposit', [amount, me])
    await h.s.indexer.waitFor(Number(r.blockNumber), 15_000)
    const first = (await h.get(`/accounts/${me}/earn`)).body
    expect(first).toHaveLength(1)
    expect(BigInt(first[0].deposited)).toBe(amount)
    expect(first[0].depositedUsd).toBeGreaterThan(990_000)
    const t0 = await chainNow()
    await waitUntilChainTime(t0 + 4)
    const later = (await h.get(`/accounts/${me}/earn`)).body[0]
    // ~4.41%/yr on 1M ≈ 0.0014 mUSDC per second
    expect(BigInt(later.lifetimeEarnings)).toBeGreaterThan(0n)
    expect(BigInt(later.assets)).toBeGreaterThan(amount)
    expect(later.lifetimeEarningsUsd).toBeGreaterThan(0)
    const after = (await h.get('/earn/vaults')).body.find((v: { symbol: string }) => v.symbol === 'meUSDC')
    expect(after.depositors).toBeGreaterThanOrEqual(1)
    expect(after.tvlUsd).toBeGreaterThan(vault.tvlUsd)
    // portfolio includes the earn position
    const pf = (await h.get(`/accounts/${me}/portfolio`)).body
    expect(pf.earn).toHaveLength(1)
    expect(pf.earnUsd).toBeGreaterThan(990_000)
  }, 120_000)

  it('launch: bid → settle → claim; token is tagged `launched`, listed and quotable', async () => {
    if (!stage5) return
    const pad = (h.s.ctx.deployment.contracts as Record<string, Address>).Launchpad
    const creator = await h.freshWallet()
    const bidders = [await h.freshWallet(), await h.freshWallet()]
    const now = await chainNow()
    const symbol = `T${(now % 100000).toString(36).toUpperCase()}`
    const floor = 10n ** 16n // 0.01 mUSDC per token
    const tick = 10n ** 15n
    const params = {
      name: 'Test Tern',
      symbol,
      totalSupply: 1_000_000_000n * 10n ** 18n,
      auctionSupplyBps: 1000n, // 100M tokens → 1M mUSDC at the floor
      quoteToken: USDC,
      floorPrice: floor,
      tickSize: tick,
      startTime: BigInt(now),
      endTime: BigInt(now + 25),
      launchThreshold: parseUnits('500000', 6),
      liquidityBps: 5000n,
      poolFee: 10000,
      description: 'integration test launch',
      website: 'https://tern.example',
    }
    const created = await tx(creator, pad, launchpadAbi, 'createLaunch', [params])
    const log = created.logs.find((l) => l.address.toLowerCase() === pad.toLowerCase())!
    const token = getAddress(`0x${log.topics[1]!.slice(26)}`)
    const auction = getAddress(`0x${log.topics[2]!.slice(26)}`)
    // bids: 0.9M at 0.02 and 0.6M at 0.012 → oversubscribed, clears above the floor
    const plan: [ReturnType<Harness['wallet']>, bigint, bigint][] = [
      [bidders[0], parseUnits('900000', 6), 20n * tick],
      [bidders[1], parseUnits('600000', 6), 12n * tick],
    ]
    for (const [w, amount, maxPrice] of plan) {
      await tx(w, USDC, testErc20Abi, 'mint', [w.account!.address, amount])
      await tx(w, USDC, testErc20Abi, 'approve', [auction, maxUint256])
      await tx(w, auction, launchAuctionAbi, 'bid', [amount, maxPrice])
    }
    let last = await h.client.getBlockNumber()
    await h.s.indexer.waitFor(Number(last), 15_000)
    const active = (await h.get(`/launches/${auction}?bidsOf=${bidders[0].account!.address}`)).body
    expect(active.status).toBe('active')
    expect(active.symbol).toBe(symbol)
    expect(active.bids).toHaveLength(2)
    expect(active.bidsOf).toHaveLength(1)
    expect(active.priceLevels.length).toBe(2)
    expect(active.thresholdPct).toBeGreaterThanOrEqual(100)
    expect(BigInt(active.clearingPrice)).toBeGreaterThan(floor)
    expect(active.description).toBe('integration test launch')
    const listed = (await h.get('/launches?status=active')).body
    expect(listed.some((r: { auction: string }) => r.auction === auction)).toBe(true)

    await waitUntilChainTime(Number(params.endTime) + 1)
    await tx(bidders[1], auction, launchAuctionAbi, 'settle', [])
    for (const w of bidders) await tx(w, auction, launchAuctionAbi, 'claimAll', [])
    last = await h.client.getBlockNumber()
    await h.s.indexer.waitFor(Number(last), 15_000)
    const done = (await h.get(`/launches/${auction}`)).body
    expect(done.status).toBe('launched')
    expect(done.pool).toMatch(/^0x/)
    expect(done.settlement.launched).toBe(1)
    expect(done.bids.every((b: { claimed: boolean }) => b.claimed)).toBe(true)
    expect(done.liquidityUsd).toBeGreaterThan(0)
    expect(done.priceUsd).toBeGreaterThan(0)

    const launchedTokens = (await h.get('/explore/tokens?category=launched')).body
    const row = launchedTokens.find((r: { token: { address: string } }) => r.token.address === token)
    expect(row).toBeTruthy()
    expect(row.tags).toEqual(['launched', 'memes'])
    expect((await h.get(`/tokens/${token}`)).body.priceUsd).toBeGreaterThan(0)
    const q = await h.get(`/quote?tokenIn=${USDC}&tokenOut=${token}&amount=${parseUnits('100', 6)}`)
    expect(q.status, JSON.stringify(q.body)).toBe(200)
    expect(BigInt(q.body.amountOut)).toBeGreaterThan(0n)
    expect(q.body.route[0].at(-1).tokenOut.address).toBe(token)
    const trending = (await h.get('/launches/trending')).body
    expect(trending.some((r: { auction: string }) => r.auction === auction)).toBe(true)
    // the claimed tokens are in the bidder's portfolio with a clearing-price cost basis
    const pf = (await h.get(`/accounts/${bidders[0].account!.address}/portfolio`)).body
    const held = pf.tokens.find((t: { token: { address: string } }) => t.token.address === token)
    expect(held).toBeTruthy()
    expect(held.avgCostUsd).toBeCloseTo((Number(done.clearingPrice) / 1e18) * 1, 3)
  }, 180_000)

  it('launches list on a replayed chain: graduated, failed, active and upcoming', async () => {
    if (!stage5) return
    const all = (await h.get('/launches')).body
    const by = (s: string) => all.filter((r: { status: string }) => r.status === s)
    if (all.length < 9) return // chain without the market.ts history replay
    expect(by('launched').length).toBeGreaterThanOrEqual(6)
    expect(by('failed').length).toBeGreaterThanOrEqual(2)
    expect(by('active').length).toBeGreaterThanOrEqual(2)
    expect(by('upcoming').length).toBeGreaterThanOrEqual(1)
    const verified = (await h.get('/launches/top-verified')).body
    expect(verified.length).toBeGreaterThan(0)
    expect(verified.length).toBeLessThanOrEqual(4)
    expect(verified.every((r: { verified: boolean }) => r.verified)).toBe(true)
    for (const r of by('launched')) {
      expect(r.fdvUsd).toBeGreaterThan(0)
      expect(r.sparkline.length).toBeGreaterThan(0)
    }
    expect((await h.get('/launches?status=bogus')).status).toBe(400)
    const pads = new Set(all.map((r: { launchpad: { name: string } }) => r.launchpad.name))
    expect(pads).toEqual(new Set(['MetaSwap Launchpad', 'Devnet Pad']))
  })

  it('portfolio: demo wallet, tokens with P/L, NFTs and a history consistent with the current value', async () => {
    const demo = (await h.get('/accounts/demo')).body.address
    expect(demo).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
    const pf = (await h.get(`/accounts/${demo}/portfolio`)).body
    expect(pf.totalUsd).toBeGreaterThan(0)
    expect(pf.tokens.length).toBeGreaterThan(0)
    const eth = pf.tokens.find((t: { token: { symbol: string } }) => t.token.symbol === 'ETH')
    expect(eth).toBeTruthy()
    expect(eth.avgCostUsd).toBeGreaterThan(0)
    for (const t of pf.tokens) {
      if (t.costBasisUsd !== null && t.valueUsd !== null) expect(t.unrealizedPnlUsd).toBeCloseTo(t.valueUsd - t.costBasisUsd, 4)
    }
    expect(Math.abs(pf.totalUsd - (pf.tokensUsd + pf.earnUsd + pf.poolsUsd))).toBeLessThan(1e-6 * pf.totalUsd)
    for (const n of pf.nfts) expect(n.image).toMatch(/^data:image\/svg\+xml/)
    const hist = (await h.get(`/accounts/${demo}/portfolio/history?range=1D`)).body
    expect(hist.length).toBeGreaterThan(1)
    for (let i = 1; i < hist.length; i++) expect(hist[i].time).toBeGreaterThan(hist[i - 1].time)
    const last = hist.at(-1).valueUsd
    // the last point is the live value (same holdings definition; fees/collected aside)
    expect(Math.abs(last - pf.totalUsd) / pf.totalUsd).toBeLessThan(0.01)
    expect((await h.get(`/accounts/${demo}/portfolio/history?range=2D`)).status).toBe(400)
    // a month of history on a replayed chain (rebuilt from events; the node keeps no old state)
    const month = (await h.get(`/accounts/${demo}/portfolio/history?range=1M`)).body
    expect(month.length).toBeGreaterThan(1)
    expect(Math.abs(month.at(-1).valueUsd - pf.totalUsd) / pf.totalUsd).toBeLessThan(0.01)
    for (const p of month) expect(p.valueUsd).toBeGreaterThan(0)
    if (month[0].time < month.at(-1).time - 20 * 86400) {
      // values move with prices over the month (not a flat line)
      expect(new Set(month.map((p: { valueUsd: number }) => Math.round(p.valueUsd))).size).toBeGreaterThan(10)
    }
    if (pf.change24hUsd !== null) expect(typeof pf.change24hPct).toBe('number')
  }, 120_000)
})

