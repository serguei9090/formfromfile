# FormFromFile — plan

A standalone web app spun out of InfraKit Studio's **FormFlow** module: upload an
XML or YAML file, auto-detect its schema (including repeating / dynamic-array
sections), get a generated form, fill it, export the result.

Difference from the InfraKit version: **multi-user accounts** (register / login,
per-user saved forms stored server-side) and its own visual identity.

- **Targets**: web only (hosted). Static SPA + Go backend. No desktop packaging.
- **License**: MIT.
- **Theme**: emerald / radiant green-leaf. `--primary` = emerald-600 `#059669`,
  a radial emerald→lime accent, full light + dark token sets.
- **Repo root**: `I:\01-Master_Code\Apps\FormFromFile` (empty, not yet a git
  repo).

## Layout

```
FormFromFile/
  web/            Vite + React 19 + TS + Tailwind v4 + shadcn (Base UI)
    src/core/form_flow/     ← ported verbatim from InfraKit, framework-free
    src/core/ports/
    src/adapters/api/       ← REST client for the Go backend
    src/adapters/ui/
  server/         Go module, chi router, modernc.org/sqlite
    cmd/formfromfile/
    internal/auth/          ← mirrors InfraKit/backend/internal/auth
    internal/schemas/       ← per-user saved forms
    internal/httpapi/
  .github/workflows/
  LICENSE  README.md  PLAN.md
```

## Status

**F0–F4b done. Only F5 (release + deploy) remains.** Code walkthrough:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); HTTP contract:
[`docs/API.md`](docs/API.md); AI-session guide: [`CLAUDE.md`](CLAUDE.md) /
[`GEMINI.md`](GEMINI.md).

- **F1 done** (`d9434cc`) — FormFlow core copied verbatim, 14 tests pass.
- **F2 done** (`6500c0d`) — `internal/auth` (argon2id + throttle + Service),
  `internal/httpapi` auth (register/login/logout/me) + admin users. 7 tests.
- **F3 done** (`2e4d57c`) — `internal/store/schemas.go` user-scoped CRUD +
  `/api/schemas*`. Cross-user isolation tested.
- **F4a done** (`6a1be13`) — `api/client.ts`, authStore + schemasStore,
  `AuthGate`, real login/register forms, Shell user menu, "My Forms" list.
- **F4b done** (`5599802`) — the designer: `FileDropField`, `FormFields`
  (rhf `useFieldArray`), `SchemaTree` + `schemaEdit`, `DesignerPage`
  (Detect → fill → Export → Save). Verified E2E in-browser.

- **F0 done** — `git init`; MIT LICENSE; README; `.gitignore`. `web/` =
  Vite 8 + React 19 + TS 6 + Tailwind v4 (emerald theme, radiant-leaf
  background, theme toggle) + Zustand + react-router 8 + rhf + zod +
  Vitest; hand-rolled `Button`/`Input`/`Card` (no shadcn CLI). Shell +
  router + placeholder pages (Home / Designer / Login / Register).
  `server/` = Go module `github.com/serguei9090/formfromfile`, chi +
  `modernc.org/sqlite`, `/healthz` + `/api/config`, SQLite schema
  (`users` / `sessions` / `schemas`), `//go:embed dist` for the release
  SPA, flags `-addr -db -session-secret -allow-register`. Verified: web
  builds + renders all routes; server `/healthz` → `{"ok":true}`.
- **F1–F5** — pending.

## Phases

### F0 — scaffold

- `git init`; MIT `LICENSE`; `README.md`.
- `web/`: `bun create vite` (react-ts) → add Tailwind v4, shadcn/ui on Base UI
  primitives, Zustand, `react-router`, `react-hook-form` + `zod`, Vitest.
- Emerald theme tokens in `web/src/index.css` (light + dark); a radial-gradient
  accent utility. Wire `data-theme` + `prefers-color-scheme` the same way
  InfraKit does.
- `server/`: `go mod init`; `chi`; `modernc.org/sqlite`; a `/healthz` route;
  `cmd/formfromfile/main.go` with flags `-db`, `-addr`, `-session-secret`,
  `-allow-register`.
