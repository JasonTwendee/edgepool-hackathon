# Tracker — FOMO Social Trading Terminal UI rebuild (DESIGN.md v2.0)

- Topic: fomo-terminal-ui-rebuild
- Started: 2026-09-30
- Spec: `docs/setup/DESIGN.md` (viewport-locked 5-block, tokens, blueprints 5.1–5.5)
- User confirms (2026-09-30):
  1. Data: real BE first, graceful mock/hide fallback (no fake PnL as real).
  2. Left: leaderboard = 10 real wallets + keep Add/Remove; Clans static demo grid.
  3. Right: Send/Copy UI-only; Copy wires to existing sim `POST /api/copy-trade/execute` + SIMULATION ONLY warning (no protected BE edits).
  4. Layout: full 5-block locked on desktop, stacked scroll on mobile; search filters local; ticker static + live status.

## Phases
- [x] P0 intake + confirmations (4 Qs answered)
- [x] P1 shell: `globals.css` tokens/scrollbar, `layout.tsx` bg/font, `page.tsx` 5-block
- [x] P2 modules: `FomoHeader` (search pill, /, Paste, dropdown), `FomoLeftSidebar` (tabs, clans demo, timeframe, your-rank real, leaderboard real, split toggles), `FomoRightPanel` (send UI-only, copy sim, positions empty-state), `FomoBottomTicker`
- [x] P3 center: `TraderProfile` reskin (profile pills real, top-trades carousel real, hero PnL + neon chart, positions real, thesis derived-real + like, swaps restyle)
- [x] P4 verify: FE `tsc` ✅, `next build` ✅, smoke `:3001/` 200 + BE ONLINE 10 wallets ✅ (2026-09-30)

## Follow-ups
- 2026-09-30 PM: removed Clans grid (`FomoLeftSidebar`); right column covered by
  single black veil (`bg-black/85`) + Preview toggle; preview mode sets content
  `inert` (view-only). FE `tsc` ✅, `next build` ✅, - 2026-09-30 PM2: removed timeframe filter (+share) from left sidebar; hero chart
  pills now 24H/7D/30D/ALL. Preview button shows coming-soon toast (2.6s),
  no peeking; right content permanently `inert`. FE `tsc` ✅, `next build` ✅,
  `:3001` restarted + smoke ✅.
- 2026-09-30 PM4 (Edgepool reskin): assets chính chủ vào `frontend/public/brand/`
  (horizontal-dark, symbol, favicon×2, avatar); tokens Nocturne
  (`#161826/#0D0F18/#232532/#3F424D`, Aqua `#49E6D7`, Violet `#9184D9`,
  Gain `#73DEA4`/Loss `#F28881`/Caution `#F0BE67`); font Inter Tight + Inter
  (JetBrains Mono giữ); nút primary chuyển outline-aqua, bỏ glow tím (misuse);
  chart line aqua + fill 16%→0 + dot, bỏ shadowBlur; logo SVG header, avatar
  edgepool, favicon + title edgepool. Layout + data thật giữ nguyên.
- 2026-09-30 PM5 (chuẩn 100% brand): `lucide-react` → `@phosphor-icons/react`
  (Regular; Bell/CaretDoubleLeft/Coins/Newspaper/Plus/Trophy/X/Check/Copy/
  ArrowSquareOut/ShareNetwork/Eye/Tray/LockSimple/Lightning/MagnifyingGlass),
  `lucide-react` uninstalled; avatar fallback → `#2B2741` + `#D2CEFD` Inter Tight;
  text/border xám-trắng → Nocturne (`#E9E9ED/#9397AB/#75798C/#595D6C/#3F424D`),
  skeleton `#2E313F/#2A2D3A`, radius 14/8; chart thêm horizontal gridlines.
  FE `tsc` ✅, build ✅, `:3001` 200 (logo/aqua/Inter Tight/Phosphor verified) ✅.
- 2026-09-30 PM7: phục hồi cột phải (Send + Your positions, veil + popup,
  Edgepool skin) + sidebar toggle Panel; ticker real-time qua CoinGecko public
  API (`hooks/useMarketTicker.ts`, poll 60s, fallback snapshot + tag `cached`
  khi stale). Slot thứ 4 Base → USDC (Base không có token). FE `tsc` ✅,
  build ✅, `:3001` 200, CoinGecko live ✅.
  `page.tsx` còn 4 block (header/left/center/ticker), center nới `max-w-7xl`,
  sidebar còn toggle Ticker; xóa file chết `FomoRightPanel.tsx` +
  `WalletSidebar.tsx`; error banner sang loss-tint; soát copy brand-voice
  (đã calm, không đổi chữ). FE `tsc` ✅, build ✅, `:3001` 200
  (right-panel markers absent) ✅.
- PnlChart stays canvas (perf + hover) but restyled neon `#00e676/#ff3b69` + glow to match spec visual (spec §5.3 SVG is illustrative).
- Thesis/bio/socials have no BE source → derived from real stats, never presented as on-chain truth.
- No edits to `backend/src/modules/copy-trade/**`, `.env`, `backend/src/config/*`.
