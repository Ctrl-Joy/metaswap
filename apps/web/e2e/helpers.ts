import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, parseAbi, type Address } from 'viem'

// Read the synced deployment directly (Node ESM can't import the sdk's JSON without import attributes).
const deployment = JSON.parse(readFileSync(join(import.meta.dirname, '../../../packages/sdk/src/generated/deployment.json'), 'utf8')) as {
  contracts: Record<string, Address>
  tokens: Array<{ symbol: string; address: Address; decimals: number }>
}
const metachainDevnet = defineChain({ id: 31337, name: 'MetaChain Devnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } } })

export const RPC = process.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545'
export const API = process.env.VITE_API_URL ?? 'http://127.0.0.1:8787'

// Anvil's public dev accounts (unlocked on the local node).
export const ACCOUNTS = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
] as const

export const pub = createPublicClient({ chain: metachainDevnet, transport: http(RPC) })
/** json-rpc wallet for unlocked Anvil accounts (test setup only). */
export const wallet = (account: Address) => createWalletClient({ account, chain: metachainDevnet, transport: http(RPC) })

export function token(symbol: string) {
  const t = deployment.tokens.find((x) => x.symbol === symbol)
  if (!t) throw new Error(`${symbol} not in deployment`)
  return t
}

export async function balanceOf(symbol: string, owner: Address): Promise<bigint> {
  if (symbol === 'ETH') return pub.getBalance({ address: owner })
  return pub.readContract({ address: token(symbol).address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
}

/** Mint test tokens directly (TestERC20.mint is open on devnet). */
export async function mint(symbol: string, to: Address, amount: bigint) {
  const hash = await wallet(to).writeContract({ address: token(symbol).address, abi: parseAbi(['function mint(address to, uint256 amount)']), functionName: 'mint', args: [to, amount] })
  await pub.waitForTransactionReceipt({ hash })
}

export async function wrapEth(owner: Address, amount: bigint) {
  const hash = await wallet(owner).writeContract({ address: token('WETH').address, abi: parseAbi(['function deposit() payable']), functionName: 'deposit', value: amount })
  await pub.waitForTransactionReceipt({ hash })
}

const cache: Record<string, { ok: boolean; reason: string }> = {}
/** Skip unless Anvil (+ the API unless api=false) is up and the sdk deployment is synced. */
export async function requireStack(opts: { api?: boolean } = {}) {
  const needApi = opts.api ?? true
  const key = needApi ? 'api' : 'chain'
  if (!cache[key]) {
    cache[key] = await (async () => {
      const contracts = deployment.contracts as Partial<Record<string, string>>
      if (!contracts.UniversalRouter || !contracts.Permit2 || !deployment.tokens.length)
        return { ok: false, reason: 'packages/sdk/src/generated/deployment.json is not synced (run node scripts/dev.mjs --chain-only)' }
      try {
        await pub.getBlockNumber()
        const code = await pub.getCode({ address: contracts.UniversalRouter as Address })
        if (!code || code === '0x') return { ok: false, reason: 'UniversalRouter has no code on :8545 — the chain was restarted without redeploying' }
      } catch {
        return { ok: false, reason: `Anvil is not reachable at ${RPC}` }
      }
      if (!needApi) return { ok: true, reason: '' }
      try {
        const r = await fetch(`${API}/health`)
        if (!r.ok) return { ok: false, reason: `API /health returned ${r.status}` }
      } catch {
        return { ok: false, reason: `MetaSwap API is not reachable at ${API}` }
      }
      return { ok: true, reason: '' }
    })()
  }
  test.skip(!cache[key]!.ok, `Live stack required: ${cache[key]!.reason}`)
}

export async function connectDevWallet(page: Page, index: number, path = '/swap') {
  await page.addInitScript(() => {
    // fresh state per test: no persisted wallet/settings/txs
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear()
      sessionStorage.setItem('e2e-init', '1')
    }
  })
  await page.goto(path)
  await page.getByTestId('connect-button').click()
  await page.getByTestId(`dev-account-${index}`).click()
  await page.getByTestId('connect-dev-wallet').click()
  await expect(page.getByTestId('account-button')).toBeVisible()
}

export async function pickToken(page: Page, side: 'swap-input' | 'swap-output' | 'limit-input' | 'limit-output', symbol: string) {
  await page.getByTestId(`${side}-token`).click()
  const selector = page.getByTestId('token-selector')
  await selector.getByTestId('token-search').fill(symbol)
  await selector.getByTestId(`token-option-${symbol}`).first().click()
  await expect(selector).toBeHidden()
}

/** Poll until `fn` returns true (on-chain assertions after a tx). */
export async function eventually(fn: () => Promise<boolean>, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('condition not met in time')
}

/** Click Review → Confirm in the review modal and wait for success. */
export async function reviewAndConfirm(page: Page) {
  const cta = page.getByTestId('swap-cta')
  await expect(cta).toBeEnabled({ timeout: 30_000 })
  await cta.click()
  const modal = page.getByTestId('review-modal')
  await expect(modal).toBeVisible()
  const ack = modal.getByTestId('ack-impact')
  if (await ack.isVisible().catch(() => false)) await ack.check()
  await modal.getByTestId('confirm-swap').click()
  await expect(modal.getByTestId('swap-success')).toBeVisible({ timeout: 60_000 })
  await modal.getByTestId('review-close').click()
}
