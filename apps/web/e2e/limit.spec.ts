import { expect, test } from '@playwright/test'
import { parseUnits } from 'viem'
import { ACCOUNTS, API, connectDevWallet, requireStack, wrapEth, fundDevAccounts } from './helpers'

// Dev wallet accounts hold small personal portfolios: top up what these specs spend (devnet only)
test.beforeAll(async () => {
  await fundDevAccounts().catch(() => {}) // stack down → specs skip via requireStack
})

test.describe('MetaSwapX limit orders', () => {
  test.beforeEach(async () => {
    await requireStack()
  })

  test('place a limit order, see it listed, and (if the filler runs) filled', async ({ page }) => {
    const me = ACCOUNTS[4]
    await wrapEth(me, parseUnits('1', 18))
    await connectDevWallet(page, 4, '/limit')

    // defaults: sell WETH, buy mUSDC, price prefilled from the market
    await expect(page.getByTestId('limit-input-token')).toContainText('WETH')
    await expect(page.getByTestId('limit-output-token')).toContainText('mUSDC')
    await expect(page.getByTestId('limit-price-input')).not.toHaveValue('', { timeout: 30_000 })
    const market = Number(await page.getByTestId('limit-price-input').inputValue())
    expect(market).toBeGreaterThan(0)

    // a limit 2% under market is immediately profitable for the filler
    await page.getByTestId('limit-price-input').fill(String(Math.floor(market * 0.98)))
    await page.getByTestId('limit-input-input').fill('0.1')
    await page.getByTestId('expiry-1d').click()
    await page.getByTestId('limit-cta').click()
    await page.getByTestId('confirm-limit').click()
    await expect(page.getByTestId('limit-success')).toBeVisible({ timeout: 60_000 })
    await page.keyboard.press('Escape')

    const list = page.getByTestId('orders-list')
    await expect(list).toBeVisible()

    const filler = (await (await fetch(`${API}/x/filler`)).json()) as { enabled?: boolean; disabledReason?: string | null }
    if (filler.enabled && !filler.disabledReason) {
      await page.getByTestId('orders-tab-filled').click()
      await expect(list.getByTestId('order-row').first()).toHaveAttribute('data-status', 'filled', { timeout: 90_000 })
    } else {
      await expect(list.getByTestId('order-row').first()).toHaveAttribute('data-status', 'open')
    }
  })

  test('cancel an open order (Permit2 invalidateUnorderedNonces)', async ({ page }) => {
    const me = ACCOUNTS[4]
    await wrapEth(me, parseUnits('0.2', 18))
    await connectDevWallet(page, 4, '/limit')
    await expect(page.getByTestId('limit-price-input')).not.toHaveValue('', { timeout: 30_000 })
    const market = Number(await page.getByTestId('limit-price-input').inputValue())
    // far above market so no filler takes it
    await page.getByTestId('limit-price-input').fill(String(Math.ceil(market * 3)))
    await page.getByTestId('limit-input-input').fill('0.05')
    await page.getByTestId('limit-cta').click()
    await page.getByTestId('confirm-limit').click()
    await expect(page.getByTestId('limit-success')).toBeVisible({ timeout: 60_000 })
    await page.keyboard.press('Escape')
    const list = page.getByTestId('orders-list')
    const open = list.locator('[data-testid="order-row"][data-status="open"]').first()
    await expect(open).toBeVisible({ timeout: 20_000 })
    const before = await list.locator('[data-testid="order-row"][data-status="open"]').count()
    await open.getByTestId('cancel-order').click()
    await expect(list.locator('[data-testid="order-row"][data-status="open"]')).toHaveCount(before - 1, { timeout: 60_000 })
  })
})
