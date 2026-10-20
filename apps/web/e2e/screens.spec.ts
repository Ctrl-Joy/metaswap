import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Visual capture of every the web shell page in dark + light at 1440px and 375px.
// Output: apps/web/e2e/screenshots/<page>-<theme>-<width>.png  (run: npx playwright test screens)
const OUT = join(import.meta.dirname, 'screenshots')
mkdirSync(OUT, { recursive: true })

const PAGES = [
  ['swap', '/swap'],
  ['limit', '/limit'],
  ['send', '/send'],
  ['buy', '/buy'],
  ['portfolio', '/portfolio'],
  ['metaswapx', '/metaswapx'],
  ['metachain', '/metachain'],
  ['explore-placeholder', '/explore'],
  ['positions-placeholder', '/positions'],
  ['404', '/nope'],
] as const

test('screens connected (live stack)', async ({ page }) => {
  test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots')
  const { requireStack, connectDevWallet, pickToken } = await import('./helpers')
  await requireStack()
  await connectDevWallet(page, 1)
  await pickToken(page, 'swap-output', 'mUSDC')
  await page.getByTestId('swap-input-input').fill('1')
  await page.getByTestId('swap-details-toggle').click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, 'swap-quote-dark-1440.png') })
  await page.getByTestId('swap-cta').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, 'swap-review-dark-1440.png') })
  await page.keyboard.press('Escape')
  await page.getByTestId('account-button').click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(OUT, 'account-drawer-dark-1440.png') })
  await page.keyboard.press('Escape')
  await page.goto('/limit')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(OUT, 'limit-connected-dark-1440.png'), fullPage: true })
  await page.goto('/portfolio')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(OUT, 'portfolio-connected-dark-1440.png'), fullPage: true })
})

for (const theme of ['dark', 'light'] as const)
  for (const width of [1440, 375] as const)
    test(`screens ${theme} ${width}`, async ({ page }) => {
      test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots')
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
      await page.addInitScript((t) => localStorage.setItem('metaswap.settings', JSON.stringify({ state: { theme: t }, version: 1 })), theme)
      for (const [name, path] of PAGES) {
        await page.goto(path)
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(OUT, `${name}-${theme}-${width}.png`), fullPage: true })
      }
    })
