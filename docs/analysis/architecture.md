# Uniswap web app architecture and MetaSwap mapping (protocol research)

Part 1 describes how `Uniswap/interface` is built, based on its `main` branch as read on 2026-10-20 (package.json, directory listings and key source files). Part 2 maps each Uniswap piece to the MetaSwap stack in PLAN.md. Items marked **(unverified)** came from memory or were not opened.

Source root: https://github.com/Uniswap/interface

---

## Part 1: How Uniswap/interface is built

### 1.1 Monorepo layout
Tooling: **bun** (`engines.bun >= 1.3.14`, Node pinned to 22.22.2), **Nx 22** for task graph and caching, **oxlint / oxfmt**, lefthook, commitlint, knip. (`package.json`, root.)

```
apps/
  web/          Vite SPA (the app.uniswap.org site). src/: App.tsx, pages/, state/, components/, hooks/, lib/, features/, connection/, rpc/, sessions/, i18n/, theme/, tracing/, config/
  mobile/       React Native app (shares packages/uniswap)
  extension/    browser wallet extension
packages/
  uniswap/      shared product code: src/features/transactions (swap, wrap, liquidity, send, steps), src/data (API clients), src/features/* domain modules, chains/tokens helpers
  ui/           shared component library
  tailwind/     Tailwind preset / styling
  wallet/       wallet connection abstractions, embedded wallet
  chains/       chain metadata (ids, names, explorers, native currencies)
  config/       shared config (ESLint/TS style), config-cli
  utilities/    logger, environment, telemetry helpers (@universe/environment, utilities/src/logger)
  analytics/    analytics wrapper (@uniswap/analytics)
  api/, trpc/, react-query/  data plumbing
  gating/, experiments/      feature flags and experiments
  prices/, encoding/, cryptography/, notifications/, sessions/, websocket/, privacy/, compliance/
```

### 1.2 Framework and libraries (from `apps/web/package.json` and `packages/uniswap/package.json`)
| Concern | Library (version on main) | Notes |
|---|---|---|
| UI framework | React 19.2.3, react-dom 19.2.3 | |
| Build / dev | Vite 8.1.3 | `apps/web/vite.config.mts` |
| Routing | react-router 7.18.1 | |
| Global state | Redux Toolkit 1.9.3 + redux 4.2.1 + react-redux 8.0.5 | `apps/web/src/state/index.ts` |
| Side effects | redux-saga (root saga `state/sagas/root`) | watches transaction and session actions |
| Persistence | redux-persist + localforage (IndexedDB) | persisted slice list in `state/webReducer.ts` (`interfacePersistedStateList`), migrations in `state/migrations` |
| Server state | @tanstack/react-query 5.90.20 | `packages/react-query` |
| GraphQL data | @apollo/client 3.11.10 | Data API used for Explore / token & pool pages |
| Wallets | wagmi 3.6.17, viem 2.49.0; legacy `@web3-react/core` 8.2.3 and `ethers` 5.7.2 still present | migration in progress; wagmi/viem is the new path |
| Protocol SDKs | `@uniswap/sdk-core` 7.19.4, `v2-sdk` 4.20.3, `v3-sdk` 3.31.0, `router-sdk` 2.10.3, `universal-router-sdk` 5.13.1, `permit2-sdk` 1.4.0, `uniswapx-sdk` 3.0.6, `token-lists` | calldata builders and types |
| API clients | `@uniswap/client-trading` 0.1.3, `client-data-api` 0.0.264, `client-liquidity` 1.4.43, `client-notification-service`, `default-token-list` 11.19.0 | generated clients |
| Charts | lightweight-charts 5.2.1 | price charts on token/pool pages |
| Styling | Tailwind (`packages/tailwind`), shared components in `packages/ui`, `global.css`, `tailwindCompat.test.ts` | no styled-components in `apps/web` deps |
| i18n | i18next 23.10.0, react-i18next 14.1.0; `.i18n/`, `i18n.config.ts`, i18next-parser | |
| Client state (small) | zustand 5.0.6 | used in `packages/uniswap` and web for local stores (e.g. `transactionDetailsModalStore.ts`) |
| Analytics / logs | @uniswap/analytics 1.7.2, analytics-events 2.43.0, Datadog, Sentry (reportFingerprintError) | |
| Feature flags | `packages/gating`, `packages/experiments`, `apps/web/src/featureFlags` | |

