# Launch runbook — Edgepool/FOMO Fund (sandbox → mainnet)

Mục tiêu: lên production không mất tiền oan. Nguyên tắc: **cap nhỏ trước, mở dần,
mọi bước có tiêu chí pass + rollback**. Trạng thái hiện tại: paper/sandbox 100%.

## Phase 0 — Web hardening (không đụng tiền)

- [ ] CORS lock theo domain prod (hiện `enableCors()` mở toàn bộ) — Owner: BE
- [ ] `COOKIE_SECURE=1` + TLS (reverse proxy) — Owner: Infra
- [ ] CSRF token cho cookie-transport + rate-limit login — Owner: BE
- [ ] Backup Postgres (daily + restore drill) — Owner: Infra
- [ ] Pass: pentest cơ bản sạch, restore DB thành công 1 lần

## Phase 1 — Hạ tầng đọc (read-path prod)

- [ ] RPC tier trả phí có archive history (Flux archive hoặc giữ Helius) — Owner: Infra
- [ ] DataStream keyed tier (bật ATR tune thật, bỏ fallback) — Owner: BE
- [ ] Lantern prod cho holdings/prices, WS giữ RPC trực tiếp — Owner: Infra
- [ ] Pass: 7 ngày portfolio/history khớp, 0 ws errors, ATR tune kích hoạt thật

## Phase 2 — Custody (quan trọng nhất)

- [ ] Chốt mô hình: KMS/HSM hoặc multisig, tách cold/hot — Owner: Founder + Security
- [ ] Xoay toàn bộ key devnet, key prod chưa từng chạm repo (hiện `VAULT_PRIVATE_KEY`
  là hot-key env — KHÔNG mang sang prod) — Owner: Security
- [ ] Pass: key ceremony có biên bản + 2 người chứng kiến

## Phase 3 — On-chain vault (chưa có code)

- [ ] Viết chương trình vault: deposit/mint/settle/withdraw theo `VAULT_CONTRACT_DESIGN.md`
- [ ] Audit độc lập + fix findings — Owner: External auditor
- [ ] Pass: audit clean (không còn Critical/High), testnet E2E full vòng đời

## Phase 4 — Mainnet execution (code mới)

- [ ] Executor mainnet: Jupiter + Jito, retry/slippage thật (code hiện tại chặn
  cứng non-devnet — không sửa lắt, viết path mới, giữ paper song song)
- [ ] Kill-switch ngày 5%/tuần 15% đấu điện thật + cảnh báo — Owner: BE
- [ ] Pass: 30 ngày shadow (fire log nhưng không tiền) khớp paper ±5%

## Phase 5 — Mở tiền thật (giới hạn)

- [ ] Closed beta whitelist, cap vault thấp, deposit trần/user — Owner: Product
- [ ] Cash-out earnings: chốt rút từ NAV hay treasury rồi mới code payout — Owner: Product
- [ ] Auto-fire bật giới hạn (1 vault, size nhỏ), loop có người trực — Owner: Ops
- [ ] Pass: 1 epoch lãi/lỗ xử lý đúng, fee 80/15/5 đối chiếu khớp sổ BE

## Phase 6 — Mở rộng

- [ ] Nâng cap theo tuần, thêm vault/trader (cap 5/vault giữ nguyên)
- [ ] KOL onboarding + link user↔ví (earnings "của tôi" tự hiện)
- [ ] Pháp lý: điều khoản quỹ, KYC/KYT ngưỡng, giới hạn địa lý nếu cần

## Rollback / incident

- Kill-switch: dừng auto-fire + đóng settle window (giữ queue, không mất request)
- Sự cố key: đóng deposit, rút hot→cold theo quy trình Phase 2
- Sự cố RPC: fallback matrix (Flux→Helius→Lantern) + health status công khai
- Mọi sự cố: ghi audit + postmortem trong `docs/codexminimal/trackers/`
