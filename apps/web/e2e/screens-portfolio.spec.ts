import { test } from '@playwright/test'
import { join } from 'node:path'
const OUT = join(import.meta.dirname, 'screenshots')
for (const [w, h] of [[1440, 900], [1024, 800], [375, 812]] as const)
  for (const theme of ['dark', 'light'] as const)
    test(`portfolio ${w} ${theme}`, async ({ page }) => {
      test.skip(!process.env.SCREENS, 'SCREENS=1')
      await page.setViewportSize({ width: w, height: h })
      await page.addInitScript((t) => localStorage.setItem('metaswap.settings', JSON.stringify({ state: { theme: t }, version: 1 })), theme)
      await page.goto('/portfolio')
      await page.waitForTimeout(5000)
      await page.screenshot({ path: join(OUT, `portfolio-demo-${theme}-${w}.png`), fullPage: true })
      await page.screenshot({ path: join(OUT, `portfolio-demo-${theme}-${w}-fold.png`) })
    })

test('portfolio connected 1440 dark', async ({ page }) => {
  test.skip(!process.env.SCREENS, 'SCREENS=1')
  const { connectDevWallet, requireStack } = await import('./helpers')
  await requireStack()
  await connectDevWallet(page, 2, '/portfolio')
  await page.waitForTimeout(5000)
  await page.screenshot({ path: join(OUT, 'portfolio-connected-dark-1440.png'), fullPage: true })
})
