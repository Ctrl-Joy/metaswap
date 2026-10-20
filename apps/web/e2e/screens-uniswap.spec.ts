import { test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// the web shell "match Uniswap" captures: dark theme at Uniswap's measured viewport (1440x1000) and at 375px.
// Compare with docs/analysis/measured/*.png. Run: SCREENS=1 npx playwright test screens-uniswap
const OUT = join(import.meta.dirname, 'screenshots', 'uniswap-match', 'after')
mkdirSync(OUT, { recursive: true })

async function dark(page: Page, width: number) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 })
  await page.addInitScript(() => localStorage.setItem('metaswap.settings', JSON.stringify({ state: { theme: 'dark' }, version: 1 })))
}
const shot = (page: Page, name: string, fullPage = true) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage })

for (const width of [1440, 375] as const)
  test(`uniswap-match pages ${width}`, async ({ page }) => {
    test.skip(!process.env.SCREENS, 'set SCREENS=1')
    await dark(page, width)
    for (const [name, path] of [
      ['swap', '/swap'],
      ['limit', '/limit'],
      ['send', '/send'],
      ['buy', '/buy'],
      ['positions', '/positions'],
      ['positions-create', '/positions/create'],
    ] as const) {
      await page.goto(path)
      await page.waitForTimeout(2500)
      await shot(page, `${name}-${width}`)
    }
  })

test('uniswap-match overlays 1440', async ({ page }) => {
  test.skip(!process.env.SCREENS, 'set SCREENS=1')
  await dark(page, 1440)
  await page.goto('/swap')
  await page.waitForTimeout(1500)
  await page.getByTestId('swap-output').hover()
  await page.waitForTimeout(300)
  await shot(page, 'swap-buy-hover-1440', false)
  await page.getByTestId('swap-input-token').click()
  await page.waitForTimeout(1200)
  await shot(page, 'swap-token-selector-1440', false)
  await page.keyboard.press('Escape')
  await page.getByTestId('settings-button').click()
  await page.waitForTimeout(500)
  await shot(page, 'swap-settings-1440', false)
  await page.keyboard.press('Escape')
  await page.getByTestId('chart-toggle').click()
  await page.waitForTimeout(2500)
  await shot(page, 'swap-chart-1440', false)
  await page.getByTestId('chart-toggle').click()
  await page.getByTestId('connect-button').click()
  await page.waitForTimeout(800)
  await shot(page, 'connect-modal-1440', false)
})

test('uniswap-match overlays 375', async ({ page }) => {
  test.skip(!process.env.SCREENS, 'set SCREENS=1')
  await dark(page, 375)
  await page.goto('/swap')
  await page.waitForTimeout(1500)
  await page.getByTestId('swap-input-token').click()
  await page.waitForTimeout(1200)
  await shot(page, 'swap-token-selector-375', false)
  await page.keyboard.press('Escape')
  await page.getByTestId('connect-button').click()
  await page.waitForTimeout(800)
  await shot(page, 'connect-modal-375', false)
})

test('uniswap-match connected 1440', async ({ page }) => {
  test.skip(!process.env.SCREENS, 'set SCREENS=1')
  const { requireStack, connectDevWallet } = await import('./helpers')
  await requireStack()
  await dark(page, 1440)
  await connectDevWallet(page, 2, '/positions')
  await page.waitForTimeout(4000)
  await shot(page, 'positions-connected-1440')
  const card = page.locator('[data-testid^="position-card-v3-"]').first()
  if (await card.count()) {
    await card.click()
    await page.waitForTimeout(4000)
    await shot(page, 'position-detail-v3-1440')
  }
  await page.goto('/buy')
  await page.waitForTimeout(2500)
  await shot(page, 'buy-connected-1440')
})
