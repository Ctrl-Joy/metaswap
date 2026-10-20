# Design tokens: observed (app.uniswap.org) and MetaSwap proposal

Source of the observed values: computed styles and the live CSS custom properties on
`https://app.uniswap.org/swap` (516 root variables read via CDP), plus the app stylesheet
(`index-*.css`, `Landing-*.css`, `Tooltip-*.css`) and the media queries it contains. Values marked
"approx" were read from screenshots, not from computed styles.

We do not copy the Uniswap palette. Section 10 proposes a MetaSwap palette with the same roles.

---

## 1. Observed colour palette

### 1.1 Dark theme (the default under a dark system setting)
| Role token (Uniswap name) | Value | Use |
|---|---|---|
| page background (`body`, surface1) | `#131313` | Page, nav bar |
| surface2 | `#1F1F1F` | Buy panel, table header, sub-surfaces |
| surface2 hovered | `#242424` | Hover on surface2 |
| surface1 hovered | `#1A1A1A` | Hover on page-level cards |
| surface3 | `rgba(255,255,255,0.12)` | Tabs active pill, chips, disabled fill |
| surface3 hovered | `rgba(255,255,255,0.16)` | Hover on surface3 |
| surface3 solid | `#393939` | Opaque border/divider |
| surface4 | `rgba(255,255,255,0.20)` | Overlays on images |
| surface5 | `rgba(0,0,0,0.04)` | Subtle tint |
| border (observed 0.8px) | `#393939` and `rgba(255,255,255,0.12)` | Card and panel borders |
| neutral1 (primary text) | `#FFFFFF` | Titles, active tabs |
| neutral1 hovered | `rgba(255,255,255,0.85)` | Hover text |
| neutral2 (secondary text) | `rgba(255,255,255,0.65)` | Labels, inactive tabs |
| neutral3 (tertiary text) | `rgba(255,255,255,0.38)` | Placeholders, empty amount `0` |
| body text observed | `oklch(0.985 0 0)` (near white) | Default text |
| accent1 (brand / primary CTA fill) | `#FF37C7` | Primary buttons, Select token, logo |
| accent1 hovered | `#E500A5` | Primary hover |
| accent2 (tint) | `rgba(255,55,199,0.08)` | Pale brand background (Get started dim) |
| accent2 hovered | `rgba(255,55,199,0.12)` | |
| accent2 solid | `#261621` | Brand-tinted panel (CTA background when disabled) |
| success | `#21C95E` | Positive change, in-range |
| success hovered | `#15863C` | |
| success secondary | `rgba(33,201,94,0.12)` | Success pill background |
| warning | `#FFBF17` | Warnings, out-of-range |
| warning hovered | `#FFDD0D` | |
| warning secondary | `rgba(255,191,23,0.08)` | Warning banner background |
| critical (error) | `#FF593C` | Negative change, errors |
| critical hovered | `#FF401F` | |
| critical secondary | `rgba(255,89,60,0.12)` | Error banner background |
| scrim | `#00000099` | Modal backdrop (60%) |
| destructive foreground | `#F9F9F9` | Text on destructive fill |
| pools brand green | `#D0ED27` | Pools product accent (dark) |
| network accents | Arc `#6E8FF7`, Blast `#FCFC03` (dark) | Chain badges (we do not need these) |
| unicon palette (10) | `#FC74FE #FFF612 #FF4D00 #996F01 #21C95E #B1F13C #5CFE9D #3ADCFF #0047FF #9E62FF` | Generated avatar colours (dark) |

### 1.2 Light theme
| Role token | Value | Use |
|---|---|---|
| page background / surface1 | `#FFFFFF` | Page, cards |
| surface2 | `#F9F9F9` | Buy panel, table header |
| surface2 hovered | `#F2F2F2` | |
| surface1 hovered | `#FCFCFC` | |
| surface3 | `rgba(19,19,19,0.08)` | Chips, tab pill |
| surface3 hovered | `rgba(19,19,19,0.10)` | |
| surface3 solid | `#F2F2F2` | Opaque tint |
| surface4 | `rgba(255,255,255,0.64)` | Glass overlays |
| surface5 | `rgba(0,0,0,0.04)`, hover `rgba(0,0,0,0.06)` | |
| neutral1 (primary text) | `#131313` | |
| neutral1 hovered | `rgba(19,19,19,0.83)` | |
| neutral2 (secondary) | `rgba(19,19,19,0.63)` | |
| neutral3 (tertiary) | `rgba(19,19,19,0.35)` | |
| accent1 | `#FF37C7` | Same brand fill in both themes |
| accent1 hovered | `#E500A5` | |
| accent2 tint | `rgba(255,55,199,0.08)` | |
| accent2 solid | `#FFF3FC` | Pale brand fill (Get started in light) |
| success | `#0C8911` | Text-safe green on white |
| success hovered | `#06742C` | |
| success secondary | `rgba(15,194,68,0.06)` | |
| warning | `#996F01` | Text-safe amber |
| warning hovered | `#7A5801` | |
| warning secondary | `rgba(255,191,23,0.10)` | |
| critical | `#E10F0F` | |
| critical hovered | `#BF0D0D` | |
| critical secondary | `rgba(255,0,0,0.05)` | |
| scrim | `#00000099` | |