Observed but not spelled out here: Firebase config (`firebase.json`, `firestore.rules`) and a Privy embedded-wallet client exist in the repo.

### 1.3 Web app source structure (`apps/web/src`)
Top-level: `App.tsx`, `index.tsx`, `pages/`, `components/`, `features/`, `hooks/`, `lib/`, `state/`, `connection/`, `rpc/`, `sessions/`, `data/`, `i18n/`, `theme/`, `tracing/`, `featureFlags/`, `constants/`, `utils/`, `config.ts`, `chains/`, `notification-service/`, `shared-cloud/`.

Redux slices (`state/`): `activity`, `application`, `connection`, `embeddedWallet`, `fiatOnRampTransactions`, `global`, `lists`, `livePrices`, `mint`, `multichain`, `popups`, `routing`, `sagas`, `transactions`, `user`, `walletCapabilities`, `wallets`, plus `webReducer.ts` combining web slices and `migrations.ts` (versioned persisted state). Store setup (`state/index.ts`) wires redux-saga, redux-persist with a localforage-backed IndexedDB table, `delegationListenerMiddleware`, `walletCapabilitiesListenerMiddleware`, and a Datadog enhancer.

### 1.4 Wallet connection
- Connection layer lives in `apps/web/src/connection/` and `packages/wallet`; `wallets/` slice holds connected wallet state; `walletCapabilities` tracks EIP-5792-style capabilities (batch calls, paymaster) per connector.
- Supports injected (EIP-6963 discovery), WalletConnect, Coinbase, Privy embedded (cloud) wallet. (Connector list not opened; treat as **unverified** beyond the package names.)

### 1.5 Quotes: Trading API, UniswapX and classic
- `packages/uniswap/src/data/apiClients/tradingApi/` is the client for Uniswap's **Trading API** (the hosted service). `apiClients/` also has `forApi`, `gasService`, `dataApiService`, `liquidityService`, `unitagsApi`, `blockaidApi`, `jupiterApi`, `conversionTracking`, `createUniswapFetchClient.ts`.
- `packages/uniswap/src/features/transactions/swap/utils/tradingApi.ts` and `routing.ts`, `protocols.ts`, `trade.ts`, `getTradeAmounts.ts`, `getExactOutputWillFail.ts`, `logSwapQuoteFetch.ts`.
- Quote routing: `isClassic(...)` distinguishes **Classic** (AMM route, calldata from the API, executed through the Universal Router) from **UniswapX** (signed order posted to the API). The UI picks the better of the two (see `docs/analysis/flows.md`).
- Client-side route computation (`@uniswap/router-sdk` / smart-order-router) is **(unverified)** as a fallback path in current main; the presence of `router-sdk` in deps indicates encoding helpers at minimum.
- `generateSwapTransactionSteps.ts` turns a quote into an ordered list of steps (see 1.6).

### 1.6 Transactions: steps and tracking
- Step model: `packages/uniswap/src/features/transactions/steps/` with `approve.ts`, `permit2Signature.ts`, `permit2Transaction.ts`, `revoke.ts`, `wrap.ts`, `types.ts`. Swap-specific steps in `features/transactions/swap/steps/` (e.g. `signOrder.ts`) and `createSwapTransactionStep` / `createSwapTransactionAsyncStep`.
- `generateSwapTransactionSteps(txContext)` produces, for classic swaps: optional **revocation** (for tokens that require resetting allowance, e.g. USDT), **approval** (ERC20 approve to Permit2, or to the router for legacy), **permit2 signature** (EIP-712 typed data), **permit2 transaction** or direct **swap transaction**. For UniswapX: approval step, permit signature, `signOrder` step, then the order is posted (no on-chain swap tx by the user).
- `chainedActions.ts` runs the steps in sequence; each step is either a wallet transaction, a wallet call (EIP-5792), a user-op (smart wallet), or an async step (`createSwapTransactionAsyncStep` — backend-assisted).
- Tx store: `state/transactions` slice keeps `TransactionDetails` (hash, status, type, chain, nonce, addedTime, info). `TransactionDetails` modal store is zustand (`transactionDetailsModalStore.ts`). Sagas watch submitted txs.
- Receipt tracking: the saga/hook polls `eth_getTransactionReceipt` (via wagmi/viem client or the RPC provider) until confirmed / reverted; reverted txs surface error states.
- Toasts/popups: `state/popups` queue; `SwapFlowTimer` and analytics events mark the flow lifecycle.
- Cancel / speed-up flows exist in `features/transactions/cancel`.

