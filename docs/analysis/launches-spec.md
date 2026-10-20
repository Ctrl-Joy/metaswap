# Launches page: measured spec (REA + DevTools, app.uniswap.org/launches, 2026-10-21)

Sources:
- `screens/stage5/launches-rea-viewport.png` (REA `capture_web_screenshot`, light theme, 1859px wide)
- `screens/stage5/launches-user-dark.png` (the user's dark-theme screenshot)
- `launches-computed-styles.json` (computed styles read over CDP)

Uniswap's font is Basel at weight 485; MetaSwap uses its own font, so map 485 → 500 and 535 → 600.
Colours below are Uniswap's light-theme values. Use MetaSwap's matching tokens:
- surface-1: card/page;
- surface-2: `#f9f9f9` in light, a raised dark surface in dark;
- border: 0.8px at about 8% text colour;
- text-2: about 63% text colour.

## Page
- Content column: max-width **1200px**, padding **24px 40px 48px**. Sections are separated by
  **36px**. (The current MetaSwap page is narrower, about 1036px, and its gaps are uneven.)
- Section titles ("Trending launches", "All launches"): **18px/24px**, medium weight, primary
  text. They are **not** large headings. MetaSwap currently uses about 24–26px; reduce it.
  - "Trending launches" has an (i) info icon (16px, text-3) right after it, and a right-aligned
    **"View all"** link (14px semibold, text-2).
  - The title row sits 12–16px above its content.

## 1. "Launch and trade" banner
- Container: **radius 24px**, bg surface-1, **border 0.8px**, **padding 24px**, gap 16px, height ≈ 173px.
  - **Dot-grid background:** `radial-gradient(<dot colour> 1px, transparent 1px)` with about a
    16px tile, where the dot colour is about 5% of the text colour (`rgba(255,255,255,0.05)` in dark).
- Header row:
  - **Icon stack:** a 40px rounded-square app icon with a smaller 28px chain/launchpad icon
    overlapping its bottom-right. MetaSwap's version is the MetaSwap mark plus the rocket badge.
  - Title "Launch and trade": 18px/24px medium.
  - Subtitle: 16px/24px, text-2, e.g. "Trade new MetaChain tokens on" followed by an inline
    accent link "**Launchpads**" with a small icon. Uniswap uses its lime green; MetaSwap uses its
    accent.
  - **Right:** a 48px circular button with a white or near-white background and a dark → arrow,
    linking to /launches/create.
- **Ticker row** below the header: an endless auto-scroll of **pills**.
  - Pill: **height 42px, radius 9999px**, bg surface-2, **border 0.8px**, **padding 8px 12px**, gap 8px.
  - Pill contents:
    - token logo, 24px round, with an **11px launchpad badge** at the bottom-right;
    - name, 14px/18px medium;
    - ▲/▼ glyph plus %, 14px, green or red.
  - Both edges fade into the banner background. The ticker spans the full inner width.

## 2. Trending launches (horizontally scrolling cards, auto-running)
- Card: **271×150**, **radius 20px**, bg surface-2, **no border**, **padding 12px**, inner gap 16px.
  Cards sit **12px apart**, and the row scrolls with partially visible cards at both edges.
- **Coloured glow:** background-image
  `radial-gradient(90% 70% at 60% 118%, <token colour @ 12%> 0%, transparent 60%)`. The colour
  comes from the token logo's dominant colour; use a stable hash of the address or a
  per-token-logo colour.
- Top row:
  - **logo 48px** round, with a **16px launchpad badge** at the bottom-right of the logo (lime square
    with a leaf on Uniswap; the MetaSwap accent with a rocket glyph for us);
  - next to it, the name (18px/24px medium) with the symbol below (16px, text-2);
  - a **sparkline** of about 110×56 at the top-right, green or red, with no fill.
- Middle row: "**$1.2M** FDV" (value 16px/22px medium, primary; the word "FDV" text-2), then ▲/▼ % in green or red.
- Bottom row:
  - left: "$27.3K **24H volume**" (12px/16px; value primary, label text-2);
  - right: a **launchpad chip** (**height 34px, radius 12px**, bg surface-1, **border 0.8px**,
    **padding 6px 8px**, gap 6px; 20px launchpad icon plus name in 14px/18px medium).

## 3. All launches
- Filter chips: "All" (selected: surface-2 pill), "✦ Recently launched", "↗ Trending".
  - Each chip: **height 36px, radius 9999px, padding 8px 12px**, 14px semibold, with an icon.
    Unselected chips are text-2 with no background.
- Right side:
  - "All launchpads ⌄" dropdown button: **height 48px, radius 16px, border 0.8px**, 16px semibold;
  - a second dropdown showing the launchpad logo with a ⌄, which picks the launchpad/chain icon.
- Table:
  - **Header row:** height 42px, **radius 12px**, bg surface-2, no border; cells padded 12px,
    text **14px/18px medium, text-2**.
  - The sorted column ("↓ 24H volume") shows an arrow and primary colour.
  - Columns: # · Token · Launchpad · FDV · 24H volume · Liquidity · 1H · 1D · Age.
  - **Rows:** height ≈ 74px, cell padding **16px 12px**, text 16px/22px.
    - Token cell: 32px logo with a 12px launchpad badge, name (16px medium) over symbol (14px text-2).
    - Launchpad cell: 20px icon plus name.
    - % cells: ▲/▼ glyph plus value in green or red.
    - Age: "124d" / "3h", text-2.
  - The rows have no outer border box: the header is a filled rounded bar, and rows sit
    directly on the page.

## Data notes
- Every number comes from the live API (`/launches`, `/launches/trending`).
- On a fresh chain the page shows the empty states, but **the layout must already match**:
  - the banner ticker shows skeleton pills;
  - the trending row shows 4 skeleton cards;
  - the table shows skeleton rows, then the empty state.