Light-vs-dark rule: the same token names. Light text colours are the dark-theme inverse; the accent
stays identical; success, warning and critical are darker in light for text contrast.

### 1.3 Tokens also exposed by the shadcn-style layer (unused by most screens)
`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border` (`oklch(92.2% 0 0)`),
`--ring` (`oklch(70.8% 0 0)`), `--chart-1..5` (warm/teal chart palette). These are library defaults
and can be dropped in MetaSwap.

---

## 2. Typography

### 2.1 Families
- Primary: **Basel Grotesk** (self-hosted woff2: Book and Medium), fallback `sans-serif`.
  Observed weights: book `485`, medium `535`, semibold `600`, bold `700`.
- Generic: `ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji, ...`.
- Mono: **InputMono** (amount inputs), fallback `monospace`.
- Do not reuse Basel. MetaSwap proposal: Inter (or Geist) with the same weight roles (see section 10.4).

### 2.2 Scale (rem = 16px)
| Token | Size | Line height | Weight | Letter-spacing | Use |
|---|---|---|---|---|---|
| text-xs | 12px | 16px | 485 | 0 | Body-4, captions |
| text-sm | 14px | 18px | 485 | 0 | Body-3, labels |
| text-base | 16px | 22px | 485 | 0 | Body-2, nav links (medium 535) |
| text-lg | 18px | 24px | 485 | 0 | Body-1, button-1 |
| text-xl | 20px | 28px | 485 | 0 | Modal titles |
| text-2xl | 24px | 32px | 485 | 0 | Heading-3 (24/28) |
| text-3xl | 30px | 36px | 485 | 0 | |
| text-4xl | 36px | 40px | 485 | -0.01em | Heading-2 (36/40); swap amount |
| text-5xl | 48px | 48px | 485 | -0.02em | |
| heading-1 | 52px | 50px | 485 | -0.02em | Token price header |

Named roles observed in the CSS (`--text-*`):
| Role | Size / line-height | Weight |
|---|---|---|
| heading-1 | 52 / 50 | 485 |
| heading-2 | 36 / 40 | 485 |
| heading-3 | 24 / 28 | 485 |
| subheading-1 | 18 / 24 | 485 |
| subheading-2 | 16 / 24 | 485 |
| body-1 | 18 / 24 | 485 |
| body-2 | 16 / 22 | 485 |
| body-3 | 14 / 18 | 485 |
| body-4 | 12 / 16 | 485 |
| button-1 | 18 / 24 | 535 |
| button-2 | 16 / 24 | 535 |
| button-3 | 14 / 20 | 535 |
| button-4 | 12 / 16 | 535 |

Computed-style census on the swap page (text elements): 16px x139, 12px x11, 18px x7, 14px x7,
36px x2. Line heights 24px dominant. Weight 485 dominant (148), 535 for buttons (17).

### 2.3 Tracking
- `tracking-tight` -0.025em; `tracking-widest` 0.1em (uppercase labels). Heading tracking as above.

---

## 3. Radii
Observed tokens: `none 0`, `4`, `6`, `8`, `12`, `16`, `20`, `24`, `28`, `full 999999px`
(pill buttons, chips, tabs). Observed in the DOM (count): 999999px x31 (pills), 12px x17
(inner tiles and rows), 20px x10 (cards and panels, modals), 8px x6 (inputs and small controls),
16px x3, 24px x2 (swap card), 28px x1. Legacy `--radius` = `0.625rem` (10px) is unused by screens.

## 4. Spacing
- Base unit `--spacing: 0.25rem` (4px). Scale is multiples: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64.
- Observed gaps (computed): 2px x2, 4px x17, 6px x2, 8px x9, 12px x8, 16px x6.
- Container: `--container-lg: 32rem` (512px). Swap card about 478px (inside a 512px container).
- Page side gutter: 16px at phone widths; about 24px at 768-1023; 32px+ desktop [approx].
- Top bar: 64px tall with 12px horizontal padding on the logo edge at desktop, 16px at phone.

