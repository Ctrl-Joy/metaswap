# @metaswap/web

The MetaSwap web app: Vite 7, React 19, TypeScript 5.9, React Router 7, wagmi 2 and viem,
TanStack Query 5, Zustand 5, Tailwind 4 and Radix primitives. It runs on
http://127.0.0.1:5173 against MetaChain Devnet (Anvil, :8545) and the MetaSwap API (:8787).

```bash
npm run dev -w @metaswap/web          # dev server on 127.0.0.1:5173
npm run typecheck -w @metaswap/web
npm run build -w @metaswap/web
npm test -w @metaswap/web             # vitest unit tests
npm run e2e -w @metaswap/web          # Playwright; needs `node scripts/dev.mjs --no-web` running
SCREENS=1 npx playwright test screens # page screenshots → e2e/screenshots/
npm run logos -w @metaswap/web        # regenerate public/tokens/*.svg + favicon
```

Environment (`.env.local`, see `.env.example`): `VITE_API_URL`, `VITE_RPC_URL`, and
`VITE_WALLETCONNECT_PROJECT_ID`. WalletConnect is offered only when the project ID is set.

## Layout

```
src/
  main.tsx, App.tsx, routes.tsx   router, providers, shell (header, banners, toasts, drawer, connect modal)
  config.ts                       API_URL, RPC_URL, Anvil dev accounts, quote timings
  styles/index.css                design tokens (CSS vars) + Tailwind theme mapping
  components/ui/                  shared UI kit (see below)
  components/layout/              Header, SearchModal, Toaster, StatusBanners, Footer, ComingSoon, Logo
  api/                            fetch client, response types, TanStack Query hooks, queryClient
  wallet/                         wagmi config, Dev wallet connector, ConnectModal, wallet hooks
  state/                          Zustand stores: settings, transactions (tx tracking), toasts, ui
  hooks/                          useTokenBalances, useDocumentTitle
  lib/                            amount parsing, formatting, error mapping, typed-data, ABIs
  features/tokens/                TokenSelector, CurrencyInputPanel, useTokenList/useTokenPrices, search
  features/swap/                  SwapForm, CTA state machine, reducer, quote hook, review modal, executor
  features/limit/                 MetaSwapX order builder, LimitForm, OrdersList, place/cancel
  features/send/, features/buy/   Send form; devnet faucet
  features/account/               AccountDrawer, holdings, positions summary, activity
  features/settings/              swap settings popover
  pages/                          route components (the web shell); pages/explore/** (the explore area); pages/positions/** (the positions/launches area)
e2e/                              Playwright specs + helpers
```

## Wallets

- **EIP-6963**: injected wallets are discovered automatically. Each one is listed with its icon.
- **Coinbase Wallet SDK**, and **WalletConnect** when `VITE_WALLETCONNECT_PROJECT_ID` is set.
- **Dev wallet** (`src/wallet/devWallet.ts`): wagmi's `mock` connector bound to one of Anvil
  accounts #0–#4, with an account picker in the connect modal. Anvil keeps these accounts
  unlocked, so `eth_sendTransaction` and `eth_signTypedData_v4` are signed by the node. No keys
  live in the browser. This is the wallet the e2e tests use.
- If the wallet is on another chain, a banner offers "Switch to MetaChain Devnet". That runs
  `wallet_switchEthereumChain` and falls back to `wallet_addEthereumChain`.

## Trade flows

- **Swap**: quotes come from `GET /quote` (300 ms debounce, refreshed every 15 s, sent with
  `swapper`). The steps follow `docs/analysis/flows.md`: ERC20 `approve(Permit2, max)` when the
  on-chain allowance is too low, then a PermitSingle signature when `quote.permit2.required`,
  then `POST /swap`, then the transaction is sent and its receipt awaited. ETH⇄WETH goes straight
  to WETH9. The web app never builds UniversalRouter calldata itself.
- **Limit**: the app builds the `ExclusiveDutchOrder` (`features/limit/order.ts`, checked against
  the Solidity hash in unit tests). The user signs the Permit2 `PermitWitnessTransferFrom`, and the
  order goes to `POST /x/orders` as `{ encodedOrder, signature }`. Cancel calls
  `Permit2.invalidateUnorderedNonces(nonce >> 8, 1 << (nonce & 0xff))`.
