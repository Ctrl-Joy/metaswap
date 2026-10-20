import { isAddress } from 'viem'
import type { Token } from '@metaswap/sdk'

/**
 * Filter + rank tokens by a query on symbol, name or address (token selector §3.2).
 * Ranking: exact symbol > symbol prefix > name prefix > substring; address queries match exactly
 * (or by prefix for partial "0x…" input). Empty query returns the list unchanged.
 */
export function searchTokens(tokens: readonly Token[], query: string): Token[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...tokens]
  if (q.startsWith('0x')) {
    if (isAddress(q, { strict: false })) return tokens.filter((t) => t.address.toLowerCase() === q)
    return tokens.filter((t) => t.address.toLowerCase().startsWith(q))
  }
  const scored: Array<{ t: Token; s: number; i: number }> = []
  tokens.forEach((t, i) => {
    const sym = t.symbol.toLowerCase()
    const name = t.name.toLowerCase()
    let s = -1
    if (sym === q) s = 0
    else if (sym.startsWith(q)) s = 1
    // "usdc" should find "mUSDC": treat the devnet "m" prefix as optional
    else if (sym.replace(/^m(?=[a-z])/, '') === q) s = 1
    else if (name.startsWith(q)) s = 2
    else if (sym.includes(q)) s = 3
    else if (name.includes(q)) s = 4
    if (s >= 0) scored.push({ t, s, i })
  })
  return scored.sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.t)
}

/**
 * Tokens with a balance first (by USD value, then raw amount), the rest in list order.
 * `balances` and `prices` are keyed by lower-cased address.
 */
export function sortByBalance(tokens: readonly Token[], balances: Record<string, bigint>, prices: Record<string, number> = {}): Token[] {
  const value = (t: Token) => {
    const b = balances[t.address.toLowerCase()] ?? 0n
    if (b === 0n) return 0
    const p = prices[t.address.toLowerCase()]
    const amount = Number(b) / 10 ** t.decimals
    return p ? amount * p : amount * 1e-9 // unknown price: keep after priced holdings
  }
  return tokens
    .map((t, i) => ({ t, i, v: value(t) }))
    .sort((a, b) => {
      const ah = a.v > 0 ? 1 : 0
      const bh = b.v > 0 ? 1 : 0
      if (ah !== bh) return bh - ah
      if (ah && bh && a.v !== b.v) return b.v - a.v
      return a.i - b.i
    })
    .map((x) => x.t)
}

/** True if `q` looks like a full address that isn't in the list (→ import flow). */
export function isUnknownAddress(q: string, tokens: readonly Token[]): boolean {
  const s = q.trim()
  return isAddress(s, { strict: false }) && !tokens.some((t) => t.address.toLowerCase() === s.toLowerCase())
}
