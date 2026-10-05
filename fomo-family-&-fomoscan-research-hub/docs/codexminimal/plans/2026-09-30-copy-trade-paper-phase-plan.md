# Phase plan — Copy-trade paper (devnet, 1-click, full DB+UI)

- Intent: `docs/codexminimal/idsd/2026-09-30-copy-trade-paper-intent.md`
- Tracker: `docs/codexminimal/trackers/2026-09-30-copy-trade-paper-tracker.md`
- Approvals: protected `copy-trade/**` ✅, `VAULT_PRIVATE_KEY` local-only ✅,
  `configuration.ts` minimal extension (D5, vetoable) ✅-adjacent.
- Infra verified 2026-09-30: PG `5433` accepting, Jupiter Lite quote OK,
  devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.

## Phase map

| Phase | Scope | Gate |
|---|---|---|
| P0 | Contract: openapi execute/history, DTO fields, FE types/api, `.env.example` keys | openapi parse + `tsc` BE+FE |
| P1 | Prisma `CopyOrder` + migration + client regen | `prisma validate` + migrate green + `tsc` |
| P2 | `paper-executor.service` + service orchestrate + tsx assert tests (TDD) | assert scripts green + `tsc` |
| P3 | Controller execute/history + API smoke incl. envelopes | curl 200/400/404 + `tsc` |
| P4 | FE confirm modal + un-veil panel + history UI + contract mirror | `tsc` FE + `next build` + smoke |
| P5 | Devnet E2E + review gate + docs/indexes | devnet sig verified + reviewer pass |

## P0 — Contract (current)

Files:
- `docs/api/openapi.yaml`: `ExecuteCopyDto` += `mode`, `confirm`, `maxSlippageBps`,
  `paperAmountSol`; new `GET /api/copy-trade/history`; new `CopyOrder` schema
  + `CopyHistoryResponse`; `CopyTradeResponse` += `devnetSignature`, `status`
  lifecycle note. Legacy sim fields stay (backward-compat).
- `backend/src/modules/copy-trade/dto/execute-copy.dto.ts`: mirror new fields
  (`mode` required enum-string `'paper'`; `confirm` required `true` via
  `@Equals(true)`; optionals as before).
- `frontend/types/onchain.ts` (or `fomo.ts` if copy lives there): `CopyOrder`,
  `ExecutePaperInput`, `CopyHistoryResponse`.
- `frontend/lib/api.ts`: `executePaperTrade()`, `listCopyHistory()`.
- `backend/.env.example`: `COPY_TRADE_PAPER_ENABLED`, `COPY_TRADE_MAX_USD`,
  `DEVNET_RPC_URL` (values → `backend/.env` local-only, never commit).
- `backend/src/config/configuration.ts`: map 3 keys (D5, minimal diff).

Verify:
- `python3 -c "import yaml;yaml.safe_load(open('docs/api/openapi.yaml'))"` parses.
- `npm run typecheck` (BE+FE) green.
- Stop if: contract mismatch BE↔FE, or D5 vetoed (fallback: module-local env read).

## P1 — DB

- `backend/prisma/schema.prisma`: model `CopyOrder` → table `copy_orders`
  (id autoincrement; masterWallet/masterHandle/masterTxHash?; symbol/action/
  amountUsd/venue; mode VarChar(10); status VarChar(16); devnetSignature?;
  quoteJson JsonB?; error?; createdAt/updatedAt timestamptz; index wallet+created).
- `npx --prefix backend prisma migrate dev --name copy-orders` (DATABASE_URL từ
  `POSTGRES_*`, port 5433) + client regen (`src/generated/prisma`).
- Copy module gets Prisma access same pattern as `WalletsService`
  (`@Inject(PrismaService)` — confirm `PrismaService` provider/global in
  `app.module.ts` or import `PrismaModule` explicitly; no per-module duplicates).
- Verify: `npx --prefix backend prisma validate`, migrate green, `tsc` BE.

## P2 — Executor + orchestration (nestjs-tdd-builder)

