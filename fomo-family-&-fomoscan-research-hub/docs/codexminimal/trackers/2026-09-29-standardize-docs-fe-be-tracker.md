# Tracker — Chuẩn hóa docs + FE/BE

- Topic: codexminimal-standardize-docs-fe-be
- Plan: `docs/codexminimal/plans/2026-09-29-standardize-docs-fe-be-phase-plan.md`
- Started: 2026-09-29
- Workflow: repo-phase-orchestrator → native execution

## Phase status

| Phase | Status | Delivered | Verification | Next |
|---|---|---|---|---|
| 0 bootstrap | done | AGENTS.md + docs/ai (12) + codexminimal runtime (3) + dual-stack profile/rules | bootstrap scripts output CREATED | — |
| 1 docs | done | architecture (3), api (openapi.yaml+README), setup (2), README rewrite | openapi covers 8 routes | — |
| 2 backend | done | backend/ 30 files, 5 modules, canonical solana.service | tsc -p backend ✅ | — |
| 3 frontend | done | frontend/ 20 files, App Router + lib/hooks/types | tsc -p frontend ✅ | — |
| 4 wiring | done | package.json scripts, tsconfig split, README, refactor-log | tsc root ✅ BE ✅ FE ✅, smoke health ONLINE + portfolio 20 + wallets 10 + SSE CONNECTED/EVENT ✅ | — |
| 5 index sync | done | indexes + context-map + runtime state | context-map v2 valid, current-work done | — |

## Close

- 2026-09-29: all phases done, tracker closed. Canonical: `frontend/` + `backend/`; contract `docs/api/openapi.yaml`; legacy frozen.

## Handoff (Phase 4 → 5)

- Completed: all code + docs written; 3× tsc green; `npm install --legacy-peer-deps` ok.
- Remaining in Phase 4: backend boot smoke (`tsx backend/src/main.ts` + `curl /api/health`).
- Phase 5 must: refresh `project-index/module-index/route-index/entity-index/context-map`, update `current-work.json` + `artifact-registry.json` + `telemetry.json`, close tracker.

## Blockers

- None. Note: `npm install` requires `--legacy-peer-deps` (vite 8 ↔ esbuild peer). Recorded for setup docs.
