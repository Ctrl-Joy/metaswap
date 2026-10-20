// Generates original token logos (coloured circle + initials) at public/tokens/<SYMBOL>.svg
// for every seed token in PLAN.md plus native ETH, and the favicon. Run: npm run logos -w @metaswap/web
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const dir = join(root, 'tokens')
mkdirSync(dir, { recursive: true })

// symbol -> [from, to, label]
const TOKENS = {
  ETH: ['#7C8CF8', '#4B5BD6', 'ETH'],
  WETH: ['#9AA3B5', '#5F687C', 'WETH'],
  mUSDC: ['#3B82F6', '#1D4ED8', 'USDC'],
  mUSDT: ['#22B07D', '#0E7C57', 'USDT'],
  mDAI: ['#F5B53D', '#D98E0B', 'DAI'],
  mWBTC: ['#F7931A', '#C2410C', 'BTC'],
  META: ['#8B8CFF', '#5B5BF0', 'M'],
  mLINK: ['#3D6BF2', '#1E3FB8', 'LINK'],
  mARB: ['#2D9CDB', '#1B5E9A', 'ARB'],
}

function svg(symbol, [from, to, label]) {
  const size = label.length >= 4 ? 30 : label.length === 3 ? 36 : label.length === 2 ? 44 : 56
  const ring = symbol.startsWith('m') ? `<circle cx="64" cy="64" r="58" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-dasharray="6 6"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <circle cx="64" cy="64" r="64" fill="url(#g)"/>${ring}
  <text x="64" y="64" dy=".35em" text-anchor="middle" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif" font-weight="700" font-size="${size}" fill="#fff" letter-spacing="-0.5">${label}</text>
</svg>
`
}

for (const [symbol, spec] of Object.entries(TOKENS)) writeFileSync(join(dir, `${symbol}.svg`), svg(symbol, spec))

writeFileSync(
  join(root, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="3" y="3" width="17" height="17" rx="5.5" fill="#5B5BF0"/><rect x="12" y="12" width="17" height="17" rx="5.5" fill="#8B8CFF"/><path d="M12 17.5V12h5.5A2.5 2.5 0 0 1 20 14.5V20h-5.5A2.5 2.5 0 0 1 12 17.5Z" fill="#2E2EA8"/></svg>\n`,
)
console.log(`wrote ${Object.keys(TOKENS).length} token logos + favicon to ${root}`)
