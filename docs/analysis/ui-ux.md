# MetaSwap — UI/UX teardown of app.uniswap.org (area the UI teardown)

Purpose: a screen-by-screen functional and visual reference for the engineers rebuilding MetaSwap.
We recreate layouts, flows and behaviour only. No logos, icons, illustrations, fonts (the observed
Basel Grotesk files) or long copy are to be copied. Describe, then design our own.

## 0. How this was observed, and the limits

Evidence tags used below:
- **[obs]** seen in the live DOM / screenshot / computed styles during this session.
- **[bundle]** derived from the app's JavaScript (translation keys, route table, CSS media queries).
- **[inf]** inferred; not directly seen. Treat as a hypothesis to verify when we build.

Session facts that shaped the evidence:
- Observation Chrome: 1427x788 CSS px, DPR 1.25, system dark preference (signed-out, no wallet).
- Chrome first refused some chunks with `ERR_CERT_VERIFIER_CHANGED` and rendered a blank `#root`.
  Opening a fresh tab fixed it. Node fetched the same assets fine, so this was a browser-side issue.
- Live data did not fully load. Explore tables and stat cards stay on **skeletons**, the token and
  pool detail pages show "Loading", and the swap chart shows "Chart unavailable". Dollar figures
  read `$00.00`. Currency is GBP (locale-driven). Explore and token/pool numbers are therefore
  **[inf]** for populated states.
- Everything that needs a wallet (positions, portfolio balances, review modal, approvals, tx
  progress, account drawer) is only observable in its **gated** state. Those sections are built
  from bundle keys and are marked [bundle]/[inf].
- Mouse-event clicks on some controls did not register through CDP. Focusing the page
  (`Page.bringToFront`) and DOM `.click()` worked. Input typing needed a focused field.
- No cookie banner, terms gate or other consent UI appeared in this session. Nothing was accepted.
  No wallet was connected and no transaction was prepared.
- Prompt-injection check: no page text asked for actions. Page copy was ordinary UI text.

Screenshots: `docs/analysis/screens/` (named `NN-route-state.png`). Index at the end of this file.

---

## 1. Global shell

### 1.1 Top navigation bar [obs]
- Fixed/sticky bar, about 64px tall (16px top padding, 40px controls). It sits across the full width.
  Background matches the page surface on the swap page. It has no visible border in dark mode.
- **Left:** brand mark (a pink, line-art creature mark, about 24px, top-left) followed by the
  wordmark and a small caret. The caret opens a product/company menu (see 1.2). Logo is clickable
  and goes to `/?intro=true`.
- **Primary nav links** (text, 16px medium, neutral-2 grey, the active route is full white):
  - `Trade` -> `/swap` (the active one on the swap page). It is a plain link, with no dropdown.
  - `Explore` -> `/explore`. No dropdown. Active on explore routes.
  - `Launches` with a small pink `Beta` pill -> `/launches`.
  - `Pool` -> `/positions` (singular "Pool" label, plural route).
  - `Portfolio` -> `/portfolio`.
  - Note for MetaSwap: the requested "Trade/Explore/Pool dropdowns" do **not** exist as dropdowns in
    this build. The items are direct links. Keep direct links, and add dropdowns only if we need them.
- **Right cluster:** search icon button (40x40), a "..." (more) icon button (40x40), and the primary
  pink "Get started" pill button (98x34, 16px semibold). "Get started" is the signed-out primary CTA
  and is the connect button.
- Under 768px (observed at 375px): the link row collapses. A hamburger button appears on the left
  next to the logo, and the right side keeps search, more and "Get started". Logo and hamburger sit
  at 16px from the left edge.

### 1.2 Logo caret menu [obs, text dump]
Opens a dropdown panel with grouped sections:
- **Products:** Wallet (swap, store, explore), UniswapX (aggregator), API (integrate), Unichain (DeFi chain).
- **Protocol:** Vote, Governance.
- **Developers.**
- **Company:** About, Careers, Blog.
- **Legal & Privacy:** Your Privacy Choices, Privacy Policy, Terms of Service, Disclosures.
MetaSwap mapping: Products -> MetaSwap, MetaSwapX, API docs (if any), MetaChain. Protocol -> governance placeholder.
Company/Legal -> placeholders (we have no legal text; use neutral placeholders).

### 1.3 Search (top bar) [obs]
- Clicking the search icon opens a full-height overlay/panel anchored under the bar. It has a
  search input (placeholder text on the page), and filter chips **All / Tokens / Pools / Wallets**.
- Default content before typing: a "Trending tokens" section, rows of token name plus a value
  (`Token Full Name`, `1,000 TFN`) rendered as skeletons in this session (data not loaded).
- Expected result rows [bundle + inf]: token logo, name, symbol, chain badge, and a short address
  (`0xA0b8...eB48` style, middle-truncated). Pool rows show the pair and fee tier. Wallet rows show an
  ENS/Unitag name or truncated address. Escape closes it.
- Keyboard: `/` or `Cmd/Ctrl+K` are standard in similar apps. Not verified here.

### 1.4 "More" (...) menu [obs]
Dropdown with a "Global preferences" heading and rows:
- **Theme:** Auto (follows system). Other options are [inf] Light and Dark.
- **Language:** English (the bundle has an i18n layer with many locales).
- **Currency:** GBP here (locale-driven). Other currencies are [bundle].

### 1.5 Chain selector [obs / inf]
- The swap page has no global chain switcher in the top bar. Chain choice is per list
  (Explore has a "All networks" / network dropdown, see 8.1), and the token selector has a network
  control (see 3.2). The Portfolio header also has an "All networks" control.
- The network list observed (labelled "New" where tagged): Ethereum, Base, Robinhood Chain (New),
  Arc (New), Ink (New), Unichain, Arbitrum, Tempo, Monad, Solana, Polygon, X Layer, OP Mainnet,
  BNB Chain, Avalanche, Linea, World Chain, ZKsync, MegaETH, Soneium, Zora Network, Celo, Blast.
  Explore's count reads "22 networks" on the pools page.
- MetaSwap: one chain only (MetaChain Devnet, 31337). Keep a chain pill that reads
  "MetaChain Devnet" and offers "Add network" for wallets (see `/metachain`). No multi-chain list.

### 1.6 Connect / account button [obs]
- Signed out: the "Get started" pink pill (top right). Opens the connect-wallet modal (section 7).
- Signed in [bundle + inf]: this becomes an account chip (avatar or Unitag/ENS name, truncated
  address) that opens the account drawer (section 7.5).

### 1.7 Footer [obs]
- No global page footer on the swap page. The legal links appear inside the logo menu (1.2) and
  inside the connect modal footer (`By connecting a wallet, you agree to ...` with Terms and Privacy
  links). Explore and token pages do not show a footer in the captured states.