### 1.7 Token lists and token data
- Token lists come from `@uniswap/default-token-list` and `@uniswap/token-lists` (Uniswap token-list JSON). Lists are managed in `state/lists` (active list ids, imported lists, unsupported tokens). Import of arbitrary tokens by address creates a "custom" token and shows a warning.
- Token metadata and prices: GraphQL Data API via Apollo (token page, explore tables) and the REST Data API client; live price updates via websocket / `livePrices` slice (**websocket details unverified**).

### 1.8 Explore, charts and pages
- Explore tables, token and pool detail pages use the Data API. Charts use `lightweight-charts` (price line/candles).
- Routes (react-router 7) cover `/swap`, `/limit`, `/send`, `/buy`, `/explore/*`, `/pools`, `/positions/*`, `/portfolio`, `/tokens/*`, `/vote`, `/nfts` etc. (route table not opened in full; `/limit` and `/send` are visible in the feature tree).

### 1.9 Settings, sessions, feature flags, analytics
- User settings in `state/user` (slippage, deadline, display currency, locale, theme, toggles). Persisted.
- `sessions/` and `shared-cloud/` for account-level sync (**unverified** details).
- Feature flags and experiments: `packages/gating` and `packages/experiments` via a flag provider with hooks (`useFeatureFlag`). Values come from the config service; `apps/web/src/featureFlags` holds local enums.
- Analytics events go through `@uniswap/analytics-events` (typed event names + payloads) and are sent via `@uniswap/analytics`.
- Error reporting: `reportFingerprintError` (web/native variants), Datadog redux enhancer and logger.

### 1.10 Build and test
- Vite SPA build, Nx affected tasks, Vitest unit tests (`vitest.config.ts`), Playwright e2e (`playwright.config.ts`, `apps/web/src/playwright`), Storybook (`apps/web/.storybook`), Chromatic visual tests, Cypress legacy (`apps/web/cypress`).

---

## Part 2: Recommended MetaSwap architecture

PLAN.md stack: Vite + React 18 + TypeScript, React Router, wagmi v2 + viem, TanStack Query, Zustand, Tailwind, Radix UI, lightweight-charts; `services/api` on Node 24 + Hono + viem + `node:sqlite`; `packages/sdk` shared; Anvil 31337.

Decisions where MetaSwap deliberately simplifies Uniswap:
- **No Redux, no redux-saga.** Use Zustand for client state (settings, transaction tracker, popups) and TanStack Query for all server/chain-derived data. Transaction tracking is a Zustand store with a small polling loop built on `wagmi`'s `waitForTransactionReceipt` (or viem `waitForTransactionReceipt`). This removes the saga/persist complexity PLAN does not require. Persist only settings and recent tx hashes in `localStorage` (try/catch wrapped).
- **No Apollo, no Trading API.** The backend `services/api` is the only quoter; `GET /quote` returns the calldata for UniversalRouter (PLAN contract). The web app never calls a third-party API.
- **No Privy / Firebase / Datadog / Sentry.** Use `console` plus an optional `services/api` logger.
- **Tamagui-free.** Tailwind + Radix primitives, matching the PLAN.

### 2.1 Mapping table

