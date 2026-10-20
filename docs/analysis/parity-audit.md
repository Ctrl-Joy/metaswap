# MetaSwap ↔ Uniswap UI parity audit (the parity review, Phase 1)

Audit date: 2026-10-21. Reference: live https://app.uniswap.org (signed out, read-only; demo wallet where Uniswap
offers one). MetaSwap: http://127.0.0.1:5173 with Dev wallet account #4 for connected states (one 1 ETH → mUSDC test
swap was executed to observe review/progress/success/toast).

Viewports: the pane renders ~800×700 natively. 1440 checks used DOM/text extraction (screenshots at 1440 were too
small to read), mobile used the 375×812 preset. Comparison screenshots: `docs/analysis/screens/parity/`
(`uni-*` = Uniswap, `ms-*` = MetaSwap).

**Excluded by scope:** fiat on-ramp providers, NFT marketplace, multi-chain switching / network filters, mobile app and
extension promos ("Get app" banner), account creation / passkeys, Uniswap-backend features (Stocks, Commodities,
ETFs, Rewards, v4 hooks/dynamic fees, UniswapX-specific copy). **Already in STAGE5.md** (listed only when a
sub-detail is missing from the spec): Earn, Launches/Auctions, Explore Trending/Earn rows, chips, Auctions tab,
full Portfolio, Uniswap-style charts.

Legend: ✅ present · ⚠️ partial / different · ❌ missing · 🔧 broken. Priority: **P1** core flow or very visible,
**P2** noticeable, **P3** polish.

> **Blocking note for testers:** during the audit the Vite dev server full-reloaded the MetaSwap tab every few
> seconds (other engineers editing). Pages often re-mount mid-interaction, and `navigate` sometimes failed with
> "navigation … denied or failed". Some MetaSwap items were therefore verified from source (marked *src*).

---

## 1. Global shell

| Feature / UI detail | Uniswap behaviour | MetaSwap | Notes / file hint | Pri |
|---|---|---|---|---|
| Nav items | Trade, Explore, Launches **Beta**, Pool, Portfolio | ⚠️ Trade, Explore, Pool, Portfolio, MetaSwapX, MetaChain; no Launches | Launches is in STAGE5 §4c. `components/layout/Header.tsx` NAV_ITEMS | — |
| **Nav hover dropdowns** | Hovering a nav item opens a small menu: **Trade** → Swap / Limit / Buy / Sell; **Explore** → Tokens / Auctions / Pools / Transactions; **Pool** → View positions / Create position / Launch auction; **Portfolio** → Overview / Tokens / NFTs / Activity. Item click still navigates. | ❌ plain links | `Header.tsx`. Screenshot `uni-nav-hover-dropdowns-logo-menu.jpg` | P2 |
| Nav collapse breakpoint | Full nav still shown at 800px wide; hamburger only below ~768px | ⚠️ hamburger below `lg` (1024px) | `Header.tsx` uses `lg:flex`; also the 2 extra items (MetaSwapX/MetaChain) cost width; they could move to the logo menu | P3 |
| Logo product menu | Grid: **Products** (Wallet, UniswapX, API, Unichain with subtitles), **Protocol** (Vote, Governance, Developers), **Company** (About, Careers, Blog), collapsible **Legal & Privacy** (Your Privacy Choices, Privacy Policy • Terms • Disclosures), bottom row with help "?" and GitHub / X / Discord icons | ⚠️ Products (MetaSwap, MetaSwapX, MetaChain), Developers (API status), devnet footer line | Add Protocol/Company/Legal placeholders (local docs/terms pages or disabled rows), social/help icon row, Earn + Launches entries (STAGE5). `Header.tsx` ProductMenu | P3 |
| Search: placement | Dropdown panel anchored under the header bar (no modal title), input placeholder "Search by name, symbol, or address" | ⚠️ centred modal titled "Search", placeholder "Search tokens and pools" | `components/layout/SearchModal.tsx` | P3 |
| Search: filter chips | All / Tokens / Pools / Wallets | ⚠️ All / Tokens / Pools | Add **Wallets**: when the query is a 0x address, show a wallet row → `/portfolio?address=` (or account view) | P3 |
| Search: default sections | "Recent" (with **Clear**), "Tokens by 24H volume" (logo, name, **APY** badge if Earn, **FDV**, price, ▲▼ 24h %), "Pools by 24H volume" (pair, version chip, fee, **vol**, **APR**) | ⚠️ "Popular tokens" (name, symbol, short address, price) and "Pools" (pair, version+fee, TVL) | No 24h change, no FDV/APY, pools ranked by TVL not volume, no APR | P2 |
| Search: recent searches | Selecting a result stores it; reopening shows "Recent" + Clear | ❌ | persist last 5 selections in `state/ui` (localStorage) | P2 |
| Search: keyboard nav | ↑/↓ move a highlighted row, Enter opens it, Esc closes | ❌ (only `/` and Ctrl/⌘K to open, Esc to close) | Add `activeIndex` state + `onKeyDown` on the input like `TokenSelector.tsx` already does | P2 |
| Search: loading / empty | skeleton rows while loading; "No results found for X" | ✅ skeleton for pools; "No tokens match "x"." | — | — |
| "⋯" menu: Global preferences | **Theme: Auto / Light / Dark** (3 icons), **Language ›** submenu, **Currency ›** submenu (flag + code list with check, choice persisted and added to URL `?cur=`) | ⚠️ Theme (Light/Dark only), Hide small balances toggle, Currency "USD" (static) | Add **Auto** (follow `prefers-color-scheme`); Language row showing "English" (single option is fine); Currency could stay USD but render as a row with chevron/disabled. `Header.tsx` MoreMenu, `state/settings` | P3 |
| Network selector | none in header (per-list filters) | ✅ "MetaChain Devnet" pill → /metachain | single-network decision | — |
| Connect button (signed out) | pink "Get started" pill | ✅ "Connect" | label difference is fine | — |
| Connect modal | Title "Connect a wallet", options, terms footer | ✅ Dev wallet with account chips #0–#4, EIP-6963 notice, Other wallets (Coinbase), devnet warning | — | — |
| Account chip / drawer | Chip with avatar + address; drawer (bundle): total + **24h change** + mini chart, actions, tabs Tokens / NFTs / Pools / Activity, Settings, Disconnect | ⚠️ total, 4 shortcuts (Swap/Send/Receive/Buy), tabs Tokens / Pools / Activity / Orders, Settings view, Disconnect, "View full portfolio" | Missing 24h change line and NFTs tab; pending-tx count chip ✅ | P3 |
| Footer | none on app pages (legal in logo menu) | ⚠️ compact footer on non-trade pages | 🔧 shows **"API offline"** (red dot) while `/health` is still loading — e.g. every route change in dev. Show a neutral "Checking…" state until the query settles. `components/layout/Footer.tsx` (`apiUp = health.isSuccess`) | P3 |
| Help button | fixed "?" circle bottom-left on trade pages | ❌ | optional; link to a local FAQ/docs page | P3 |
| Toasts | top-right; review modal shows inline status instead | ⚠️ "Swapping…" toast renders over the open review modal (top-right overlaps the dialog) | Suppress tx toasts while the review/progress modal for the same tx is open, or offset. `components/layout/Toaster.tsx`, `features/swap/ReviewModal.tsx`. Screenshot `ms-review-progress-toast-overlap.jpg` | P3 |
| Banners | wrong-network etc. | ✅ wrong-network + devnet-down banners | — | — |
| 404 | "/x" → redirects to `/not-found`: "404 / Page not found! / Oops, take me back to Swap" | ✅ own copy, Back to swap | — | — |
| Mobile nav | hamburger opens a **bottom sheet**: App (Trade, Explore, Launches, Pool, Portfolio) + accordions Products / Protocol / Company / Legal | ⚠️ left drawer with nav + theme toggle | P3 polish only | P3 |