- MetaSwap: add a compact footer (links to docs, terms placeholder, network status, version) on
  non-app pages. Keep the swap page footer-free.

### 1.8 Page background [obs]
- Dark: near-black page surface `#131313` (solid, no gradient on the swap page). `#background-radial-gradient`
  is a fixed layer in the DOM, used for a soft radial glow on some pages (landing/explore); on swap
  it is not visible.
- Light: pure white `#FFFFFF`.
- A fixed "?" help button sits bottom-left (24px-ish circle, 20px icon) on the swap page.

### 1.9 Theme [obs]
- Dark is the default under a dark system preference. Light is used when the system is light.
  Theme choice lives in the More menu (1.4). Both themes come from CSS custom properties (see
  `design-tokens.md`).
- Light-mode difference seen: surfaces become white and grey tints, the pink accent stays the same,
  and the Get started button becomes a pale pink fill (`accent2` tint) with pink text.

### 1.10 Responsive behaviour [obs]
Breakpoints extracted from the stylesheet: 360, 380, 396, 450, 640, 768, 850, 864, 1024, 1050, 1280,
1536 px (plus `height<=736/800/960` rules for short viewports).
- 1427px desktop: full nav, swap card centred at a fixed width of about 478px.
- 375px phone: no horizontal page scroll (`scrollWidth == 375`, checked on swap, explore, portfolio).
  The nav collapses (1.1), the swap card goes full width with a 16px gutter. The tab row keeps all
  four tabs and the settings gear on the right.
- Portfolio and explore tables reflow to fewer columns on small widths [inf] (cannot verify with data).

---

## 2. Swap page (`/swap`, also the default landing route)

### 2.1 Layout [obs]
- Centred card column. Card width about 478px on desktop (container max about 512px). Card is
  vertically offset about 170px from the top bar.
- Stack, top to bottom:
  1. **Tab row** (pill segmented control): `Swap` (active) / `Limit` / `Buy` / `Sell`. Right side:
     a trend icon (opens price chart, see 2.9) and a settings gear (opens settings, see section 4).
  2. **Sell panel** (the "from" panel, labelled `Sell` in this build).
  3. **Flip button** (down arrow, 48px round, centred over the seam between panels).
  4. **Buy panel** (the "to" panel, labelled `Buy`).
  5. **Primary CTA** (full card width, 54px tall, pill-ish radius 20px).
- Below the card: nothing on swap. Above it the price chart is unavailable here (chart area shows
  "Chart unavailable" with a 1H/1D/1W/1M/1Y range row when the chart is enabled). The chart is
  opened from the trend icon.

### 2.2 Tabs [obs]
- Swap / Limit / Buy / Sell. Each is a link to its own route (`/swap`, `/limit`, `/buy`, `/sell`).
  Active tab = filled grey pill (surface3) with semibold text; inactive = neutral-2 text.
- **Naming difference:** the PLAN says "Send". This build uses **"Sell"** for the 4th tab (it
  routes to `/sell`). It shows "You're selling" with `25% / 50% / 75% / Max` chips. Decide with
  product whether MetaSwap keeps Send (`/send`) or uses Sell.

### 2.3 Sell and Buy panels [obs]
Each panel is a rounded box (radius about 20px) with:
- **Label** top-left: `Sell` / `Buy` (14px, neutral-2).
- **Amount input** big number (about 36px, `0` placeholder, neutral-3 colour when empty). Right-aligned
  to the token button on the same row. Input is `inputmode=decimal`.
- **Token selector button** on the right: when no token is chosen it is a solid pink pill "Select
  token" with chevron (buy side, 142x38). When a token is set it is a neutral outlined pill with the
  token logo (with a chain badge) + symbol + chevron (sell side default is ETH, 108x38).
- **Fiat line** under the amount: `£0` (GBP in this session) in 14px neutral-2. Updates with the
  amount; it is the USD value formatted in the user's currency.
- **Balance row** [inf/bundle]: `Balance: x.xx SYM` with a `Max` text button when connected. Not
  visible while signed out.
- The Buy panel has a reserved empty area under the amount (about 40px) where the chain/route hint
  goes [inf] and then the balance row.
- Buy panel background is a slightly lighter surface (surface2) than the Sell panel (surface1), which
  makes the two panels read as distinct blocks, joined by the flip button.

### 2.4 Amount input behaviour [bundle + inf]
- Accepts digits and one decimal separator. Leading zeros collapse. Max decimals = token decimals.
- Typing fires a debounced quote (quote-finalising label `swap.finalizingQuote`).
- Editing the Buy side switches to exact-output mode (the Sell amount becomes an estimate).
- Fiat line recomputes on every change.
- Empty amount: CTA shows the "Enter an amount" state (see 2.7).

### 2.5 Flip arrow [obs]
- Centred circular button (48px, surface panel with 1px border, radius full) over the seam. Click
  swaps sell and buy tokens and amounts. Rotation or hover tint [inf].

### 2.6 Rate line, details, and warnings [bundle]
Rendered between the Buy panel and the CTA, or inside an expandable row:
- **Rate line:** `1 ETH = 3,000 USDC` style with a swap-direction toggle. Keys: `swap.details.rate`.
- **Details accordion** (expand chevron), rows:
  - Price impact (`swap.priceImpact`). Colour rules: low = neutral, high = warning/critical.
  - Max slippage (`swap.details.slippage`, `swap.details.slippage.total`).
  - Uniswap fee (`swap.details.uniswapFee`), with a fee-on-transfer note (`swap.details.feeOnTransfer`).
  - Network cost (gas) and estimated time (`swap.details.estimatedTime`).
  - Order routing (`swap.details.orderRoutingInfo`, `swap.details.routingInfo.plan`) with a route
    diagram and "Powered by" line (`swap.details.poweredBy`).
  - Updated price indicator (`swap.details.updatedPrice`).
- **Warnings** (`swap.form.warning.*`): cross-chain output, fee-on-transfer output, Solana output,
  and a "restore" warning. These render as an inline banner above the CTA with an icon and a
  secondary action, and they colour the CTA (warning tone) when they block.
- **Slippage warning** appears in the details and in settings when slippage is too low for the route
  (`swap.settings.slippage.warning.low.lp`) or too high (`warning.max`, `warning.min`).

### 2.7 Primary CTA states [obs + bundle]
Observed (signed out): the CTA reads **"Get started"** and is a pink-tinted button (dim fill, pink
text). Clicking it opens the connect modal (section 7).