- Server serves `web/dist/` (embedded via `//go:embed` in the release build,
  proxied in dev).
- **Commit.**

### F1 — port the core (verbatim)

- Copy from InfraKit:
  - `app/src/core/form_flow/formFlowParser.ts` (282)
  - `app/src/core/form_flow/schemaModel.ts` (123)
  - `app/src/core/form_flow/formFlowParser.test.ts` (250)
  - `app/src/core/ports/IFormFlowUseCase.ts`
  - `app/src/core/ports/ISchemaRepository.ts`
- deps: `fast-xml-parser`, `js-yaml`.
- `bun run test` green (Vitest). No changes to the logic — it's framework-free
  by design.
- **Commit.**

### F2 — auth backend (the big chunk)

- `internal/auth/` mirrors `InfraKit/backend/internal/auth`:
  - `users` table: `id`, `email` (unique), `pw_hash` (argon2id), `role`
    (`admin` | `user`), `disabled`, `created_at`.
  - `password.go` — argon2id, same params as InfraKit.
  - `service.go` — `Register`, `Login`, `ChangePassword`.
  - `throttle.go` — per-IP + per-email login rate-limit.
  - sessions: signed HttpOnly cookie (`SameSite=Lax`, `Secure` when TLS),
    server-side `sessions` table (`token`, `user_id`, `expires_at`), sliding
    expiry.
- Endpoints: `POST /api/auth/register` (gated by `-allow-register`),
  `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Middleware: `requireAuth`, `requireAdmin`.
- First registered user → `admin`.
- Admin: `GET /api/admin/users`, `POST /api/admin/users/{id}/disable`,
  `POST /api/admin/users/{id}/reset`.
- Backend unit tests (auth_test.go style).
- **Commit.**

### F3 — per-user schema store

- `schemas` table: `id`, `user_id`, `name`, `kind` (`xml` | `yaml`), `body`
  (the original file text), `form_json` (the detected schema, cached),
  `created_at`, `updated_at`.
- REST: `GET /api/schemas`, `POST /api/schemas`, `GET /api/schemas/{id}`,
  `PUT /api/schemas/{id}`, `DELETE /api/schemas/{id}` — all `requireAuth`,
  all `user_id`-scoped.
- Size cap (e.g. 1 MiB body).
- Version history table → **phase 2**, not now.
- **Commit.**

### F4 — UI

- New shell: top bar (app name + emerald leaf mark), user menu (email, logout),
  auth guard that bounces to `/login`.
- `/login`, `/register` pages.
- Port `FormFlowBuilderScreen.tsx` (549) + `FileDropField.tsx` into
  `src/adapters/ui/`:
  - **Designer**: drop a file → schema tree, retype a field, mark a node as a
    dynamic-array loop (the `useFieldArray` case FormFlow exists for).
  - **Live form**: the generated form, add/remove array items, fill.
  - **Export**: filled XML / YAML, copy + download.
- **My Forms**: server-backed list — open / rename / duplicate / delete.
  "Save" persists `body` + `form_json`.
- `src/adapters/api/` — typed fetch client, 401 → redirect to login.
- **Commit.**

### F5 — deploy

- `web`: `bun run build` → `web/dist/`.
- `server`: `//go:embed web/dist` → single static binary serves SPA + `/api`.
- `Dockerfile` (multi-stage: bun build web → go build → scratch/distroless).
- env contract documented in README: `FFF_DB`, `FFF_ADDR`,
  `FFF_SESSION_SECRET`, `FFF_ALLOW_REGISTER`, `FFF_TLS_*` (optional).
- `.github/workflows/ci.yml` — `bun test` + `bun build` + `go vet` + `go test`
  + docker build.
- **Commit + tag `v0.1.0`.**

## Effort

F0 M · F1 S · F2 L · F3 M · F4 M · F5 M → **L total** (multi-day). Independent
of InfraKit — can run in parallel with WS1 / WS2.

## Open items (later)

- Schema version history + diff (port the pattern from InfraKit's prompt
  versions).
- Shared / published forms (a form a user marks public, others can fill).
- Import an existing *filled* file to pre-populate (reverse fill).
- OIDC / SSO login option.