## 2. Trade — Swap

| Feature / UI detail | Uniswap behaviour | MetaSwap | Notes / file hint | Pri |
|---|---|---|---|---|
| Tabs | Swap / Limit / Buy / Sell | ⚠️ Swap / Limit / Send / Buy | Send is intentional (PLAN). Sell is an off-ramp (out of scope) | — |
| **Price chart panel next to the card** | On wide desktop the trade pages render the input token's chart (token, price, ▲ change, line, **1H 1D 1W 1M 1Y**) beside the card; a **trend icon** next to the gear toggles it; "Chart unavailable" fallback | ❌ no chart, no toggle | Reuse the explore area `features/explore/charts/TimeChart` with the sell token (or the pair). Show at ≥1280px, toggle persisted. `pages/TradeLayout.tsx`, `features/swap/SwapForm.tsx` header row | P1 |
| Fiat line under empty amount | "$0" shown under both panels even when empty | ❌ hidden until an amount is typed | show `$0` in text-3 for parity. `features/tokens/CurrencyInputPanel.tsx` | P3 |
| Balance + Max | Balance row when connected | ✅ "9,971.06 ETH  Max" | — | — |
| Empty Buy panel quick picks | On mobile the empty Buy panel shows 4 common-base token logos next to "Select token" | ❌ | P3; `CurrencyInputPanel.tsx` | P3 |
| URL prefill | `?inputCurrency=&outputCurrency=&value=&field=` | ✅ (`exactAmount`/`exactField`, symbols accepted) | Also accept Uniswap's `value`/`field` aliases | P3 |
| Rate line | "1 USDC = 0.000410331 ETH ($1.00)", click inverts | ✅ incl. invert | — | — |
| Details placement | Rate + collapsible details sit **below** the CTA | ⚠️ between Buy panel and CTA | P3 layout difference | P3 |
| Detail rows | Fee (Free), Network cost, Max slippage (Auto badge + value), Route **"View"** (opens route modal) + "Uniswap API"; price impact when relevant | ✅ Fee, Network cost, Price impact, Max slippage (Auto), Min received, Order routing + inline route diagram | 🔧/P3: an ASCII debug line "`[100%] WETH --[V3 0.05%]--> mUSDC`" is **visible** under the route diagram (details and review modal). Hide it or make it `sr-only`. `features/swap/SwapDetails.tsx` ~l.163 | P2 |
| Route modal | "View" opens a dialog: "1.00 ETH → 2,437 USDC · Via … · 1 hop", diagram, explainer | ⚠️ inline diagram only | optional | P3 |
| CTA states | Get started / Select a token / Enter an amount / Review … | ✅ Connect wallet, Select a token, Enter an amount, Review, Switch network etc. | — | — |
| Review modal | "You're swapping", amounts with fiat, details, Confirm | ✅ "Review swap", You pay / You receive (estimated), details, Confirm swap | — | — |
| Progress / success | steps, then success with explorer link | ✅ "Confirm swap · Step 1 of 1", "Swap success!", tx hash + copy, Close; form resets | — | — |
| Settings popover | **Max slippage** row (info, "Auto" pill + value 5.5 %), **Swap deadline** (30 minutes), **Trade options ›** sub-page: "Default" master toggle (explainer + "Includes UniswapX"); turning it off reveals per-protocol toggles (UniswapX, v4, v4 hooks, v3, v2) | ✅ Max slippage (Auto/custom + warnings), Transaction deadline, Routing toggles (V2, V3, MetaSwapX gasless) shown flat | ⚠️ structure: no compact rows / sub-page and no **Default** master toggle. Optional restyle: collapse to rows + "Trade options › Default" page. `features/settings/SettingsPopover.tsx` | P3 |
| Token selector | Title, search "Search tokens" + network chip, dismissible banner, common-base tiles, "Tokens by 24H volume", rows w/ name/symbol/short address/tags, balances when connected, "No results found for X" | ✅ search (paste address), common bases, "Your tokens" with balances + USD, tag pills ("Stablecoin"), Imported badge, import-warning flow with "I understand the risk", keyboard ↑/↓ | ⚠️ the "rest" section header is "Tokens" (empty when all are owned); Uniswap orders by 24H volume and labels it so. `features/tokens/TokenSelector.tsx` | P3 |