Planned states (bundle keys + standard flow [inf]):
| State | Label | Notes |
|---|---|---|
| Signed out | Get started (observed) | Opens connect modal |
| No sell token | Select a token | Disabled |
| No amount | Enter an amount | Disabled |
| No route | No route found / Insufficient liquidity | Disabled, shows reason |
| Insufficient balance | Insufficient {SYM} balance | Disabled, critical colour |
| Needs approval | Approve {SYM} | Opens approval step |
| Ready | Review (`swap.button.review`) | Opens review modal |
| Wrap/unwrap | Wrap / Unwrap (`swap.button.wrap`, `unwrap`) | Native ETH <-> WETH |
| Quote refresh | Refreshing quote | Spinner, disabled |
| Submitting | Submitting... (`swap.button.submitting`) | Keep-open hint shown |

### 2.8 Review modal and progress [bundle + inf]
- Opened from the CTA. A centred dialog (about 420px wide, radius 20px, scrim `#0009`).
- Contents: title (`swap.review`), a summary of the sell/buy amounts with fiat values, a route
  summary, the same details rows as 2.6, the price-impact warning if needed, and a primary button
  (`swap.confirmSwap`, or `swap.confirmApproveAndSwap` / `confirmWrap` / `confirmUnwrap` depending
  on steps).
- **Progress steps** (`swap.review.stepXofN`, with per-step idle/pending/completed states):
  1. Approve token (Permit2 approval if not yet approved).
  2. Sign permit (`continueInWallet`, `pendingWalletAction`).
  3. Confirm swap (wallet signature/tx).
  4. Submitted (`swap.submitted`, "keep this window open" hint for batched/passkey flows).
  5. Success state with a link to the explorer and the txn summary.
- Step rows show a status icon: idle (hollow), pending (spinner), completed (check). Only one step is
  pending at a time. A failed step shows an error panel with a retry.
- Bridge variant for cross-chain (`swap.review.bridge.idle/pending/completed`).
- Quote refresh error (`swap.review.quoteRefreshError.title/message`) interrupts the review and asks
  for a refresh.

### 2.9 Price chart (trend icon) [obs + bundle]
- Trend icon in the tab row toggles a chart panel above the card (or as a sheet on mobile).
- Header: token pair, current price, change %, and a "Chart unavailable" fallback when data fails.
- Range row: 1H, 1D, 1W, 1M, 1Y (observed). Chart types line and candles (see section 9).

### 2.10 Error states [bundle]
- `swap.fail.message` / `swap.fail.message.plan`: a failed tx shows the failure reason and offers
  "Try again" or a route fallback. `swap.fail.uniswapX`: failed off-chain order. `swap.fail.batched`
  with retry: batched flow failure.
- Network errors on quote show an inline retry. A failed chunk load shows the app error fallback.

---

## 3. Token selector modal

### 3.1 Container [obs]
- Opens from either "Select token" or the token chip. Centred dialog about 500px wide, about 840px
  tall on desktop (fills most of the viewport), radius 20px, scrim `#0009` behind it, close X top-right.
  Title "Select a token" (about 20px semibold).
- Stacking: title row, search field, optional banner, quick chips, network chips, list.

### 3.2 Search [obs]
- Full-width input, placeholder "Search tokens", leading search icon. Right side: a network filter
  chip (a stack of chain logos + chevron) that scopes results to one chain or All networks.
- Typing replaces the list with search results (see 3.5). Autofocus on open [obs: focused in
  session].
- Pasting an address into search resolves the token [inf/bundle]. Unknown address -> import flow (3.6).

### 3.3 Banner and chips [obs]
- A dismissible pink-tinted banner: "Crosschain swaps are here" with a shuffle icon and a one-line
  subtitle. The close X hides it.
- **Common bases chips** (quick picks, 5 per row, each a 92px-wide tile): USDT, WETH, WBTC, ETH, USDC
  (observed). Each tile is a 36px logo with a chain badge, label below (semibold, 14px). Selecting one
  sets the token and closes the modal.
- **"Swap across networks" row** (sub-section header with a shuffle icon): tiles for ETH on
  Base/Arbitrum/OP/... plus an "8+" overflow tile. Shows the same token across chains (crosschain).

### 3.4 Token lists [obs (headers) + bundle]
- Sections in the list: `Tokens by 24H volume` header (observed), then rows. Category tags on rows
  ("Majors", "Stablecoins", "Stocks", "Doppler", "New") are observed.
- Lists observed in the populated state: a **Popular/Top** list (by 24H volume), and **search results**.
  "Your tokens" (balances) appears only when connected [bundle: portfolio tokens].
- Section order: Your tokens (connected) -> Common bases chips -> Tokens by volume -> rest.

### 3.5 Token row [obs]
- Row height about 56px, full width, hover shows surface2-hovered background.
- Left: logo (36px circle, chain badge bottom-right). Middle: two lines: **Name** (16px medium, white)
  above **SYMBOL** (14px neutral-2) plus a short contract `0xA0b8...eB48` (12px neutral-3, middle
  ellipsis). A category tag pill may appear after the symbol.
- Right: balance (when connected) as token amount (top) and fiat value (bottom). Signed out: empty.
- Row click selects the token. Keyboard: arrow keys move, Enter selects [inf].

### 3.6 Unknown token / import warning [bundle + inf]
- Pasting an unknown contract address shows a token card with name, symbol, decimals and a
  "Not verified / unknown token" warning block (red/orange tone). The user must acknowledge an
  "I understand" checkbox before the token can be imported (standard flow; verify keys
  `swap.form.warning.*` and token-warning copy when building).
- MetaSwap: the token list is ours; import flow should warn on any token not in the MetaSwap list.

### 3.7 Empty and loading states [obs]
- Loading: skeleton rows (pill shaped, grey) in place of rows. Session observed this for search
  results ("Token Full Name / 1,000 TFN" skeletons).
- No results: [inf] "No results for '...'" centred message with a retry.

---

## 4. Settings popover (swap gear)

Gear is at the top right of the swap card, next to the trend icon. In this session the gear did not
open through automated clicks, so panel layout is from the bundle (translation keys) [bundle + inf].

### 4.1 Sections [bundle]
1. **Max slippage** (`swap.settings.slippage.*`):
   - Modes: **Auto** (`control.auto`) and **Custom** (numeric input, percent, with a % suffix).
   - Auto default is route-aware. Custom input accepts decimals, and the field has a warning state.
   - Validation messages: `warning.low.lp` (too low for an LP route, transaction may fail), `warning.min`
     (below minimum), `warning.max` (too high, you may lose value), `warning.hover` tooltip.
   - Description and "input receive" / "output spend" explainers show which amount the slippage
     applies to.
2. **Transaction deadline** (`swap.settings.deadline.tooltip`, `deadline.warning`): minutes input with
   a default of 30, validated against min/max, warning if very short or very long.
3. **One-click swap** (`swap.settings.oneClickSwap.title/tooltip`): toggle. When on, the review step
   is skipped for repeat trades.
