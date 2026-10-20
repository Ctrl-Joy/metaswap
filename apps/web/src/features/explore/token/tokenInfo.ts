// Original, devnet-specific descriptions for the seed tokens (not third-party copy).
export const TOKEN_INFO: Record<string, string> = {
  ETH: 'Native gas token of MetaChain Devnet. It pays for transactions on the local chain and wraps 1:1 into WETH for trading in pools.',
  WETH: 'Wrapped Ether for MetaChain Devnet. Pools trade WETH, and native ETH swaps wrap and unwrap through it automatically.',
  mUSDC: 'A devnet USD stablecoin used as the main quote asset. Its price is anchored at $1 for pricing and TVL.',
  mUSDT: 'A devnet USD stablecoin with its own V2 and V3 pools, useful for testing stable-to-stable routes.',
  mDAI: 'A devnet USD stablecoin with an 18-decimal balance, used in low-fee V3 pools against mUSDC.',
  mWBTC: 'A devnet wrapped Bitcoin token with 8 decimals, paired against WETH in a 0.3% V3 pool.',
  META: 'The MetaSwap devnet token. It has a 1% fee-tier pool against WETH and is used to exercise thinner liquidity.',
  mLINK: 'A devnet oracle-style token with a V2 pool against WETH, for testing mid-volatility pairs.',
  mARB: 'A devnet token with a 0.3% V3 pool against WETH, for testing a mid-cap asset.',
}

export function tokenDescription(symbol: string): string {
  return TOKEN_INFO[symbol] ?? `${symbol} is a test token on MetaChain Devnet. Its price and volume come from the local MetaSwap pools.`
}