## 3. Trade — Limit / Send / Buy

| Feature / UI detail | Uniswap behaviour | MetaSwap | Notes | Pri |
|---|---|---|---|---|
| Limit price block | "When 1 ETH is worth [USDC]", Market / +1% / +5% / +10% | ✅ identical (WETH because intents need ERC-20), invert button | — | — |
| Limit expiry | 1 day / 1 week / 1 month / 1 year | ✅ | — | — |
| Limit disclaimer | "Limits may not execute exactly when tokens reach the specified price. Learn more" | ✅ MetaSwapX version + "How it works" | — | — |
| Order list | in Portfolio | ✅ "Your orders" with Open / Filled / Expired-cancelled + empty state | — | — |
| Price chart beside card | same as Swap | ❌ | see Swap P1 | — |
| Send | (not a tab on Uniswap any more; Send lives in Portfolio actions) | ✅ "You're sending", USD/token toggle, Balance + Max, recipient with self / checksum / contract warnings | ⚠️ no **recent recipients** list; consider also opening Send from Portfolio "Send" tile | P3 |
| Buy layout | "You're buying" big fiat input with `$`, quick chips **$100 / $300 / $1000**, token chip, CTA | ⚠️ devnet faucet list (by design) | Optional: add a "You're buying" header + amount chips that drive the faucet amount; keep faucet behaviour | P3 |

## 4. Explore

