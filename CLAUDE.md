# FormFromFile — CLAUDE.md

Guidance for AI coding sessions (Claude Code, Gemini CLI via `GEMINI.md`) working
in this repo. Read [`README.md`](README.md) for the product pitch, [`PLAN.md`](PLAN.md)
for the phase log, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the
file-by-file code walkthrough, and [`docs/API.md`](docs/API.md) for the HTTP
contract.

## What this is

A web app: upload an XML/YAML/JSON file → auto-detect its structure → generate a
form → fill it → export in the original format. Multi-user (argon2id + sessions),
per-user saved forms stored server-side.

Spun out of **InfraKit Studio**'s FormFlow module. `web/src/core/form_flow/**` is
copied **verbatim** from InfraKit (`app/src/core/form_flow/**`) — see "Keep the
core in sync" below.

## Stack

- **Frontend** (`web/`) — Vite 8 + React 19 + TypeScript 6, Tailwind v4
  (`@tailwindcss/vite`, no config file — theme tokens live in `src/index.css`),
  Zustand, `react-router` v8, `react-hook-form` + `zod`, Vitest + Testing Library.
  Package manager: **bun**.
- **UI** — hand-rolled primitives in `src/components/ui/` (`class-variance-authority`
  + `cn()`), **not** shadcn/Radix. Icons: `lucide-react`.
- **Backend** (`server/`) — Go, module `github.com/serguei9090/formfromfile`.
  `chi` router, `modernc.org/sqlite` (pure Go, **no cgo**), `golang.org/x/crypto`
  for argon2id. No ORM. One binary; `//go:embed` bundles `web/dist` for release.
- **Deploy target** — web only, hosted. No Tauri / desktop. One process serves the
  SPA and `/api`.

### Why these choices

- Hand-rolled UI primitives instead of the shadcn CLI: fewer moving parts, no
  Radix/Base-UI runtime, and the app only needs ~6 components.
- `modernc.org/sqlite` not `mattn/go-sqlite3`: pure Go → `CGO_ENABLED=0` →
  trivial cross-compile and a `scratch`/distroless Docker image.
- Opaque session tokens stored as `sha256(token)` (no JWT, no cookie signing):
  simplest thing that's revocable and leak-safe. `--session-secret` is reserved
  but currently unused.
- The FormFlow parser was already framework-free in InfraKit by design, so it
  ports with zero changes and keeps its own test suite.

## Architecture

Same ports-&-adapters spirit as InfraKit, lighter:

```
web/src/
  core/form_flow/**   pure TS — the parser + schema model. ZERO React imports.
  core/ports/**        the interfaces (IFormFlowUseCase, ISchemaRepository)
  api/                 client.ts (typed fetch) + types.ts
  stores/              Zustand: authStore, schemasStore, themeStore
  app/                 Shell, AuthGate, AuthCard, FileDropField, Leaf
  designer/            FormFields (live form), SchemaTree (retype), schemaEdit
  pages/               HomePage (My Forms), DesignerPage, Login/RegisterPage
  components/ui/        Button, Input, Card, Textarea, Select, Label

server/
  cmd/formfromfile/    main.go (flags, wiring), embed.go (//go:embed dist)
  internal/store/      store.go (schema + Open), schemas.go (per-user CRUD)
  internal/auth/       auth.go (types/errors), password.go + throttle.go
                       (copied from InfraKit), service.go (Register/Login/…)
  internal/httpapi/    httpapi.go (Router), middleware.go (requireAuth/Admin),
                       auth.go, users.go, schemas.go (handlers)
```

**Rule carried from InfraKit:** no framework imports in `web/src/core/**`.

```bash
grep -rl "from 'react" web/src/core   # must print nothing
```

Request flow: `client.ts` → Vite `/api` proxy (dev) or the embedded router
(release) → `chi` → `requireAuth` middleware (reads `fff_session` cookie →
`auth.Service.UserByToken` → puts `auth.User` in the request context) → handler →
`store` (user-scoped SQL) → JSON.

## Keep the core in sync

