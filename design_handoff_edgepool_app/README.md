# Handoff: Edgepool App (Pools, Pool detail, Portfolio, Trader portal)

## Overview
Edgepool is a non-custodial Solana copy-trading app. Users deposit SOL into **pools**; each pool copies a basket of ranked onchain traders under fixed risk rules and issues **shares** priced at NAV per share. Live trade signals are behind a paywall: they unlock when the user holds **≥ 0.5 SOL** in that pool. Partner traders sign in to a **Trader** portal to run their own pool.

## About the design files
Everything here is a **design reference built in HTML**: a working prototype showing the intended look and behavior, not production code. Recreate it in the team's **Next.js / React** codebase with your own patterns (routing, state, data fetching, wallet adapter). All data is sample data; all wallet, chain and API actions are simulated.

- `edgepool-app-offline.html`: **open this first.** Single self-contained file, works offline, fully clickable.
- `source/Edgepool App.dc.html`: the editable source. The `<script data-dc-script>` block at the bottom holds every sample value, state transition and formula; it's the best place to look up exact behavior.
> **Lưu ý (dọn HTML Oct 2026):** 2 file prototype `edgepool-app-offline.html` và
> `source/Edgepool App.dc.html` đã được gỡ khỏi repo để đỡ rối — nội dung đã gộp vào
> `../../01-edgepool-core-logic-spec.html` (core + spec), `../../02-edgepool-contract-test-tickets.html`
> (pool-math + test tickets) và `../../03-edgepool-ops-demo.html` (ops + demo).
> Logic sống (`nextjs/lib/pool-math.ts`, `types.ts`, `styles/tokens.css`, `assets/`) giữ nguyên.

- `nextjs/styles/tokens.css`: all colors, fonts, radii, shadows and layout values as CSS variables.
- `nextjs/lib/pool-math.ts`: business rules (shares, PnL, fees, withdrawals, slots, masking, strategy defaults) as pure TypeScript. Port as-is.
- `nextjs/lib/types.ts`: data shapes the UI expects.
- `assets/`: logo, symbol, favicon, background motif (SVG).

Prototype extras to ignore in production: the Tweaks props (`demoHoldings`, `slotsFull`, `startRoute`) exist only to demo states.

## Fidelity
**High fidelity.** Final colors, type, spacing, copy and interactions. Match pixel-for-pixel.

## Routes
| Route | Screen |
|---|---|
| `/` or `/pools` | Pools index |
| `/pools/[id]` | Pool detail. `?view=advanced` for Advanced (header toggle Calm / Advanced) |
| `/portfolio` | Portfolio |
| `/trader` | Partner sign-in → apply → application received; after sign-in, Partner dashboard |

Header nav: **Pools · Portfolio · Trader**. Footer link "Become a partner trader →" opens `/trader` on the Apply view.

## Global layout
- Page bg `#161826`. Content max-width **1240px**, side padding `clamp(16px,4vw,40px)`, top 28px.
- **Header**: sticky, 64px, `rgba(22,24,38,0.9)` + `backdrop-filter: blur(10px)`, bottom border `#2E313F`. Left: horizontal logo (26px tall; symbol only under 760px). Nav buttons 36px, 14px/500, active `#E9E9ED`, inactive `#9397AB`. Right: Calm/Advanced segmented control (pool page only) and wallet button (38px, 1px `#3F424D`, wallet icon green `#73DEA4` when connected, label `7xQ4…f3a` or "Connect wallet").
- **Mobile < 760px**: nav moves to a fixed bottom tab bar (68px, `rgba(26,28,42,0.96)`, icons 22px, label 11px, active `#49E6D7`). Add 96px bottom padding to main and footer.
- Two-column screens use `minmax(0,1fr) minmax(300px,360px)` on desktop and collapse to one column on mobile. Card grids use `repeat(auto-fit|auto-fill, minmax(min(100%,Npx),1fr))` and wrap naturally.
- **Footer**: 12px `#75798C`: "Sample data for prototype. Past performance does not indicate future results. Memecoin trading carries a high risk of loss." (Replace "Sample data…" in production.)

