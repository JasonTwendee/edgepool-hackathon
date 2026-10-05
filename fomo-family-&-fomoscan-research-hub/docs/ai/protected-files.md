# Protected Files

Files and folders listed here must not be edited unless explicitly approved in the current task.

## Critical

Critical paths require explicit approval before any edit.

| Path | Reason | Approval Required |
|---|---|---|
| `.env` | Live secrets / RPC keys | Yes |
| `.env.local` | Live secrets | Yes |
| `backend/src/config/*` | RPC / Jito / vault key wiring | Yes (prod values) |
| `docs/ai/protected-files.md` | Policy itself | Yes |

## Sensitive

Sensitive paths may contain secrets, credentials, production configuration, or high-risk settings.

| Path | Reason | Approval Required |
|---|---|---|
| `.env*` (except `.env.example`) | Secrets | Yes |
| `*.pem`, `*id_rsa*`, `vault*.json` | Keys | Yes |
| `backend/src/modules/copy-trade/**` | Future fund-movement execution | Yes (any execution logic) |

## Integration

Integration paths are owned by external systems or vendor integrations.

| Path | Reason | Approval Required |
|---|---|---|
| `frontend/public/vault_system_design_specification.html` | Static research artifact (served by Next) | Ask before regen |
| `metadata.json` | AI Studio applet metadata | Ask before change |

## Default Sensitive Areas

- `.env`
- `.env.*`
- secret files
- deployment credentials
- production infra files

## Canonical vs Legacy (2026-09-29)

- Canonical (extend here): `frontend/`, `backend/`, `docs/`.
- Legacy compat (do not extend): `src/`, `server.ts`, `vite.config.ts`, `index.html`.
- Edits to legacy allowed only for compat shims with a `refactor-log.md` entry.

## Approval Rule

If a task requires editing a protected path:

1. stop
2. explain why the change is needed
3. ask for explicit approval
