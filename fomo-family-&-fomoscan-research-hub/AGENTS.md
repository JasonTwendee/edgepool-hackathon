# AGENTS.md

Use this file as the Codex / OpenCode entrypoint for the repository. Keep it short; push detailed or frequently changing context into `docs/ai/` and `docs/codexminimal/`.

<!-- CODEXMINIMAL:ROUTING START -->
## Always-On Task Router Protocol

Before any non-trivial task, internally classify the request, choose the smallest suitable skill, then decide whether to proceed, ask first, or block.

Use `task-router` for ambiguous, risky, multi-step, protected, refactor, review, scan, or orchestration work. For trivial requests, answer directly.

Default feature intake:
1. `idsd-orchestrator`
2. `repo-phase-orchestrator`
3. Native tool execution (Codex CLI or OpenCode build agent)

Do not jump from a rough feature prompt straight into coding. Capture intent, decision evidence, acceptance evidence, and phase boundaries first. Ask first if the task touches protected files, architecture boundaries, env/deploy/database, CI/CD, public API contracts, or wide multi-module changes.

Repo scope for this project (user-confirmed 2026-09-29, runtime cutover same day):
- `frontend/` = FE runtime, Next.js 16 App Router (`fomo-frontend`, dev `:3001`, rewrites `/api` → BE).
- `backend/` = BE runtime, NestJS 12 (`fomo-backend`, `NestFactory`, dev `:3000`).
- `docs/` = plugin-standard documentation (`docs/ai/`, `docs/architecture/`, `docs/api/`, `docs/setup/`).
- Root = `fomo-monorepo` orchestrator scripts only. Legacy `src/` + `server.ts` + Vite REMOVED (backup `/tmp/opencode/legacy-backup-20260929.tar.gz`).
<!-- CODEXMINIMAL:ROUTING END -->

<!-- CODEXMINIMAL:MODEL_ROUTING START -->
## Model Routing

Default to the cheapest capable model and effort. Escalate only when risk justifies it: complex architecture, multi-module changes, failing tests with unclear cause, database/env/deploy work, or protected boundaries. Never escalate without a concrete reason.
<!-- CODEXMINIMAL:MODEL_ROUTING END -->

<!-- CODEXMINIMAL:CONTEXT_BUDGET START -->
## Context Budget

Start with the smallest budget that can answer the task:
- `low`: indexes plus up to 5 files
- `medium`: indexes plus up to 12 files
- `high`: only for risky, ambiguous, or multi-module work

Do not broad-scan under `low`. If confidence stays low after budget is exhausted, reroute or ask. Rely on the tool's built-in auto-compaction for long sessions; do not manage compaction by hand.
<!-- CODEXMINIMAL:CONTEXT_BUDGET END -->

<!-- CODEXMINIMAL:SEARCH_POLICY START -->
## Search Policy

Always go index-first:
1. `docs/ai/context-map.json`
2. `docs/ai/project-index.md`
3. relevant `docs/ai/*-index.md`
4. indexed files
5. local folders
6. repository-wide search only as last resort

Treat `docs/ai/` as the primary navigation layer. If source code conflicts with an index, trust source code and update the index afterward. If indexes are missing or stale, use `project-indexer`.
<!-- CODEXMINIMAL:SEARCH_POLICY END -->

<!-- CODEXMINIMAL:SKILL_POLICY START -->
## Skill Selection Policy

Use the smallest suitable skill:
- `project-init`: sync `AGENTS.md`, `docs/ai`, `docs/codexminimal`, durable rules, and protected-file guidance
- `project-indexer`: build or repair repository indexes and `context-map.json`
- `idsd-orchestrator`: default gate for intent contract, decision ledger, acceptance evidence, and phase-plan handoff; select `solution_challenger`, `system_designer`, `senior_qa` quality gates only when they add confidence
- `repo-phase-orchestrator`: write the phase plan and tracker, then hand off execution
- profile-specific skills only when `docs/ai/stack-profile.md` shows an active profile; default to `generic`

Prefer deterministic local helpers for repetitive repo operations; fall back to prompt-only work when helpers are missing or blocked. Do not use a broader skill when a narrower one is sufficient.

Active stack for this repo (see `docs/ai/stack-profile.md`):
- FE: Next.js App Router conventions (no `nestjs-*` skills for FE).
- BE: NestJS conventions — `nestjs-tdd-builder` for new behavior, `nestjs-bug-fixer` for bugs, `nestjs-code-reviewer` before merge, `nestjs-refactor-guardian` for structural moves.
<!-- CODEXMINIMAL:SKILL_POLICY END -->

<!-- CODEXMINIMAL:TESTING_SPEC START -->
## Testing Specification

Use the repository's native test entrypoints and layout. Run targeted tests first, then broader lint/build checks only as needed.

- Typecheck (all): `npm run typecheck` (BE + FE)
- BE typecheck: `npm --prefix backend run typecheck`
- FE typecheck: `npm --prefix frontend run typecheck`
- BE dev (NestJS): `npm run dev:backend` → `http://localhost:3000`
- FE dev (Next.js): `npm run dev:frontend` → `http://localhost:3001`
- FE build: `npm --prefix frontend run build`
- API smoke: `curl -s http://localhost:3000/api/health` (direct) or `:3001/api/health` (via FE rewrites)
<!-- CODEXMINIMAL:TESTING_SPEC END -->

<!-- CODEXMINIMAL:PROTECTED_FILES START -->
## Protected Files Policy

Before editing, read `docs/ai/protected-files.md`. If a required change touches a protected file, stop, explain why, and ask for explicit approval first.
<!-- CODEXMINIMAL:PROTECTED_FILES END -->

<!-- CODEXMINIMAL:USER_RULE_MUTATION START -->
## User Rule Mutation Policy

When the user changes a durable rule, persist it immediately in `docs/ai/rule-registry.md` and related generated docs. Treat repeated user-confirmed feedback as durable: write it into the rule registry directly.
<!-- CODEXMINIMAL:USER_RULE_MUTATION END -->