## Screens

### 1. Pools
- H1 "Pools" (Inter Tight 500, `clamp(30px,4vw,44px)`, -0.03em). Sub: "Each pool copies its own basket of ranked onchain traders under fixed risk rules. Signals unlock with a 0.5 SOL deposit."
- Period tabs **Day / Week / Month / All** (shared app-wide; default Week).
- Grid of pool cards (min 360px). Card: radius 18, padding 22, bg `#1D1F2C` + radial glow top-right (aqua `rgba(3,45,42,0.75)` for the featured Edgepool basket, violet `rgba(43,39,65,0.55)` for partner pools); edge `0 0 0 1px` (`#49E6D7` featured, `#2E313F` otherwise). Contents: status tag (mono 11px, `LIVE · FLAGSHIP` / `LIVE · PARTNER` / `PAUSED · PARTNER`), "You hold X SOL" badge if held, name (Inter Tight 24/500), kind line, stacked trader avatars (28px, -8px overlap, `#2B2741` bg, `#D2CEFD` initial) + "N traders · X% to signal trader", PnL % for the period (mono 24, green/red), NAV, sparkline (72px, stroke matches PnL color, 10% fill), **depositor slots meter**, CTA.
- CTA: featured = solid aqua "Open pool →"; partner = aqua outline; full pool (and user not a holder) = "Full · view pool", neutral outline.
- Unlisted partner pools are hidden here unless the user holds them.
- "Basket 02 · Coming soon" dashed card with a "Notify me" button that toggles to "You'll be notified".

### 2. Pool detail · Calm
Main column:
- "← All pools" link; amber banner when the owner paused the pool.
- Eyebrow `LIVE · …` aqua with a glowing dot, H1 pool name, description, rule chips: "2% cap per trader", "50% now + 50% limit at −10%", "Adaptive stop", "−5% daily kill switch".
- **PnL card**: period tabs, PnL SOL (mono `clamp(26px,3vw,34px)`) + %, NAV-per-share chart (120px), side stats: Pool NAV, NAV/share (aqua), Today, Since inception.
- **Open positions** (unrealized per position: token, trader · stage, %, SOL). Flat pool: "No open positions. This pool is flat, so withdrawals are instant."
- **Live signals**: pipeline step chips per signal (Detect / Qualify / Enter 50% / Limit −10% / TP / Stop / Skipped). Chip colors: done `#004B45`/`#BBF6EE`, waiting `#2E313F`/`#B2B6CA`, skipped/failed `#4A3B1C`/`#F7DDA9`, TP `#2B2741`/`#D2CEFD`, stop `#3A2226`/`#F7C1BC`.
- **Trader basket**: avatar, handle + X icon, ranks "24h · 7d · 30d", exposure %.

Side column (sticky, top 88px):
- **My position** (only if the user holds shares): `#032D2A` bg, value, PnL SOL + %, shares, deposited, Withdraw (copy depends on flat or queued).
- **Deposit panel**: Pool NAV, NAV/share, slots meter + sub-line, amount input (mono 20px) + "Min" (fills 0.50), "≈ N shares · ≈ $—", primary button, hint line, terms list (Cap per trader / Daily kill switch / Fee / Withdraw).