## 5. Shadows and elevation
| Token | Value |
|---|---|
| shadow-short | `0 1px 6px 2px #00000008, 0 1px 2px 0 #00000005` |
| shadow-medium | `0 6px 12px -3px #1313130A, 0 2px 5px -2px #13131308` |
| shadow-large | `0 10px 20px -5px #1313130D, 0 4px 12px -3px #1313130A` |
| shadow-color | `#00000026` (hover `#0003`) |
Observed on-screen: the swap flip button uses a small shadow and a 1px border; modals use a larger
shadow over the scrim. In dark mode shadows are nearly invisible, so separate surfaces with the
surface tokens and borders instead.

## 6. Z-index layers
| Token | Value | Use |
|---|---|---|
| z-default | 1 | Normal stacking |
| z-header | 980 | Top nav bar |
| z-sticky | 1020 | Sticky sub-headers, table headers |
| (implied) z-popover | ~1100 | Settings, menus [approx] |
| (implied) z-modal / scrim | ~1200 / 1190 | Dialogs, drawers, toasts |
MetaSwap: keep these ordering rules and add explicit toast (1300) and tooltip (1400) layers.

## 7. Breakpoints (from media queries in the stylesheet)
- Min-width queries: `360px`, `380px`, `396px`, `450px`, `640px`, `768px`, `850px`, `1024px`,
  `1050px`, `1280px`, `1536px`, `96rem` (1536px).
- Max-width queries: `360`, `380`, `450`, `640`, `768`, `864`, `1024`, `1280`, `1536`.
- Heights: `height <= 736px`, `800px`, `960px` (short-viewport rules for swap card and modals).
- Hover: `(hover: hover)` gates hover-only affordances. Forced-colors media is supported.
- MetaSwap proposal: `sm 400`, `md 640`, `tablet 768`, `lg 1024`, `xl 1280`, `2xl 1536`, plus the
  `height <= 800` short-viewport rule for the swap card.

## 8. Icons
- Observed sizes (approx from screenshots and inventory): nav search and more icons 20px inside 40px
  buttons; settings gear and trend icon 20px in 32px hit areas; flip arrow 20px in a 48px circle;
  token chevrons 16px; help "?" bubble about 20px; token logos 36px (dropdown) and 24-28px (chips).
- Stroke icons, 1.5px-2px stroke, rounded caps. Monochrome, using `currentColor`.
- MetaSwap: use one line-icon set (Lucide or Phosphor, MIT/ISC), sizes 16/20/24, stroke 1.75. Do not
  copy Uniswap icons.

## 9. Motion
- Default transition: `150ms cubic-bezier(.4, 0, .2, 1)`.
- Ease tokens: `ease-in cubic-bezier(.4,0,1,1)`, `ease-out cubic-bezier(0,0,.2,1)`,
  `ease-in-out cubic-bezier(.4,0,.2,1)`.
- Sheets: enter `350ms cubic-bezier(.4,0,.2,1)`, exit `250ms` (both directions, left and right).
- Popovers/tooltips: enter `200ms ease-out` (fade/scale), exit `200ms forwards`.
- Accordion: `170ms cubic-bezier(.25,.46,.45,.94)`.
- Pager: `120ms cubic-bezier(.17,.67,.45,1)` backwards/forwards.
- Spin: `1s linear infinite`. Refresh spin: `1s cubic-bezier(.83,0,.17,1)`.
- Respect `prefers-reduced-motion`: drop transforms and keep opacity-only fades.

---

## 10. MetaSwap proposed palette (same roles, different brand)

Brand direction: a deep indigo/violet accent instead of magenta, a cooler neutral grey base, and a
different typeface. The role names match the Uniswap tokens above, so the frontend can map 1:1.
Contrast ratios below were computed (WCAG 2.1). Every text token meets 4.5:1 on its surface except
--ms-text-3, which is limited to placeholders and non-essential hints (about 3.9:1).

### 10.1 Dark (default)
| MetaSwap token | Proposed value | Maps to | Notes |
|---|---|---|---|
| --ms-bg | `#0B0C10` | page background | |
| --ms-surface-1 | `#13141A` | surface1 | Cards, nav |
| --ms-surface-2 | `#1A1C24` | surface2 | Buy panel, table header |
| --ms-surface-2-hover | `#20232D` | surface2 hovered | |
| --ms-surface-3 | `#FFFFFF1F` | surface3 | Chips, tab pill (12% white) |
| --ms-surface-3-solid | `#2A2D38` | surface3 solid | Opaque divider fill |
| --ms-border | `#2A2D38` | border | 1px, use for all panels |
| --ms-text-1 | `#F2F4F8` | neutral1 | Primary text (about 16.7:1 on surface) |
| --ms-text-2 | `#A4AAB9` | neutral2 | Secondary (about 7.9:1) |
| --ms-text-3 | `#6E7486` | neutral3 | Placeholders and hints only (about 3.9:1); never for essential text |
| --ms-accent | `#8B8CFF` | accent1 (text/links on dark) | Lighter indigo for text on dark (6.4:1 on surface1) |
| --ms-accent-fill | `#5B5BF0` | accent1 (button fill) | White text on fill: 5.0:1 |
| --ms-accent-hover | `#7A7BFF` | accent1 hovered (dark) | |
| --ms-accent-tint | `#5B5BF01F` | accent2 | Pale brand tint (12%) |
| --ms-accent-solid | `#1C1B33` | accent2 solid | Tinted panel |
| --ms-success | `#3DDC84` | success | Text on dark about 11:1 |
| --ms-success-tint | `#3DDC8420` | success secondary | |
| --ms-warning | `#FFC53D` | warning | |
| --ms-warning-tint | `#FFC53D1F` | warning secondary | |
| --ms-critical | `#FF6B6B` | critical | |
| --ms-critical-tint | `#FF6B6B26` | critical secondary | |
| --ms-scrim | `#05060AB3` | scrim (70%) | |
| --ms-focus | `#A5A6FF` | focus ring | 2px outline with 2px offset |

