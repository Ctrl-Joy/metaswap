import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, type Address, type Hex } from 'viem'
import { erc20Abi, multicall3Abi, npmAbi, v2PairAbi, v3PoolAbi, vaultAbi } from '../abis'
import type { Accounts } from '../accounts'
import type { Analytics } from '../analytics'
import { HttpError, addr, lc, tokenJson, type Context, type TokenInfo } from '../context'
import { vaultsOf, type Indexer } from '../indexer/indexer'
import { getAmountsForLiquidity } from '../lib/v3math'
import type { Router } from '../routing/router'
import type { Earn } from './earn'
import { costBasis, historyBuckets, priceToNumber, type Inflow } from './math'

/** Anvil account #1 — the public demo wallet shown on the signed-out portfolio. */
export const DEMO_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const
const ETH_KEY = 'eth'
const DAY = 86400

type Call = { target: Address; callData: Hex; decode: (data: Hex) => void }

/** Underlying token amounts (raw) an account holds at a block, keyed by pool-token address ('eth' for native). */
type Holdings = Map<string, bigint>

export class Portfolio {
  private historyCache = new Map<string, { at: number; block: number; value: { time: number; valueUsd: number }[] }>()

  constructor(
    private ctx: Context,
    private indexer: Indexer,
    private analytics: Analytics,
    private accounts: Accounts,
    private earn: Earn,
    private router: Router,
  ) {}

  private owner(a: string): Address {
    if (!isAddress(a, { strict: false })) throw new HttpError(400, 'invalid address')
    return getAddress(a)
  }

  /** ERC20 tokens to value: deployment + discovered (incl. launched), excluding LP and vault shares. */
  private tokenSet(): TokenInfo[] {
    return this.indexer.tokens.all()
  }