### 3. Pool detail · Advanced
- Title row: name, LIVE, slots chip, "Initial strategy settings under validation".
- **Deposit bar**: aqua-edged. Shows My position / My PnL / Shares / Withdraw if held; otherwise the lock prompt "Deposit 0.5 SOL or more". Inline amount + Deposit.
- **KPI tiles** (min 170px, each its own card): Pool NAV, NAV/share, PnL · period, Unrealized, Deployed % NAV, From HWM.
- Chart card (150px, 3 gridlines) and **Risk limits**: daily kill switch (−5%) and weekly loss limit (−15%) bars showing % of limit used; Signals · 24h; Emergency exits · 7d.
- **Positions table** (min-width 1000px, horizontal scroll on small screens). Columns `96 / 100 / 84 / 110 / minmax(240,1fr) / 104 / 130 / 86px`: Token, Trader, Size, Unrealized, **Price ladder**, Stop/floor, Stage, Time stop. Ladder: 2px track; stop tick red at the left; entry tick `#9397AB`; TP1 at +60%, TP2 at +100% (violet when hit, `#595D6C` when armed); dashed violet runner-floor marker once TP2 is hit (range extends to +300%); 12px current-price dot.
- **Exposure per trader** (bar = share of the 2% cap, amber at cap, PnL for the period) and a timestamped **Execution log**.

### 4. Portfolio
States: **not connected** (Connect wallet CTA), **connected, no deposits** ("0.00 SOL · No deposits yet" + Browse pools), **holding**.
- Total value (mono `clamp(30px,4vw,40px)`), "≈ $—" (USDC placeholder `#595D6C`), total PnL SOL + %, "Deposited X · Withdrawn Y", chart with **Value / PnL** toggle.
- **My pools** rows: name (clickable → pool), kind, value + ≈$—, cash-flow PnL + share-price %, status tag ("Flat · instant exit", "N open · queued exit", or "X SOL queued"), Detail (expands **both** PnL methods) and Withdraw.
- **Open positions across pools**: my exposure = position size × my share of the pool. Tokens are masked for pools where the user holds < 0.5 SOL, with a violet notice.
- **Pending withdrawals**, with a live countdown to the next checkpoint and Cancel.
- **Deposit and withdrawal history**: date, type, pool, tx, SOL, shares.

### 5. Withdraw modal
Centered, max 440px, scrim `rgba(13,15,24,0.72)` + blur 6px. Fields: pool, "X SOL available · Y queued", amount, 25% / 50% / Max, Shares burned, Est. SOL out, ≈ USDC $—. Mode line: **Instant** if the pool is flat, otherwise "Queued · N open positions. Settles at the next checkpoint in [countdown]". CTA "Withdraw now" or "Request withdrawal". Errors: empty amount, more than available.

### 6. Wallet modal
Options: Phantom (Detected), Solflare, Fomo wallet, Email (embedded wallet). Connected view: address + Disconnect. If the user clicked Deposit while disconnected, connecting **continues the deposit automatically**.

### 7. Trader portal (`/trader`)
- **Signed out**: split card. Brand panel (motif background, "Run your own copy pool.") and form panel.
  - **Sign in**: email + password, "Use the login your Edgepool contact sent you." Accounts are created manually by the Edgepool team, so there is **no self-sign-up**.
  - **Apply**: Fomo handle, X handle, trading wallet (≥ 32 chars), contact (email or Telegram) → "Application received".
- **Partner dashboard**:
  - Header: avatar, "@kestrel · payout wallet", Sign out.
  - **First login**: violet banner "Connect a payout wallet" (Phantom / Solflare).
  - **Fees**: Pending (from winning trades), Claimable (settled above HWM), Paid to date, Claim button (disabled until a payout wallet is connected), note "Auto-paid at each checkpoint, next in [live countdown]".
  - **My pool**:
    - Editable name, NAV line, and the fee line: "Traders in this pool earn **15%** (aqua) of their own profitable trades. Edgepool takes **5%** (violet)."
    - Public / Unlisted, Pause pool, View public page.
    - **Depositor slots**: meter plus a max stepper (±10). It can't go below the current number of depositors.
    - Max traders 3 / 4 / 5.
    - Traders table: status, signals 7d, profit made, fee earned 15%, Pause/Resume, Remove (with an **Undo** bar).
    - "Request a trader" (Fomo + X handle → pending until Edgepool creates the account).
  - **Pool rules · custom**: editable cap, entry %, limit offset, stop min/max, time stop, daily and weekly limits, then Save.
  - **Edgepool basket status**: "In basket", ranks, "You'd move out if you drop below #8 on 7d. Picked by algorithm; you earn **10%** of the profit your signals make here, Edgepool takes **10%**."
  - **My signals in my pool**: per-trade profit and fee.
  - **Payouts**: history list.
  - **Share card for X**: 600×315, download as PNG, copy pool link.
