import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, type Address, type Hex } from 'viem'
import { AUCTION_STATUS, launchAuctionAbi, launchpadAbi } from '../abis'
import type { Analytics } from '../analytics'
import { HttpError, lc, tokenJson, type Context } from '../context'
import { launchpadsOf, readLaunchParams, type Indexer } from '../indexer/indexer'
import type { Router } from '../routing/router'
import { fillBid, priceToNumber, tokensFor, type PriceLevel } from './math'

const DAY = 86400

interface LaunchRow {
  auction: string
  token: string
  launchpad: string
  creator: string
  name: string
  symbol: string
  created_block: number
  created_ts: number
  params_json: string | null
}

export interface LaunchParamsJson {
  name: string
  symbol: string
  totalSupply: string
  auctionSupplyBps: string
  quoteToken: string
  floorPrice: string
  tickSize: string
  startTime: string
  endTime: string
  launchThreshold: string
  liquidityBps: string
  poolFee: number
  description: string
  website: string
}

interface LiveState {
  status: (typeof AUCTION_STATUS)[number]
  clearingPrice: bigint
  totalCommitted: bigint
  bidCount: number
  raised: bigint
  thresholdProgressBps: bigint
  pool: string | null
  verified: boolean
}

const ZERO = '0x0000000000000000000000000000000000000000'

/** Launchpads, auctions and launched tokens (STAGE5 §1b/§3). */
export class Launches {
  private padNames = new Map<string, string>()
  private liveCache: { block: number; at: number; data: Map<string, LiveState> } | null = null

  constructor(
    private ctx: Context,
    private indexer: Indexer,
    private analytics: Analytics,
    private router: Router,
  ) {}

  private rows(): Promise<LaunchRow[]> {
    return this.ctx.db.all<LaunchRow>('SELECT * FROM launches ORDER BY created_block DESC')
  }

  private async params(r: LaunchRow): Promise<LaunchParamsJson | null> {
    if (r.params_json) return JSON.parse(r.params_json) as LaunchParamsJson
    const p = await readLaunchParams(this.ctx, r.auction)
    if (p) await this.ctx.db.run('UPDATE launches SET params_json = ? WHERE auction = ?', p, r.auction)
    return p ? (JSON.parse(p) as LaunchParamsJson) : null
  }

  private async padName(pad: string): Promise<string> {
    const hit = this.padNames.get(pad)
    if (hit) return hit
    const name = await this.ctx.client.readContract({ address: getAddress(pad), abi: launchpadAbi, functionName: 'name' }).catch(() => {
      const key = launchpadsOf(this.ctx.deployment).find((p) => lc(p.address) === pad)?.key
      return key === 'DevnetPad' ? 'Devnet Pad' : 'MetaSwap Launchpad'
    })
    this.padNames.set(pad, name)
    return name
  }

  /** Live auction state for every launch, one multicall per indexed block (cached ~1 block). */
  private async live(rows: LaunchRow[]): Promise<Map<string, LiveState>> {
    if (this.liveCache && this.liveCache.block === this.indexer.indexedBlock && this.liveCache.data.size === rows.length && Date.now() - this.liveCache.at < 3000)
      return this.liveCache.data
    const fns = ['status', 'clearingPrice', 'totalCommitted', 'raised', 'thresholdProgressBps', 'pool', 'totalBids'] as const
    const calls: { target: Address; callData: Hex }[] = []
    for (const r of rows) {
      for (const fn of fns) calls.push({ target: getAddress(r.auction), callData: encodeFunctionData({ abi: launchAuctionAbi, functionName: fn }) })
      calls.push({ target: getAddress(r.launchpad), callData: encodeFunctionData({ abi: launchpadAbi, functionName: 'verified', args: [getAddress(r.auction)] }) })
    }
    const block = await this.ctx.client.getBlockNumber({ cacheTime: 0 })
    const res = await this.router.multicall(calls, block)
    const per = fns.length + 1
    const data = new Map<string, LiveState>()
    rows.forEach((r, i) => {
      const get = (j: number, fn: string) => {
        const x = res[i * per + j]
        if (!x?.success || x.returnData === '0x') return null
        try {
          return decodeFunctionResult({ abi: fn === 'verified' ? launchpadAbi : launchAuctionAbi, functionName: fn as never, data: x.returnData }) as unknown
        } catch {
          return null
        }
      }
      const status = get(0, 'status') as number | null
      const pool = get(5, 'pool') as string | null
      data.set(r.auction, {
        status: AUCTION_STATUS[status ?? 0] ?? 'upcoming',
        clearingPrice: (get(1, 'clearingPrice') as bigint | null) ?? 0n,
        totalCommitted: (get(2, 'totalCommitted') as bigint | null) ?? 0n,
        bidCount: Number((get(6, 'totalBids') as bigint | null) ?? 0n),
        raised: (get(3, 'raised') as bigint | null) ?? 0n,
        thresholdProgressBps: (get(4, 'thresholdProgressBps') as bigint | null) ?? 0n,
        pool: pool && pool !== ZERO ? lc(pool) : null,
        verified: Boolean(get(7, 'verified')),
      })
    })
    this.liveCache = { block: this.indexer.indexedBlock, at: Date.now(), data }
    return data
  }

