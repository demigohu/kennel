# Design System: Kennel

Reference: allancordero.site (extracted 2026-11-14 with Playwright: computed styles, font faces, colors, transitions).
Principles: Emil Kowalski design engineering (motion, feedback, invisible details) + stitch-design-taste (anti-slop rules).
Status: **v1.0**, decisions at the bottom.

## 1. Visual Theme & Atmosphere

A **terminal-brutalist kennel**. Near-black canvas with film grain, one mint-green accent, square corners, hairline rules
and monospaced uppercase labels everywhere. Imagery is **ASCII / dot-matrix art** rendered in the accent green: the
pups, coins and handlers look like they live inside a terminal. Every pixel is either data or a pup.

Two moods, one system:

| Surface | Density | Variance | Motion | Feel |
|---|---|---|---|---|
| Landing (`/`) | 3, gallery-airy | 7, offset/asymmetric | 6, fluid, scroll-driven | Portfolio-grade: one idea per screen, huge wordmark, an interactive ASCII pup |
| App (`/app`, coin, profile, leaderboard) | 8, cockpit-dense | 3, strict grid | 3, crisp and near-static | Trading terminal: tables, mono numbers, nothing moves unless data changes |

The landing sells the mechanic and the app does the trading. They share tokens, so moving between them feels like zooming into
the same machine.

## 2. Color Palette & Roles

One accent. Everything else is neutral with a slight warm cast, taken from the reference.

| Token | Hex | Role |
|---|---|---|
| `--ink` **Kennel Black** | `#0A0A0A` | Page canvas (never `#000`) |
| `--surface` **Graphite** | `#161616` | Panels, table header, inputs |
| `--surface-2` **Soot** | `#1E1E1C` | Hover row, pressed input |
| `--line` **Hairline** | `#3B3B38` | 1px rules, borders, dividers |
| `--ash` **Ash** | `#5C5C58` | Tertiary text, disabled, axis labels |
| `--fog` **Fog** | `#9B9B96` | Secondary text, metadata, mono labels |
| `--bone` **Bone** | `#F4F4F2` | Primary text on dark; canvas of inverted sections |
| `--leash` **Leash Green** | `#60CE8B` | The only accent: primary CTA, active row bar, focus ring, "up"/buy, live dots, ASCII art |
| `--leash-dim` | `rgba(96,206,139,.45)` | Accent borders, chart volume, selected outline |
| `--burn` **Burn** | `#E2584E` | **Semantic only** (never decorative): sell, down, burned tranche, bear bark, errors |

Rules:
- Green means **up / buy / unlocked / live / primary action**. Burn means **down / sell / burned / error**. Nothing else gets color.
- Inverted bands: a few sections (landing manifesto, footer) flip to `--bone` canvas with `--ink` text, like the reference footer.
- A full-bleed **Leash Green band** carries the giant wordmark (landing hero foot, app empty states).

## 3. Typography Rules

| Role | Font | Spec |
|---|---|---|
| **Mono / labels / numbers** | `Mono RGO Modular` if licensed, otherwise **Departure Mono** (OFL pixel mono) → fallback `Geist Mono` | Uppercase, 10–15px, tracking +0.08–0.12em. Every number, address, ticker, timestamp and button label |
| **UI / body** | **Instrument Sans** (Google Fonts) | 13–16px, weight 400/500, tracking -0.005em, line-height 1.45, max 65ch |
| **Display** | **Instrument Sans** 400 | `clamp(48px, 7vw, 96px)`, tracking -0.03em, line-height 0.95 |
| **Wordmark** | Instrument Sans 500, lowercase `kennel` + `®` superscript | `clamp(96px, 16vw, 240px)`, tracking -0.05em, on the green band |

- Hierarchy comes from **case + font family + color**, not from size jumps. A mono uppercase label in Fog over a Bone value is the
  base unit of every stat ("MARKET CAP / 44.56 NEAR").
- All numbers are mono with `font-variant-numeric: tabular-nums`.
- Banned: Inter, system-ui as a design choice, serif anywhere, bold-everything.

## 4. Imagery: ASCII & dot-matrix

The signature. Built on `<canvas>` (or pre-rendered `<pre>`), green on black (or ink on bone in inverted bands).