- Partner changes apply to the public pool page live: name, slots, pause, listing.

## Interactions and rules
See `nextjs/lib/pool-math.ts` for the authoritative logic. In short:
- **Deposit**: wallet required. Minimum 0.5 SOL. Blocked for new depositors when the pool is full; existing holders can still add. Shares minted = amount / NAV per share. A new holder takes one slot. Success toast "Deposited X SOL · N shares minted · signals unlocked".
- **Paywall per pool**: holding < 0.5 SOL shows tokens as `$••••`, traders as `Trader •`, and sizes and SOL values as `•••`. Percent PnL stays visible.
- **Withdrawals**: instant if the pool is flat. Otherwise queued: a queued request does not change value or shares until it settles, and cancelling just removes it.
- **Fees**: 20% of new profit above the NAV-per-share high-water mark, no management fee. Edgepool baskets: 10% to the trader whose signal made the profit + 10% Edgepool. Partner pools: 15% + 5%.
- **Slots meter colors**: aqua normally, amber when ≤ max(5, 10% of max) are left, red when full.
- **Countdown**: ticks every second to the next checkpoint (weekly in the prototype).
- **Toasts**: bottom-center, `#032D2A` bg, auto-hide after 2.8s.
- **Modals**: close on Esc and on a click outside the dialog.
- **Focus**: 2px aqua outline, 2px offset, on buttons, links and inputs.

## State
Global: `wallet {connected, kind, address}`, `period`, `viewMode (calm | advanced)`, `holdings[poolId]`, `pendingWithdrawals[]`, `history[]`, `toast`. Pool data comes from the backend (NAV, series, positions, signals, log, exposure, risk, slots). Partner: `session`, `payoutWallet`, `fees`, `pool settings`, `traders`, `requests`, `rules`.

## What needs real integration (simulated in the prototype)
- Solana wallet adapter (Phantom, Solflare, Fomo wallet, email embedded wallet).
- Pool program / vault contracts: deposit (mint shares), withdraw (burn), checkpoint settlement queue, HWM fee accrual and payout.
- Trader ranking + signals: FomoAPI / onchain trade detection; RugCheck qualification; execution routing.
- Partner auth: invite-only email + password accounts created by the Edgepool team; application intake; trader request review.
- USDC estimates: show `≈ $—` until a live SOL/USDC rate is wired in.
- Share card: render server-side or keep client-side PNG export.

## Design tokens
All tokens are in `nextjs/styles/tokens.css`. Key values:
- **Colors**: Midnight `#161826`, Surface `#1D1F2C`, Abyss `#0D0F18`, Cool White `#E9E9ED`, Edge Aqua `#49E6D7`, Signal Violet `#9184D9`, Amber `#F0BE67`, Positive `#73DEA4`, Negative `#F28881`.
- **Type**: Inter Tight 500 for headings (negative tracking −0.015 to −0.035em), Inter 400/500 for UI and body, JetBrains Mono for every number and SOL amount. Section labels are 11px uppercase with 0.08em tracking in `#75798C`.
- **Radii**: 6 / 8 / 10 / 14 / 16 / 18. Edges are drawn with `box-shadow: 0 0 0 1px #2E313F`, not borders.
- **Icons**: Phosphor (regular).

## Assets
`assets/edgepool-horizontal-dark.svg`, `edgepool-symbol-dark.svg`, `edgepool-favicon.svg`, `motif-flow.svg`: the official Edgepool brand files. Don't redraw them. Fonts come from Google Fonts: Inter, Inter Tight, JetBrains Mono.