| Feature / UI detail | Uniswap behaviour | MetaSwap | Notes / file hint | Pri |
|---|---|---|---|---|
| Stats strip | 1D volume, Total TVL, v2, v3, v4 TVL; **every** stat has "▲ x.xx% today"; values animate with a digit-roll | ⚠️ 1D volume and Total TVL have "% today"; V2/V3 TVL don't; no roll animation | add deltas to V2/V3 TVL (API: tvl 24h ago per protocol). `features/explore/ExploreOverview.tsx` | P3 |
| TVL / Volume charts block | (not on current Uniswap explore) | extra ✅ | keep | — |
| Trending / Earn rows | STAGE5 | Trending ✅, Earn ❌ (in progress) | STAGE5 | — |
| Tabs | Tokens / Auctions / Pools / Transactions (each a route) | ✅ | — | — |
| Tokens chips | (Uniswap now: All / Stocks / Commodities / ETFs — out of scope) | ✅ STAGE5 chips | — | — |
| Volume window | custom dropdown "1D ⌄" (1H/1D/1W/1M/1Y/All time volume) | ⚠️ native `<select>` | style as a Popover menu to match other dropdowns | P3 |
| Search in table bar | search **icon button** that expands to an input | ⚠️ always-open input | fine; P3 | P3 |
| **Native ETH row** | "Ethereum ETH" is row #1 | ❌ only WETH listed | add native ETH (priced = WETH, volume aggregated) to `/explore/tokens`, link `/explore/tokens/<chain>/NATIVE`. API `services/api` explore tokens + `features/explore/TokensTable.tsx` | P2 |
| Token row sub-line | symbol + "14 networks" or short address | ⚠️ symbol + tag pills next to name | fine (tags per STAGE5). META has no tag (spec says defi) | P3 |
| Change formatting | filled triangles ▲ ▼, neutral grey ▲ with **"0%"** | ⚠️ arrows ↑ ↓, neutral shows grey "↑ 0.00%" | use ▲/▼ glyphs, neutral → "0%" with no arrow or grey triangle, trim trailing zeros. shared `components/ui` delta component | P3 |
| Sorting | sortable headers (Price, 1H, 1D, FDV, Volume), arrow on active column | ✅ `aria-sort`, default Volume ↓ | — | — |
| Sticky first column + horizontal scroll | Token column sticky, table scrolls horizontally; floating "→" scroll button at right edge | ✅ sticky # + Token, overflow-x auto | ⚠️ no "→" scroll-hint button | P3 |
| Pagination | infinite load | n/a (8–15 rows) | — | — |
| **Pools table columns** | Pool, TVL, **1D vol**, **30D vol**, **1D vol/TVL as ratio (e.g. 12.55)**, Pool APR; default sort 1D vol ↓ | ⚠️ #, Pool, TVL, APR, 1D vol, **7D vol**, 1D vol/TVL as **%** | reorder columns, switch 7D → 30D vol (API has daily volumes), render vol/TVL as a 2-dp ratio. `features/explore/PoolsTable.tsx` | P2 |
| Pools: "New position" button | white pill "+ New position" | ✅ | — | — |
| **Pools: filters** | sliders icon opens "Filters" modal: Protocol (v4/v3/v2 chips), **APR** min–max %, Rewards toggle, **TVL** buckets (<$100k, $100k–$1M, $10M+), Clear all / Apply | ❌ | build modal with Protocol (v2/v3), APR range, TVL buckets; filter client-side. Screenshot `uni-explore-pools-filters.jpg` | P2 |
| Pools: search | search icon button | ❌ | reuse the token-table search input (match pair symbols / address) | P2 |
| Pair naming | "ETH/USDC" (WETH shown as ETH, no spaces) | ⚠️ "WETH / mUSDC" | P3 | P3 |
| **Transactions: Type cell** | "USDC **for** ETH" with token logo; Add/Remove read "Add ETH and USDC" | ⚠️ generic "Swap" | build label from in/out tokens. `features/explore/TransactionsTable.tsx` | P2 |
| Transactions: columns | Type, USD, Token amount, Token amount, Wallet (+ time) | ⚠️ Time, Type, USD, Amounts (stacked), Wallet | split into two token-amount columns with logos | P3 |
| Transactions: type filter | "⇅ Type" header opens checkbox popover Swap / Add / Remove (multi-select) | ⚠️ chips All / Swaps / Adds / Removes (single select) | P3 | P3 |
| Relative time | "18s", "1m" | 🔧 shows **"0m ago"** for 45–59 s old rows (seen on pool detail) | `apps/web/src/lib/format.ts` `formatRelativeTime`: `if (s < 45)` then `Math.floor(s/60)` → 0. Use `s < 60 → "${s}s ago"`. Repro: open any pool detail, wait ~50 s, look at the newest tx | P2 |
| Loading | skeleton rows, wavy-line chart placeholder | ✅ skeletons | — | — |

## 5. Token detail (`/explore/tokens/:chain/:address`)

| Feature / UI detail | Uniswap behaviour | MetaSwap | Notes / file hint | Pri |
|---|---|---|---|---|
| Breadcrumb | "Tokens › ETH" | ✅ (*src*) | — | — |
| Header actions | X (Twitter) share, share icon, **"⋯" menu: Copy link / Share to Twitter / Report data issue** | ⚠️ copy address + share-link button | add "⋯" menu (Copy link, Copy address, View contract) | P3 |
| **Sticky compact header on scroll** | after scrolling, header collapses to logo + name + actions pinned under the nav | ❌ | P3; `features/explore/token/TokenParts.tsx` TokenHeader | P3 |
| Price headline | big price, "▲ $34.46 (1.44%)" (abs + %) | ✅ (*src*, STAGE5 charts) | ensure **absolute $ change** is shown, not only % | P3 |
| Chart modes / ranges | Price / Volume / TVL; 1H 1D 1W 1M 1Y All; line ↔ candle toggle; mode in URL | ✅ (STAGE5 §4a) | spec detail: Uniswap's **token** price line uses the token's brand colour (ETH = blue), green/red is used for sparklines. STAGE5 chose green/red; keep or revisit | P3 |
| Stats | **Stats** heading: TVL, Market cap, FDV, 1 day volume, **52W High**, **52W Low** (6 tiles, 3×2) | ⚠️ TVL, Market cap, FDV, 1D volume, combined "All-time high / low" | split into two tiles "52W high"/"52W low" (or "High"/"Low" over available history). `TokenParts.tsx` TokenStats | P3 |
| About | description with "…Show more" **plus link chips: Etherscan, Website, Twitter** | ⚠️ description + Show more; **no links** | add chips: "Contract" (copy / local explorer view), "Pool" links, Website for launched tokens (STAGE5 launch `website`) | P2 |
| Tabs under chart | Transactions / Pools | ✅ | — | — |
| Token tx table columns | Time, Type (**Buy/Sell** coloured), ETH amount, **For** (other token amount + symbol), USD, Wallet | ⚠️ generic table | show Buy/Sell relative to the page token. `TransactionsTable.tsx` (token mode) | P2 |
| Swap widget | right column on desktop; on narrow screens a **sticky bottom "Buy" (and Sell) button** opens it | ✅ widget (*src*); ⚠️ no sticky mobile Buy/Sell bar | `features/explore/token/TokenSwapWidget.tsx` | P3 |

## 6. Pool detail (`/explore/pools/:chain/:address`)