  /**
   * Everything the account holds at `blockNumber`, broken down to underlying tokens:
   * native ETH, ERC20 balances, earn vault shares (→ assets), V2 LP (→ pro-rata reserves) and
   * V3 position NFTs owned at that block (→ principal at the pool price then). Calls that fail
   * (e.g. a token deployed later) count as zero.
   */
  async holdings(owner: Address, blockNumber: bigint, opts: { pools?: boolean } = {}): Promise<{ wallet: Holdings; earn: Holdings; pools: Holdings }> {
    const wallet: Holdings = new Map()
    const earn: Holdings = new Map()
    const pools: Holdings = new Map()
    const add = (m: Holdings, k: string, v: bigint) => m.set(k, (m.get(k) ?? 0n) + v)
    const calls: Call[] = []
    const mc = addr(this.ctx, 'Multicall3')
    calls.push({ target: mc, callData: encodeFunctionData({ abi: multicall3Abi, functionName: 'getEthBalance', args: [owner] }), decode: (d) => add(wallet, ETH_KEY, decodeFunctionResult({ abi: multicall3Abi, functionName: 'getEthBalance', data: d })) })
    for (const t of this.tokenSet()) {
      calls.push({ target: t.address, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [owner] }), decode: (d) => add(wallet, lc(t.address), decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: d })) })
    }
    // vault shares → convertToAssets in a second round
    const vaults = vaultsOf(this.ctx.deployment)
    const shares = new Map<string, bigint>()
    for (const v of vaults) {
      calls.push({ target: getAddress(v.address), callData: encodeFunctionData({ abi: vaultAbi, functionName: 'balanceOf', args: [owner] }), decode: (d) => shares.set(lc(v.address), decodeFunctionResult({ abi: vaultAbi, functionName: 'balanceOf', data: d })) })
    }
    // V2 LP: pairs the account ever received
    const o = lc(owner)
    const block = Number(blockNumber)
    const v2 = new Map<string, { bal?: bigint; supply?: bigint; r0?: bigint; r1?: bigint }>()
    const v3: { tokenId: bigint; pos?: readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint] }[] = []
    if (opts.pools !== false) {
      for (const r of this.ctx.db.all<{ token: string }>("SELECT DISTINCT token FROM transfers WHERE to_addr = ? AND block <= ? AND token IN (SELECT address FROM pools WHERE version = 'v2')", o, block)) {
        const st: { bal?: bigint; supply?: bigint; r0?: bigint; r1?: bigint } = {}
        v2.set(r.token, st)
        const target = getAddress(r.token)
        calls.push({ target, callData: encodeFunctionData({ abi: v2PairAbi, functionName: 'balanceOf', args: [owner] }), decode: (d) => (st.bal = decodeFunctionResult({ abi: v2PairAbi, functionName: 'balanceOf', data: d })) })
        calls.push({ target, callData: encodeFunctionData({ abi: v2PairAbi, functionName: 'totalSupply' }), decode: (d) => (st.supply = decodeFunctionResult({ abi: v2PairAbi, functionName: 'totalSupply', data: d })) })
        calls.push({
          target,
          callData: encodeFunctionData({ abi: v2PairAbi, functionName: 'getReserves' }),
          decode: (d) => {
            const [a, b] = decodeFunctionResult({ abi: v2PairAbi, functionName: 'getReserves', data: d })
            st.r0 = a
            st.r1 = b
          },
        })
      }
      const owned = this.ctx.db
        .all<{ token_id: string; to_addr: string }>(
          'SELECT token_id, to_addr FROM nft_transfers t WHERE block <= ? AND (block, log_index) = (SELECT block, log_index FROM nft_transfers u WHERE u.token_id = t.token_id AND u.block <= ? ORDER BY block DESC, log_index DESC LIMIT 1)',
          block,
          block,
        )
        .filter((r) => r.to_addr === o)
      const npm = addr(this.ctx, 'NonfungiblePositionManager')
      for (const r of owned) {
        const item: (typeof v3)[number] = { tokenId: BigInt(r.token_id) }
        v3.push(item)
        calls.push({ target: npm, callData: encodeFunctionData({ abi: npmAbi, functionName: 'positions', args: [item.tokenId] }), decode: (d) => (item.pos = decodeFunctionResult({ abi: npmAbi, functionName: 'positions', data: d }) as never) })
      }
    }
    await this.run(calls, blockNumber)

    // round 2: vault assets, v3 pool prices
    const calls2: Call[] = []
    for (const v of vaults) {
      const s = shares.get(lc(v.address)) ?? 0n
      if (s === 0n) continue
      calls2.push({ target: getAddress(v.address), callData: encodeFunctionData({ abi: vaultAbi, functionName: 'convertToAssets', args: [s] }), decode: (d) => add(earn, lc(v.asset), decodeFunctionResult({ abi: vaultAbi, functionName: 'convertToAssets', data: d })) })
    }
    const slot = new Map<string, bigint>()
    const v3PoolOf = (t0: string, t1: string, fee: number) => [...this.indexer.pools.values()].find((p) => p.version === 'v3' && p.token0 === lc(t0) && p.token1 === lc(t1) && p.fee === fee)
    for (const item of v3) {
      if (!item.pos || item.pos[7] === 0n) continue
      const pool = v3PoolOf(item.pos[2], item.pos[3], Number(item.pos[4]))
      if (!pool || slot.has(pool.address)) continue
      slot.set(pool.address, 0n)
      calls2.push({ target: getAddress(pool.address), callData: encodeFunctionData({ abi: v3PoolAbi, functionName: 'slot0' }), decode: (d) => slot.set(pool.address, decodeFunctionResult({ abi: v3PoolAbi, functionName: 'slot0', data: d })[0]) })
    }
    await this.run(calls2, blockNumber)
    for (const [pair, st] of v2) {
      if (!st.bal || !st.supply || st.r0 === undefined || st.r1 === undefined) continue
      const p = this.indexer.pools.get(pair)
      if (!p) continue
      add(pools, p.token0, (st.bal * st.r0) / st.supply)
      add(pools, p.token1, (st.bal * st.r1) / st.supply)
    }
    for (const item of v3) {
      if (!item.pos || item.pos[7] === 0n) continue
      const pool = v3PoolOf(item.pos[2], item.pos[3], Number(item.pos[4]))
      const sqrt = pool ? slot.get(pool.address) : undefined
      if (!pool || !sqrt) continue
      const { amount0, amount1 } = getAmountsForLiquidity(sqrt, Number(item.pos[5]), Number(item.pos[6]), item.pos[7])
      add(pools, pool.token0, amount0)
      add(pools, pool.token1, amount1)
    }
    return { wallet, earn, pools }
  }

  private async run(calls: Call[], blockNumber: bigint) {
    if (!calls.length) return
    const res = await this.router.multicall(calls, blockNumber)
    calls.forEach((c, i) => {
      const r = res[i]
      if (!r?.success || r.returnData === '0x') return
      try {
        c.decode(r.returnData)
      } catch {
        /* ignore undecodable (e.g. not a contract at that block) */
      }
    })
  }

  private decimalsOf(key: string): number {
    return key === ETH_KEY ? 18 : (this.indexer.decimals.get(key) ?? 18)
  }

  private priceKey(key: string): string {
    return key === ETH_KEY ? lc(addr(this.ctx, 'WETH9')) : key
  }

  /** USD value of holdings using price lookups (`at` = unix seconds, or undefined for live prices). */
  usd(h: Holdings, at?: number): number {
    let total = 0
    for (const [k, v] of h) {
      if (v === 0n) continue
      const p = at === undefined ? this.analytics.priceUsd(this.priceKey(k)) : this.analytics.priceAt(this.priceKey(k), at)
      if (p === null) continue
      total += (Number(v) / 10 ** this.decimalsOf(k)) * p
    }
    return total
  }

  /** Inflows of one asset into the account, valued at the USD price when they arrived. */
  inflows(owner: string, key: string, genesisEth: bigint): Inflow[] {
    const o = lc(owner)
    const priceKey = this.priceKey(key)
    const dec = this.decimalsOf(key)
    const out: Inflow[] = []
    const at = (amount: string | bigint, ts: number, price?: number | null) =>
      out.push({ qty: Number(BigInt(amount)) / 10 ** dec, priceUsd: price !== undefined ? price : this.analytics.priceAt(priceKey, ts) })
    if (key === ETH_KEY) {
      const first = this.ctx.db.get<{ t: number | null }>('SELECT MIN(timestamp) AS t FROM blocks')?.t ?? 0
      if (genesisEth > 0n) at(genesisEth, Number(first))
      for (const r of this.ctx.db.all<{ value: string; timestamp: number }>('SELECT value, timestamp FROM native_transfers WHERE to_addr = ?', o)) at(r.value, Number(r.timestamp))
      // ETH paid out by unwraps the account triggered (router UNWRAP_WETH or direct withdraw)
      for (const r of this.ctx.db.all<{ amount: string; timestamp: number }>("SELECT amount, timestamp FROM weth_events WHERE type = 'unwrap' AND origin = ?", o)) at(r.amount, Number(r.timestamp))
      return out
    }
    const auctions = new Map(
      this.ctx.db
        .all<{ auction: string; clearing_price: string; quote: string | null }>("SELECT s.auction, s.clearing_price, json_extract(l.params_json, '$.quoteToken') AS quote FROM settlements s JOIN launches l ON l.auction = s.auction")
        .map((r) => [r.auction, r]),
    )
    for (const r of this.ctx.db.all<{ amount: string; timestamp: number; from_addr: string }>('SELECT amount, timestamp, from_addr FROM transfers WHERE token = ? AND to_addr = ?', key, o)) {
      const auction = auctions.get(r.from_addr)
      if (auction && auction.quote) {
        // tokens claimed from a launch auction cost the clearing price
        const q = this.analytics.priceAt(auction.quote, Number(r.timestamp))
        at(r.amount, Number(r.timestamp), q === null ? null : priceToNumber(BigInt(auction.clearing_price)) * q)
      } else at(r.amount, Number(r.timestamp))
    }
    if (key === lc(addr(this.ctx, 'WETH9'))) {
      for (const r of this.ctx.db.all<{ amount: string; timestamp: number }>("SELECT amount, timestamp FROM weth_events WHERE type = 'wrap' AND account = ?", o)) at(r.amount, Number(r.timestamp))
    }
    return out
  }

  async portfolio(address: string) {
    const owner = this.owner(address)
    const block = await this.ctx.client.getBlockNumber({ cacheTime: 0 })
    const [h, positions, earn, genesis] = await Promise.all([
      this.holdings(owner, block, { pools: false }),
      this.accounts.positions(owner),
      this.earn.account(owner),
      this.genesisEth(owner),
    ])
    const native = this.indexer.tokens.native()
    const tokens = [native, ...this.tokenSet()]
      .map((t) => {
        const key = t.isNative ? ETH_KEY : lc(t.address)
        const raw = h.wallet.get(key) ?? 0n
        if (raw === 0n) return null
        const balance = Number(raw) / 10 ** t.decimals
        const priceUsd = this.analytics.priceUsd(this.priceKey(key))
        const cb = costBasis(this.inflows(owner, key, genesis), balance, priceUsd)
        return {
          token: tokenJson(this.ctx, t),
          priceUsd,
          balance: raw.toString(),
          balanceFormatted: balance,
          valueUsd: cb.valueUsd,
          avgCostUsd: cb.avgCostUsd,
          costBasisUsd: cb.costBasisUsd,
          unrealizedPnlUsd: cb.unrealizedPnlUsd,
          unrealizedPnlPct: cb.unrealizedPnlPct,
          change24h: this.analytics.tokenStatsChange24h(this.priceKey(key)),
          tags: this.analytics.tagsFor(t.address),
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
    const pools = positions.positions.map((p) => {
      const fees = 'uncollectedFees' in p ? p.uncollectedFees : null
      const status = p.version === 'v2' ? 'in-range' : p.closed ? 'closed' : p.inRange ? 'in-range' : 'out-of-range'
      return { ...p, status, feesUsd: fees?.valueUsd ?? null }
    })
    const tokensUsd = tokens.reduce((a, t) => a + (t.valueUsd ?? 0), 0)
    const earnUsd = earn.reduce((a, e) => a + (e.valueUsd ?? 0), 0)
    const poolsUsd = pools.reduce((a, p) => a + Number(p.valueUsd ?? 0), 0)
    const totalUsd = tokensUsd + earnUsd + poolsUsd
    // value 24h ago with the same definition (holdings rebuilt from indexed events × prices then)
    const now = this.analytics.now()
    let change24hUsd: number | null = null
    let change24hPct: number | null = null
    const [prev] = await this.reconstruct(owner, [now - DAY])
    if (prev && prev.valueUsd > 0) {
      change24hUsd = totalUsd - prev.valueUsd
      change24hPct = (change24hUsd / prev.valueUsd) * 100
    }
    return {
      address: owner,
      blockNumber: block.toString(),
      totalUsd,
      tokensUsd,
      earnUsd,
      poolsUsd,
      change24hUsd,
      change24hPct,
      tokens,
      pools,
      earn,
      earnLifetimeEarningsUsd: earn.reduce((a, e) => a + (e.lifetimeEarningsUsd ?? 0), 0),
      nfts: await this.nfts(owner),
      activity: this.accounts.activity(owner, 20),
    }
  }

  /**
   * ETH the account held before any indexed activity (an inflow with no event): the current balance
   * minus every indexed ETH movement (tx values in/out and unwrap payouts). Needs no historical
   * node state (anvil runs with --prune-history); gas is ignored (~0 on the devnet).
   */
  private async genesisEth(owner: Address): Promise<bigint> {
    const o = lc(owner)
    const nowBal = await this.ctx.client.getBalance({ address: owner })
    let delta = 0n
    for (const r of this.ctx.db.all<{ from_addr: string; to_addr: string | null; value: string }>('SELECT from_addr, to_addr, value FROM tx_values WHERE from_addr = ? OR to_addr = ?', o, o)) {
      const v = BigInt(r.value)
      if (r.to_addr === o) delta += v
      if (r.from_addr === o) delta -= v
    }
    for (const r of this.ctx.db.all<{ amount: string }>("SELECT amount FROM weth_events WHERE type = 'unwrap' AND origin = ?", o)) delta += BigInt(r.amount)
    const g = nowBal - delta
    return g > 0n ? g : 0n
  }

  /**
   * GET /accounts/:a/portfolio/history. Holdings at each bucket are rebuilt backwards from the
   * account's current on-chain holdings using indexed events (exact for ERC20/WETH/vault shares/LP
   * tokens/V3 liquidity; ETH from value-carrying txs and unwraps, ignoring gas, which is ~0 on the
   * devnet), then valued at that bucket's prices. No historical node state is needed, so it works
   * for the whole replayed month. The last point is the live value.
   */
  async history(address: string, range = '1D') {
    const owner = this.owner(address)
    const now = this.analytics.now()
    const first = this.ctx.db.get<{ t: number | null }>('SELECT MIN(timestamp) AS t FROM blocks')?.t
    if (first === null || first === undefined) return []
    let buckets: number[]
    try {
      buckets = historyBuckets(range, now, Number(first))
    } catch (e) {
      throw new HttpError(400, (e as Error).message)
    }
    const cacheKey = `${lc(owner)}:${range.toUpperCase()}`
    const hit = this.historyCache.get(cacheKey)
    if (hit && hit.block === this.indexer.indexedBlock) return hit.value
    if (hit && Date.now() - hit.at < 15_000) return hit.value
    const points = await this.reconstruct(owner, buckets)
    this.historyCache.set(cacheKey, { at: Date.now(), block: this.indexer.indexedBlock, value: points })
    if (this.historyCache.size > 200) this.historyCache.clear()
    return points
  }

  /** Value of the account at each timestamp (ascending input), rebuilt from events. */
  async reconstruct(owner: Address, times: number[]): Promise<{ time: number; valueUsd: number }[]> {
    const o = lc(owner)
    const now = this.analytics.now()
    const block = await this.ctx.client.getBlockNumber({ cacheTime: 0 })
    const [cur, positions, vaults] = await Promise.all([this.holdings(owner, block, { pools: false }), this.accounts.positions(owner), this.earn.vaults()])
    // ---- current balances (raw) ----
    const bal = new Map<string, bigint>(cur.wallet)
    const shares = new Map<string, bigint>()
    for (const r of await this.earn.account(owner)) shares.set(lc(r.vault.address), BigInt(r.shares))
    const lp = new Map<string, bigint>()
    const lpSupply = new Map<string, bigint>()
    for (const p of positions.v2) {
      lp.set(lc(p.pair), BigInt(p.liquidity))
      lpSupply.set(lc(p.pair), BigInt(p.totalSupply))
    }
    const vaultSet = new Set(vaults.map((v) => lc(v.address)))
    const weth = lc(addr(this.ctx, 'WETH9'))
    const tokenKeys = new Set(this.tokenSet().map((t) => lc(t.address)))

    // ---- deltas (block, ts, apply(sign)) ----
    type Ev = { block: number; ts: number; key: string; kind: 'bal' | 'share' | 'lp' | 'supply'; delta: bigint }
    const evs: Ev[] = []
    for (const r of this.ctx.db.all<{ block: number; timestamp: number; token: string; from_addr: string; to_addr: string; amount: string }>(
      'SELECT block, timestamp, token, from_addr, to_addr, amount FROM transfers WHERE from_addr = ? OR to_addr = ?',
      o,
      o,
    )) {
      const amt = BigInt(r.amount)
      const d = (r.to_addr === o ? amt : 0n) - (r.from_addr === o ? amt : 0n)
      if (d === 0n) continue
      const kind = tokenKeys.has(r.token) ? 'bal' : vaultSet.has(r.token) ? 'share' : lp.has(r.token) || this.indexer.pools.get(r.token)?.version === 'v2' ? 'lp' : null
      if (kind) evs.push({ block: Number(r.block), ts: Number(r.timestamp), key: r.token, kind, delta: d })
    }
    // LP total supply changes (mint from / burn to zero) for pairs the account held
    const pairs = new Set([...lp.keys(), ...evs.filter((e) => e.kind === 'lp').map((e) => e.key)])
    for (const pair of pairs) {
      if (!lpSupply.has(pair)) lpSupply.set(pair, this.indexer.pools.get(pair)?.lpSupply ?? 0n)
      if (!lp.has(pair)) lp.set(pair, 0n)
      for (const r of this.ctx.db.all<{ block: number; timestamp: number; from_addr: string; to_addr: string; amount: string }>(
        "SELECT block, timestamp, from_addr, to_addr, amount FROM transfers WHERE token = ? AND (from_addr = '0x0000000000000000000000000000000000000000' OR to_addr = '0x0000000000000000000000000000000000000000')",
        pair,
      )) {
        const amt = BigInt(r.amount)
        evs.push({ block: Number(r.block), ts: Number(r.timestamp), key: pair, kind: 'supply', delta: r.from_addr === '0x0000000000000000000000000000000000000000' ? amt : -amt })
      }
    }
    // WETH wraps/unwraps by the account itself (WETH9 emits Deposit/Withdrawal, not Transfer)
    for (const r of this.ctx.db.all<{ block: number; timestamp: number; type: string; amount: string }>('SELECT block, timestamp, type, amount FROM weth_events WHERE account = ?', o))
      evs.push({ block: Number(r.block), ts: Number(r.timestamp), key: weth, kind: 'bal', delta: r.type === 'wrap' ? BigInt(r.amount) : -BigInt(r.amount) })
    // ETH: value sent/received by top-level txs, plus ETH paid out by unwraps the account triggered
    for (const r of this.ctx.db.all<{ block: number; timestamp: number; from_addr: string; to_addr: string | null; value: string }>(
      'SELECT block, timestamp, from_addr, to_addr, value FROM tx_values WHERE from_addr = ? OR to_addr = ?',
      o,
      o,
    )) {
      const v = BigInt(r.value)
      const d = (r.to_addr === o ? v : 0n) - (r.from_addr === o ? v : 0n)
      if (d !== 0n) evs.push({ block: Number(r.block), ts: Number(r.timestamp), key: ETH_KEY, kind: 'bal', delta: d })
    }
    for (const r of this.ctx.db.all<{ block: number; timestamp: number; amount: string }>("SELECT block, timestamp, amount FROM weth_events WHERE type = 'unwrap' AND origin = ?", o))
      evs.push({ block: Number(r.block), ts: Number(r.timestamp), key: ETH_KEY, kind: 'bal', delta: BigInt(r.amount) })
    evs.sort((a, b) => b.block - a.block)

    // ---- V3: liquidity per currently-owned position over time ----
    const v3 = positions.v3.map((p) => {
      const events = this.ctx.db.all<{ timestamp: number; type: string; liquidity: string | null }>(
        "SELECT timestamp, type, liquidity FROM nft_events WHERE token_id = ? AND type IN ('increase','decrease') ORDER BY block, log_index",
        p.tokenId,
      )
      const ownedSince = this.ctx.db.get<{ timestamp: number }>('SELECT timestamp FROM nft_transfers WHERE token_id = ? AND to_addr = ? ORDER BY block DESC LIMIT 1', p.tokenId, o)?.timestamp ?? 0
      const pool = p.pool ? this.indexer.pools.get(lc(p.pool)) : undefined
      return { p, events, ownedSince: Number(ownedSince), pool }
    })

    // ---- vault share → asset ratio over time (index grows at the APY) ----
    const ratio = new Map<string, { now: number; rate: number; asset: string; decimals: number }>()
    for (const v of vaults) {
      const total = Number(BigInt(v.totalShares))
      const assets = Number(BigInt(v.totalAssets))
      ratio.set(lc(v.address), { now: total > 0 ? assets / total : 1, rate: Math.log(1 + v.apyBps / 10_000) / (365 * DAY), asset: lc(v.asset.address), decimals: v.asset.decimals })
    }

    const priceAt = (key: string, t: number, live: boolean) => (live ? this.analytics.priceUsd(this.priceKey(key)) : this.analytics.priceAt(this.priceKey(key), t))
    const human = (key: string, raw: bigint) => Number(raw) / 10 ** this.decimalsOf(key)
    const valueAt = (t: number, live: boolean) => {
      let total = 0
      for (const [k, v] of bal) {
        if (v <= 0n) continue
        const p = priceAt(k, t, live)
        if (p !== null) total += human(k, v) * p
      }
      for (const [vault, sh] of shares) {
        const r = ratio.get(vault)
        if (!r || sh <= 0n) continue
        const assets = (Number(sh) * r.now * Math.exp(-r.rate * Math.max(0, now - t))) / 10 ** r.decimals
        const p = priceAt(r.asset, t, live)
        if (p !== null) total += assets * p
      }
      for (const [pair, l] of lp) {
        const supply = lpSupply.get(pair) ?? 0n
        const pool = this.indexer.pools.get(pair)
        if (!pool || l <= 0n || supply <= 0n) continue
        const snap = live
          ? { reserve0: pool.reserve0.toString(), reserve1: pool.reserve1.toString() }
          : this.ctx.db.get<{ reserve0: string; reserve1: string }>('SELECT reserve0, reserve1 FROM pool_snapshots WHERE pool = ? AND timestamp <= ? ORDER BY block DESC LIMIT 1', pair, t)
        if (!snap) continue
        const a0 = (BigInt(snap.reserve0) * l) / supply
        const a1 = (BigInt(snap.reserve1) * l) / supply
        const p0 = priceAt(pool.token0, t, live)
        const p1 = priceAt(pool.token1, t, live)
        total += (p0 === null ? 0 : human(pool.token0, a0) * p0) + (p1 === null ? 0 : human(pool.token1, a1) * p1)
      }
      for (const x of v3) {
        if (!x.pool || t < x.ownedSince) continue
        let liq = 0n
        for (const e of x.events) {
          if (Number(e.timestamp) > t) break
          liq += (e.type === 'increase' ? 1n : -1n) * BigInt(e.liquidity ?? '0')
        }
        if (liq <= 0n) continue
        let sqrt: bigint | null = null
        if (live) sqrt = x.pool.sqrtPriceX96
        else {
          const snap = this.ctx.db.get<{ price0: number | null }>('SELECT price0 FROM pool_snapshots WHERE pool = ? AND timestamp <= ? AND price0 IS NOT NULL ORDER BY block DESC LIMIT 1', x.pool.address, t)
          if (snap?.price0) {
            const d0 = this.decimalsOf(x.pool.token0)
            const d1 = this.decimalsOf(x.pool.token1)
            sqrt = BigInt(Math.floor(Math.sqrt(snap.price0 * 10 ** (d1 - d0)) * 2 ** 64)) * 2n ** 32n
          }
        }
        if (!sqrt) continue
        const { amount0, amount1 } = getAmountsForLiquidity(sqrt, x.p.tickLower, x.p.tickUpper, liq)
        const p0 = priceAt(x.pool.token0, t, live)
        const p1 = priceAt(x.pool.token1, t, live)
        total += (p0 === null ? 0 : human(x.pool.token0, amount0) * p0) + (p1 === null ? 0 : human(x.pool.token1, amount1) * p1)
      }
      return total
    }

    // walk backwards: undo every event newer than each bucket boundary
    const out: { time: number; valueUsd: number }[] = []
    let i = 0
    const sorted = [...times].sort((a, b) => b - a)
    for (const t of sorted) {
      while (i < evs.length && evs[i].ts > t) {
        const e = evs[i++]
        const m = e.kind === 'bal' ? bal : e.kind === 'share' ? shares : e.kind === 'lp' ? lp : lpSupply
        m.set(e.key, (m.get(e.key) ?? 0n) - e.delta)
      }
      out.push({ time: t, valueUsd: valueAt(t, t >= now) })
    }
    return out.reverse()
  }

  /** V3 position NFTs with their on-chain tokenURI (data URI JSON with an SVG image). */
  async nfts(address: string) {
    const owner = this.owner(address)
    const positions = await this.accounts.positions(owner)
    const npm = addr(this.ctx, 'NonfungiblePositionManager')
    const block = await this.ctx.client.getBlockNumber({ cacheTime: 0 })
    const ids = positions.v3.map((p) => BigInt(p.tokenId))
    const res = await this.router.multicall(
      ids.map((id) => ({ target: npm, callData: encodeFunctionData({ abi: tokenUriAbi, functionName: 'tokenURI', args: [id] }) })),
      block,
    )
    return positions.v3.map((p, i) => {
      let tokenURI: string | null = null
      let image: string | null = null
      let name: string | null = null
      const r = res[i]
      if (r?.success) {
        try {
          tokenURI = decodeFunctionResult({ abi: tokenUriAbi, functionName: 'tokenURI', data: r.returnData }) as string
          const meta = parseDataUriJson(tokenURI)
          image = (meta?.image as string) ?? null
          name = (meta?.name as string) ?? null
        } catch {
          /* ignore */
        }
      }
      return { tokenId: p.tokenId, contract: npm, pool: p.pool, name, image, tokenURI, inRange: p.inRange, closed: p.closed }
    })
  }
}

const tokenUriAbi = [{ type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] }] as const

export function parseDataUriJson(uri: string): Record<string, unknown> | null {
  const m = /^data:application\/json(;base64)?,(.*)$/s.exec(uri)
  if (!m) return null
  const body = m[1] ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2])
  return JSON.parse(body) as Record<string, unknown>
}