- **Send**: native ETH uses `sendTransaction`; ERC20 tokens use `transfer`.
- **Buy**: devnet faucet. `TestERC20.faucet()` runs for each token, and ETH comes from
  `anvil_setBalance`.
- Deep links: `/swap?inputCurrency=ETH&outputCurrency=<address|symbol>&exactAmount=1&exactField=input|output`,
  and `/send?token=<address>&to=<address>`.

## Charts

Shared chart kit in `src/features/explore/charts` (import from `@/features/explore/charts`). Portfolio
(the web shell) and launches (the positions/launches area) use the same components, so every chart matches Uniswap:

| Export | Use for |
|---|---|
| `TimeChart` | Line/area (period trend colour, gradient fill, dotted grid, pulsing last-point dot), `kind="bar"` volume bars (hovered bar highlighted), and `kind="candles"` (green/red bodies). Props: `kind`, `data`, `formatValue`, `onHover`. |
| `ChartFrame` / `ChartControls` | Loading, empty and error states around a chart, plus the footer row: range pills bottom-left, mode toggles bottom-right. |
| `Sparkline` | Row sparklines, 1.5px, green/red by sign of the change, no fill. |
| `LiquidityHistogram`, `DepthChart` | V3 tick liquidity and cumulative depth (SVG). |
| `useChartPalette`, `trendColor`, `withAlpha` | Theme colours from CSS variables; trend colour rule (green if the period ended at or above its start). |

Rules: line colour follows the period change (green ≥ 0, red < 0). The grid is dotted. The crosshair is a
vertical dashed line with a dot on the hovered point, and the headline (price, delta, date) updates while
hovering. Ranges are `1H 1D 1W 1M 1Y All`. Never show fake zeros while loading.

## For feature areas

Build on these pieces rather than re-implementing them. Import UI from `@/components/ui`.

### UI kit (`src/components/ui`)
| Component | Notes |
|---|---|
| `Button`, `ButtonLink`, `IconButton` | variants `primary \| tint \| secondary \| outline \| ghost \| critical \| warning`; sizes `sm md lg xl`; `loading`, `leftIcon`, `fullWidth` |
| `Modal` | Radix dialog. Centred on desktop, bottom sheet under 640px. Props: `title`, `width`, `tall`, `onBack`, `dismissible`, `testId` |
| `Sheet` | right-side drawer (account drawer) |
| `TokenLogo`, `DoubleLogo` | `/tokens/<SYMBOL>.svg` with a coloured-initials fallback; `chainBadge` |
| `Table`, `THead`, `Th`, `SortTh`, `Tr`, `Td`, `TableSkeleton` | explore-style table: rounded surface, 48px header, 56px rows, horizontal scroll |
| `Skeleton` | shimmer placeholder. Never show fake `0` / `$0` while loading |
| `SegmentedTabs`, `UnderlineTabs` | pill tabs (ranges, modes) and large text tabs (page sections) |
| `Tooltip`, `InfoTip`, `Popover` | Radix-based |
| `PercentChange`, `Usd`, `Amount` | coloured ▲/▼ percent, formatted USD and token amounts |
| `Badge`, `Switch`, `Banner`, `CopyButton`, `EmptyState`, `Card`, `Spinner`, `Identicon` | |

### Data and state
- `@/api/hooks`: `useHealth`, `useApiTokens`, `useTokenStats`, `useTokenCandles`,
  `usePriceHistory`, `useExploreStats`, `useExploreTokens`, `useExplorePools`,
  `useExploreTransactions`, `usePool`, `useAccountActivity`, `useAccountPositions`,
  `useAccountBalances`, `useXOrders`, and the generic `useApiQuery(key, path, params)`. Keys all
  start with `['api', …]`. Add new endpoints here, and call `apiGet` / `apiPost` from
  `@/api/client` rather than `fetch`. Response types are in `@/api/types`.