  private async rowJson(r: LaunchRow, live: LiveState) {
    const p = await this.params(r)
    const quote = p ? this.indexer.tokens.getSync(p.quoteToken) : undefined
    const quoteUsd = quote ? this.analytics.priceUsd(quote.address) : null
    const qd = quote?.decimals ?? 18
    const totalSupply = p ? BigInt(p.totalSupply) : 0n
    const supplyWhole = Number(totalSupply) / 1e18
    const floor = p ? BigInt(p.floorPrice) : 0n
    const usdOf = (price: bigint) => (quoteUsd === null ? null : priceToNumber(price) * quoteUsd)
    const quoteUsdOf = (amount: bigint) => (quoteUsd === null ? null : (Number(amount) / 10 ** qd) * quoteUsd)
    const threshold = p ? BigInt(p.launchThreshold) : 0n
    const now = this.analytics.now()
    const settlement = await this.ctx.db.get<{ timestamp: number; pool: string | null; clearing_price: string; launched: number }>('SELECT timestamp, pool, clearing_price, launched FROM settlements WHERE auction = ?', r.auction)
    const launched = live.status === 'launched'
    const pool = live.pool ?? settlement?.pool ?? null
    let after: { pool: string | null; priceUsd: number | null; fdvUsd: number | null; volume24hUsd: number | null; liquidityUsd: number | null; change1h: number | null; change1d: number | null; sparkline: { time: number; priceUsd: number }[] } = { pool: null, fdvUsd: null, volume24hUsd: null, liquidityUsd: null, change1h: null, change1d: null, priceUsd: null, sparkline: [] }
    if (launched) {
      const priceUsd = this.analytics.priceUsd(r.token)
      const poolRt = pool ? this.indexer.pools.get(pool) : undefined
      const [volume24hUsd, change1h, change1d, sparkline] = await Promise.all([
        this.analytics.tokenVolume(r.token, now - DAY),
        this.analytics.changeSince(r.token, 3600),
        this.analytics.changeSince(r.token, DAY),
        this.analytics.sparkline(r.token),
      ])
      after = {
        pool: pool ? getAddress(pool) : null,
        priceUsd,
        fdvUsd: priceUsd === null ? null : priceUsd * supplyWhole,
        volume24hUsd,
        liquidityUsd: poolRt ? this.analytics.poolTvl(poolRt) : null,
        change1h,
        change1d,
        sparkline,
      }
    }
    const clearing = live.clearingPrice > 0n ? live.clearingPrice : floor
    const auctionSupply = p ? (totalSupply * BigInt(p.auctionSupplyBps)) / 10_000n : 0n
    return {
      auction: getAddress(r.auction),
      token: getAddress(r.token),
      name: r.name,
      symbol: r.symbol,
      logoURI: `/tokens/${r.symbol}.svg`,
      launchpad: { address: getAddress(r.launchpad), name: await this.padName(r.launchpad) },
      creator: getAddress(r.creator),
      verified: live.verified,
      status: live.status,
      startTime: p ? Number(p.startTime) : null,
      endTime: p ? Number(p.endTime) : null,
      createdAt: r.created_ts,
      launchedAt: settlement?.launched ? settlement.timestamp : null,
      ageSec: now - (settlement?.launched ? settlement.timestamp : r.created_ts),
      quoteToken: quote ? tokenJson(this.ctx, quote) : p?.quoteToken ?? null,
      totalSupply: totalSupply.toString(),
      auctionSupply: auctionSupply.toString(),
      floorPrice: floor.toString(),
      floorPriceUsd: usdOf(floor),
      fdvAtFloorUsd: usdOf(floor) === null ? null : usdOf(floor)! * supplyWhole,
      totalCommitted: live.totalCommitted.toString(),
      bidVolumeUsd: quoteUsdOf(live.totalCommitted),
      bidCount: live.bidCount,
      raised: live.raised.toString(),
      threshold: threshold.toString(),
      thresholdUsd: quoteUsdOf(threshold),
      thresholdPct: Number(live.thresholdProgressBps) / 100,
      clearingPrice: clearing.toString(),
      clearingPriceUsd: usdOf(clearing),
      clearingFdvUsd: usdOf(clearing) === null ? null : usdOf(clearing)! * supplyWhole,
      ...after,
    }
  }

