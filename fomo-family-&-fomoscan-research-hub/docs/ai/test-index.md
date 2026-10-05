# Test Index

## Current state (2026-09-29)

- No test runner configured yet. No `*.spec.ts` / `*.test.*` in repo.
- Typecheck is the primary gate: root + `backend/` + `frontend/` tsconfigs.
- Smoke: `curl -s http://localhost:3000/api/health` and portfolio total check.

## Target layout (NestJS spec for BE, Next.js spec for FE)

| Scope | Path convention | Runner (to add) | First specs to write |
|---|---|---|---|
| BE unit | `backend/src/modules/*/*.spec.ts` | `vitest` or `jest` | `wallets.service` (PubKey validation, add/remove/update), `portfolio.service` (25/wallet aggregation, sort), `onchain.service` (event mapping) |
| BE e2e | `backend/test/*.e2e-spec.ts` | `supertest` + Nest testing | `GET /api/health`, `GET /api/wallets`, `POST /api/wallets` 400/200, `GET /api/portfolio/transactions` total |
| FE | `frontend/**/*.test.tsx` | `vitest` + Testing Library | `lib/format`, `lib/api` contract shape, `usePortfolio` hook |

## Verification commands

```bash
npx tsc --noEmit
npx tsc --noEmit -p backend/tsconfig.json
npx tsc --noEmit -p frontend/tsconfig.json
curl -s http://localhost:3000/api/health
curl -s "http://localhost:3000/api/portfolio/transactions?limit=2" | head -c 500
```