| Feature / UI detail | Uniswap behaviour | MetaSwap | Notes / file hint | Pri |
|---|---|---|---|---|
| Header | "Pools › ETH / USDC", pair logos, **⇅ invert**, network chip, version + fee chip, short address; right: explorer icon, share, "⋯" (Copy link / Share / Report) | ✅ breadcrumb, invert, chips, address + copy; ⚠️ no share / "⋯" | P3 | P3 |
| Chart modes | Price / Volume / Liquidity / **Depth**; ranges 1H–All; mode kept in URL `?chart=depth` | ✅ four modes incl. Depth | ⚠️ mode not in URL | P3 |
| Loading price | skeleton | 🔧 shows **"1 WETH = 0 mUSDC"** under a skeleton while loading. Repro: open `/explore/pools/metachain-devnet/<v3 pool>`, observe first paint. `features/explore/pool/PoolChartPanel.tsx` — render skeleton/“–” until price known | P2 |
| Swap / Add liquidity | in right column on desktop; on narrow screens **sticky bottom bar** with Swap + Add liquidity | ⚠️ inline buttons under header | P3 | P3 |
| Stats | Pool balances (amounts + bar), **Total APR**, TVL **+ Δ%**, 24H volume **+ Δ%**, 24H fees | ✅ balances with %, TVL, APR, 1D volume, 1D fees, vol/TVL, 7D volume; ⚠️ no Δ% on TVL / volume | add 24h deltas | P3 |
| Links | Pool, token0, token1 rows with copy + explorer | ✅ "Contracts" block | — | — |
| Pool tx table | Time, Type (**"Sell ETH" / "Buy ETH"**), USD, token0 amt, token1 amt, Wallet | ⚠️ Type "Swap", stacked Amounts; "Show more (25 older)" ✅ | same fix as Explore tx | P2 |

## 7. Launches / Auctions (compare with STAGE5 §4b–4c)

Spec covers the pages. Sub-details seen on Uniswap that the spec does not mention:

| Detail | Uniswap behaviour | Pri |
|---|---|---|
| Logo fallback | tokens without a logo show a coloured circle with 3-letter initials ("GH0", "BAW") | P3 |
| Auctions table disclaimer | line under the table: auctions sorted by committed volume, no valuation/endorsement | P3 |
| Auction detail: top countdown | "Auction ends in …" banner with "See full details" | P2 |
| Auction detail: price block | **Current clearing price** with % above floor and USD; **Current FDV**; **Bid volume** (USD + quote); **"Bids concentrated at X – Y"** range | P2 |
| Auction detail: chart | toggle **Price / Demand**, "Pre-bid price" marker, "**12.67% of supply sold**" | P2 |
| Auction detail: stats | Implied token price range, Auction supply, % committed to LP, Total supply, "View all stats" | P3 |
| Auction detail: activity | tabs **Activity / Timeline**, "487 bids" table: Wallet, Bid, Max price, Time | P2 |
| Auction detail: info | Launched on, Contract address, % committed to LP, **LP owner**, disclaimer | P3 |
| Positions page | "Top verified auctions" cards + "See all auctions" also appear on `/positions` (signed out) | P3 |

## 8. Pool / Positions

| Feature / UI detail | Uniswap behaviour | MetaSwap | Notes / file hint | Pri |
|---|---|---|---|---|
| Positions hero | "Supply liquidity to collect fees / Contribute to the largest protocol in DeFi" with buttons **Create position**, **+ Create Pool**, **+ Launch token** | ⚠️ "Your positions" + "New position" | add hero row; "Launch token" → `/launches/create` (STAGE5). `features/positions/list/PositionsList.tsx` | P3 |
| Signed-out | decorative "Connect your wallet / To view your positions and rewards…" card + Connect | ✅ (*src*) | — | — |
| Filters | status + protocol dropdowns | ✅ Open / In range / Out of range / Closed / All + All versions / v3 / v2 | — | — |
| Empty state | — | ✅ "No positions yet" + New position | — | — |
| Top pools sidebar | "Top pools" table (Pool, TVL, 1D vol, 30D vol, 1D vol/TVL, APR), 10 rows, "See all pools" | ⚠️ "Top pools by TVL" cards (TVL + APR), 6 rows, "Explore more pools" | fine; consider vol columns | P3 |
| Create: header | breadcrumb "Your positions › Create Pool", **Reset** button, **version dropdown** (v4/v3/v2), **settings gear** | ✅ version segmented (v3/v2) + settings; ❌ **Reset** | add Reset (clears URL params). `features/positions/create/CreatePosition.tsx` | P3 |
| Create: step rail | "Step 1 of 2 Select token pair and fees", "Step 2 of 2 Set price range and deposit amounts" | ✅ | — | — |
| Create: fee tiers | tiles sorted by **TVL**, each shows description, **"$82.3M TVL"** and **"56.188% select"**, or "Not created"; "Search or create other fee tiers (Advanced)" | ⚠️ fixed order, "% TVL" only, "Not created" ✅ | show $ TVL per tier and order by TVL; custom fee tiers not applicable (fixed v3 tiers) | P3 |
| Hooks / v4 | "Add a hook (optional)" | n/a (v4 out of scope) | — | — |
| **Range chart** | price-**history line** (with 1D/1W/1M/1Y/All time ranges + Reset) overlaid with the shaded range band, liquidity histogram as **horizontal bars on the right**, vertical drag handles on a right-edge slider; part of the line inside the range highlighted | ⚠️ liquidity histogram with draggable band + zoom reset (no price history, no time ranges) | add price-history line using the pool candles (the explore area chart data) behind the band. `features/positions/components/LiquidityChart.tsx`. Screenshot `uni-create-position-range-chart.jpg` | P2 |
| **Range presets** | strategy cards: **Stable** (± 3 ticks / ± 0.3%), **Wide** (−50% — +100%), **One-sided lower** (−50%), **One-sided upper** (+100%) with one-line explanations | ⚠️ chips ±1/5/10/20/50% | replace/add the four strategy cards (one-sided = range entirely below/above current tick). `components/RangeSelector.tsx` | P2 |
| Min / Max inputs | value + **% delta vs current price** ("−7.51%", "+8.21%") | ⚠️ value + steppers, no % delta | add delta label | P3 |
| Current price format | "0.0₃4106 WETH/USDC ($0.974)" – subscript-zero notation + USD | ⚠️ plain decimal, no USD | see Misc formatting | P3 |
| Deposit | two token amount boxes with $ value, **"Add as ETH"** toggle for WETH pairs | ⚠️ native ETH is chosen via token selection; no toggle | add toggle when one side is WETH/ETH. `components/DepositInputs.tsx` | P3 |
| Starting price for new pool | price input | ✅ "Starting price" + warning | — | — |
| Review / progress | review + steps | ✅ TxFlowModal steps | — | — |
| Position detail | add / remove (slider + presets) / collect, NFT image, range chart, out-of-range banner | ✅ (*src*) incl. "Collect as ETH", burn toggle | — | — |
| **Migrate V2 → V3** | v2 position page offers "Migrate" | ❌ | add Migrate on `V2PositionDetail.tsx`: remove v2 liquidity → mint v3 with chosen fee/range (2 txs; a V3Migrator contract is optional) | P2 |