- **Running pup (landing, `app/runner.tsx`):** Eadweard Muybridge's *Dog Dread galloping* (Animal Locomotion, 1887,
  public domain, Wikimedia Commons), converted by `scripts/muybridge.cjs` into 7 ASCII density frames (120x59,
  `app/muybridge-dog.json`): blur to drop the plate grid, keep the largest bright component, align frames on the dog,
  shade cells from the photo. The reference's galloping horse is the same idea with Muybridge's horse.
  - Hero ("chase"): Leash Green pup gallops after the pointer and flips direction; a click drops an ASCII bone that falls
    to the ground, the pup runs to it and eats it (crumbs burst, "N bones eaten").
  - Footer ("gallop"): a large ink dog galloping in place on the bone band.
  - In both, glyphs within 110px of the pointer scatter and fade. Reduced motion draws one still frame.
- **Coin avatars:** each coin's icon is shown as a dot-matrix dither (16×16 cells) in Leash Green. Generated client-side from the
  coin image, or from the ticker when it has none. No raw emoji.
- **Profile portraits:** a deterministic dot-matrix identicon from the account id (pups get an ear/snout mask so they read as dogs).
- **Burns:** when a tranche burns, its glyphs scatter and fade in Burn (one-time, on first view).
- Mechanic diagrams (how it works) are ASCII too: boxes from `┌ ─ ┐ │`, with arrows `→`.

## 5. Component Stylings

- **Buttons:** square (radius 0), height 40px (min tap 44px on touch), mono uppercase 12–13px, tracking +0.1em.
  - Primary: Leash Green fill, Ink text (`LET'S TALK` style).
  - Secondary: 1px Hairline border, Bone text; hover border turns Leash.
  - Destructive (sell / revoke): 1px Burn border, Burn text.
  - Press: `transform: scale(0.97)` at 160ms ease-out. No glows, no gradients, no shadows.
- **Active row / selection = the green bar.** In any list (coins, leaderboard, holders, tabs on landing), the hovered or selected
  row becomes a full-width Leash Green bar with Ink text, exactly like the reference project index. Neighbors fade (opacity .55 → .3
  by distance) on the landing; in the app, only the hovered row changes.
- **Panels:** no cards with shadows. A panel = Graphite fill or just a 1px top rule + a mono uppercase caption (`01 / HOLDERS`).
  Numbered captions (`01 /`, `02 /`) as in the reference contact form.
- **Tables:** dense (row 36px), hairline row rules, mono numbers right-aligned, sticky header in Graphite, sortable headers with ↑↓.
- **Inputs:** Graphite fill, 1px Hairline, radius 0, mono value; focus = 1px Leash border (no glow). Label above in mono 10px Fog.
- **Tabs:** mono uppercase text tabs with a 1px Leash underline on the active tab (reference: SCHEDULE A CALL / WRITE A MESSAGE).
- **Badges:** mono 10px uppercase in square brackets: `[HOT]` `[LEASHED]` `[RHEA]` `[BULL 42M]` `[BURNED]`. Color only for semantic ones.
- **Live indicators:** a 6px Leash square (not a circle) blinking at 1s, next to live numbers (block height, UTC clock).
- **Loaders:** skeleton bars of hairline-outlined rectangles with a shimmer; ASCII spinner `|/-\` for inline waits. No round spinners.
- **Empty states:** a small ASCII pup + one mono line ("NO BARKS YET. A BULL BARK LOCKS THE FAMILY FOR 60+ MIN.").
- **Toasts:** bottom-left mono, square, slide up from `translateY(100%)`, 200ms ease-out.

## 6. Layout Principles

- 12-column grid, 28px outer gutter (reference), max-width 1680px for the app, full-bleed for the landing.
- App shell: slim top bar (wordmark left, search center, `+` and wallet right), a live ticker rail below it, content below.
  No left emoji sidebar.
- Board (`/app`): three columns (Coins / Callouts / Leaderboard) on ≥1280px, two on ≥900px, one below.
- Coin page: left rail callouts (300px) · center chart + tabs · right trade rail (360px), sticky.
- Profile: dot-matrix banner + identicon, portfolio, tabs; rails for top traders / top trades.
- Mobile < 768px: single column, trade rail becomes a bottom sheet with BUY / SELL buttons fixed at the bottom.
- `min-height: 100dvh` for landing screens, never `100vh`.

## 7. Motion & Interaction

Two tempos, matching the two moods.

- Tokens: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`; `--ease-in-out: cubic-bezier(0.76, 0, 0.24, 1)` (from the reference).
- **App:** hover/color 150ms ease, press 160ms ease-out, dropdowns 180ms ease-out from their trigger. No animation on keyboard
  actions (⌘K search opens instantly). New trades flash their row Leash at 20% for 600ms. Numbers tick without animation.