4. **Protection** (`swap.settings.protection.*`): MEV-protection toggle. Subtitles report support
   (supported / unavailable) for the chain.
5. **Routing preference** (`swap.settings.routingPreference.*`):
   - Default (auto router, with a tooltip explaining routing).
   - v2 only, v3 only, v4 only, v4 with hooks (each with a title and tooltip).
   - MetaSwap mapping: Default, V2 only, V3 only. Skip v4 (BUSL, out of scope).
6. **Routing source UI** explainers (`swap.routing.uniswapAutoRouter.description`,
   `swap.routing.poolsAndVersions`) list the pools and version used.

### 4.2 Behaviour [inf]
- Popover anchored to the gear on desktop; full-screen sheet on mobile.
- Changes apply to the next quote. Warnings and the CTA recompute.
- Close on outside click or Escape. Changes persist per browser (local storage) [inf].

---

## 5. Limit tab (`/limit`)

### 5.1 Layout [obs]
- Same card frame as swap, with the tabs row (Limit active).
- Chart area above the card: `ETH` with "Chart unavailable" fallback and a 1H/1D/1W/1M/1Y range row.
- Panels: **Sell** ETH (amount + token chip) and **Buy** USDC (token chip), flip arrow between.
- **Limit price** row: label "Limit price" with a token pair toggle `USDC` (the quote token) and a
  **Market** quick button, then **+1%**, **+5%**, **+10%** chips. These set the price relative to the
  current market price.
- CTA: `Connect wallet` (signed out). Signed-in CTA [inf]: Review limit (`swap.reviewLimit`) and
  Confirm limit (`swap.confirmLimit`).
- Disclaimer under the CTA: "Limits may not execute exactly when tokens reach the specified price."
  with a Learn more link.

### 5.2 Price input [bundle + inf]
- "When 1 {SELL} is worth {BUY}" sentence in the details (the limit price is quoted as "1 ETH = X USDC").
  Inline editable value with a +/- or preset chips.
- Validation: must be > 0, must be a sensible distance from the market (warn when far off), and must
  not be below the current market for a sell (it would fill immediately) [inf].

### 5.3 Expiry [inf/bundle]
- Expiry picker (for example 1 day, 1 week, 1 month, custom). Shown in the details. Default [inf] one week.
- Orders expire server-side. Expired orders move to the expired tab.

### 5.4 Order list [inf]
- Orders list lives in Portfolio -> Activity and in the Portfolio "Open limits" card (observed:
  "Open limits: 0 open orders").
- Row: pair, side, limit price, fill %, status badge (open/filled/expired/cancelled), created time,
  and cancel action (for open orders).

---

## 6. Send and Buy tabs

### 6.1 Buy (`/buy`) [obs]
- Same card frame. Title line "You're buying" with a fiat amount input (currency prefix `£`).
- **Quick amounts:** £100 / £300 / £1000 (chips). Plus a fiat amount field.
- Output side shows the token to buy and the estimated amount.
- Provider list [bundle/inf]: card and bank on-ramps (MoonPay, Coinbase on-ramp endpoints present in
  the bundle). MetaSwap: replace with the devnet faucet (mint test tokens, get Anvil ETH), per PLAN.
- CTA: `Connect wallet` when signed out.

### 6.2 Sell (`/sell`) [obs]
- "You're selling" with the token and amount input and quick chips **25% / 50% / 75% / Max** (Max
  uses the full balance and keeps gas reserve [inf]).
- Output: fiat proceeds. CTA: `Connect wallet` signed out.
- Under the hood it is a token-to-fiat off-ramp in the product. MetaSwap: decide (see 2.2 note).

### 6.3 Send [not present as a tab here]
- The PLAN requires `/send`. Build it as a single panel: token + amount, recipient input (address,
  ENS/unitag resolution, recent recipients), review, sign. Keep the "Sell" tab placement only if
  product keeps the name "Sell"; otherwise label the 4th tab Send.

---

## 7. Connect-wallet modal and account drawer

### 7.1 Connect modal [obs]
- Triggered by "Get started" / "Connect wallet" / any gated section. Shows as a bottom sheet
  (mobile) or a centred dialog (desktop) with a title "Get started", then:
  - Primary option **Uniswap Mobile** (the QR/app hand-off option), then **Other wallets**.
  - A separator "or" and a secondary path **Create account** / **Log in** (passkey and email
    embedded-wallet via Privy, see 13).
  - Footer: "By connecting a wallet, you agree to ... Terms of Service and consent to ... Privacy
    Policy." (links, 12px, neutral-2).
- Wallet ordering [bundle]: installed EIP-6963 wallets first (MetaMask, Rabby, Coinbase, etc.), then
  WalletConnect, then the "Other wallets" list. Detected wallets show an "installed" badge [inf].
- Connecting state [inf]: row shows a spinner and "Connecting..." with a "Open your wallet" hint.
  Error state: row turns critical with a Try again link. User rejection returns to the list silently.
- MetaSwap: custom modal (not RainbowKit look). Order: Dev wallet (Anvil, chain 31337 only), then
  EIP-6963 injected, then WalletConnect (if configured), then Coinbase Wallet SDK. Show "Other
  wallets" as the fallback.

### 7.2 Gated sections (observed) [obs]
Each gated page keeps its chrome and replaces its body with a centred "Connect a wallet" card with
the same modal as 7.1:
- `/positions` (Pool): "Connect a wallet" card (positions list is empty without wallet).
- `/positions/create`: same gate.
- `/portfolio`: "Connect a wallet to view your portfolio" with a Connect button and a "Track your
  portfolio" sub-line, plus a **Demo wallet** option [obs]. Demo wallet shows sample balances. We
  may copy the concept for a read-only demo mode (not required by PLAN).
- `/explore/transactions`: "Wallet" column with a connect prompt and a "Connect a wallet" card.
- `/launches`, `/explore/pools/...` detail pages: connect modal shown as an overlay gate.

### 7.3 Account drawer (signed in) [bundle + inf; not observable without connecting]
- Triggered from the account chip (top right). Right-side drawer (about 420px wide on desktop,
  full-screen on mobile), slide-in animation `sheet-in-right` 0.35s (see tokens).
- Header: account name (Unitag or truncated address), copy button, explorer link, and a network chip.
- **Portfolio balance:** big total in fiat (heading-1 scale) with a 1H/1D/1W/1M/1Y/All range row and
  a small chart. Delta % with success/critical colour.
- **Quick actions row:** Send, Receive, Buy, Swap, Sell, Limit, New position, More. (Observed as the
  text row on `/portfolio`.)
