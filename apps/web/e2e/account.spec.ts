import { expect, test } from '@playwright/test'
import { parseUnits, type Address } from 'viem'
import { balanceOf, eventually, pickToken, pub, requireStack, reviewAndConfirm } from './helpers'

// "Create account" (devnet-only local key), "Log in" (reconnect it) and the account drawer.
test.describe.serial('devnet local account', () => {
  let created: Address | undefined

  test.beforeEach(async () => {
    await requireStack({ api: true })
  })

  test('Create account: funded local key connects and swaps ETH → mUSDC', async ({ page }) => {
    test.setTimeout(180_000)
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('e2e-init')) {
        localStorage.clear()
        sessionStorage.setItem('e2e-init', '1')
      }
    })
    await page.goto('/swap')
    await page.getByTestId('connect-button').click()
    const panel = page.getByTestId('connect-modal')
    await expect(panel.getByTestId('connect-terms')).toContainText('test network')
    await panel.getByTestId('create-account').click()
    await expect(panel.getByTestId('account-created')).toBeVisible({ timeout: 60_000 })
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('metaswap.localAccount.devnetOnly') ?? '{}') as { address?: string; network?: string })
    expect(stored.network).toBe('metachain-devnet-31337')
    created = stored.address as Address
    expect(await pub.getBalance({ address: created })).toBeGreaterThanOrEqual(parseUnits('99', 18))
    await panel.getByTestId('created-done').click()
    await expect(page.getByTestId('account-button')).toBeVisible()

    const before = await balanceOf('mUSDC', created)
    await pickToken(page, 'swap-output', 'mUSDC')
    await page.getByTestId('swap-input-input').fill('0.2')
    await expect(page.getByTestId('swap-output-input')).not.toHaveValue('', { timeout: 30_000 })
    await reviewAndConfirm(page)
    await eventually(async () => (await balanceOf('mUSDC', created!)) > before)

    // drawer: Uniswap layout (avatar, address, balance, Send/Receive, View portfolio, recent activity)
    await page.getByTestId('account-button').click()
    const drawer = page.getByTestId('account-drawer')
    await expect(drawer.getByTestId('drawer-address')).toHaveText(`${created.slice(0, 6)}...${created.slice(-4)}`)
    await expect(drawer.getByTestId('drawer-wallet-label')).toContainText('Devnet account')
    await expect(drawer.getByTestId('portfolio-total')).toContainText('$')
    await expect(drawer.getByTestId('shortcut-send')).toBeVisible()
    await expect(drawer.getByTestId('shortcut-receive')).toBeVisible()
    await expect(drawer.getByTestId('activity-row').first()).toBeVisible({ timeout: 30_000 })
    await drawer.getByTestId('drawer-settings').click()
    await expect(drawer.getByTestId('drawer-settings-view')).toBeVisible()
    await drawer.getByTestId('drawer-back').click()
    await drawer.getByTestId('disconnect-button').click()
    await expect(page.getByTestId('connect-button')).toBeVisible()
  })

  test('Log in reconnects; Log in without a stored account offers Create', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/swap')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.getByTestId('connect-button').click()
    await page.getByTestId('log-in').click()
    await expect(page.getByTestId('login-none')).toBeVisible()
    await page.getByTestId('login-none').getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByTestId('account-created')).toBeVisible({ timeout: 60_000 })
    const addr = await page.evaluate(() => (JSON.parse(localStorage.getItem('metaswap.localAccount.devnetOnly') ?? '{}') as { address: string }).address)
    await page.getByTestId('created-done').click()
    await page.getByTestId('account-button').click()
    await page.getByTestId('disconnect-button').click()
    await page.reload()
    await expect(page.getByTestId('connect-button')).toBeVisible()
    await page.getByTestId('connect-button').click()
    await page.getByTestId('log-in').click()
    await expect(page.getByTestId('account-button')).toBeVisible()
    await page.getByTestId('account-button').click()
    await expect(page.getByTestId('drawer-address')).toHaveText(`${addr.slice(0, 6)}...${addr.slice(-4)}`)
  })
})
