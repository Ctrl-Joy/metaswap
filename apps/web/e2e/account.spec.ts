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

test.describe('WalletConnect (MetaSwap Mobile)', () => {
  for (const width of [375, 1440])
    test(`QR replaces our panel at ${width}px and dismissing it brings the panel back`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/swap')
      await page.getByTestId('connect-button').click()
      await page.getByTestId('connect-mobile').click()
      const wc = page.locator('wcm-modal, w3m-modal').first()
      test.skip((await page.getByTestId('walletconnect-setup').count()) > 0, 'VITE_WALLETCONNECT_PROJECT_ID is not set')
      await expect(page.getByTestId('connect-modal')).toBeHidden()
      await expect(wc).toBeAttached({ timeout: 20_000 })
      // WalletConnect renders in a shadow root; hit-testing returns its host element. Probe the middle and
      // the lower part of the screen (where our bottom sheet used to sit): WalletConnect must be on top.
      await expect
        .poll(async () =>
          page.evaluate(() =>
            [0.5, 0.75].map((f) => document.elementFromPoint(innerWidth / 2, innerHeight * f)?.tagName.toLowerCase() ?? ''),
          ),
        { timeout: 20_000 })
        .toEqual(expect.arrayContaining([expect.stringMatching(/^(wcm|w3m)-modal$/)]))
      const hits = await page.evaluate(() => [0.5, 0.75].map((f) => document.elementFromPoint(innerWidth / 2, innerHeight * f)?.closest('[data-testid="connect-modal"]') ? 'ours' : 'other'))
      expect(hits).not.toContain('ours')
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('connect-modal')).toBeVisible({ timeout: 15_000 })
    })
})