- **Tabs:** Tokens, NFTs, Pools (positions), Activity.
  - Tokens: table with Token / Price / Balance / Value / Unrealized P&L; "View all tokens" link.
  - Pools: rows with pool name, status (In range / Out of range), fees, value. "View all pools".
  - Activity: recent transactions with type, amount, time, status; "View all activity".
  - Open limits (observed on the portfolio page): count plus list.
- Footer rows: Settings (theme, currency, language), Disconnect (destructive style, neutral-2
  colour until hover), and a Log out for embedded accounts [inf].
- Disconnect: confirm step [inf], then returns to signed-out state; swap form values persist.

---

## 8. Explore (`/explore`, `/explore/tokens`, `/explore/pools`, `/explore/transactions`)

### 8.1 Stats header [obs]
- Row of five stat blocks separated by 1px vertical dividers: **1D volume**, **Total Uniswap TVL**,
  **v2 TVL**, **v3 TVL**, **v4 TVL**. Each block: 14px label above a 36px-ish value. Value
  placeholders are skeleton pills in this session. Populated values show `$1.2B`-style compact money.
- MetaSwap: stat row = **24h volume**, **TVL**, **v2 TVL**, **v3 TVL** (no v4).

### 8.2 Trending and Earn [obs]
- **Trending** section: heading + "View all" link. A horizontal carousel of 4 cards (each about
  340x82px, radius 16px, border): token logo, name, symbol/price, and a mini sparkline or delta.
  Scroll snap, partial 4th card visible as affordance.
- **Earn** section (subtitle "Deposit for yield with no lockup"): 3 promo cards, each with a token logo
  and APY (for example USDT 3.62% APY, USDC 4.37% APY, ETH 1.58% APY observed in transactions page
  promo). These link to pool/earn flows. Not needed for MetaSwap v1; keep the slot empty or use it
  for "Earn on devnet" placeholders.

### 8.3 Tabs [obs]
- Segmented text tabs: **Tokens**, **Auctions**, **Pools**, **Transactions**. Active = full white,
  larger weight; inactive = neutral-2. Each tab is a route.
- Filter bar below tabs: **time range** dropdown ("1D volume" sort/window selector: 1H, 1D, 1W,
  1M, 1Y, All time volume), **network** multi-select (icon stack chevron; list of 22 networks, with
  "All networks" default), and a **search** icon button (opens a search field).

### 8.4 Tokens table [obs]
- Columns: **#**, **Token** (logo, name, symbol), **Price**, **1H** (change %), **1D** (change %),
  **FDV**, **Volume** (sortable, default sort descending by 1D volume, with down-arrow), **1D chart**
  (sparkline, 96px x 32px).
- Header row: 48px tall, surface2 background, rounded, 14px neutral-2 labels. Sortable columns show
  arrow and active column is full white.
- Rows: about 56px tall, hover row background, click row -> token detail `/explore/tokens/:chain/:address`.
- Pagination: infinite scroll loads the next page as you reach the bottom [inf]. No page numbers observed.
- Sparkline: 1D line, green if up, red if down (see 12.3).

### 8.5 Pools table [obs]
- Columns: **#**, **Pool** (pair logos + pair name + fee tier chip such as 0.3%), **TVL**, **1D vol**,
  **30D vol**, **1D vol/TVL**, **Pool APR**.
- Header "New position" button (pink secondary) at top right of the list area.
- Row click -> pool detail `/explore/pools/:chain/:address`.
- Sort by clicking headers. Default sort by TVL [inf].

### 8.6 Transactions table [obs]
- Columns: **Time**, **Type** (Swap/Add/Remove, with pill), **Token amount** (two amounts with pair
  arrows), **GBP/USD value** (fiat value, currency from settings), **Token**, **Wallet** (truncated
  address link to explorer).
- Filters: type chips and token filter [inf].
- Live updating feed with a "new transactions" highlight [inf].

### 8.7 Auctions tab [obs / bundle]
- Tab exists (`/explore/auctions/:chain/:address`, `/liquidity/launch-auction`). Not in MetaSwap scope
  for v1. Hide it or show a placeholder.

### 8.8 Empty and loading [obs]
- Loading: skeleton rows (pill shapes, grey) for the first page. Cards show skeleton blocks.
- Error: [inf] inline banner with retry.

---

## 9. Token detail page (`/explore/tokens/:chain/:address`)

### 9.1 Observed states
- Loading: `Tokens` breadcrumb header, text "Loading token data for Ethereum (ETH) on Ethereum",
  right column with a Swap widget (signed out). Page width grows beyond viewport (scrollWidth 1634
  at 1427 viewport) in the loading state, which is a layout bug to avoid.

### 9.2 Layout [bundle + inf]
- **Header:** token logo (40px), name, symbol, network chip, favourite star, and share/explorer links.
- **Price header:** large price (heading-1 scale, about 52px), change % pill (1D), and time label.
- **Chart block:** full width under header. Chart type toggle (**Line** / **Candles**), range
  segmented control **1H / 1D / 1W / 1M / 1Y** (observed on swap chart as the same five ranges). Chart
  hover crosshair with a tooltip: time, price, and change; candles show O/H/L/C and volume.
- **Stats grid** (2 columns on mobile, 4 on desktop): Market cap, FDV, 24h volume, TVL, Circulating
  supply, Total supply, Holders [inf for some], 24h high / low.
- **About section:** description with "Show more" and external links (website, socials, explorer).
  Copy is third-party data; do not reproduce.
- **Swap widget** (right column on desktop, stacked below chart on mobile): preselected output token
  equals this token; input token defaults to ETH or the user's last pair.
- **Transactions table** (below chart): same columns as 8.6, scoped to the token.

### 9.3 Chart behaviour [bundle + obs]
- Library: lightweight-charts is in the bundle (see section 13). Render time-series with a fixed
  price-scale width and a volume histogram below (optional).
- Interaction: mouse-wheel zoom off by default; drag pans; crosshair follows pointer; tooltip shows
  date-time and value in the user's currency.
- Empty state: "Chart unavailable" text with a retry (observed on the swap chart when data failed).
- Range change re-fetches data; keep the previous data visible while loading with a subtle shimmer.

---

## 10. Pool detail page (`/explore/pools/:chain/:address`)

### 10.1 Observed state
- Only the signed-out connect gate was rendered for `/explore/pools/ethereum/0x88e6...` in this
  session (rendered as overlay gate with the modal in 7.1). The pool body itself is unobserved.

### 10.2 Layout [bundle + inf]
- **Header:** pair logos, pair name, fee tier chip (for example 0.05% / 0.3% / 1%), version chip
  (v2 / v3 / v4), network chip, favourite, explorer link.
- **Action row:** "Add liquidity" (primary pink), "Swap" (secondary, opens swap with the pool pair),
  "Remove" if the user holds a position [inf].
