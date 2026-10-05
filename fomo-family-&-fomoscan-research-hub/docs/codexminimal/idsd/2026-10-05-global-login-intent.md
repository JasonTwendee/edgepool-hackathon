# Intent — Global login modal + all-English UI

- Date: 2026-10-05
- Stage: intent-bounded → execution (user: modal theo design mẫu, EN toàn project,
  giữ tk/mk, dưới thay bằng connect wallet)
- Parent: accounts + login-wall + report §4 (global product).

## 1. Intent contract

- **Modal** (`LoginModal`, dùng cho gate): card tối theo design — title, REGISTER
  toggle, Username + Email (register) + Password + Forgot?, nút Sign in trắng,
  divider OR SIGN IN WITH + nút Connect wallet (browser + manual nonce flow).
- **EN**: mọi chuỗi user-facing FE + BE messages + openapi sang tiếng Anh.
  Docs nội bộ (`docs/**`) giữ tiếng Việt. `copy-trade/**` (protected) CHƯA đụng.
- **Forgot?**: chưa có reset flow → inline notice, phase sau.
- **Non-goals**: Google/Github OAuth, password-reset BE, user↔wallet linking.
- **Acceptance**: tsc + build xanh, asserts GREEN, live login tk+mk + ví.

## 2. Decisions

- D-G1 giữ username (không ép email) vì identity hiện tại là username.
- D-G2 inline AuthPanel giữ nguyên cho khu fund-admin (tránh duplicate logic).
- D-G3 docs nội bộ giữ VI (dịch docs là việc riêng nếu cần).
