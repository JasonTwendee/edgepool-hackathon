# Lộ trình lên production (sandbox → tiền thật)

> Nguyên tắc chung: **cap nhỏ trước, mở dần, mọi bước có tiêu chí pass + rollback**.
> Trạng thái hiện tại: off-chain paper hoàn chỉnh; vault program on-chain đang
> triển khai devnet (thiết kế tại `docs/architecture/VAULT_CONTRACT_DESIGN.md`).

## Nhánh Product (dòng tiền thật) — gates bắt buộc, giữ nguyên khi chốt

Phạm vi: mọi thứ chạm tiền user — vault, copy execution, fee, payout.

- [ ] **P0 — Web hardening:** CORS lock theo domain prod · `COOKIE_SECURE=1` + TLS ·
  CSRF + rate-limit login · backup Postgres + restore drill thành công 1 lần.
- [ ] **P1 — Custody (làm trước mọi dòng tiền):** chốt mô hình KMS/HSM hoặc multisig,
  tách cold/hot; xoay toàn bộ key devnet; key prod chưa từng chạm repo.
- [ ] **P2 — On-chain vault:** deposit/mint/settle/withdraw theo design doc +
  audit độc lập sạch (0 Critical/High) + testnet E2E full vòng đời.
- [ ] **P3 — Mainnet execution:** executor mainnet (Jupiter + Jito, retry/slippage thật),
  code hiện tại chặn cứng non-devnet — viết path mới; kill-switch ngày 5%/tuần 15%;
  30 ngày shadow khớp paper ±5%.
- [ ] **P4 — Mở tiền thật (giới hạn, có người trực):** closed beta whitelist, cap vault
  thấp, trần deposit/user; cash-out earnings đối chiếu khớp sổ (fee 80/15/5);
  auto-fire giới hạn 1 vault size nhỏ.
- [ ] **P5 — Mở rộng:** nâng cap theo tuần, thêm vault/trader (giữ cap 5/vault),
  KOL onboarding, pháp lý (điều khoản quỹ, KYC/KYT ngưỡng).

Rollback (tiền): kill-switch dừng auto-fire + đóng settle window (giữ queue);
sự cố key: đóng deposit, rút hot→cold; mọi sự cố: audit + postmortem.

## Nhánh Analyst (không cần tiền thật vẫn có value)

- [ ] **A0 — Nền dữ liệu prod-grade:** RPC archive tier, keyed price tier,
  retention policy cho realtime_events/transactions.
- [ ] **A1 — Chất lượng tín hiệu:** ATR đa khung, shadow-validator mọi signal,
  manipulation flags + wallet-cluster, ranking risk-adjusted (không brand copyable-score).
- [ ] **A2 — UX + API ngoài:** watchlist, alert theo ví, API key + quota.
- [ ] **A3 — Vận hành rẻ:** cache/bulk-first, status page công khai, p95 API < 500ms.

Hai nhánh dùng chung: auth/roles, audit append-only, FE shell, policy engine.
Mọi thứ chạm tiền thuộc nhánh Product.