- **Chart block:** chart mode toggle with three modes: **Volume** (bars), **Price** (line of
  token0/token1 price), **Liquidity** (depth). Range segmented control 1H/1D/1W/1M/1Y.
- **Pool balances bar:** a 100% stacked bar splitting TVL between token0 and token1, with a
  legend row (token symbol, amount, percentage).
- **Stats grid:** TVL, 1D volume, 30D volume, 1D fees, APR, volume/TVL, current price, current
  tick (v3) [bundle/inf].
- **Transactions table:** swaps/adds/removes for this pool (columns as 8.6).
- **Liquidity range chart** (v3 only, shown on detail when user has a position) [inf].

---

## 11. Positions (Pool tab)

### 11.1 Positions list (`/positions`) [obs]
- Page header "Pool" with actions: **New position** (primary pink) and a tabs row (**Positions** /
  **Pool** entries [inf]).
- Signed out: the connect gate (7.2). No empty-state illustration in this build.
- Signed in [inf]: list of positions as cards or rows with pair, version, fee tier, status badge
  **In range** (green) / **Out of range** (amber/red), value, uncollected fees, and an "Open" chevron.
  Empty signed-in state: "No positions yet" with a "New position" CTA [inf].
- Portfolio card (observed on `/portfolio`) shows "Pools: 2 open positions", with each row listing
  pool name, status, fees, value, and the In-range label.

### 11.2 New position flow (`/positions/create`, `/positions/add/new`) [obs for gate, bundle for flow]
Observed: the create route shows only the connect gate in this session. The flow below is from the
bundle (path names `/positions/create`, `/positions/add/new`, `/positions/add`) and standard v3
creation [inf].

**Step 1: select pair and fee tier**
- Two token selectors (token A, token B) with a swap-order arrow. Each token chip opens the token
  selector (section 3).
- Version selector: **v2** (full range, no fee choice) / **v3** (fee tiers) / **v4** (out of scope for
  MetaSwap).
- Fee tier tiles: **0.01%, 0.05%, 0.3%, 1%** (v3 tiers per PLAN: 100/500/3000/10000 bps, MetaSwap's
  tick spacing 1/10/60/200). Each tile shows the **% of selected pool** stats: pool share of TVL
  per tier, and "Selected" state with a check. Tiles with no pool show "Create pool" hint [inf].
- Continue button.

**Step 2: set price range**
- Toggle: **Full range** / **Custom range**. Full range hides the chart and uses min/max ticks.
- Custom: a liquidity histogram (bars for liquidity density by price) with a draggable range band.
  Two drag handles (min and max). Current price is a dashed horizontal line marked "Current price".
- **Min price** and **Max price** inputs below the chart, each with +/- steppers (step size scales
  with price), a unit label (`USDC per ETH`), and a quick "Full range" link. Inputs accept typing;
  invalid order shows an error (min must be less than max).
- Price-direction toggle to flip quote (ETH per USDC vs USDC per ETH).
- Out-of-range warning on the range text when the chosen range excludes the current price.

**Step 3: deposit amounts**
- Two amount panels (token A, token B) with balances and Max. Changing one amount recomputes the
  other based on range (single-sided deposit when range is one-sided [inf]).
- Approval indicators per token (Approve step if needed).
- Fiat values.

**Step 4: review**
- Summary: pair, fee tier, range, deposit amounts, and estimated fees. CTA "Create position" (wallet
  signing). Step progress as in 2.8.
- Success: the new position card with the NFT id (v3) / LP token (v2).

### 11.3 Position detail (`/positions/v3/:chain/:tokenId`, `/positions/v2/:chain/:pairAddress`) [bundle + inf]
- Header: pair logos, pair name, fee tier chip, **In range / Out of range** badge, and version chip.
- Body: two-column on desktop.
  - Left: **Liquidity** (value in fiat, token A and B amounts), **Min/Max price** range display, and
    a range chart with current price marker.
  - Right: **Uncollected fees** card (amounts and fiat, with "Collect" button), **Actions** card
    (Add liquidity, Remove liquidity, Collect fees), and links to pool detail.
- Remove liquidity: percentage slider with presets (25/50/75/100%) and a "Collect fees" checkbox.
  Review then confirm.
- Collect: one-click action with progress.
- Out-of-range banner: prompt to rebalance (add or remove) [inf].

---

## 12. Microinteractions and formatting

### 12.1 Loading [obs]
- **Skeletons:** rounded grey pills and rectangles matching the final layout (see explore and
  trending screenshots). Shimmer animation [inf]: a moving gradient over the skeleton. Respect
  reduced motion.
- Rule: never show `0` or `$0` as a fake value while loading. Show the skeleton instead (observed
  `$00.00` and `£0` placeholders are a bug we should avoid: show `—` or the skeleton).

### 12.2 Toasts and notifications [inf/bundle]
- Toast stack top-right on desktop, bottom on mobile. Types: success (check), error (critical icon),
  pending (spinner), warning. Auto-dismiss after 5s except pending and error with actions.
- Tx toasts: pending -> success with explorer link, or error with retry.
- Keep toasts out of the review modal (use inline status there).

### 12.3 Hover, focus, active [obs + inf]
- Buttons: hover shifts to the `*-hovered` colour token (see tokens). Primary pink hover is darker
  magenta (`#e500a5`). Disabled buttons: 40% opacity equivalent (surface3 fill, neutral-3 text).
- Tabs: hover shows surface2-hovered fill.
- Inputs: focus ring 1px accent-colour border (pink) [inf]. Visible focus ring for keyboard users is
  required; add it in MetaSwap (`:focus-visible`).
- Table rows: hover fill surface2-hovered. Clickable rows show pointer cursor.
- Pressed: scale 0.98 on primary buttons [inf].

### 12.4 Animations and motion [obs tokens]
- Default transition: 150ms `cubic-bezier(.4, 0, .2, 1)`.
- Sheets and drawers: 350ms enter (`sheet-in-*`), 250ms exit, same easing.
- Popovers and tooltips: 200ms ease-out (`spore-enter-*`), exit 200ms forwards.
- Accordion: 170ms `cubic-bezier(.25,.46,.45,.94)`.
- Spinner: 1s linear infinite. Refresh spin: 1s `cubic-bezier(.83,0,.17,1)`.
- Pager slide: 120ms `cubic-bezier(.17,.67,.45,1)`.

### 12.5 Number formatting rules [obs + inf]
- Fiat compact: `$1.2B`, `$345M`, `$12.3K`; full precision under 1000 in tables (`$1,234.56`). Locale
  separators follow the user's locale. Observed GBP symbol `£`.
- Token amounts: up to 6 significant digits in inputs; in balances show 4 decimals max for amounts
  >= 1, and significant digits for small values.
- Tiny values: `<0.001` for amounts below 0.001 (observed style in Uniswap: show "<0.001" with the
  asset symbol).