## 9. Portfolio (compare with STAGE5 §4d)

| Feature / UI detail | Uniswap behaviour | MetaSwap now | Pri |
|---|---|---|---|
| Demo banner | decorative "**Connect a wallet** to view your portfolio" card + Connect; "Demo wallet" + eye icon; **floating bottom bar "Track your portfolio · Connect wallet"** on every tab | spec'd; floating bottom bar not in spec | P3 |
| Total + change | "$1,232.49" and "▲ $17.33 (1.43%) today" | ⚠️ total shown, **no today change line** | P2 |
| Action tiles | **Send, Receive, Buy, Swap, Sell, Limit, New position, More** | ⚠️ Send / Receive / Buy / More (spec lists 4) | P3 |
| Overview tokens header | "Tokens · 13 tokens" | ✅ "9 tokens" | — |
| Pools header | "Pools · 2 open positions", rows Pool / Status / Fees / Value | ✅ "0 open positions" + empty | — |
| Earn card | "$40.61 lifetime earnings" with live-ticking digits, vault rows with APY + value | in progress | — |
| Recent activity | "**1 transaction in the last 7 days**" subtitle | ⚠️ no subtitle | P3 |
| **Tokens tab columns** | Token, Price, **Avg cost**, **1D change**, Balance, Value, Unrealized P/L, **Allocation** (%) | ⚠️ Overview columns only (spec: "full table") | P2 |
| **Hidden tokens** | collapsible "**Hidden tokens (58)**" section at the bottom (spam + user-hidden + small balances) | ❌ | P2 |
| Hide token per row | row menu to hide/unhide (connected) | ❌ | P3 |
| Overview duplicate list | — | 🔧 "Your tokens · Live · 1D charts" strip renders the token list **twice** in the DOM (all 9 tokens repeated) — likely a duplicated marquee/strip track that is also exposed to screen readers. Mark the clone `aria-hidden` or render once. `features/portfolio/TokenStrip.tsx` | P3 |
| **Activity filters** | dropdowns **All types** (Swaps, Sends, Receives, Wraps, Withdrawals, Approvals, Pools created, Added liquidity, Removed liquidity, Claimed fees, Mints) and **time** (All time / 24 hours / 7 days / 30 days); table columns Time (date + full timestamp), Type, Amount (+$), Address (To/From/Transaction/Protocol) | ⚠️ chips All / Swaps / Transfers / Liquidity / Orders / Earn / Wraps; list rows, no time filter, no column layout | P2 |
| Activity consistency | — | ⚠️ locally tracked tx appears as "Swap — Swapped 1 ETH for 3,063.12 mUSDC · 0xa778" while indexed rows read "Swapped 20 WETH → 60,285.7 mUSDC · $60,817". Normalise the local entry to the indexed format (and de-dupe once indexed). `features/account/ActivityList.tsx` | P3 |

## 10. Misc

