import { expect, test } from '@playwright/test'

// These run without the chain/API (UI-only), so they always execute.

test('settings: custom slippage and deadline persist across reload', async ({ page }) => {
  await page.goto('/swap')
  await page.getByTestId('settings-button').click()
  await page.getByTestId('slippage-input').fill('1.5')
  await page.getByTestId('deadline-input').fill('45')
  // routing toggles live in the "Trade options" sub-view (Uniswap layout)
  await page.getByTestId('settings-trade-options').click()
  await page.getByTestId('route-v2').click()
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('slippage-input')).toHaveValue('1.5')
  await expect(page.getByTestId('deadline-input')).toHaveValue('45')
  await page.getByTestId('settings-trade-options').click()
  await expect(page.getByTestId('route-v2')).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: 'Back' }).click()
  // warnings
  await page.getByTestId('slippage-input').fill('0.01')
  await expect(page.getByTestId('slippage-warning')).toContainText('may cause your transaction to fail')
  await page.getByTestId('slippage-input').fill('8')
  await expect(page.getByTestId('slippage-warning')).toContainText('High slippage')
  await page.getByTestId('slippage-auto').click()
  await expect(page.getByTestId('slippage-input')).toHaveValue('')
})

test('theme toggle persists (dark default → light)', async ({ page }) => {
  await page.goto('/swap')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByTestId('more-button').click()
  await page.getByTestId('theme-light').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('connect modal lists the Dev wallet with 5 Anvil accounts and is keyboard-closable', async ({ page }) => {
  await page.goto('/swap')
  await page.getByTestId('connect-button').click()
  const modal = page.getByTestId('connect-modal')
  await expect(modal).toBeVisible()
  await expect(modal.getByTestId('connect-options')).toContainText('Other wallets')
  await modal.getByTestId('connect-other-wallets').click()
  await expect(modal.getByTestId('dev-wallet-section')).toBeVisible()
  for (let i = 0; i < 5; i++) await expect(modal.getByTestId(`dev-account-${i}`)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
})

test('token selector search, chips and swap CTA states', async ({ page }) => {
  await page.goto('/swap')
  await expect(page.getByTestId('swap-cta')).toHaveText('Connect wallet')
  await page.getByTestId('swap-output-token').click()
  const sel = page.getByTestId('token-selector')
  await expect(sel).toBeVisible()
  await sel.getByTestId('token-search').fill('zzzz-nothing')
  await expect(sel).toContainText('No results')
  await page.keyboard.press('Escape')
})

test('routes render: 404, explore, positions and metachain', async ({ page }) => {
  await page.goto('/definitely-not-a-page')
  await expect(page.getByTestId('not-found')).toBeVisible()
  await page.goto('/explore')
  await expect(page.getByTestId('explore-page')).toBeVisible()
  await expect(page.getByTestId('explore-stats')).toBeVisible()
  await page.goto('/positions')
  // signed out: the positions page shows its connect gate rather than a placeholder
  await expect(page.getByTestId('positions-gate')).toBeVisible()
  await page.goto('/metachain')
  await expect(page.getByTestId('devnet-specs')).toContainText('31337')
  await page.goto('/')
  await expect(page).toHaveURL(/\/swap$/)
})

test.describe('mobile 375px', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
  test('swap page smoke: no horizontal scroll, menu and bottom-sheet modal work', async ({ page }) => {
    for (const path of ['/swap', '/limit', '/send', '/buy', '/portfolio', '/portfolio/tokens', '/earn', '/metaswapx', '/metachain']) {
      await page.goto(path)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(path.startsWith('/portfolio') ? 2500 : 300)
      // body hides x-overflow, so measure <main> (scroll containers clip their own content)
      await page.locator('main').waitFor()
      const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('main')?.scrollWidth ?? 0))
      const culprit = sw > 375 ? await page.evaluate(() => "cw=" + document.documentElement.clientWidth + " " + Array.from(document.querySelectorAll("body *")).filter((e) => { const s = getComputedStyle(e); const p = e.parentElement; const ps = p ? getComputedStyle(p) : null; return (e as HTMLElement).offsetWidth > 380 && (!ps || ps.overflowX === "visible") && s.position !== "fixed" }).slice(0, 6).map((e) => e.tagName + "." + String((e as HTMLElement).className).slice(0, 70) + "=" + (e as HTMLElement).offsetWidth).join(" | ")) : ""
      expect(sw, `horizontal overflow on ${path}: ${culprit}`).toBeLessThanOrEqual(375)
    }
    await page.goto('/swap')
    await page.getByTestId('mobile-menu-button').click()
    await expect(page.getByRole('navigation', { name: 'Mobile' })).toBeVisible()
    await page.getByRole('link', { name: 'Portfolio' }).click()
    await expect(page).toHaveURL(/portfolio/)
    await page.goto('/swap')
    await page.getByTestId('swap-output-token').click()
    const sel = page.getByTestId('token-selector')
    await expect(sel).toBeVisible()
    const box = await sel.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(370) // bottom sheet spans the screen
  })
})

for (const width of [1024, 1100, 1280, 1440])
  test(`header fits at ${width}px (Launches visible, Connect on screen)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/swap')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: /Launches/ })).toBeVisible()
    const connect = page.getByTestId('connect-button')
    await expect(connect).toBeVisible()
    const box = (await connect.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const navBox = (await nav.boundingBox())!
    expect(navBox.x + navBox.width).toBeLessThan(box.x)
  })