- `paper-executor.service.ts` (new, `@Inject()`显式, no chain singleton reuse —
  own devnet `Connection` from `DEVNET_RPC_URL`):
  1. `assertDevnet()` — `getGenesisHash()` must equal devnet hash else throw
     (mainnet-refusal, unit-tested with mocked connection).
  2. `loadVaultKeypair()` — from env only; missing → `BadRequest(success:false)`.
  3. `quote()` — Jupiter Lite `swap/v1/quote` (fetch, timeout 10s); parse
     `outAmount`/`otherAmountThreshold`; failure → FAILED with message.
  4. `executeProof()` — dust transfer (`paperAmountSol` default 0.0001, cap
     enforced vs `COPY_TRADE_MAX_USD` notional) via `sendAndConfirmTransaction`,
     then `getSignatureStatus` must be `Ok`.
- `copy-trade.service.ts`: `executePaper()` — validate cap/gate
  (`COPY_TRADE_PAPER_ENABLED === 'true'`) → insert `PENDING` → run executor →
  update `QUATED/SENT/CONFIRMED|FAILED`. Keep legacy `execute()` untouched
  (sim endpoint stays green).
- Tests: `paper-executor.spec.ts` + `copy-trade.service.spec.ts` run via
  `npx tsx --test`? No runner installed — use `tsx` assert scripts
  (`backend/scripts/assert-copy-trade.ts`, plain `node:assert`, mocked
  Connection/fetch) + document. `npm run typecheck` must include them
  (check `tsconfig.json` include covers `scripts/` or place under module dir).
- Verify: assert scripts exit 0, `tsc` BE green.

## P3 — Controller + smoke

- `copy-trade.controller.ts`: `POST execute` routes legacy (no `mode`) → sim,
  `mode:'paper'` → `executePaper` (validateDto显式, 400 envelope khi thiếu
  `confirm:true`/cap/gate-off); `GET history` (`wallet?`, `limit?` default 20 max
  100, parse thủ công) → `{success:true,total,data}` (empty → `data:[]`).
- Smoke (BE dev `:3000` running):
  - `POST {}` → 400 envelope; `POST {mode:paper}` (no confirm) → 400;
  - gate-off → 400 `paper trading disabled`;
  - `GET /api/copy-trade/history` → 200 empty.
- Verify: all curls match envelopes; legacy sim response unchanged.

## P4 — FE

- `CopyConfirmModal.tsx` (Edgepool modal pattern): master trade (symbol/action/
  amountUsd/venue/handle) + paper box (devnet badge, dust amount, est fee,
  cap note) + Confirm/Cancel; ESC/backdrop close.
- Right panel: remove veil + coming-soon popup; Copy button opens modal with
  `copySignal`-derived defaults; success → toast + Solscan-devnet link
  (`https://explorer.solana.com/tx/<sig>?cluster=devnet`).
- `Copy history` section under Your positions: `listCopyHistory()`, status
  badges (PENDING/QUATED/SENT/CONFIRMED/FAILED), 60s poll while open.
- Verify: `npm --prefix frontend run typecheck`, `next build`, `:3001` smoke.

## P5 — Devnet E2E + gates + docs

1. Generate devnet keypair (`solana-keygen` or `web3.js` script → stdout ONLY,
   paste pubkey only to chat), fund via `solana airdrop 1 <pubkey> --url devnet`
   (retry if rate-limited), set `VAULT_PRIVATE_KEY` in `backend/.env` (local).
2. Restart BE (`tsx` watch auto-reload or restart process), 1-click execute from
   FE → expect `CONFIRMED` + devnet sig → verify
   `curl devnet getSignatureStatus` Ok + `copy_orders` row + FE history shows it.
3. Gate: `nestjs-code-reviewer` on `copy-trade/**` (key handling, mainnet-refusal,
   envelopes) — fix findings before close.
4. Docs: `openapi.yaml` (already P0), `route-index.md`, `module-index.md`,
   `entity-index.md`, `ARCHITECTURE.md` copy-trade line (sim → paper), tracker
   close; `project-indexer` follow-up.
5. Telemetry: phase events per completed phase.

## Stop conditions

- Any red `tsc`/build/migration/smoke → stop, fix, re-verify same phase.
- `configuration.ts` veto → fallback module-local env, note in tracker.
- Devnet airdrop rate-limit → wait/retry, no mainnet substitution ever.
- Scope drift (mainnet/auto-mirror/Jito-real) → stop, re-ask user.