| Feature / UI detail | Uniswap behaviour | MetaSwap | Notes | Pri |
|---|---|---|---|---|
| Keyboard | Esc closes popovers/modals; search ↑/↓/Enter | ⚠️ `/` and Ctrl/⌘K open search (extra ✅); search lacks ↑/↓/Enter | see Search | P2 |
| Theme | Auto / Light / Dark | ⚠️ Light / Dark | add Auto | P3 |
| Focus rings | visible | ✅ global `:focus-visible` (`styles/index.css`) | — | — |
| Labels | many unlabeled icon buttons on Uniswap | ✅ MetaSwap icon buttons have `aria-label`s | — | — |
| Tiny-number formatting | subscript zeros "0.0₃4106"; "<0.001", "<0.01 ETH" | ⚠️ "<0.01%" for impact only; no subscript-zero notation | add `formatPrice` subscript mode for values < 0.0001 (matters for launched meme tokens). `packages/sdk/src/format.ts` | P2 |
| Number roll animation | stat values and Earn balances animate digit-by-digit | ❌ | P3 | P3 |
| Skeletons | everywhere, chart placeholder is a grey wavy line | ✅ skeletons; plain grey block for charts | P3 | P3 |
| Mobile 375 | no horizontal scroll | ✅ `scrollWidth == 375` on swap and explore | — | — |
| Loading spinner on lazy routes | n/a | ⚠️ route chunks show a lone spinner that also hides the trade tabs (e.g. /send first load). Wrap only the form in Suspense inside `TradeLayout` | P3 |

---

## Prioritised fix list (excludes STAGE5 items)

Grouped by area / owner file. Owners per PLAN.md/STAGE5: the web shell shell/trade/portfolio, the explore area explore/charts, the positions/launches area positions/launches, the API API.

### P1
1. **Trade price chart beside the swap/limit card + trend toggle** — `pages/TradeLayout.tsx`, `features/swap/SwapForm.tsx` (the web shell using the explore area `features/explore/charts/TimeChart`). Show sell-token chart (price, Δ, 1H–1Y) at ≥1280px; trend icon next to the gear toggles it (persist in `state/settings`). Fallback "Chart unavailable".

### P2
2. **Search upgrade** — `components/layout/SearchModal.tsx` (the web shell): ↑/↓/Enter keyboard nav (copy `TokenSelector` pattern); "Recent" section with Clear (localStorage, max 5); sections "Tokens by 24H volume" (add 1D Δ, FDV) and "Pools by 24H volume" (vol + APR, sort by volume); Wallets chip for 0x queries.
3. **Nav hover dropdowns** — `components/layout/Header.tsx` (the web shell): Radix HoverCard/NavigationMenu per item with the sub-links listed in §1; keep click-through.
4. **Visible ASCII route line** — `features/swap/SwapDetails.tsx` (the web shell): remove or `sr-only` the `[100%] A --[V3 x%]--> B` text.
5. **Relative time "0m ago"** — `apps/web/src/lib/format.ts` (the web shell): return seconds up to 59 s; add a unit test.
6. **Pool chart "1 WETH = 0 mUSDC" while loading** — `features/explore/pool/PoolChartPanel.tsx` (the explore area): render skeleton/“–” until the price is known.
7. **Explore pools table** — `features/explore/PoolsTable.tsx` (the explore area) + API (the API): column order Pool/TVL/1D vol/30D vol/1D vol÷TVL (ratio, 2 dp)/APR; add Filters modal (Protocol v2/v3, APR min–max, TVL buckets, Clear all/Apply) and a search box.
8. **Transaction labels** — `features/explore/TransactionsTable.tsx` (the explore area): "A for B" / "Add A and B" / "Remove A and B" with logos on Explore; "Buy X / Sell X" on token and pool pages; split amounts into two columns.
9. **Native ETH in Explore tokens** — API explore tokens (the API) + `TokensTable.tsx` (the explore area): add an "Ether ETH" row linking to `/NATIVE`.
10. **Token About links** — `features/explore/token/TokenParts.tsx` (the explore area): link chips (Contract copy/view, Website for launched tokens, top pool).
11. **Range strategies + price-history range chart** — `features/positions/components/RangeSelector.tsx`, `LiquidityChart.tsx` (the positions/launches area): Stable / Wide / One-sided lower / One-sided upper cards; draw the pool price history (1D–All) behind the range band with the histogram on the right; show % delta under min/max.
12. **V2 → V3 migrate** — `features/positions/detail/V2PositionDetail.tsx` (the positions/launches area): "Migrate to v3" flow (remove v2 + mint v3, fee/range pickers, 2-step TxFlowModal).
13. **Tiny price formatting** — `packages/sdk/src/format.ts` (maintainer/the explore area): subscript-zero notation for prices < 0.0001; "<0.001" for tiny amounts.
14. **Portfolio sub-details beyond STAGE5** — `features/portfolio/**` (the web shell): "today" Δ line under the total; Tokens tab extra columns (Avg cost, 1D change, Allocation); "Hidden tokens (n)" collapsible section; Activity type dropdown + time-range dropdown + Time/Type/Amount/Address columns.
15. **Auction detail sub-details** — `pages/launches/**` (the positions/launches area): "ends in" banner, clearing price % above floor, "Bids concentrated at", Price/Demand toggle + "% of supply sold", Activity/Timeline bids table (Wallet, Bid, Max price, Time).