- Prices: 2 to 6 significant figures depending on magnitude; token prices under $0.01 use subscript
  zero notation [inf].
- Percentages: one decimal (`12.3%`); price impact two decimals (`0.05%`); fees `0.3%`.
- Dates: relative for recent ("2m ago"), absolute for older.
- Addresses: `0xA0b8...eB48` middle ellipsis (4 + 4 chars), monospace in details.

### 12.6 Percentage colouring [obs]
- Positive change: success green (`#21c95e` dark, `#0c8911` light).
- Negative change: critical red (`#ff593c` dark, `#e10f0f` light).
- Neutral zero: neutral-2.
- Price impact: below 1% neutral; 1 to 5% warning amber; above 5% critical red and a confirm step.
- In range / out of range badges use success / warning tones.

---

## 13. Tech stack fingerprint (from `analyze_web_bundle`-equivalent static analysis)

Method: the live page's JS chunks (705 files, about 9.8 MB) were downloaded with Node and grepped.
REA's `analyze_web_bundle` returned zero scripts because the attach window saw no script loads, so
this fingerprint is from static grep, not REA's graph. It is directional, not authoritative.

| Area | Finding | Evidence |
|---|---|---|
| Build | Vite with Rolldown (rollup-compatible), chunk names with hashes | `index-*.js`, `rolldown-runtime-*.js` |
| UI framework | React (react-dom, createRoot) | React symbols in chunks |
| Router | React Router (`createBrowserRouter`, `useNavigate`) | route table: `/swap`, `/limit`, `/explore/...`, `/positions/...` |
| Server-state | TanStack Query (`useQuery`, `useMutation`, `QueryClient`) | 55 hits |
| Client state | Redux Toolkit + redux-saga (`swapSaga`, `createSlice`), Zustand (6 hits) | saga symbols |
| Wallet | wagmi + viem; EIP-6963 discovery; WalletConnect (heavy); Coinbase Wallet SDK; MetaMask SDK refs | 28 wagmi, 35 viem, 291 walletconnect, 146 metamask, 14 eip6963 |
| Auth / embedded wallet | Privy (`auth.privy.io`, `/api/v1/siwe/*`, passkeys, passwordless SMS, email) | 1038 privy hits, `/api/v1/*` paths |
| Feature flags | Statsig (`statsigApiKey`, proxy URL override) | 196 hits |
| Analytics / observability | Amplitude, Segment-style analytics, Sentry (with replay stats), Datadog | 64 amplitude, 43 segment, 2 sentry, 10 datadog |
| Charts | lightweight-charts | `createChart` hits |
| Protobuf / RPC | Connect-RPC (`@connectrpc/connect-web`) + protobuf (`@bufbuild/protobuf`) | connectrpc, protobuf hits |
| i18n | i18next-style keys (`swap.*`, `explore.*`); many locales | 17 i18next hits, 88 i18n namespace hits |
| Styling | Tailwind v4 (arbitrary `[prop:value]` classes, CSS custom properties `--color-*`, `--text-*`, `--radius-*`) plus a shared UI kit | 8 tailwind hits; 516 root vars observed |
| Fonts | Basel Grotesk Book/Medium (self-hosted woff2), InputMono for mono | cdn font URLs |
| On-ramps | MoonPay, Coinbase on-ramp endpoints | 40 moonpay hits, `/v1/funding/coinbase_on_ramp/*` |
| Bot defence | Cloudflare Turnstile / challenges | 43 hits |
| Unitags | Uniswap username service | 307 hits |
| Multichain | Explorer links for 20+ chains; Solana support (Jupiter entry gateway) | explorer domains |

Not MetaSwap-relevant (do not port): Privy, Statsig, Sentry, Datadog, Amplitude, MoonPay, Unitags,
Solana, Turnstile. Use our own equivalents only where needed.

### 13.1 Backend endpoints (hostnames, paths, purpose only)
- `interface.gateway.uniswap.org` (and `gateway.uniswap.org`):
  - `/v1/graphql`: GraphQL for token, pool and explore data.
  - `/v2` (trading/quote API, `/v2/api`, `/v2/find`, pools `/v2/:chainName/:pairAddress`): pool
    lookup for v2 pools.
- `entry-gateway.backend-prod.api.uniswap.org/jupiter`: Solana routing (not in scope).
- `liquidity.backend-prod.api.uniswap.org` and `...-staging...`: liquidity and launch-auction service.
- `gateway.backend-prod.api.uniswap.org` (and staging/dev): auth and wallet API (`/api/v1/...`,
  `/api/v2/farcaster/*`, passkeys, siwe/siws, sessions, recovery).
- `/v1/analytics_events`, `/v2/events`: analytics sink.
- Third-party: `cdn.app.uniswap.org` (assets), `coin-images.coingecko.com` and `assets.coingecko.com`
  (token images), `s2.coinmarketcap.com`, block explorers (etherscan family, blockscout, etc.),
  public RPCs (mainnet.base.org, infura, etc.), `api.moonpay.com`, `4byte.sourcify.dev` (decoding).
- Client-side route list (for our route parity): `/`, `/swap`, `/limit`, `/limits`, `/send`,
  `/sell`, `/buy`, `/preview`, `/tokens`, `/tokens/:chainName`, `/tokens/:chainName/:tokenAddress`,
  `/explore`, `/explore/tokens/:chain/:address`, `/explore/pools/:chain/:address`,
  `/explore/category/:slug`, `/explore/auctions/...`, `/pools`, `/pool`, `/pool/v2`, `/pool/:tokenId`,
  `/pool/v2/find`, `/pools/v2/find`, `/pools/:tokenId`, `/positions`, `/positions/create`,
  `/positions/add`, `/positions/add/new`, `/positions/v2/:chain/:pair`, `/positions/v3/:chain/:id`,
  `/positions/v4/...`, `/remove/:tokenId`, `/remove/v2/:a/:b`, `/migrate/v2/...`, `/migrate/v3/...`,
  `/portfolio` (with `tokens`, `nfts`, `pools`, `activity`, `defi` sub-routes), `/launches`,
  `/liquidity/launch-auction`, `/manage/passkey/:wallet`, `/vote/*`, `/create-proposal`, `/not-found`.
  (`/metachain`, `/metaswapx` are MetaSwap-only.)

---

## 14. Screen index (screenshots in `docs/analysis/screens/`)

