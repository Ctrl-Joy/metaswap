import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, type Address, type Hex } from 'viem'
import { erc20Abi, multicall3Abi, npmAbi, v2PairAbi } from './abis'
import type { Analytics } from './analytics'
import { HttpError, addr, lc, tokenJson, type Context } from './context'
import type { Indexer } from './indexer/indexer'
import { MAX_UINT128, getAmountsForLiquidity, tickToPrice } from './lib/v3math'
import type { Router } from './routing/router'
import type { XService } from './x/service'
import { vaultsOf } from './indexer/indexer'

function account(a: string): Address {
  if (!isAddress(a, { strict: false })) throw new HttpError(400, 'invalid address')
  return getAddress(a)
}

export class Accounts {
  constructor(
    private ctx: Context,
    private indexer: Indexer,
    private analytics: Analytics,
    private router: Router,
    private x: XService,
  ) {}

  private usd(token: string, raw: bigint): number | null {
    const p = this.indexer.prices.get(lc(token))
    if (p === undefined) return null
    return (Number(raw) / 10 ** (this.indexer.decimals.get(lc(token)) ?? 18)) * p
  }

  private amt(token: string, raw: bigint) {
    const t = this.indexer.tokens.getSync(token)
    if (!t) return { address: getAddress(token), amount: raw.toString() }
    return { ...tokenJson(this.ctx, t), amount: raw.toString(), amountFormatted: Number(raw) / 10 ** t.decimals }
  }

