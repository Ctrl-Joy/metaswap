import { expect, test } from '@playwright/test'
import { erc20Abi, formatUnits, type Address } from 'viem'
import { ACCOUNTS, API, connectDevWallet, pub, requireStack, fundDevAccounts } from './helpers'

// Dev wallet accounts hold small personal portfolios: top up what these specs spend (devnet only)
test.beforeAll(async () => {
  await fundDevAccounts().catch(() => {}) // stack down → specs skip via requireStack
})

test.describe('portfolio', () => {
  test('signed out: demo wallet with connect banner, tabs as sub-routes, live strip', async ({ page }) => {
    await requireStack()
    await page.goto('/portfolio')
    await expect(page.getByTestId('portfolio-gate')).toContainText('Connect a wallet')
    await expect(page.getByTestId('demo-label')).toHaveText('Demo wallet')
    await expect(page.getByTestId('track-portfolio')).toBeVisible()
    // demo wallet (Anvil #1) holds seed tokens → non-zero total and token rows
    await expect(page.getByTestId('portfolio-total')).toContainText('$', { timeout: 30_000 })
    await expect(page.getByTestId('portfolio-tokens').locator('tr').first()).toBeVisible()
    await expect(page.getByTestId('holdings-strip').locator('a[data-testid^="holding-card-"]').first()).toBeVisible()
    for (const [tab, path] of [
      ['tokens', '/portfolio/tokens'],
      ['nfts', '/portfolio/nfts'],
      ['activity', '/portfolio/activity'],
      ['overview', '/portfolio'],
    ] as const) {
      await page.getByTestId(`portfolio-tab-${tab}`).click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
    }
    // hide balances
    await page.getByTestId('hide-balances').click()
    await expect(page.getByTestId('portfolio-total')).toContainText('••••')
    await page.getByTestId('hide-balances').click()
  })

  test('connected: shows own balances matching the chain', async ({ page }) => {
    await requireStack()
    const me = ACCOUNTS[2]
    await connectDevWallet(page, 2, '/portfolio')
    await expect(page.getByTestId('portfolio-gate')).toHaveCount(0)
    await expect(page.getByTestId('demo-label')).toHaveCount(0)
    const usdc = (await fetch(`${API}/tokens`).then((r) => r.json()) as { tokens: Array<{ symbol: string; address: Address }> }).tokens.find((t) => t.symbol === 'mUSDC')!
    const bal = await pub.readContract({ address: usdc.address, abi: erc20Abi, functionName: 'balanceOf', args: [me] })
    test.skip(bal === 0n, 'account #2 holds no mUSDC')
    const row = page.getByTestId('portfolio-token-mUSDC')
    await expect(row).toBeVisible({ timeout: 30_000 })
    const whole = Math.floor(Number(formatUnits(bal, 6))).toLocaleString('en-US')
    await expect(row).toContainText(whole.slice(0, Math.min(whole.length, 4)))
  })
})

test.describe('earn', () => {
  test('deposit into and withdraw from the mUSDC vault (on-chain shares)', async ({ page }) => {
    await requireStack()
    const vaults = await fetch(`${API}/earn/vaults`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    const list = (Array.isArray(vaults) ? vaults : (vaults?.vaults ?? [])) as Array<{ address: Address; symbol: string; asset: { symbol: string } }>
    const vault = list.find((v) => v.asset.symbol === 'mUSDC')
    test.skip(!vault, 'Earn vaults are not deployed / GET /earn/vaults unavailable')
    const me = ACCOUNTS[3]
    const shareBal = () => pub.readContract({ address: vault!.address, abi: erc20Abi, functionName: 'balanceOf', args: [me] })
    const before = await shareBal()

    await connectDevWallet(page, 3, '/earn')
    await page.getByTestId(`vault-deposit-${vault!.symbol}`).click()
    const modal = page.getByTestId('earn-modal')
    await modal.getByTestId('earn-amount').fill('25')
    await modal.getByTestId('earn-confirm').click()
    await expect(modal.getByTestId('earn-success')).toBeVisible({ timeout: 60_000 })
    await modal.getByTestId('earn-close').click()
    await expect.poll(shareBal, { timeout: 20_000 }).toBeGreaterThan(before)

    await page.goto(`/earn/${vault!.address}`)
    await page.getByTestId('vault-withdraw').click()
    await modal.getByTestId('earn-max').click()
    await modal.getByTestId('earn-confirm').click()
    await expect(modal.getByTestId('earn-success')).toBeVisible({ timeout: 60_000 })
    await expect.poll(shareBal, { timeout: 20_000 }).toBe(0n)
  })
})