| File | State |
|---|---|
| 01b-swap-desktop-1440-dark.png | Swap, dark, signed out |
| 01c-swap-desktop-1440-light.png | Swap, light, signed out |
| m-swap-375.png | Swap, 375px phone, dark |
| m-explore-375.png | Explore, 375px (gate/skeleton) |
| m-portfolio-375.png | Portfolio, 375px, connect gate |
| 02-explore-tokens-desktop-1427.png | Explore tokens, skeleton state |
| 03-explore-pools-desktop-1427.png | Explore pools, skeleton state |
| 04-explore-transactions-desktop-1427.png | Explore transactions, gated |
| 05-pool-new-positions-desktop-1427.png | Positions, connect gate |
| 06-positions-create-desktop-1427.png | Positions create, connect gate |
| 07-portfolio-desktop-1427.png | Portfolio, connect gate with Demo wallet |
| 08-limit-desktop-1427.png | Limit tab, signed out |
| 09-buy-desktop-1427.png | Buy tab, signed out |
| 10-sell-desktop-1427.png | Sell tab, signed out |
| 11-token-eth-desktop-1427.png | Token detail, loading |
| 12-pool-detail-desktop-1427.png | Pool detail, connect gate |
| 13-launches-desktop-1427.png | Launches, connect gate |
| 14-swap-token-selector-buy-open.png | Token selector (buy side) with chips |
| 14b-swap-token-search-usdc.png | Token selector search, skeleton results |
| 16-more-menu-open.png | More menu (theme/language/currency) |
| 17-search-open.png | Top search overlay |
| 19-logo-menu-open.png | Logo caret menu |

Not captured (could not be reached in this session): the swap settings popover (gear click did not
register), the review modal and progress steps, populated explore tables, token and pool detail
bodies, the account drawer, and the positions flow beyond the gate. These are covered by bundle
evidence and [inf] notes above, and need a funded local devnet and a wallet to observe.

---

## 15. Build notes for MetaSwap (summary)
1. Keep the four swap tabs, but name the fourth consistently with the route. Resolve Send vs Sell.
2. Replace `$00.00` / `£0` placeholders with skeletons, and never show fake zeros.
3. Gated pages keep their chrome and show one shared connect modal.
4. Build the token selector around chips, a network filter and token rows with category tags.
5. Use direct nav links (no dropdowns) unless we add real submenus.
6. Ship the stats, table and chart patterns from section 8-9, with lightweight-charts.
7. Position flow is three steps plus review; the range chart with draggable handles is the hard part.
8. Keep everything Uniswap-proprietary out: logo, wordmark, fonts, icons, copy.

---

## Addendum (maintainer): live-data observations

the UI teardown's Chrome session never received live data. The maintainer re-checked these pages in a second browser on 2026-10-20, where data loaded. Values below are observed. Currency showed as GBP only because of browser locale; MetaSwap uses USD.
Screens: `screens/90-explore-tokens-live.jpg`, `91-token-detail-eth-live.jpg`, `92-pool-detail-ethusdc-live.jpg`.

### Explore (`/explore/tokens`)
- Stats strip at the top. Each tile has a label, a big compact value and a small coloured "x.xx% today" delta:
  "1D volume" ($1.23B), "Total Uniswap TVL", "v2 TVL", "v3 TVL", "v4 TVL". MetaSwap shows 1D volume, Total TVL, v2 TVL and v3 TVL.
- "Earn" row of cards (token icon, symbol, "x.xx% APY" in accent colour). Out of scope for MetaSwap. Skip it or show top pool APRs instead.
- Section tabs as large text tabs: **Tokens · Auctions · Pools · Transactions**. MetaSwap uses Tokens · Pools · Transactions.
- Category chips under the tabs: All / Stocks / Commodities / ETFs. MetaSwap uses All / Stablecoins / Wrapped.
- Right-side controls:
  - time-range dropdown for the volume column: 1H, 1D, 1W, 1M, 1Y, All time;
  - network filter dropdown;
  - search icon button that expands into an input.
- Tokens table columns: `#`, Token (icon + name + symbol below in secondary text), Price, 1H, 1D (delta with ▲ green / ▼ red triangles; 0% shows a grey ▲), FDV, Volume (sortable, ↓ indicator on the active sort), 1D chart (sparkline).
- The first columns are sticky on horizontal scroll, and a round "→" scroll button appears at the table edge on narrow widths.
- Row height ≈ 50px. The table sits on a rounded surface with a header row in a slightly lighter surface.

### Token detail (`/explore/tokens/:chain/:address`, e.g. `ethereum/NATIVE`)
- Breadcrumb: "Tokens > ETH".
- Header: large token icon, name + symbol, network selector ("Ethereum ⌄", lists networks). Right side: X/share/⋯ icon buttons (copy link, share, report data issue).
- Price block: big price ($1,819.18), then the change in absolute and percent terms ("▲ $22.43 (1.25%)") in green or red.
- Chart:
  - area/line chart with a soft gradient fill and a dotted grid;
  - y-axis labels on the right, time axis at the bottom;
  - bottom-left range pills: 1H 1D 1W 1M 1Y All (the active pill is a filled chip);
  - bottom-right toggles: line or candlestick icon, plus a segmented Price / Volume / TVL control.
- Full-width primary "Buy" button below the chart (MetaSwap: "Swap", or open the swap widget).
- Stats grid: TVL, Market cap, FDV, 1 day volume, 52W High, 52W Low.
- About: description with "Show more", plus links (explorer, website, Twitter).
- Bottom tabs: Transactions / Pools.
  - Transactions columns: Time (relative "14s"), Type (Buy/Sell coloured), token amount, For (other amount + symbol), USD value, Wallet (shortened address).
  - The list is live-updating.

### Pool detail (`/explore/pools/:chain/:address`)
- Breadcrumb: "Pools > ETH / USDC".
- Header:
  - overlapping double token icon;
  - "ETH / USDC" with a ⇅ invert-pair button;
  - chips: network, version "v3", fee "0.05%";
  - shortened pool address (copyable).
- Chart tabs as text tabs: **Price · Volume · Liquidity · Depth**. Volume shows a bar chart in accent colour, with a big "$30.1M / Past day" headline.
- Range pills: 1H 1D 1W 1M 1Y All.
- Two big buttons: "Swap" and "+ Add liquidity".
- Transactions table columns: Time, Type ("Buy ETH" / "Sell ETH"), USD, token0 amount, token1 amount, Wallet.
- A side column on wide screens has pool balances with a two-colour bar, TVL, 24H volume, 24H fees, and links.

### Global nav (confirmed)
- Left: logo + ▾ dropdown.
- Direct links: Trade, Explore, Launches (Beta badge), Pool, Portfolio. MetaSwap uses Trade, Explore, Pool, Portfolio, plus MetaSwapX and MetaChain.
- Right: search icon, "⋯" menu, and a primary pill button ("Get started" / "Connect").
- The connect panel lists "Uniswap Mobile", "Other wallets", "Create account / Log in", then a Terms notice. MetaSwap shows detected wallets, WalletConnect, Coinbase Wallet and the Dev wallet instead.
