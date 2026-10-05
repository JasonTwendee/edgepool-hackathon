# Launch runbook — NHÁNH PRODUCT (dòng tiền thật)

Phạm vi: mọi thứ chạm tiền user — vault, copy execution, fee, payout.
Đọc chung: `LAUNCH_RUNBOOK.md` (hub). Nhánh còn lại: `LAUNCH_RUNBOOK_ANALYST.md`.

## P0 — Web hardening (phần tiền)

- [ ] CORS lock theo domain prod (hiện mở toàn bộ) · `COOKIE_SECURE=1` + TLS
- [ ] CSRF + rate-limit login · backup Postgres + restore drill
- [ ] Pass: pentest cơ bản sạch, restore DB thành công 1 lần

## P1 — Custody (quan trọng nhất, làm trước mọi dòng tiền)

- [ ] Chốt mô hình: KMS/HSM hoặc multisig, tách cold/hot (Owner: Founder + Security)
- [ ] Xoay toàn bộ key devnet; key prod chưa từng chạm repo (`VAULT_PRIVATE_KEY`
  hiện là hot-key env — KHÔNG mang sang prod)
- [ ] Pass: key ceremony có biên bản + 2 người chứng kiến

## P2 — On-chain vault (chưa có code)

- [ ] Viết chương trình vault: deposit/mint/settle/withdraw theo
  `docs/architecture/VAULT_CONTRACT_DESIGN.md`
- [ ] Audit độc lập + fix findings (Owner: external auditor)
- [ ] Pass: audit clean (0 Critical/High) + testnet E2E full vòng đời

## P3 — Mainnet execution (code mới, giữ paper song song)

- [ ] Executor mainnet: Jupiter + Jito, retry/slippage thật (code hiện tại chặn
  cứng non-devnet bằng genesis-check — viết path mới)
- [ ] Kill-switch ngày 5%/tuần 15% đấu điện thật + cảnh báo (Owner: BE/Ops)
- [ ] Pass: 30 ngày shadow (log fire nhưng không tiền) khớp paper ±5%

## P4 — Mở tiền thật (giới hạn, có người trực)

- [ ] Closed beta whitelist, cap vault thấp, trần deposit/user (Owner: Product)
- [ ] Cash-out earnings: chốt rút từ NAV hay treasury → code payout ACCRUED→PAID
- [ ] Auto-fire giới hạn (1 vault, size nhỏ), loop có người trực
- [ ] Pass: 1 epoch lãi/lỗ xử lý đúng, fee 80/15/5 đối chiếu khớp sổ BE

## P5 — Mở rộng

- [ ] Nâng cap theo tuần, thêm vault/trader (giữ cap 5/vault)
- [ ] KOL onboarding + link user↔ví (earnings "của tôi" tự hiện)
- [ ] Pháp lý: điều khoản quỹ, KYC/KYT ngưỡng, giới hạn địa lý nếu cần

## Rollback (tiền)

- Kill-switch: dừng auto-fire + đóng settle window (giữ queue)
- Sự cố key: đóng deposit, rút hot→cold theo quy trình P1
- Mọi sự cố: audit + postmortem trong `docs/codexminimal/trackers/`