| Uniswap piece (interface) | MetaSwap replacement | Location |
|---|---|---|
| `apps/web` Vite SPA shell, `App.tsx`, router | Vite + React 18 + React Router app shell, route table exactly per PLAN "Web app — routes" | `apps/web/src/app/`, `apps/web/src/routes.tsx` |
| `packages/uniswap` shared product logic | `packages/sdk` (`@metaswap/sdk`): ABIs, addresses, chain config, token list, math (`getAmountOut/In`, price impact, tick↔price, sqrtPriceX96↔price, formatting), types | `packages/sdk/src/` |
| `packages/uniswap/src/data/apiClients/tradingApi` | `services/api` `GET /quote` and `POST /x/orders`; web uses a thin typed client generated from `packages/sdk` types | `services/api/src/routes/quote.ts`; `apps/web/src/api/client.ts` |
| `features/transactions/swap/utils/generateSwapTransactionSteps` + `chainedActions` | `apps/web/src/features/swap/steps.ts` — builds step list from the `/quote` response (`permit2.required`, allowance state): approve Permit2 → permit signature (optional) → swap tx; UniswapX path: sign order → POST `/x/orders` | `apps/web/src/features/swap/` |
| `features/transactions/steps/*` (approve, permit2Signature, permit2Transaction, wrap, revoke) | step modules with the same names: `approve.ts`, `permit2Signature.ts`, `permit2Transaction.ts`, `wrap.ts`; `revoke.ts` only for USDT-style tokens (optional) | `apps/web/src/features/steps/` |
| `state/transactions` (redux slice) + saga watchers | Zustand store `useTxStore` with `addTx`, `updateTx`, status enum `pending|confirmed|reverted|replaced|dropped`; receipt poller via TanStack Query `refetchInterval` (1 s, matching Anvil block time) | `apps/web/src/state/tx.ts` |
| `state/popups` (toasts) | Zustand `usePopups` + Radix Toast | `apps/web/src/components/Toasts.tsx` |
| `state/user` settings (slippage, deadline, theme) | Zustand `useSettings` persisted to `localStorage` (try/catch) | `apps/web/src/state/settings.ts` |
| `state/lists` + `@uniswap/default-token-list` | `GET /tokens` from API; the static list is `packages/sdk/src/tokens.ts` (Uniswap token-list schema, logo URIs `/tokens/<symbol>.svg`); custom import by address calls `GET /tokens/:address` | `packages/sdk/src/tokens.ts`, `apps/web/src/features/tokens/` |
| `wallets` / `connection` / `walletCapabilities` | wagmi v2 config: EIP-6963 injected connector (auto-discovered), WalletConnect (only if `VITE_WALLETCONNECT_PROJECT_ID`), Coinbase Wallet SDK, **Dev wallet** connector (Anvil #0–#4, chain 31337 only) | `apps/web/src/wallet/wagmi.ts`, `apps/web/src/wallet/DevWalletConnector.ts`, `apps/web/src/wallet/ConnectModal.tsx` (custom MetaSwap-styled modal) |
| `packages/chains` | `packages/sdk/src/chains.ts`: `metachainDevnet` (id 31337, "MetaChain Devnet", native ETH, RPC 8545), plus `metachainMainnet`/`metachainTestnet` with `status: "planned"`; Unichain entries (chain 130 / 1301) kept as reference metadata only | `packages/sdk/src/chains.ts` |
| Data API (GraphQL via Apollo) for explore/token/pool | `services/api` REST endpoints per PLAN (`/explore/*`, `/tokens/:address`, `/pools/:address`) consumed with TanStack Query | `apps/web/src/features/explore/`, `services/api/src/routes/explore.ts` |
| lightweight-charts price charts | `lightweight-charts` 4.x/5.x (same lib) with `/tokens/:address/candles` and `/price-history` | `apps/web/src/components/charts/PriceChart.tsx` |
| Pool/liquidity (`packages/uniswap/src/features/liquidity`, `v2-sdk`/`v3-sdk`) | `packages/sdk/src/math/v2.ts`, `v3.ts`; calldata via viem `encodeFunctionData` against V2Router02 and NonfungiblePositionManager ABIs | `apps/web/src/features/positions/` |
| Indexer (Uniswap Data API backend) | `services/api/src/indexer/` — polls logs from `deployments/31337.json` `blockNumber`, decodes Swap/Mint/Burn/Collect/Initialize (V2 + V3 events from `protocol.md` §1.7, §2.8) into `node:sqlite` tables | `services/api/src/indexer/` |
| Router (smart-order-router / Trading API) | `services/api/src/routing/` — enumerate V2 + V3 pools from factories' events, ≤3 hops, optional ≤3-way split, V2 quote via reserve math (`protocol.md` §1.2), V3 via `QuoterV2` `eth_call`; net-of-gas ranking; output `methodParameters` for UniversalRouter | `services/api/src/routing/` |
| UniswapX (`uniswapx-sdk`, Trading API order endpoints) | `services/api/src/x/` (order validation, storage, status, `/x/quote` decay math) + `packages/sdk/src/x/` (EIP-712 typed data builder for `ExclusiveDutchOrder` witness) | `services/api/src/x/`, `packages/sdk/src/x/` |
| Filler (UniswapX fillers / quoters) | `services/api/src/filler/` — polling bot that signs fills using Anvil account #9 and calls `ExclusiveDutchOrderReactor.execute` with `SwapRouter02Executor` | `services/api/src/filler/` |
| Analytics / gating / experiments | none in MetaSwap v1; feature flags as a static `packages/sdk/src/flags.ts` | |
| i18n | English only (strings in `apps/web/src/i18n/en.ts`); keep keys so i18n can be added later | |

### 2.2 Web data flow (recommended)
1. User edits the swap form → TanStack Query key `['quote', tokenIn, tokenOut, amount, type, slippageBps, recipient, deadline]` calls `GET /quote` with debounce 300 ms and `refetchInterval` ~ 1 block (1 s).
2. The quote drives the review modal: amounts, route string, price impact, `amountOutMin`, gas estimate.
3. Confirm → step engine (Zustand `useSwapFlow`) runs steps sequentially: each step returns `{ kind: 'tx' | 'sig' | 'x-order', status, hash?, signature? }`, updates `useTxStore`, and resumes after reloads from persisted state.
4. Balances and allowances via wagmi `readContract` / `multicall` (Multicall3 deployed in AMM set), cached in TanStack Query, invalidated on each new block the app sees.

### 2.3 API boundaries (must match PLAN)
- Web never signs with the API's keys; the API never holds user keys. Filler key is Anvil #9 only.
- All amounts on the wire are decimal strings in base units.
- The `/quote` response's `methodParameters` (`to`, `calldata`, `value`) is what the web sends via `sendTransaction`; the web must not re-encode routes itself.

### 2.4 Things to copy from Uniswap's design (decisions to keep)
- Step-based transaction model (approve / permit / swap as separate, individually tracked steps), so a failed approval does not hide a pending swap.
- Classic vs X (UniswapX) comparison in the review modal; show the lightning indicator only when X is better by the user's net outcome.
- Persist only what is needed for resumption; treat chain state as the source of truth on reload.
- Token-list model with a custom import path that warns when the token is not in the list.

### 2.5 Things deliberately not copied
- Multi-chain selection beyond chain 31337 (MetaChain roadmap page only).
- Embedded/Privy wallet, fiat on-ramp, NFTs, governance, unitags, Blockaid, Jupiter (Solana).
- Redux-persist migrations, saga-based flows, Apollo.

---

## Sources
- Repo and tree: https://github.com/Uniswap/interface (root listing via GitHub API; `apps/web/package.json`, `packages/uniswap/package.json`, `apps/web/src/state/index.ts`, `packages/uniswap/src/features/transactions/swap/utils/generateSwapTransactionSteps.ts`, `packages/uniswap/src/data/apiClients/tradingApi/`)
- Fetch-verified paths listed in §1.1-1.6 above; the `apps/web/src/state` and `packages/uniswap/src/features/transactions` directory listings were taken from the GitHub contents API at the same time.
- Uniswap UniswapX auction docs: https://developers.uniswap.org/llms.mdx/docs/liquidity/uniswapx/concepts/auction-types
