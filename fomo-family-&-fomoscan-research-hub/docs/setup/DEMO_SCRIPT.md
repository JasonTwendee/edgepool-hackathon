# Demo script — Edgepool/FOMO Fund (5 phút, đã rehearse trên local)

- Public (Tailscale Funnel, URL cố định): https://edgepool-dev.tailec308e.ts.net/
- LAN/server: http://100.110.155.108/ · local: http://localhost:3001 · BE: :3000
- Không cần ví crypto trên sân khấu: login bằng TK đã seed (tab **Tài khoản**).
- TK: `admin` / `$SEED_ADMIN_PASSWORD` (ADMIN) · `user` / `$SEED_USER_PASSWORD` (USER) ·
  `kol` / `$SEED_KOL_PASSWORD` (KOL). Đổi pass trước khi public.

## Phút 0–1 — Bối cảnh + terminal live

1. Mở FE: chỉ header brand Edgepool, leaderboard ví thật, chart PnL, ticker chạy.
2. Nói: "Track 10 smart-money Solana realtime — SSE live, không mock."
3. Điểm cần khoe: bell, bottom ticker (giá proxy BE), timeframe trên chart.

## Phút 1–2 — User view (login `user`)

1. Login tab Tài khoản → role USER. Chỉ còn: chart/swaps/positions-read/VaultCard read.
2. Nói: "User thấy PnL-first; nút Send/Copy/History/In-Out bị ẩn theo role —
   authz thật ở BE, FE chỉ ẩn UI."
3. Logout.

## Phút 2–3 — Copy-trade paper (login `admin`)

1. Tab bots (AdminPanel default) → engine: tick gần nhất đã bắn 2 lệnh CONFIRMED.
2. CopyHistory: 12 orders, có devnet signature finalized (E2E order #4).
3. Nói: "1-click paper trên devnet, lifecycle PENDING→CONFIRMED, gate/cap đầy đủ."

## Phút 3–4 — Vault + chia phí KOL (điểm mới nhất)

1. VaultCard: Share/HWM/Queued + block **PARTNER EARNINGS** (live: partner 0.30,
   treasury 0.10 sau epoch lãi — đúng công thức report §4: 80/15/5).
2. Nói: "Phí 20% trên lãi mới vượt đỉnh cũ. Trader đối tác ăn 15% profit —
   có sổ ghi nhận riêng, KOL nhìn thấy value của mình. Edgepool 5% về treasury."
3. Nếu hỏi sâu: mở `GET /api/vaults/1/earnings` (JSON totals + rows theo ví).

## Phút 4–5 — Admin/audit + chốt

1. AdminPanel tabs users/audit/vaults: set-role KOL live, audit append-only
   (gồm cả `auth.login_failed`).
2. Chốt: "Paper-only, sandbox. On-chain vault + cash-out earnings là phase sau."

## Fallback khi sân khấu không có mạng ví

- TK+MK login không cần Phantom. Devnet fire cần mạng — nếu rớt, dùng CopyHistory
  có sẵn (12 orders) + SSE reconnect tự động.
- Đừng `docker compose down -v` (mất volume DB). Đổi `.env` phải `up -d <service>`
  (restart không đọc lại env_file).