  async balances(address: string) {
    const owner = account(address)
    const tokens = this.indexer.tokens.all()
    const mc = addr(this.ctx, 'Multicall3')
    const calls = [
      { target: mc, callData: encodeFunctionData({ abi: multicall3Abi, functionName: 'getEthBalance', args: [owner] }) },
      ...tokens.map((t) => ({ target: t.address, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [owner] }) })),
    ]
    const block = await this.ctx.client.getBlockNumber({ cacheTime: 0 })
    const res = await this.router.multicall(calls, block)
    const weth = lc(addr(this.ctx, 'WETH9'))
    const all = [this.indexer.tokens.native(), ...tokens]
    const changes = await Promise.all(all.map((t) => this.analytics.tokenStatsChange24h(t.address)))
    const rows = all.map((t, i) => {
      const r = res[i]
      const raw = r.success ? (decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: r.returnData }) as bigint) : 0n
      const priceUsd = this.indexer.prices.get(t.isNative ? weth : lc(t.address)) ?? null
      const formatted = Number(raw) / 10 ** t.decimals
      return {
        token: tokenJson(this.ctx, t),
        balance: raw.toString(),
        balanceFormatted: formatted,
        priceUsd,
        valueUsd: priceUsd === null ? null : formatted * priceUsd,
        change24h: changes[i],
      }
    })
    return {
      address: owner,
      blockNumber: block.toString(),
      totalValueUsd: rows.reduce((a, r) => a + (r.valueUsd ?? 0), 0),
      balances: rows.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
    }
  }

  async positions(address: string) {
    const owner = account(address)
    const o = lc(owner)
    const block = await this.ctx.client.getBlockNumber({ cacheTime: 0 })
    // V2: pairs the account ever received LP tokens for → live balanceOf
    const pairs = (await this.ctx.db.all<{ token: string }>("SELECT DISTINCT token FROM transfers WHERE to_addr = ? AND token IN (SELECT address FROM pools WHERE version = 'v2')", o)).map((r) => r.token)
    const v2Calls = pairs.flatMap((p) => [
      { target: getAddress(p), callData: encodeFunctionData({ abi: v2PairAbi, functionName: 'balanceOf', args: [owner] }) },
      { target: getAddress(p), callData: encodeFunctionData({ abi: v2PairAbi, functionName: 'totalSupply' }) },
      { target: getAddress(p), callData: encodeFunctionData({ abi: v2PairAbi, functionName: 'getReserves' }) },
    ])
    // V3: NFTs whose latest transfer went to the account
    // V3: NFTs whose latest transfer went to the account (candidates: every NFT it ever received)
    const tokenIds = (
      await this.ctx.db.all<{ token_id: string; to_addr: string }>(
        'SELECT token_id, to_addr FROM nft_transfers t WHERE token_id IN (SELECT token_id FROM nft_transfers WHERE to_addr = ?) AND NOT EXISTS (SELECT 1 FROM nft_transfers u WHERE u.token_id = t.token_id AND (u.block > t.block OR (u.block = t.block AND u.log_index > t.log_index)))',
        o,
      )
    )
      .filter((r) => r.to_addr === o)
      .map((r) => BigInt(r.token_id))
    const npm = addr(this.ctx, 'NonfungiblePositionManager')
    const v3Calls = tokenIds.map((id) => ({ target: npm, callData: encodeFunctionData({ abi: npmAbi, functionName: 'positions', args: [id] }) }))
    const res = await this.router.multicall([...v2Calls, ...v3Calls], block)

    const v2 = pairs
      .map((p, i) => {
        const [b, s, r] = [res[i * 3], res[i * 3 + 1], res[i * 3 + 2]]
        if (!b.success || !s.success || !r.success) return null
        const balance = decodeFunctionResult({ abi: v2PairAbi, functionName: 'balanceOf', data: b.returnData }) as bigint
        if (balance === 0n) return null
        const supply = decodeFunctionResult({ abi: v2PairAbi, functionName: 'totalSupply', data: s.returnData }) as bigint
        const [r0, r1] = decodeFunctionResult({ abi: v2PairAbi, functionName: 'getReserves', data: r.returnData }) as readonly [bigint, bigint, number]
        const pool = this.indexer.pools.get(p)!
        const amount0 = (balance * r0) / supply
        const amount1 = (balance * r1) / supply
        const v0 = this.usd(pool.token0, amount0)
        const v1 = this.usd(pool.token1, amount1)
        return {
          version: 'v2' as const,
          pool: getAddress(p),
          pair: getAddress(p),
          fee: pool.fee,
          token0: this.amt(pool.token0, amount0),
          token1: this.amt(pool.token1, amount1),
          liquidity: balance.toString(),
          totalSupply: supply.toString(),
          shareOfPool: Number(balance) / Number(supply),
          valueUsd: v0 === null && v1 === null ? null : (v0 ?? 0) + (v1 ?? 0),
          inRange: true,
          closed: false,
        }
      })
      .filter((x) => x !== null)

    // uncollected fees: static collect() from the owner with max amounts (exact, includes pending fee growth)
    const feeResults = await Promise.all(
      tokenIds.map((tokenId) =>
        this.ctx.client
          .simulateContract({ address: npm, abi: npmAbi, functionName: 'collect', args: [{ tokenId, recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }], account: owner, blockNumber: block })
          .then((r) => r.result as readonly [bigint, bigint])
          .catch(() => null),
      ),
    )
    const v3 = tokenIds
      .map((tokenId, k) => {
        const r = res[v2Calls.length + k]
        if (!r.success) return null
        const pos = decodeFunctionResult({ abi: npmAbi, functionName: 'positions', data: r.returnData as Hex }) as readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint]
        const [, , token0, token1, fee, tickLower, tickUpper, liquidity, , , owed0, owed1] = pos
        const pool = [...this.indexer.pools.values()].find((p) => p.version === 'v3' && p.token0 === lc(token0) && p.token1 === lc(token1) && p.fee === Number(fee))
        const sqrt = pool?.sqrtPriceX96 ?? 0n
        const tick = pool?.tick ?? null
        const { amount0, amount1 } = sqrt > 0n ? getAmountsForLiquidity(sqrt, Number(tickLower), Number(tickUpper), liquidity) : { amount0: 0n, amount1: 0n }
        const fees = feeResults[k] ?? [owed0, owed1]
        const d0 = this.indexer.decimals.get(lc(token0)) ?? 18
        const d1 = this.indexer.decimals.get(lc(token1)) ?? 18
        const v0 = this.usd(token0, amount0)
        const v1 = this.usd(token1, amount1)
        const f0 = this.usd(token0, fees[0])
        const f1 = this.usd(token1, fees[1])
        return {
          version: 'v3' as const,
          tokenId: tokenId.toString(),
          pool: pool ? getAddress(pool.address) : null,
          fee: Number(fee),
          tickLower: Number(tickLower),
          tickUpper: Number(tickUpper),
          currentTick: tick,
          priceLower: tickToPrice(Number(tickLower), d0, d1),
          priceUpper: tickToPrice(Number(tickUpper), d0, d1),
          currentPrice: tick === null ? null : tickToPrice(tick, d0, d1),
          liquidity: liquidity.toString(),
          token0: this.amt(token0, amount0),
          token1: this.amt(token1, amount1),
          uncollectedFees: { amount0: fees[0].toString(), amount1: fees[1].toString(), valueUsd: f0 === null && f1 === null ? null : (f0 ?? 0) + (f1 ?? 0) },
          valueUsd: v0 === null && v1 === null ? null : (v0 ?? 0) + (v1 ?? 0),
          inRange: tick !== null && tick >= Number(tickLower) && tick < Number(tickUpper),
          closed: liquidity === 0n,
        }
      })
      .filter((x) => x !== null)
    return { address: owner, blockNumber: block.toString(), v2, v3, positions: [...v3, ...v2] }
  }

  async activity(address: string, limit = 100) {
    const owner = account(address)
    const o = lc(owner)
    const items: Record<string, unknown>[] = []
    const txWithEvents = new Set<string>()
    for (const r of await this.ctx.db.all<Record<string, string | number | null>>('SELECT x.*, p.token0, p.token1, p.fee FROM swaps x JOIN pools p ON p.address = x.pool WHERE x.origin = ? ORDER BY block DESC LIMIT ?', o, limit)) {
      txWithEvents.add(r.tx_hash as string)
      items.push(this.analytics.swapTx(r))
    }
    for (const r of await this.ctx.db.all<Record<string, string | number | null>>(
      "SELECT x.*, p.token0, p.token1, p.fee FROM liquidity_events x JOIN pools p ON p.address = x.pool WHERE x.origin = ? AND (x.amount0 != '0' OR x.amount1 != '0') ORDER BY block DESC LIMIT ?",
      o,
      limit,
    )) {
      txWithEvents.add(r.tx_hash as string)
      items.push(this.analytics.liqTx(r))
    }
    for (const r of await this.ctx.db.all<Record<string, string | number>>("SELECT * FROM nft_events WHERE origin = ? AND type = 'collect' ORDER BY block DESC LIMIT ?", o, limit)) {
      if (txWithEvents.has(r.tx_hash as string)) continue
      txWithEvents.add(r.tx_hash as string)
      items.push({ type: 'collect', txHash: r.tx_hash, blockNumber: Number(r.block), logIndex: Number(r.log_index), timestamp: Number(r.timestamp), tokenId: r.token_id, amount0: r.amount0, amount1: r.amount1 })
    }
    for (const r of await this.ctx.db.all<Record<string, string | number>>('SELECT * FROM weth_events WHERE origin = ? ORDER BY block DESC LIMIT ?', o, limit)) {
      if (txWithEvents.has(r.tx_hash as string)) continue
      items.push({ type: r.type, txHash: r.tx_hash, blockNumber: Number(r.block), logIndex: Number(r.log_index), timestamp: Number(r.timestamp), amount: r.amount, token: tokenJson(this.ctx, this.indexer.tokens.getSync(addr(this.ctx, 'WETH9'))!) })
    }
    // plain token sends/receives (skip transfers that are part of swaps/liquidity/fills)
    const fillTxs = new Set((await this.ctx.db.all<{ tx_hash: string }>('SELECT tx_hash FROM fills WHERE swapper = ?', o)).map((r) => r.tx_hash))
    const skipAddrs = new Set([...this.indexer.pools.keys(), ...this.indexer.vaults, ...this.indexer.auctions, lc(addr(this.ctx, 'UniversalRouter')), lc(this.ctx.deployment.contracts.Permit2 ?? '0x'), lc(this.ctx.deployment.contracts.NonfungiblePositionManager ?? '0x')])
    for (const r of await this.ctx.db.all<Record<string, string | number>>(
      'SELECT * FROM transfers WHERE (from_addr = ? OR to_addr = ?) AND token NOT IN (SELECT address FROM pools) ORDER BY block DESC LIMIT ?',
      o,
      o,
      limit,
    )) {
      const tx = r.tx_hash as string
      if (txWithEvents.has(tx) || fillTxs.has(tx) || this.indexer.vaults.has(r.token as string)) continue
      const counterparty = r.from_addr === o ? (r.to_addr as string) : (r.from_addr as string)
      if (skipAddrs.has(counterparty)) continue
      const isMint = r.from_addr === '0x0000000000000000000000000000000000000000'
      items.push({
        type: isMint ? 'mint' : r.from_addr === o ? 'send' : 'receive',
        txHash: tx,
        blockNumber: Number(r.block),
        logIndex: Number(r.log_index),
        timestamp: Number(r.timestamp),
        from: getAddress(r.from_addr as string),
        to: getAddress(r.to_addr as string),
        token: this.amt(r.token as string, BigInt(r.amount as string)),
        amountUsd: this.usd(r.token as string, BigInt(r.amount as string)),
      })
    }
    for (const r of await this.ctx.db.all<Record<string, string | number>>('SELECT * FROM native_transfers WHERE from_addr = ? OR to_addr = ? ORDER BY block DESC LIMIT ?', o, o, limit)) {
      const v = BigInt(r.value as string)
      items.push({
        type: r.from_addr === o ? 'send' : 'receive',
        txHash: r.tx_hash,
        blockNumber: Number(r.block),
        logIndex: -1,
        timestamp: Number(r.timestamp),
        from: getAddress(r.from_addr as string),
        to: getAddress(r.to_addr as string),
        token: { ...tokenJson(this.ctx, this.indexer.tokens.native()), amount: v.toString(), amountFormatted: Number(v) / 1e18 },
        amountUsd: this.usd(addr(this.ctx, 'WETH9'), v),
      })
    }
    // Stage 5: earn deposits/withdrawals, launch bids and claims
    for (const r of await this.ctx.db.all<Record<string, string | number>>('SELECT * FROM earn_events WHERE owner = ? ORDER BY block DESC LIMIT ?', o, limit)) {
      const v = vaultsOf(this.ctx.deployment).find((x) => lc(x.address) === r.vault)
      items.push({
        type: r.type === 'deposit' ? 'earn-deposit' : 'earn-withdraw',
        txHash: r.tx_hash,
        blockNumber: Number(r.block),
        logIndex: Number(r.log_index),
        timestamp: Number(r.timestamp),
        vault: { address: getAddress(r.vault as string), symbol: v?.symbol ?? null },
        token: v ? this.amt(v.asset, BigInt(r.assets as string)) : null,
        amountUsd: v ? this.usd(v.asset, BigInt(r.assets as string)) : null,
      })
    }
    const launchMeta = (auction: string) =>
      this.ctx.db.get<{ symbol: string; name: string; token: string; quote: string | null }>(`SELECT symbol, name, token, ${this.ctx.db.jsonField('params_json', 'quoteToken')} AS quote FROM launches WHERE auction = ?`, auction)
    for (const r of await this.ctx.db.all<Record<string, string | number>>('SELECT * FROM bids WHERE bidder = ? ORDER BY block DESC LIMIT ?', o, limit)) {
      const m = await launchMeta(r.auction as string)
      items.push({
        type: 'bid',
        txHash: r.tx_hash,
        blockNumber: Number(r.block),
        logIndex: Number(r.log_index),
        timestamp: Number(r.timestamp),
        auction: getAddress(r.auction as string),
        launch: m ? { name: m.name, symbol: m.symbol, token: getAddress(m.token) } : null,
        bidId: r.bid_id,
        maxPrice: r.max_price,
        token: m?.quote ? this.amt(m.quote, BigInt(r.amount as string)) : null,
        amountUsd: m?.quote ? this.usd(m.quote, BigInt(r.amount as string)) : null,
      })
    }
    for (const r of await this.ctx.db.all<Record<string, string | number>>('SELECT * FROM claims WHERE bidder = ? ORDER BY block DESC LIMIT ?', o, limit)) {
      const m = await launchMeta(r.auction as string)
      items.push({
        type: 'claim',
        txHash: r.tx_hash,
        blockNumber: Number(r.block),
        logIndex: Number(r.log_index),
        timestamp: Number(r.timestamp),
        auction: getAddress(r.auction as string),
        launch: m ? { name: m.name, symbol: m.symbol, token: getAddress(m.token) } : null,
        bidId: r.bid_id,
        token: m ? this.amt(m.token, BigInt(r.tokens as string)) : null,
        refund: m?.quote ? this.amt(m.quote, BigInt(r.refund as string)) : null,
      })
    }
    for (const ord of await this.x.list({ swapper: owner, limit: String(limit) })) {
      items.push({ type: 'order', txHash: ord.fillTx, blockNumber: ord.fillBlock ?? null, logIndex: 0, timestamp: ord.fillBlock ? ord.updatedAt : ord.createdAt, order: ord })
    }
    return items.sort((a, b) => Number(b.timestamp) - Number(a.timestamp) || Number(b.logIndex ?? 0) - Number(a.logIndex ?? 0)).slice(0, limit)
  }
}
