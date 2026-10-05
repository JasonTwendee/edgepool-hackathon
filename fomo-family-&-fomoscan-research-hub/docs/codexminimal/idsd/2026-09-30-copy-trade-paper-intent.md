# Intent — Copy-trade paper (devnet, 1-click, full DB+UI)

- Date: 2026-09-30
- Stage: intent-bounded → handoff `repo-phase-orchestrator`
- User approvals (2026-09-30, explicit):
  1. Protected ✅ — may edit `backend/src/modules/copy-trade/**`, set
     `VAULT_PRIVATE_KEY` local-only (never commit/log).
  2. Mode: **devnet paper-trade** (no mainnet funds, ever).
  3. Trigger: **1-click confirm** per signal.
  4. Storage+UI: **full** — Prisma model + history API + FE panel.

## 1. Intent contract

- **Intent**: cho phép user bấm Follow một ví → khi có tín hiệu mới, mở modal
  xác nhận (symbol/action/amountUsd/venue từ `copySignal`) → Confirm bắn lệnh
  paper trên **Solana devnet** → lưu DB → hiện lịch sử trên FE.
- **Business rules**:
  - Chỉ devnet. Service từ chối mọi connection không phải devnet (check genesis).
  - Mỗi lệnh cần `confirm: true`显式 + `mode: 'paper'`; thiếu → 400.
  - Paper notional cap $100/lệnh (config).
  - Vault keypair chỉ từ `backend/.env` local; không log key/signature đầy đủ
    vào console (log prefix 8 ký tự).
  - Error envelope `{success:false,message}` giữ nguyên mọi 4xx/5xx.
- **Non-goals**: mainnet execution, auto-mirror, Jito bundle thật, DEX swap thật
  trên devnet, sizing/vault PDA, auth/multi-user.
- **Acceptance (observable)**:
  - `POST /api/copy-trade/execute` với confirm → `CONFIRMED` + devnet signature
    verify được qua `getSignatureStatus` (lettuce: BE tự verify).
  - Row mới trong `copy_orders` + `GET /api/copy-trade/history` trả về.
  - FE: modal xác nhận → toast/link devnet → history list hiện lệnh mới.
  - Veil/popup "Coming soon" cột phải được gỡ (panel live).
  - `tsc` BE+FE ✅, `next build` ✅, smoke envelopes 400/404 cũ vẫn xanh.

## 2. Architecture decisions (ADR-style)

- **D1 — Paper execution = quote(mainnet, read-only) + proof(devnet)**.
  Jupiter quote-only cho route/slippage math thật (không ký); proof là dust
  transfer SOL devnet (ký + broadcast + confirm thật). Lý do: Jupiter swap API
  không hỗ trợ devnet; DEX devnet thiếu thanh khoản. Token-swap devnet thật là
  follow-up, không thuộc build này.
- **D2 — Module-owned devnet connection**. Copy module tự tạo `Connection`
  devnet riêng (không đụng singleton mainnet listener, không sửa `config/*`
  quá mức cần thiết — xem D5).
- **D3 — Lifecycle trong DB**: `PENDING → QUATED → SENT → CONFIRMED | FAILED`
  (`FAILED` lưu error message, không bao giờ throw raw).
- **D4 — FE confirm modal là gate duy nhất**. Không auto-fire; nút Copy cũ sau
  veil gọi modal thay vì bắn thẳng.
- **D5 — Mở rộng `configuration.ts` tối thiểu** (thêm `COPY_TRADE_PAPER_ENABLED`,
  `COPY_TRADE_MAX_USD`, `DEVNET_RPC_URL`). File này critical-protected; coi như
  thuộc phạm vi duyệt đã cho (vault wiring) — user có thể veto, fallback là đọc
  env cục bộ trong module.
- **D6 — Contract-first**: `openapi.yaml` cập nhật trước, BE DTO + FE `lib/api.ts`
  mirror theo.

## 3. Bounded specification

**BE** (`backend/src/modules/copy-trade/`):
1. `dto/execute-copy.dto.ts`: thêm `mode: 'paper'` (required), `confirm: true`
   (required `true`), `maxSlippageBps?`, `paperAmountSol?` (optional, default dust).
2. `paper-executor.service.ts` (mới): load keypair từ env → quote Jupiter (fetch,
   no key) → build dust transfer → `sendAndConfirm` devnet → verify status.
   Từ chối mainnet (genesis hash check). `@Inject()`显式 mọi constructor (tsx-safe).
3. `copy-trade.service.ts`: orchestrate validate → persist PENDING → executor →
   update SENT/CONFIRMED/FAILED qua Prisma `CopyOrder`.
4. `copy-trade.controller.ts`: `POST execute` (validateDto显式) + `GET history`
   (`?wallet=&limit=`, parse thủ công).
5. Prisma: model `CopyOrder` + migration (PG `5433` local).
6. `*.spec.ts`: quote parse, lifecycle, mainnet-refusal, cap, envelope 400.

**FE** (`frontend/`):
1. `lib/api.ts` + `types/`: `executePaperTrade`, `listCopyHistory`, types mới.
2. `components/CopyConfirmModal.tsx` (mới, Edgepool modal pattern có sẵn):
   master trade + paper params + Confirm/Cancel.
3. Right panel: gỡ veil + popup, nút Copy mở modal; thêm `Copy history` list
   (mới, dưới Your positions).
4. `openapi.yaml` + docs cập nhật.

## 4. Task breakdown (sang phase plan)

- P0: contract (openapi + DTO/types) + `.env.example` keys (values local-only).
- P1: Prisma `CopyOrder` + migration + Prisma client regen.
- P2: paper-executor + service orchestrate + unit tests (mock Connection/fetch).
- P3: controller execute/history + API smoke (400/404 envelopes).
- P4: FE modal + panel un-veil + history + `tsc`/`build`.
- P5: devnet E2E (gen keypair → airdrop → 1-click → devnet sig verify → history),
  docs + index update.

## 5. Test contract

- BE `*.spec.ts` (vitest/jest hiện có? — kiểm tra `backend/package.json`; nếu chưa
  có runner, dùng `tsx` script assert + ghi rõ thay thế).
- Smoke: execute thiếu confirm → 400 envelope; wallet unknown vẫn cho (master
  fields optional, giữ semantics sim cũ); history rỗng → `{success:true,data:[]}`.
- Devnet E2E: signature `getSignatureStatus` = `Ok`; DB row `CONFIRMED`.

## 6. Agent cards

- Primary: `nestjs-tdd-builder` (P2: failing test → minimal executor → green).
- Gate trước merge: `nestjs-code-reviewer` (key handling, mainnet-refusal, envelope).
- Follow-up: `project-indexer` (module/route/entity index + context-map).

## 7. Protected-file / risk concerns

- `backend/src/modules/copy-trade/**` — APPROVED (user 2026-09-30).
- `backend/.env` (+`VAULT_PRIVATE_KEY`) — APPROVED local-only; không commit.
- `backend/src/config/configuration.ts` — ADJACENT, cần xác nhận ngầm (D5); veto → fallback.
- `backend/prisma/schema.prisma` + migration — không protected, nhưng đụng DB
  local (`docker-compose` PG 5433 phải chạy).
- Rủi ro chính: key leak (mitigate: không log/commit, `.gitignore` đã có `.env`);
  nhầm mainnet (mitigate: genesis check + test assert).

## 8. Next skill

`repo-phase-orchestrator` — viết phase plan + tracker rồi native execution.
Stop khi: tracker P0–P5 đóng + acceptance evidence đủ.
