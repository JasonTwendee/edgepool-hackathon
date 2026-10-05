# Intent — Per-order ladder config

- Date: 2026-10-02
- Stage: intent-bounded → execution (user duyệt per-order config paper-only 2026-10-02)
- Parent: ladder intent (constants → per-order).

## 1. Intent contract

- **Intent**: mỗi paper order mang cấu hình ladder riêng (TP1 share / trail % /
  TP2 mult), engine đọc theo order, thiếu → constants cũ.
- **Business rules**:
  - `tp1ShareBps` 1..10000 (default 5000 = 50%); `trailPct` 1..100 (default 20);
    `tp2MultPct` 101..1000 (default 200 = 2×). Nullable trong DB = chưa set.
  - DTO optional, validate ranges ở controller (service tin DTO như các field cũ).
  - Engine fallback: `orderField ?? CONSTANT` — orders cũ behavior y nguyên.
- **Non-goals**: per-order time-stop, UI config (shape có sẵn cho FE sau), đổi defaults.
- **Acceptance**: persist đúng + engine dùng đúng (TP1 25% / trail 10 / TP2 150%
  trong asserts); orders cũ fallback constants; live order mang config.
- **Constraints**: chỉ `copy-trade/*` + migration; paper-only; tsx-safe.

## 2. Decisions

- D-C1 Int-nullable thay vì Decimal (bps int sạch, không float; null = default).
- D-C2 ranges chặn 0 (share/trail 0 = vô nghĩa; TP2 ≤100% = dưới TP1).

## 3. Bounded spec

1. Prisma: `CopyOrder += tp1ShareBps Int?, trailPct Int?, tp2MultPct Int?` + migration.
2. DTO `ExecuteCopyDto` += 3 optional fields + ranges.
3. `executePaper` create += 3 fields; `toOrderShape` += 3 fields (history).
4. `manage.service` đọc per-order (fallback constants).
5. Asserts: persist (paper-executor +1 case) + engine dùng config (manage +3 cases).
6. openapi execute body (nếu mô tả fields) + live smoke order có config.

## 4. Test/agents/risks

Primary generic; gate reviewer. Rủi ro: orders cũ null → fallback (test ../../../legacy).