### P3 (polish)
16. Header: nav visible down to 768px (move MetaSwapX/MetaChain into the logo menu); logo menu Protocol/Company/Legal placeholders + social/help row; mobile nav as bottom sheet — `Header.tsx`.
17. "⋯" menu: Theme **Auto**, Language row, Currency row — `Header.tsx`, `state/settings`.
18. Footer "API offline" flash while loading — `Footer.tsx` (`isPending` → neutral).
19. Tx toast overlapping the review modal — `Toaster.tsx` / `ReviewModal.tsx`.
20. Swap card: `$0` fiat line when empty, details below CTA, optional route "View" modal, mobile quick-pick logos in empty Buy panel, URL aliases `value`/`field` — `CurrencyInputPanel.tsx`, `SwapForm.tsx`, `SwapDetails.tsx`.
21. Settings: compact rows + "Trade options › Default" master toggle — `SettingsPopover.tsx`.
22. Explore: Δ% on V2/V3 TVL stats, custom volume-window dropdown, ▲/▼ glyphs and "0%" neutral, "→" table scroll hint, pair names without spaces/ETH for WETH, multi-select type filter — `features/explore/**`.
23. Token page: "⋯" menu (copy link/address), sticky compact header, 52W high/low tiles, sticky mobile Buy/Sell bar — `TokenParts.tsx`, `TokenDetailPage.tsx`.
24. Pool page: share/“⋯”, chart mode in URL, Δ% on TVL/volume, sticky mobile Swap/Add bar — `pages/explore/PoolDetailPage.tsx`, `PoolChartPanel.tsx`.
25. Positions: hero with Create position / Create pool / Launch token, Reset button on create, fee-tier $ TVL + sort by TVL, "Add as ETH" toggle — `PositionsList.tsx`, `CreatePosition.tsx`, `FeeTierSelector.tsx`, `DepositInputs.tsx`.
26. Portfolio: floating demo "Track your portfolio" bar, 8 action tiles, "n transactions in the last 7 days", per-row hide token, duplicated token strip `aria-hidden`, local vs indexed activity format — `features/portfolio/**`, `ActivityList.tsx`.
27. Account drawer: 24h change + NFTs tab — `AccountDrawer.tsx`.
28. Search panel anchored under the header instead of a titled modal; search icon-to-input in tables — `SearchModal.tsx`.
29. Send: recent recipients; Buy: "You're buying" header + amount chips over the faucet — `SendForm.tsx`, `BuyForm.tsx`.
30. Number roll animation for stats/Earn; wavy chart skeleton; lazy-route Suspense inside `TradeLayout` so tabs stay visible.

## Counts

| | P1 | P2 | P3 | Total |
|---|---|---|---|---|
| ❌ missing | 1 | 12 | 13 | 26 |
| ⚠️ partial / different | 0 | 13 | 41 | 54 |
| 🔧 broken | 0 | 3 | 2 | 5 |

(Counted from the prioritised rows in §1–§10; the §7 auction sub-details count as ❌. ✅ rows and STAGE5-covered rows
are not counted. Rows that mix a ⚠️ gap with a 🔧 bug are counted as 🔧.)

---

## Phase 2 status (the parity review fixes, 2026-10-21)

Fixed (fix-list numbers):
- **#1 P1** trade chart: trend-icon toggle on /swap and /limit, chart left of the card on desktop, below it on mobile, persisted (`features/swap/TradeChart.tsx`, `pages/TradeLayout.tsx`).
- **#2** search: ↑/↓/Home/End/Enter, Recent (+Clear), "Tokens by 24H volume" with 1D % and FDV, "Pools by 24H volume" with vol and APR (`components/layout/SearchModal.tsx`, `features/tokens/tokenSearch.ts`).
- **#4** debug route string removed (details + review modal).
- **#5** "0m ago" fixed; **#13** subscript-zero prices (`lib/format.ts` `formatSubscript`, used by `formatPrice` and range prices).
- **#6** pool chart "1 WETH = 0" while loading.
- **#7** pools table: 1D vol default sort, 30D vol (summed from daily history), vol/TVL ratio, Pool APR last; Filters modal (protocol, APR range, TVL buckets) and search.
- **#8** tx labels "Swap A for B" / "Add A and B" / "Remove A and B", "Buy X"/"Sell X" on token and pool pages, two token-amount columns.
- **#9** native ETH row in explore tokens; **#10** About link chips (contract, top pool, trade, launch auction, website); 52W high/low tiles.
- **#11** range strategy cards (Stable / Wide / One-sided lower / upper), % delta under min/max, price-history chart behind the range band.
- **#12** V2 → V3 migrate flow (remove via V2 router, then NPM multicall create+mint).
- **#15** auction detail: ends-in banner + progress + "See full details", clearing % vs floor, "Bids concentrated at", "% of supply sold", Activity/Timeline tabs with bid count, Info rows (auction supply, implied price, % to LP, contract, launched on, LP owner), disclaimer.
- **#29** Send: recent recipients.

Left for later: nav hover dropdowns, ⋯-menu theme Auto/Language/Currency, mobile bottom-sheet nav, footer "API offline" flash (Header/Footer belong to the web shell); portfolio extras (#14, #26, #27); `$0` fiat line / quick-pick logos (`features/tokens/CurrencyInputPanel.tsx`, not in scope); `▲/▼` glyphs and neutral "0%" (`components/ui` PercentChange); Δ% on V2/V3 TVL and pool TVL/volume (needs API history per protocol); Price/Demand toggle on the auction chart (needs bid-time price history from the API); settings "Trade options" restyle, route "View" modal, sticky token header / "⋯" menus (P3 polish).
