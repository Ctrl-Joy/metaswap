import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAbi, parseEther, type Address } from 'viem'
import { ACCOUNTS, connectDevWallet, pub, requireStack, token, wallet } from './helpers'

// Real-time updates over the API WebSocket: no reload, no REST refetch in between.
// A swap made from another account (viem, straight to the chain) must show up in the open
// Explore → Transactions table, and in the swapping account's portfolio total, within ~5 s.

const deployment = JSON.parse(readFileSync(join(import.meta.dirname, '../../../packages/sdk/src/generated/deployment.json'), 'utf8')) as {
  contracts: Record<string, Address>
}
const V2R = deployment.contracts.V2Router02!
const routerAbi = parseAbi(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)'])
const SWAPPER = ACCOUNTS[4]!

async function swapEthForUsdc(from: Address, eth = '0.05') {
  const path = [token('WETH').address, token('mUSDC').address]
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
  const hash = await wallet(from).writeContract({ address: V2R, abi: routerAbi, functionName: 'swapExactETHForTokens', args: [0n, path, from, deadline], value: parseEther(eth) })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  expect(receipt.status).toBe('success')
  return hash
}

/** Count REST calls whose URL matches `re` from now on. */
function countRequests(page: Page, re: RegExp) {
  const seen: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'GET' && re.test(r.url())) seen.push(r.url())
  })
  return seen
}

test.describe('real-time updates', () => {
  test.beforeEach(async () => {
    await requireStack({ api: true })
  })

  test('a swap from another account appears in Explore → Transactions without reload', async ({ page }) => {
    await page.goto('/explore/transactions')
    await expect(page.getByTestId('tx-row').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('footer-live')).toHaveAttribute('data-live', 'on', { timeout: 15_000 })
    const navs: string[] = []
    page.on('framenavigated', (f) => f === page.mainFrame() && navs.push(f.url()))
    const rest = countRequests(page, /\/explore\/transactions/)

    const started = Date.now()
    await swapEthForUsdc(SWAPPER)
    const row = page.locator('[data-testid="tx-row"][data-live="new"]').filter({ has: page.locator(`[title="${SWAPPER}"]`) }).first()
    await expect(row).toBeVisible({ timeout: 6_000 })
    const ms = Date.now() - started
    await expect(row.getByTestId('tx-label')).toContainText(/ETH|WETH/)
    expect(navs, 'no reload').toEqual([])
    expect(rest, 'delivered by the socket, not a REST refetch').toEqual([])
    test.info().annotations.push({ type: 'latency', description: `${ms} ms from send to row` })
  })

  test('the swapping account portfolio total updates live', async ({ page }) => {
    await connectDevWallet(page, 4, '/portfolio')
    const total = page.getByTestId('portfolio-total').locator('[data-value]')
    await expect(total).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('footer-live')).toHaveAttribute('data-live', 'on', { timeout: 15_000 })
    await page.waitForTimeout(1_500) // let the connect-time fetches settle
    const before = Number(await total.getAttribute('data-value'))
    const rest = countRequests(page, /\/accounts\/0x[0-9a-fA-F]{40}\/portfolio(\?|$)/)

    await swapEthForUsdc(SWAPPER, '0.5')
    await expect.poll(async () => Number(await total.getAttribute('data-value')), { timeout: 6_000, intervals: [200] }).not.toBe(before)
    expect(rest, 'delivered by the socket, not a REST refetch').toEqual([])
  })
})
