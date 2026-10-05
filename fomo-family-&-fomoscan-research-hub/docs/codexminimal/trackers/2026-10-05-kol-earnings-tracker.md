# Tracker — Collab/KOL earnings 80/15/5

- Topic: kol-earnings
- Intent: `docs/codexminimal/idsd/2026-10-05-kol-earnings-intent.md`
- Started: 2026-10-05

## Phases

- [x] K1 BE split (schema + migration + settle + policy feeBps + asserts): `done`
  (`PartnerPayout` + migration `20261005000000` + regen; `bookFeeSplit` 75/25,
  dust→treasury; `earnings()` + status `partnerAccruedSol`; policy += feeBps;
  `assert-partner.ts` 6 nhóm GREEN; treasury/vault/windows fakes += stubs)
- [x] K2 earnings endpoint + contract: `done`
  (`GET :id/earnings?trader=` public-read; openapi path + PartnerPayout/
  VaultEarnings schemas + policy feeBps; 41 paths YAML valid)
- [x] K3 FE VaultCard earnings: `done`
  (`getVaultEarnings` + PARTNER EARNINGS block read-visible cho KOL/non-ADMIN;
  `next build` ✅; container FE rebuild)
- [x] K4 typecheck + live E2E + review: `done`
  (root tsc ✅; 14/14 suites GREEN; live vault 12: fee 0.2 → 0.1125/0.0375/0.05,
  earnings + status khớp report; reviewer APPROVE)

## Review gate — APPROVE

Bảo toàn số học (assert + live); split hằng số theo report; policy ADMIN+audited;
earnings public-read nhất quán vault reads; không đụng copy-trade/config/.env.
Non-goals giữ nguyên (cash-out, link user↔ví, per-vault split).

## Handoff log

- 2026-10-05: intake xong (report §4 80/15/5; hằng số split; dust về treasury).
- 2026-10-05: K1–K4 đóng. BE+FE rebuild + E2E vault 12 khớp report VD.