- `@/features/tokens`: `useTokenList()` (`all`, `listed`, `find(addressOrSymbol)`, `isListed`),
  `useTokenPrices()` (USD by lower-cased address, seed prices as fallback), `TokenSelector`
  (modal), `CurrencyInputPanel` (amount + token + balance/Max + USD), and `TokenButton`.
- `@/hooks/useTokenBalances(tokens, account)` returns balances keyed by lower-cased address
  (Multicall3). `useTokenBalance(token, account)` covers a single token.
- `@/state/transactions`: after sending a tx, call
  `trackTx(account, { hash, type, summary })`. It records the tx (persisted per account), shows
  pending → success/failure toasts, waits for the receipt, and invalidates balances, allowances
  and account queries. Add tx types to `TxType` if you need them (`add-liquidity`,
  `remove-liquidity` and `collect-fees` already exist).
- `@/state/toasts`: `toast.success/error/info/pending`.
- `@/state/settings`: `useSettings` (slippage, deadline, theme, …) and `useSlippageBps()`.
- `@/lib/errors`: `parseTxError(err)` turns wallet, RPC, revert and API errors into
  `{ kind, title, message }`.
- `@/lib/amount` (`sanitizeAmountInput`, `parseAmount`, `toInputString`, `applyBps`), and
  `@/lib/format` (sdk formatters plus `formatRelativeTime`, `formatDuration`, `formatImpact`).
- `@/wallet/hooks`: `useWallet()` (`address`, `wrongNetwork`, …), `useSwitchToDevnet()`.
  `useUi().openConnect()` opens the connect modal (use it for gated pages).
- `@/features/swap/StepList` is the step-progress list (approve → sign → confirm) for multi-step
  tx modals.

### Conventions
- Routes: the explore area edits `src/pages/explore/routes.tsx` and the positions/launches area edits `src/pages/positions/routes.tsx`.
  `src/routes.tsx` mounts both. The current pages there are placeholders (`ComingSoon`), so
  replace them freely. Put feature code in `src/features/explore/**` and
  `src/features/positions/**`.
- URLs use `CHAIN_SLUG` (`metachain-devnet`) from `@/config`, for example
  `/explore/tokens/metachain-devnet/<address>`. Native ETH is `NATIVE`.
- Colours: use only the semantic utilities (`bg-surface-1/2/3`, `text-text-1/2/3`,
  `border-border`, `bg-accent-fill`, `text-accent`, `bg-accent-tint`, `text-success`,
  `text-critical`, `text-warning`, `bg-*-tint`). Never hard-code hex values in components. The
  type scale is `text-body-4/3/2/1`, `text-heading-3/2/1`. Radii: cards `rounded-2xl` (20px),
  inputs `rounded-xl`, chips and buttons `rounded-full`.
- Charts: `lightweight-charts` 5 is installed. Read colours from the CSS vars
  (`getComputedStyle(document.documentElement).getPropertyValue('--ms-accent')`) so both themes
  work.
- Every interactive element that e2e touches gets a `data-testid`.
- ABIs: `src/lib/abis.ts` has hand-written minimal ABIs (erc20, weth9, testErc20, permit2). For
  V2/V3 periphery, use `@metaswap/sdk/abis` once synced, or add a minimal `parseAbi` entry.

### Running strips (Stage 5)
- `Marquee` (`@/components/ui`): continuously scrolling strip. Props: `children` (items), `speed` (px/s, default 35, 0 = static),
  `gap` / `itemGap` (px, default 8), `arrows` / `controls` (‹ › buttons, default false), `step` (px per arrow click, default 300),
  `fade` (edge fade, default false), `ariaLabel`, `className`, `testId`. Items are duplicated for a seamless loop; it pauses on
  hover/focus/touch, the root region carries `data-running`, and under `prefers-reduced-motion` it is a static snap-scroller.
- `ChartCard`: 300×108 "Trending launches"-style card. Props: `to`, `token`, `title`, `subtitle?`, `chart?` (slot, e.g. the explore area's
  `<Sparkline>`), `primary`, `changePct?`, `secondary?`, `chip?`, `testId?`.
- `TickerPill`: `to?`, `token`, `label`, `changePct?`, `testId?` — for ticker marquees.
