# Demo script — Edgepool/FOMO Fund (5 phút, đã rehearse trên local)

- Public: URL reverse-proxy cố định do chủ hệ thống cấp (ghi trong `.env` deploy, không hard-code ở đây).
- LAN/server: URL nội bộ do chủ hệ thống cấp · local: http://localhost:3001 · BE: :3000
- Không cần ví crypto trên sân khấu: login bằng TK đã seed (tab **Tài khoản**).
- TK: `admin` / `$SEED_ADMIN_PASSWORD` (ADMIN) · `user` / `$SEED_USER_PASSWORD` (USER) ·
  `kol` / `$SEED_KOL_PASSWORD` (KOL). Pass thật chỉ nằm trong `backend/.env` trên server (không commit). Đổi pass trước khi public.

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

## P3 — Demo on-chain devnet (unlisted demo pool)

Chuẩn bị (ADMIN + devnet, làm trước giờ demo):
1. Đặt `CHAIN_KEEPER_KEY=<base58 keeper>` (backend/.env local). Keypair phải có devnet SOL
   (init buffer + tx fees). Không dùng keypair này cho mainnet.
2. Vào `/terminal` → tab **Demo** → **Create devnet demo pool** (hoặc ADMIN
   `POST /api/chain/demo-pool`). Flow tạo một pool `demo-chain-*` **unlisted** và
   initialize vault on-chain devnet; **từ chối** pool public 14/15.
   - Có thể bind pool demo có sẵn bằng `POST /api/chain/pools/:id/initialize`
     (chỉ chấp nhận `unlisted` + tên `demo-chain-*`).
3. Chạy E2E browser trước khi bật keeper/indexer:
   - mở `/pools/<demo-id>` → badge `ON-CHAIN DEVNET`;
   - deposit ≥ 0.5 SOL → ký ví → share mint vào ATA;
   - kiểm tra explorer/treasury/shares on-chain.
4. Sau E2E, bật toàn bộ chain loop cho demo:
   - `CHAIN_ENABLED=true` (chỉ pool demo đã bind; pool 14/15 vẫn không có `chainVault`);
   - restart backend; keeper tick 45s tự đẩy marks + settle; indexer mirror sự kiện.
5. FE withdraw → min_payout mặc định (= estimate − 0.5%) → SOL về ví ngay.

Lưu ý vận hành:
- Public devnet RPC (`api.devnet.solana.com`) rate-limit rất mạnh `getTransaction` (429).
  Indexer mirror có thể chậm/không chạy với RPC public; dùng **dedicated devnet RPC**
  trước khi demo cho khách. Deposit/withdraw trực tiếp trên browser không phụ thuộc indexer.
- Không bind pool 14/15; không bật `MAINNET_SWAP_ENABLED`; không dùng keypair mainnet.
- Nếu `CHAIN_ENABLED=false`, admin initialize/bind vẫn chạy được (setup path), nhưng
  faucet/keeper/indexer không chạy.
- Kiểm tra nhanh DB: `vaults.chain_vault`, `chain_events`, `vault_deposits.chain_sig`,
  `vault_withdrawals.chain_sig`.