`web/src/core/form_flow/{formFlowParser.ts,schemaModel.ts,formFlowParser.test.ts}`
and `core/ports/{IFormFlowUseCase.ts,ISchemaRepository.ts}` are **verbatim copies**
from InfraKit Studio (`I:\01-Master_Code\Apps\InfraKitOps\app\src\core\`). If you
fix a parser bug here, port it back (and vice-versa). Deps: `fast-xml-parser`,
`js-yaml` (v5 here — ships its own types, so no `@types/js-yaml`).

Do **not** rewrite the parser — extend around it.

## Conventions

- **Commit straight to `main`.** One logical change per commit. Green gate first
  (`bun run build && bun run test && bun run lint`; `go build ./... && go vet
  ./... && go test ./...`). Never `git push` unless asked. Commit-message trailer:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and, for PRs,
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **`erasableSyntaxOnly` is on** in `tsconfig.app.json`: no TS parameter
  properties (`constructor(public x)`), no `enum`, no namespaces. Use plain
  fields / union types.
- **`baseUrl` is banned** (TS 6 deprecation errors the build). The `@/*` path
  alias is `paths: { "@/*": ["./src/*"] }` with no `baseUrl`, plus the Vite
  `resolve.alias`.
- **Emerald theme**: all colors are CSS custom properties in `src/index.css`
  (`--primary` etc., oklch), redefined under `.dark`. Never hardcode a hex —
  use a Tailwind token (`bg-primary`, `text-muted-foreground`, …). The
  `.dark` class is toggled on `<html>` by `useApplyTheme()`.
- **rhf dynamic paths**: the form shape is data-driven, so `FormFields` takes a
  `FieldCtx.reg(name: string, opts?)` wrapper that casts the string path
  (`form.register(n as never, o)`) — keep that cast in one place.
- Backend: user-scoped queries always carry `WHERE ... AND user_id = ?`.
  `store.ErrNotFound` doubles as "not yours" — never leak a 403 vs 404 difference
  for another user's row.
- Backend errors to the client: `{"error": "..."}` with the right status code
  (`writeErr`). No stack traces.

## Adding things

**A new API endpoint**
1. Handler in `server/internal/httpapi/<area>.go` — `func (h *handlers) name(w,r)`.
2. Route in `httpapi.go` `Router()` — inside the right `r.Group` (`requireAuth`
   and/or `requireAdmin`).
3. Store method in `server/internal/store/` if it touches SQLite — user-scoped.
4. Test: `service_test.go` / `schemas_test.go` style (temp-file SQLite via
   `t.TempDir()`).
5. Frontend: add to `web/src/api/client.ts` callers or a Zustand store; type in
   `web/src/api/types.ts`.

**A new page / route**
1. `web/src/pages/<Name>.tsx`.
2. Register in `web/src/App.tsx` — inside the `<AuthGate><Shell/></AuthGate>`
   route for authed pages, or a bare `<Route>` for public ones.

**A schema-model change** — edit `core/form_flow/schemaModel.ts`, keep it JSON-
serializable (persistence is `JSON.stringify`), and port the change to InfraKit.

## Commands

```bash
# web (from web/)
bun install
bun run dev        # Vite dev server on :5273 (proxies /api → :8787)
bun run build      # tsc -b && vite build  → web/dist/
bun run test       # Vitest
bun run lint       # oxlint

# server (from server/)
go run ./cmd/formfromfile --addr 127.0.0.1:8787 --db formfromfile.db
go test ./...
go build -o fff ./cmd/formfromfile     # dev build; dist/ is a placeholder

# docker (from repo root) — bun build web → CGO_ENABLED=0 go build → distroless
docker build -t formfromfile .
docker run -p 8787:8787 -v fff-data:/data formfromfile
```

## Status & what's next

**F0–F4b done.** Working: auth (register/login/logout, first user = admin,
admin user list), the designer (detect → retype → fill → export), per-user
saved forms.

**F5 — release + deploy (not started).** See [`PLAN.md`](PLAN.md) §F5:
- copy `web/dist` into `server/cmd/formfromfile/dist/` before `go build` so
  `//go:embed all:dist` bundles the real SPA (today it embeds a placeholder);
  `main.go` already switches to serving it when `dist/index.html` exists.
- multi-stage `Dockerfile` (bun build web → `CGO_ENABLED=0 go build` → distroless).
- `.github/workflows/ci.yml` — `bun test` + `bun build` + `go vet` + `go test` +
  docker build.
- tag `v0.1.0`.

**F6–F12 done.** All in `web/src/formflow_ext/` (the verbatim `core/` stays
frozen) — see [`PLAN-F6.md`](PLAN-F6.md) progress log and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §"extension layer". Field
metadata + validation presets, XML-attribute/comment round-trip, `%TOKEN%`
templates, author ⚙ panel, validated `/fill/:id`, publish + `/f/:slug` share +
submissions, format plugins (TOML/INI/`.env`/CSV) + JSON Schema import. Extra
deps: `smol-toml`, `papaparse` (+ `@types/papaparse`).

**Polish backlog:** [`PLAN-F13.md`](PLAN-F13.md) — format fidelity (comment/order
preserving YAML + `.env`), designer UX (collapsible tree, Fill preview, token
authoring), submissions export/delete, code-split + a11y + responsive,
Playwright e2e + `golangci-lint` + error surfacing, onboarding samples.

**F5 done** — `Dockerfile` (bun → distroless static, ~14 MB) +
`.github/workflows/ci.yml` (web gate, server gate, docker build + smoke test) +
`.dockerignore`. Release build copies `web/dist` into
`server/cmd/formfromfile/dist/` so `//go:embed all:dist` bundles the real SPA
(`main.go` serves it when `dist/index.html` exists). Still open: XSD import,
`v0.1.0` push/publish.

**Deferred / ideas** (`PLAN.md` "Open items"): schema version history + diff,
reverse-fill from an existing filled file, OIDC/SSO.

## Known rough edges

- `DesignerPage` retype re-seeds the whole form with detected defaults (loses
  entered values). Documented in the UI. A smarter per-branch reset is a TODO.
- Empty arrays / `null` values: same documented FormFlow-parser limitations as
  InfraKit (see the header comment in `formFlowParser.ts`).
- Login form submit was flaky under browser automation in testing — the app
  itself is fine; use a direct `fetch` to `/api/auth/login` if scripting.
