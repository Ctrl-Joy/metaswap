# Stage 5: Earn, Launches/Auctions, Explore discovery, full Portfolio, Uniswap-style charts

Binding addendum to PLAN.md (the rules in PLAN.md's "Ground rules" still apply). Reference
screenshots of the current Uniswap app: `docs/analysis/screens/stage5/` (explore with Trending/Earn,
Auctions tab, Portfolio, Launches). Everything runs on the local devnet with real contracts.

## 1. Contracts (router & MetaSwapX contracts: `packages/contracts/src/x/`, `test/x/`, `script/DeployStage5.s.sol`)

### 1a. Earn: `earn/MetaSwapSavingsVault.sol`
An ERC-4626 vault (OpenZeppelin `ERC4626`) paying a fixed, owner-settable APY. It works like a
savings-rate contract:
- A per-second accumulator `index` (ray, 1e27) grows at `ratePerSecond`. Set it from `apyBps` via
  `ratePerSecond = ln(1 + apy) / year`, approximated with sufficient precision.
- `totalAssets()` = shares × index, backed by principal plus a **reward reserve** that the owner
  funds with `fundReserve(amount)`.
- `maxWithdraw` is capped by the actual balance.
- Events: standard ERC-4626 events plus `RateUpdated(uint256 apyBps)` and `ReserveFunded(uint256)`.
- Helpers for native ETH on the WETH vault: `depositETH(receiver)` (payable) and
  `withdrawETH(assets, receiver, owner)`.
- Three vaults, named/symbol and APY:

  | Asset | Name / symbol | APY |
  |---|---|---|
  | mUSDT | "MetaSwap Earn mUSDT" / `meUSDT` | 478 bps |
  | mUSDC | "MetaSwap Earn mUSDC" / `meUSDC` | 441 bps |
  | WETH | "MetaSwap Earn ETH" / `meETH` | 157 bps |

  Each reserve is funded for at least 2 years at 50M USD TVL.

### 1b. Launches: `launch/MetaSwapLaunchpad.sol`, `launch/LaunchAuction.sol`, `launch/LaunchToken.sol`
A token-launch platform with a uniform-price batch auction, inspired by Uniswap's Launches /
Continuous Clearing Auctions, simplified.

**Launchpad factory**
- `constructor(string name, address v3Factory, address positionManager, address weth, address owner)`.
- `createLaunch(LaunchParams p)` deploys a `LaunchToken` (ERC20 + permit, fixed supply minted to the
  auction) and a `LaunchAuction`, and returns `(token, auction)`.
- `LaunchParams` fields:
  - `name`, `symbol`, `totalSupply`
  - `auctionSupplyBps`: share sold in the auction; the rest is reserved for liquidity
  - `quoteToken` (mUSDC or WETH)
  - `floorPrice` (quote per whole token, 1e18-scaled)
  - `tickSize`
  - `startTime`, `endTime`
  - `launchThreshold`: minimum raise in quote units
  - `liquidityBps`: share of the raise paired with reserved tokens
  - `poolFee` (V3 fee tier)
  - `description`, `website`
- Each launchpad has a `name`. Owner functions: `setVerified(auction, bool)` and
  `allLaunches()` / `launchCount()`.
- Events: `LaunchCreated(address indexed token, address indexed auction, address indexed creator, string name, string symbol)`.

**LaunchAuction**
- Bids: `bid(uint256 amount, uint256 maxPrice)` pulls the quote token. `maxPrice` must be at least
  the floor and a multiple of the tick. Demand aggregates per price level.
  - Native ETH via `bidETH(maxPrice)` when the quote is WETH.
  - At most 256 distinct price levels.
  - Each bid is recorded with an id per bidder.
  - Events: `BidPlaced(uint256 indexed bidId, address indexed bidder, uint256 amount, uint256 maxPrice)`,
    `Settled(uint256 clearingPrice, uint256 raised, bool launched, address pool)`,
    `Claimed(uint256 indexed bidId, address indexed bidder, uint256 tokens, uint256 refund)`.
- Views:
  - `status()`: `Upcoming | Active | Ended | Launched | Failed`
  - `clearingPrice()` (live estimate while Active): the highest price p where the cumulative quote
    demanded at ≥ p buys at least `auctionSupply` tokens at p; otherwise the floor
  - `totalBids()`, `raised()`, `thresholdProgressBps()`, `priceLevels()` returning (price, demand)
    arrays for the bid-distribution chart, `bidsOf(address)`, `fdvAtFloor()` (floor × totalSupply)
  - `params()`, `token()`, `pool()`
- `settle()` is callable by anyone after `endTime`.
  - If `raised` reaches the threshold: compute the uniform clearing price. Bids above it fill fully;
    bids at it fill pro-rata; bids below are refunded.
    `liquidityBps` of the proceeds plus the reserved tokens seed a V3 pool at the clearing price via
    `createAndInitializePoolIfNecessary` + `mint` (full range). The LP NFT stays with the auction
    (locked). The rest of the proceeds goes to the creator.
  - Otherwise: status `Failed`, and everyone is refunded.
  - `claim(bidId)` / `claimAll()` pays tokens plus refunds.

**Deploy:** `script/DeployStage5.s.sol` runs after DeployX and before Seed.
- Deploys the 3 vaults (funded) and two launchpads, named **"MetaSwap Launchpad"** and
  **"Devnet Pad"**.
- Merges into `deployments/31337.json`:
  - `contracts.Launchpad`, `contracts.DevnetPad`
  - `vaults: [{ address, asset, symbol, apyBps }]`
- Must keep all existing keys. Seed must also keep the new keys when it rewrites `pools`.

Tests: full lifecycles. Vault deposit/withdraw/accrual/ETH helpers. Auction success with pro-rata
at the margin, failure with refunds, the pool created at the clearing price, claims, and edge cases.

## 2. Devnet data (API extends `scripts/market.ts` history and live modes)
During the 30-day history replay, run realistic launches through both launchpads:
- **≥ 6 graduated launches**, at different points in the month. Bid activity runs over each auction
  window from several traders; after graduating, the tokens trade with the same random-walk model
  (memes with high volatility). They join the pool set the replay steers.
- **≥ 2 failed launches** (refunded).
- At "now":
  - **2–3 Active auctions** ending 6h–6d in the future, with partial bids, one of them verified;
  - **1–2 Upcoming** ("starting soon") auctions.
  Live mode keeps adding small bids to Active auctions.
- Original names only, e.g. Pixel Pup PUP, Moon Mango MANGO, Orbit ORB, Lumen LUMEN, Quokka QKA,
  Tidal TIDE, Ember EMBR, Nimbus NIMB. Never real project names.
- Also seed Earn deposits from several accounts (#10–#14 and #1) so vault TVL and lifetime earnings
  show.

## 3. API (API: `services/api`)
Index the new contracts dynamically: the vaults, the launchpads' `LaunchCreated`, each auction's
events, and launched tokens and pools join the token and pool sets automatically.

**Explore**
- `GET /explore/trending` → 4–8 token rows ranked by recent volume × |1D change| (launched tokens
  included). Each row includes `sparkline`.
- `GET /explore/tokens?category=all|trending|gainers|stablecoins|majors|defi|l2|memes|launched|wrapped`
  plus the existing `sort`/`range`. Rows add `tags: string[]`.
  - Seed tags: ETH/WETH/mWBTC = majors; mUSDC/mUSDT/mDAI = stablecoins; META/mLINK = defi;
    mARB = l2; WETH = wrapped.
  - Launched tokens get `launched` + `memes`.
  - `gainers` = 1D change descending, positive only.

**Earn**
- `GET /earn/vaults` → `[{ address, asset: token, symbol, apyPct, tvlUsd, totalAssets, depositors }]`.
- `GET /accounts/:a/earn` → `[{ vault, shares, assets, valueUsd, depositedUsd, lifetimeEarningsUsd }]`.

**Launches**
- `GET /launches?status=all|active|upcoming|launched|failed&launchpad=&verified=&sort=fdv|volume|liquidity|age|bidVolume&q=`
  → each row has:
  - identity: `auction`, `token`, `name`, `symbol`, `logoURI`, `launchpad`, `verified`, `status`
  - timing: `startTime`, `endTime`, `ageSec`
  - auction: `floorPrice`, `fdvAtFloorUsd`, `bidVolumeUsd`, `thresholdUsd`, `thresholdPct`,
    `clearingPriceUsd`
  - after launch: `pool`, `fdvUsd`, `volume24hUsd`, `liquidityUsd`, `change1h`, `change1d`, `sparkline`
- `GET /launches/trending` → launched rows ranked by 24h volume.
- `GET /launches/top-verified` → up to 4 verified rows.
- `GET /launches/:auction` → the row plus `params`, `priceLevels`, `bids` (recent),
  `bidsOf=<address>` support, `description`, `website`.

**Portfolio** (everything exact from chain state)
- `GET /accounts/:a/portfolio` returns:
  - `totalUsd`, `change24hUsd`, `change24hPct`
  - `tokens: [{ token, priceUsd, balance, valueUsd, avgCostUsd, costBasisUsd, unrealizedPnlUsd, unrealizedPnlPct, change24h }]`
    (native ETH included; cost basis = average cost of inflows valued at the USD price when they arrived)
  - `pools`: positions with status, fees and value
  - `earn`: as `/accounts/:a/earn`
  - `nfts`: V3 position NFTs with `tokenURI` image data URIs
  - `activity`: recent
- `GET /accounts/:a/portfolio/history?range=1H|1D|1W|1M|1Y|ALL` → `[{ time, valueUsd }]`.
  Compute it from balances at historical blocks: `eth_getBalance` plus a Multicall of `balanceOf`
  at ~60–120 bucket boundaries, × historical prices. Cache it.
- `GET /accounts/demo` → `{ address }` of the demo wallet (Anvil #1) for the signed-out portfolio.

## 4. Web (`apps/web`)

### 4a. Charts (explore owns `features/explore/charts/**`, applied app-wide), matching Uniswap
- **Price charts:** a line coloured by the period's change (success green if ≥ 0, critical red if
  < 0), with an area gradient from the line colour (~25% opacity) to transparent.
  - A **dotted-grid background** (dots, no solid grid lines).
  - Right-side y-axis labels in tertiary text; a bottom time axis with sparse labels.
  - A **pulsing dot on the last point**.
  - Crosshair: a vertical dashed line, a dot on the hovered point, and the headline price/delta/date
    updating while hovering.
  - Ranges as pills bottom-left (1H 1D 1W 1M 1Y All). Line/candle toggle and Price/Volume/TVL
    segmented control bottom-right.
- **Candles:** green/red bodies.
- **Volume:** accent-coloured bars, with the hovered bar highlighted.
- **Sparklines** everywhere: green/red by 1D change, no fill, 1.5px.
- Use the same components on the token, pool, explore, portfolio and launch charts.

### 4b. Explore (explore: `pages/explore/**`, `features/explore/**`)
- Stats strip as now.
- **Trending** row: 4 cards with logo, name, symbol, ▲/▼ %, sparkline, an (i) tooltip, and a
  "View all" link → `/explore/tokens?category=trending`.
- **Earn** row: title "Earn", subtitle "Deposit for yield with no lockup", and 3 vault cards (logo,
  symbol, APY in accent) → `/earn/:vault`.
- Section tabs: **Tokens · Auctions · Pools · Transactions**.
- Tokens chips: All, Trending, Stablecoins, Top Gainers, Memes, More ▾ (Majors, DeFi, L2, Launched,
  Wrapped). Tag badges next to token names ("Majors", "Stablecoins", …).
- **Auctions tab** (`/explore/auctions`):
  - "Top verified auctions" cards: logo, name, verified check, FDV, bid volume, and a progress bar
    with countdown or "Launched".
  - "Auctions" table: Token, FDV at floor, Bid volume, Launch threshold ($ + % met), Status
    (progress bar + countdown, "Starting soon", "Launched", "Failed").
  - Chips: All / Verified / New / Launched. A Status dropdown, search, and a **"+ Launch auction"**
    button → `/launches/create`. Rows → `/launches/:auction`.

### 4c. Launches (positions: `pages/launches/**`, `features/launches/**`)
- `/launches` (nav item "Launches" with a "Beta" badge, between Explore and Pool):
  - "Launch and trade" banner with an auto-scrolling **ticker** of launched tokens and their 1D %
    (pauses on hover), plus an arrow → `/launches/create`.
  - **Trending launches** carousel cards: logo, name, symbol, sparkline, FDV, 24H volume, % change
    and a launchpad chip. Horizontal scroll with arrows.
  - **All launches** table: #, Token, Launchpad, FDV, 24H volume, Liquidity, 1H, 1D, Age. Chips
    All / Recently launched / Trending, plus an "All launchpads" dropdown.
- `/launches/create`: form for name, symbol, supply, auction %, quote token, floor price (shows FDV
  at floor), start (now/scheduled), duration, threshold, liquidity %, fee tier, description and
  launchpad. Then a review modal → tx → redirect to the auction.
- `/launches/:auction`:
  - header with status badge and countdown;
  - stats: FDV at floor, bid volume, threshold progress bar, live clearing price / FDV;
  - **bid distribution chart** (demand per price level, clearing line);
  - **bid form**: amount in the quote token, max price or max FDV, approve → `bid`;
  - your bids; recent bids table;
  - after end: **Settle**, then **Claim** (tokens + refund);
  - when launched: a link to the token page, a Swap button, and the price chart.

### 4d. Portfolio + Earn (web app: `pages/PortfolioPage.tsx` → `pages/portfolio/**`, `features/portfolio/**`, `pages/earn/**`, `features/earn/**`)
- `/portfolio` (tabs **Overview · Tokens · NFTs · Activity** as sub-routes):
  - **Signed out:** a top banner "Connect a wallet to view your portfolio" with a Connect button,
    and the page renders the **Demo wallet** (address from `/accounts/demo`) with a "Demo wallet"
    label.
  - **Overview:**
    - wallet identicon + name/address + an eye toggle (hide balances);
    - big total value and today's change;
    - **portfolio value chart** (Uniswap style, ranges) with a "Track your portfolio / Connect
      wallet" overlay when in demo mode;
    - action tiles Send / Receive / Buy / More;
    - **Tokens** table: Token, Price, Balance, Value, Unrealized P/L ($ and ▲/▼ %), top 8 then
      "View all tokens";
    - right column: **Earn** ("$X lifetime earnings" and vault rows with APY and value), then
      **Recent activity** with "View all activity";
    - **Pools** table: Pool, Status (In range / Out of range badge), Fees, Value, then "View all pools".
  - **Tokens tab:** full table. **NFTs tab:** grid of V3 position NFT images. **Activity tab:** full
    activity list with filters.
- `/earn` and `/earn/:vault`:
  - vault cards/table: APY, TVL and your position;
  - deposit/withdraw modal (ERC20 approve → deposit; ETH via `depositETH`);
  - earnings shown live as the index accrues.
- Nav and product menu: add Launches (Beta). Earn sits in the product menu and the explore Earn row.

## 5. Ownership, testing, process
- Owners: contracts **the router/MetaSwapX contracts**; API + `scripts/market.ts` + seed data **the API**; charts + explore **the explore area**;
  launches **the positions/launches area**; portfolio + earn + nav **the web shell**.
- Shared web files (`src/components/**`, `src/api/**`, `src/state/**`, the router) change only via
  the owner of the feature that needs it. the web shell owns the router/nav. Others put hooks in their own
  `features/<x>/api.ts`.
- Same rules as before:
  - real behaviour tests (forge, vitest, Playwright against the live stack);
  - don't start anvil on 8545 yourself (use your own port for experiments);
  - don't git commit;
  - report deviations in `docs/specs/CHANGES.md`.
- Web engineers can build against the shapes above before the API lands, and integrate once the
  maintainer says the stack is redeployed.