  async list(q: { status?: string; launchpad?: string; verified?: string; sort?: string; order?: string; q?: string }) {
    const rows = await this.rows()
    const live = await this.live(rows)
    let out = await Promise.all(rows.map((r) => this.rowJson(r, live.get(r.auction)!)))
    const status = (q.status ?? 'all').toLowerCase()
    if (status !== 'all') {
      if (!['active', 'upcoming', 'launched', 'failed', 'ended'].includes(status)) throw new HttpError(400, 'status must be all|active|upcoming|launched|failed|ended')
      out = out.filter((r) => r.status === status)
    }
    if (q.launchpad) {
      const lp = q.launchpad.toLowerCase()
      out = out.filter((r) => r.launchpad.address.toLowerCase() === lp || r.launchpad.name.toLowerCase().includes(lp))
    }
    if (q.verified === 'true' || q.verified === '1') out = out.filter((r) => r.verified)
    if (q.verified === 'false' || q.verified === '0') out = out.filter((r) => !r.verified)
    if (q.q) {
      const needle = q.q.toLowerCase()
      out = out.filter((r) => r.name.toLowerCase().includes(needle) || r.symbol.toLowerCase().includes(needle) || r.token.toLowerCase() === needle)
    }
    const sort = q.sort ?? 'age'
    const key: Record<string, (r: (typeof out)[number]) => number> = {
      fdv: (r) => Number(r.fdvUsd ?? r.clearingFdvUsd ?? r.fdvAtFloorUsd ?? 0),
      volume: (r) => Number(r.volume24hUsd ?? 0),
      liquidity: (r) => Number(r.liquidityUsd ?? 0),
      age: (r) => -r.ageSec,
      bidVolume: (r) => Number(r.bidVolumeUsd ?? 0),
    }
    if (!key[sort]) throw new HttpError(400, 'sort must be fdv|volume|liquidity|age|bidVolume')
    const dir = q.order === 'asc' ? -1 : 1
    return out.sort((a, b) => dir * (key[sort](b) - key[sort](a)))
  }

  async trending() {
    return (await this.list({ status: 'launched', sort: 'volume' })).slice(0, 12)
  }

  async topVerified() {
    const rows = (await this.list({ verified: 'true', sort: 'bidVolume' })).filter((r) => r.status !== 'failed')
    // live auctions first, then launched by volume
    const rank = (s: string) => (s === 'active' ? 0 : s === 'upcoming' ? 1 : s === 'launched' ? 2 : 3)
    return rows.sort((a, b) => rank(a.status) - rank(b.status)).slice(0, 4)
  }