### 10.2 Light
| MetaSwap token | Proposed value | Notes |
|---|---|---|
| --ms-bg | `#F5F6FA` | page background |
| --ms-surface-1 | `#FFFFFF` | cards, nav |
| --ms-surface-2 | `#F0F1F7` | panels, table header |
| --ms-surface-2-hover | `#E8EAF3` | |
| --ms-surface-3 | `rgba(14,16,32,0.08)` | chips, tab pill |
| --ms-surface-3-solid | `#E4E6F0` | |
| --ms-border | `#DCDFEA` | |
| --ms-text-1 | `#0E1020` | |
| --ms-text-2 | `#525869` | about 7.1:1 on white |
| --ms-text-3 | `#7C8294` | about 3.8:1, placeholders and hints only |
| --ms-accent-fill | `#5B5BF0` | same button fill (white text about 5.0:1) |
| --ms-accent | `#4747D6` | text/links on light (about 6.4:1) |
| --ms-accent-hover | `#4343C9` | |
| --ms-accent-tint | `#5B5BF01F` | |
| --ms-accent-solid | `#ECECFF` | tinted panel |
| --ms-success | `#15803D` | |
| --ms-warning | `#8A5A00` | |
| --ms-critical | `#C81E1E` | |
| --ms-scrim | `#0E102066` | 40% |

### 10.3 Usage rules (for the frontend)
- Primary CTA: `--ms-accent-fill` background, white text, radius full on the swap page (pill), 12px
  radius elsewhere. Disabled: `--ms-surface-3` background with `--ms-text-3` text.
- Tabs: active = `--ms-surface-3` pill with `--ms-text-1`; inactive = `--ms-text-2`.
- Percent change: success / critical per the signed value. Neutral zero uses `--ms-text-2`.
- Price impact: neutral under 1%, warning 1 to 5%, critical above 5% (needs confirm).
- Never put `--ms-accent` on `--ms-surface-*` for body copy in light mode without checking contrast;
  use `--ms-accent` for links and icons only.

### 10.4 Typography (MetaSwap)
- Family: **Inter** (variable, OFL) for UI; **JetBrains Mono** (OFL) for amounts and addresses.
  Both are open and not Uniswap assets. Weights 400, 500, 600.
- Sizes: keep the same scale as section 2.2 but use weights 400 (body), 500 (medium), 600 (buttons
  and headings). Heading-1 52/52 with -0.02em tracking.

### 10.5 Shape, spacing, motion (MetaSwap)
- Radii: 4, 8, 12, 16, 20, 24, full (pill). Swap card 20px. Inputs 12px. Chips and tabs full.
- Spacing: 4px base, same multiples as section 4.
- Shadows: `0 1px 2px #0B0C1040` (short), `0 8px 24px -8px #0B0C1066` (medium), `0 20px 48px -12px #0B0C1080`
  (large). Dark mode relies on borders and surface steps.
- Motion: same durations as section 9. Easing `cubic-bezier(.2,.7,.2,1)` for enter, standard
  `cubic-bezier(.4,0,.2,1)` for the rest. Reduce motion by default in tests.
- Z-layers: header 980, sticky 1020, popover 1100, modal 1200, toast 1300, tooltip 1400.

### 10.6 Logo and brand (for design, not tokens)
- Describe only. Proposed: a geometric mark built from two overlapping rounded squares (swap
  metaphor) in `--ms-accent-fill`, wordmark "MetaSwap" in Inter 600. Design original artwork.

---

## 11. Gaps to fill when implementing
- Exact swap card padding and internal gaps were not captured from computed styles on the signed-out
  page (values above are from the spacing census). Measure again on the funded devnet build.
- Modal, toast and drawer sizes are from screenshots (approx), not from computed styles.
- Focus ring and hover values for inputs were not observable (no focused input in the captures).
