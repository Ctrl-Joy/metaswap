import { expect, test } from '@playwright/test'
import { parseUnits } from 'viem'
import { ACCOUNTS, balanceOf, connectDevWallet, eventually, mint, pickToken, requireStack, reviewAndConfirm, fundDevAccounts } from './helpers'

// Dev wallet accounts hold small personal portfolios: top up what these specs spend (devnet only)
test.beforeAll(async () => {
  await fundDevAccounts().catch(() => {}) // stack down → specs skip via requireStack
})

test.describe('trade flows on the live devnet', () => {
  // Swaps need the API (quotes); wrap / send / validation only need the chain.
  test.beforeEach(async ({}, info) => {
    await requireStack({ api: !/wrap|send|recipient/i.test(info.title) })
  })

  test('connect Dev wallet and swap ETH → mUSDC (exact input)', async ({ page }) => {
    const me = ACCOUNTS[1]
    const before = await balanceOf('mUSDC', me)
    await connectDevWallet(page, 1)
    await pickToken(page, 'swap-output', 'mUSDC')
    await page.getByTestId('swap-input-input').fill('0.5')
    await expect(page.getByTestId('swap-output-input')).not.toHaveValue('', { timeout: 30_000 })
    await expect(page.getByTestId('swap-details')).toBeVisible()
    await reviewAndConfirm(page)
    await eventually(async () => (await balanceOf('mUSDC', me)) > before)
    const gained = (await balanceOf('mUSDC', me)) - before
    expect(gained).toBeGreaterThan(parseUnits('500', 6)) // 0.5 ETH ≈ $1,500 at seed prices
  })

  test('swap mUSDC → META with Permit2 approval + permit signature', async ({ page }) => {
    const me = ACCOUNTS[2]
    await mint('mUSDC', me, parseUnits('1000', 6))
    const before = await balanceOf('META', me)
    await connectDevWallet(page, 2)
    await pickToken(page, 'swap-input', 'mUSDC')
    await pickToken(page, 'swap-output', 'META')
    await page.getByTestId('swap-input-input').fill('100')
    const cta = page.getByTestId('swap-cta')
    await expect(cta).toBeEnabled({ timeout: 30_000 })
    await cta.click()
    const modal = page.getByTestId('review-modal')
    await modal.getByTestId('confirm-swap').click()
    await expect(modal.getByTestId('swap-success')).toBeVisible({ timeout: 90_000 })
    // the approve step only appears the first time this account uses mUSDC
    await modal.getByTestId('review-close').click()
    await eventually(async () => (await balanceOf('META', me)) > before)
    const gained = (await balanceOf('META', me)) - before
    expect(gained).toBeGreaterThan(parseUnits('10', 18)) // $100 / $8 ≈ 12.5 META
  })

  test('exact-output swap: buy exactly 250 mUSDC with ETH', async ({ page }) => {
    const me = ACCOUNTS[1]
    const before = await balanceOf('mUSDC', me)
    await connectDevWallet(page, 1)
    await pickToken(page, 'swap-output', 'mUSDC')
    await page.getByTestId('swap-output-input').fill('250')
    await expect(page.getByTestId('swap-input-input')).not.toHaveValue('', { timeout: 30_000 })
    await expect(page.getByTestId('detail-max-in').or(page.getByTestId('swap-details'))).toBeVisible()
    await reviewAndConfirm(page)
    await eventually(async () => (await balanceOf('mUSDC', me)) - before >= parseUnits('250', 6))
  })

  test('wrap ETH → WETH and unwrap back', async ({ page }) => {
    const me = ACCOUNTS[3]
    const w0 = await balanceOf('WETH', me)
    await connectDevWallet(page, 3)
    await pickToken(page, 'swap-output', 'WETH')
    await page.getByTestId('swap-input-input').fill('0.25')
    await expect(page.getByTestId('wrap-info')).toBeVisible()
    await expect(page.getByTestId('swap-cta')).toHaveText('Wrap')
    await reviewAndConfirm(page)
    await eventually(async () => (await balanceOf('WETH', me)) - w0 === parseUnits('0.25', 18))

    await page.getByTestId('flip-button').click()
    await page.getByTestId('swap-input-input').fill('0.25')
    await expect(page.getByTestId('swap-cta')).toHaveText('Unwrap')
    await reviewAndConfirm(page)
    await eventually(async () => (await balanceOf('WETH', me)) === w0)
  })

  test('send mUSDC to account #3', async ({ page }) => {
    const me = ACCOUNTS[1]
    const to = ACCOUNTS[3]
    await mint('mUSDC', me, parseUnits('100', 6))
    const before = await balanceOf('mUSDC', to)
    await connectDevWallet(page, 1, '/send')
    await page.getByTestId('send-token').click()
    await page.getByTestId('token-search').fill('mUSDC')
    await page.getByTestId('token-option-mUSDC').click()
    await page.getByTestId('send-amount-input').fill('42.5')
    await page.getByTestId('send-recipient').fill(to.toLowerCase())
    await page.getByTestId('send-cta').click()
    await page.getByTestId('confirm-send').click()
    await expect(page.getByTestId('send-success')).toBeVisible({ timeout: 60_000 })
    await eventually(async () => (await balanceOf('mUSDC', to)) - before === parseUnits('42.5', 6))
  })

  test('invalid recipient is rejected', async ({ page }) => {
    await connectDevWallet(page, 1, '/send')
    await page.getByTestId('send-amount-input').fill('1')
    await page.getByTestId('send-recipient').fill('0x1234')
    await expect(page.getByTestId('recipient-error')).toBeVisible()
    await expect(page.getByTestId('send-cta')).toBeDisabled()
  })
})