  async detail(auction: string, bidsOf?: string) {
    const r = await this.ctx.db.get<LaunchRow>('SELECT * FROM launches WHERE auction = ?', lc(auction))
    if (!r) throw new HttpError(404, 'Unknown auction')
    const live = await this.live(await this.rows())
    const row = await this.rowJson(r, live.get(r.auction)!)
    const p = await this.params(r)
    const quote = p ? this.indexer.tokens.getSync(p.quoteToken) : undefined
    const qd = quote?.decimals ?? 18
    const quoteUsd = quote ? this.analytics.priceUsd(quote.address) : null
    let rawLevels: PriceLevel[] = []
    let levels: { price: string; priceUsd: number | null; demand: string; demandUsd: number | null; fdvUsd: number | null }[] = []
    try {
      const [prices, demand] = (await this.ctx.client.readContract({ address: getAddress(r.auction), abi: launchAuctionAbi, functionName: 'priceLevels' })) as readonly [readonly bigint[], readonly bigint[]]
      const supplyWhole = p ? Number(BigInt(p.totalSupply)) / 1e18 : 0
      rawLevels = prices.map((price, i) => ({ price, demand: demand[i] }))
      levels = prices
        .map((price, i) => {
          const pu = quoteUsd === null ? null : priceToNumber(price) * quoteUsd
          return { price: price.toString(), priceUsd: pu, demand: demand[i].toString(), demandUsd: quoteUsd === null ? null : (Number(demand[i]) / 10 ** qd) * quoteUsd, fdvUsd: pu === null ? null : pu * supplyWhole }
        })
        .sort((a, b) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1))
    } catch {
      /* not readable (e.g. not deployed yet) */
    }
    const open = row.status === 'active' || row.status === 'ended' || row.status === 'upcoming'
    const estimate =
      p && open && rawLevels.length
        ? (amount: bigint, maxPrice: bigint) => {
            const f = fillBid({ amount, maxPrice }, rawLevels, (BigInt(p.totalSupply) * BigInt(p.auctionSupplyBps)) / 10_000n, BigInt(p.floorPrice), BigInt(p.tickSize), qd)
            return { estimatedTokens: f.tokens.toString(), estimatedRefund: f.refund.toString() }
          }
        : null
    const claims = new Map((await this.ctx.db.all<{ bid_id: string; tokens: string; refund: string; tx_hash: string }>('SELECT bid_id, tokens, refund, tx_hash FROM claims WHERE auction = ?', r.auction)).map((c) => [c.bid_id, c]))
    const bidJson = (b: { block: number; tx_hash: string; timestamp: number; bid_id: string; bidder: string; amount: string; max_price: string }) => {
      const claim = claims.get(b.bid_id)
      const amount = BigInt(b.amount)
      const maxPrice = BigInt(b.max_price)
      return {
        bidId: b.bid_id,
        bidder: getAddress(b.bidder),
        amount: b.amount,
        amountFormatted: Number(amount) / 10 ** qd,
        amountUsd: quoteUsd === null ? null : (Number(amount) / 10 ** qd) * quoteUsd,
        maxPrice: b.max_price,
        maxPriceUsd: quoteUsd === null ? null : priceToNumber(maxPrice) * quoteUsd,
        // tokens this bid would buy if it fully filled at its max price (lower bound)
        minTokens: tokensFor(amount, maxPrice, qd).toString(),
        txHash: b.tx_hash,
        blockNumber: Number(b.block),
        timestamp: Number(b.timestamp),
        // live estimate (mirrors LaunchAuction.previewClaim) while the auction is open
        ...(estimate ? estimate(amount, maxPrice) : {}),
        claimed: Boolean(claim),
        claimedTokens: claim?.tokens ?? null,
        claimedRefund: claim?.refund ?? null,
      }
    }
    const recent = (await this.ctx.db.all<Parameters<typeof bidJson>[0]>('SELECT * FROM bids WHERE auction = ? ORDER BY block DESC, log_index DESC LIMIT 50', r.auction)).map(bidJson)
    let mine: ReturnType<typeof bidJson>[] | undefined
    if (bidsOf) {
      if (!isAddress(bidsOf, { strict: false })) throw new HttpError(400, 'bidsOf must be an address')
      mine = (await this.ctx.db.all<Parameters<typeof bidJson>[0]>('SELECT * FROM bids WHERE auction = ? AND bidder = ? ORDER BY block DESC, log_index DESC', r.auction, lc(bidsOf))).map(bidJson)
    }
    return {
      ...row,
      params: p,
      description: p?.description ?? '',
      website: p?.website ?? '',
      priceLevels: levels,
      bids: recent,
      ...(mine ? { bidsOf: mine } : {}),
      settlement: (await this.ctx.db.get('SELECT block, tx_hash AS "txHash", timestamp, clearing_price AS "clearingPrice", raised, launched, pool FROM settlements WHERE auction = ?', r.auction)) ?? null,
    }
  }

  /** Launches an account bid on (portfolio / activity). */
  bidsByAccount(address: string) {
    return this.ctx.db.all<{ auction: string; bid_id: string; amount: string; max_price: string; timestamp: number; tx_hash: string }>('SELECT auction, bid_id, amount, max_price, timestamp, tx_hash FROM bids WHERE bidder = ? ORDER BY block DESC', lc(address))
  }
}