- **Library:** Motion (`motion/react`) inside `MotionConfig reducedMotion="user"`. Landing entrances follow better-ui:
  stagger 100ms, opacity + 4px blur + 12px rise, 300ms ease-out; detail swaps cross-fade 150ms with `AnimatePresence initial={false}`;
  sections reveal once in view. Buttons press to `scale(0.96)` over 150ms ease-out (never when disabled). Hover styles only
  under `@media (hover: hover)`.
- **Chart:** continuous time (empty intervals become flat candles), 9px bar spacing, 8 bars of right offset, scrolled to now,
  compact K/M price scale clamped at 0, volume tinted by candle direction, OHLC + volume legend, and trader bubbles
  (dot-matrix identicons, green border for buys and red for sells) pinned to each trade's time and price.
- **Landing:** scroll-driven sections (sticky stage + progress), green-bar index transitions on `max-width/padding` with
  `--ease-in-out` 500ms, ASCII reveal by rows (stagger 12ms per row), wordmark band slides up on load.
- Only `transform`, `opacity`, `clip-path` are animated. The grain is a fixed pseudo-element with a static noise PNG.
- `prefers-reduced-motion`: ASCII renders static, no scroll choreography, color/opacity transitions only.
- Hover effects gated behind `@media (hover: hover) and (pointer: fine)`.

## 8. Information Architecture (pump.fun parity)

| Route | Purpose |
|---|---|
| `/` | **Landing**: hero (ASCII pup + wordmark band), the leash in 4 rules (green-bar index), live stats, agent quickstart, inverted footer |
| `/app` | Board: Coins (trending / movers / new / market cap / graduated + timeframe), Callouts, Leaderboard |
| `/coin/[symbol]` | Header stats, chart (1m–D, price/mcap, markers), tabs (holders, callouts, trades, thread, leash, about), trade rail, stats windows, pool, creator, fees |
| `/u/[id]` | Profile: portfolio + chart, PnL, open / closed / replies / activity / launched, pup or handler panel |
| `/leaderboard` | Traders, earners, handlers (kennel score) |
| `/launch` | How a pup launches a coin (CLI + skill) |
| `/how` | The mechanics as ASCII diagrams + the simulation charts |

## 9. Copy voice

Short, literal, a little dry. Mono uppercase for labels and system lines; sentence case for explanations.
Dog vocabulary only where it carries meaning: pup, handler, leash, bark, trick, litter. No "unleash", "seamless", "next-gen",
"revolutionary". No exclamation marks.

## 10. Anti-patterns (banned)

- Emoji anywhere in the UI (replace 🐶🐂🐻🔥 with ASCII glyphs and bracket badges).
- Rounded "pill" buttons and soft cards with drop shadows.
- Gradients, glows, glassmorphism, purple/blue neon.
- Inter, serif fonts, more than one accent.
- Centered hero with a generic headline + two CTAs.
- "Scroll to explore" filler and bouncing chevrons (the reference uses them; we don't).
- Three equal feature cards in a row.
- Animating keyboard-triggered UI, `transition: all`, `scale(0)` entrances, `ease-in`.
- Fake round numbers; every number on the landing comes from the live contract or indexer.

## Decisions (2026-11-14)

- Mono: **Departure Mono** (OFL) self-hosted in `app/fonts/`, fallback Geist Mono.
- ASCII pup: generated procedurally (SVG dog silhouette sampled onto a glyph grid on canvas).
- Routes: `/` landing, `/app` board, `/coin/[symbol]` coin pages (`/litter/*` redirects), `/u/[id]` profiles.
- Burn red `#E2584E` approved, semantic only.
- Logo: lowercase `kennel®` wordmark in Instrument Sans.
