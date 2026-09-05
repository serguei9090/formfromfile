# FormFromFile

[![CI](https://github.com/serguei9090/formfromfile/actions/workflows/ci.yml/badge.svg)](https://github.com/serguei9090/formfromfile/actions/workflows/ci.yml)

Upload an XML, YAML, or JSON file (or import a JSON Schema / `.xsd`) → the app
auto-detects its structure (including repeating / dynamic-array sections) →
you get a generated form → fill it → export the result in the original
format.

A standalone spin-out of **InfraKit Studio**'s FormFlow module, with multi-user
accounts, per-user saved forms, and publishable shareable forms.

- **Web only** — a static SPA (`web/`) + a Go backend (`server/`). No desktop build.
- **Multi-user** — register / login (argon2id) or Google sign-in (Firebase),
  admin-provisioned accounts, per-user schemas stored server-side.
- **Publish + share** — turn a saved form into a public link (`/f/:slug`),
  open to anyone or gated to signed-in users, with submission review,
  approval workflow, and webhooks.
- **Local-first to run** — one Go binary that embeds the SPA and serves `/api`.
- MIT licensed.

## Quick start (dev)

```bash
# backend — http://localhost:8787
cd server && go run ./cmd/formfromfile --addr 127.0.0.1:8787 --db formfromfile.db

# frontend — http://localhost:5273, proxies /api → :8787
cd web && bun install && bun run dev
```

Open http://localhost:5273, register (the **first account becomes admin**), open
the designer, paste a file, and save a form.

Locked out, or no server running? Manage accounts directly against the
SQLite file:

```bash
./fff user passwd --password NewStrongPassword123 --db formfromfile.db admin@example.com
./fff user add --role admin --db formfromfile.db someone@example.com
./fff user ls --db formfromfile.db
```

See [`docs/guides/AUTH.md`](docs/guides/AUTH.md) "CLI: account recovery" for
the full command reference.

## Checks

```bash
cd web    && bun run build && bun run test && bun run lint
cd server && go build ./... && go vet ./... && go test ./...
```

## Server flags / env

| flag | env | default | meaning |
|------|-----|---------|---------|
| `--addr` | `FFF_ADDR` | `127.0.0.1:8787` | listen address |
| `--db` | `FFF_DB` | `formfromfile.db` | SQLite file path |
| `--allow-register` | `FFF_ALLOW_REGISTER` | `true` | public self-registration (bootstrap admin always allowed) — set `false` once your admin exists |
| — | `FFF_TRUST_PROXY` | — | `true` to key rate-limits off `X-Forwarded-For` / `X-Real-IP` — **only** behind a proxy that overwrites them (Caddy/nginx/Cloudflare) |
| — | `FFF_LOG_FORMAT` | text | `json` for one structured line per request (id, status, dur, ip); `FFF_LOG_LEVEL` = `debug`\|`info`\|`warn`\|`error` |
| — | `FFF_WEBHOOK_ALLOW_PRIVATE` | — | `true` allows webhook targets on LAN / loopback / `http` — default blocks them (SSRF) |
| — | `FFF_TURNSTILE_SITE_KEY` / `FFF_TURNSTILE_SECRET` | — | both set → Cloudflare Turnstile CAPTCHA on public forms (free; see [`docs/DEPLOY.md`](docs/deployment/DEPLOY.md)) |
| — | `FFF_ANTHROPIC_API_KEY` | — | AI assist key (beta) |
| — | `FFF_AI_BETA` | — | `true` to turn AI on — **needs the key too**; off by default (see [`docs/AI.md`](docs/guides/AI.md)) |
| — | `FFF_AI_MODEL` | `claude-sonnet-5` | AI model override |
| — | `FFF_SECURITY_HEADERS` | `on` | security headers + CSP on every response; `off` to disable (debugging / odd proxy) |
| — | `FFF_METRICS_TOKEN` | — | set → `GET /metrics` (Prometheus) behind `Authorization: Bearer <token>`; unset → no route |
| — | `FFF_ERROR_WEBHOOK` | — | recovered panics POST a JSON report here (request id, path, error, stack) |
| — | `FFF_FIREBASE_PROJECT_ID` | — | set → a "Continue with Google" button appears on `/login`; see [`docs/AUTH.md`](docs/guides/AUTH.md) |
| — | `FFF_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_APP_ID` | — | the rest of the Firebase Web SDK config (not secrets) — needed alongside `_PROJECT_ID` |

Most of these (register, Turnstile keys, webhook-allow-private, AI beta,
default submission cap) can also be changed at runtime from **Admin →
Settings** with no restart — a stored value overrides the startup env/flag.

The release binary embeds `web/dist` and serves the SPA + `/api` from one
process. In dev the SPA runs under Vite and proxies `/api` to the server.
Deploying for a team? → [`docs/DEPLOY.md`](docs/deployment/DEPLOY.md). Fastest path:
`cp .env.example .env` (set `DOMAIN` + `ACME_EMAIL`) then `docker compose up -d`
— app + Caddy (auto-TLS, security headers) + a named data volume. Also covers
nginx, Cloudflare Tunnel + Access (SSO, zero open ports), and Litestream backups.

## Docker

Multi-stage build (bun → `CGO_ENABLED=0 go build` → distroless static, ~19 MB):

```bash
docker build -t formfromfile .
docker run -p 8787:8787 -v fff-data:/data formfromfile
```

The container runs as `nonroot`, listens on `0.0.0.0:8787`, and keeps its
SQLite file in the `/data` volume. Override any of the `FFF_*` env vars above
with `-e`. `.github/workflows/ci.yml` runs the web + server gates and a
container smoke test (healthz, config, embedded SPA, first-user register).

## Documentation

Full docs live under [`docs/`](docs/README.md) — start there for the index.
Highlights:

- [**Diagrams**](docs/architecture/DIAGRAMS.md) — system overview, request
  flow, auth flow, and the detect → fill → export → publish → submit lifecycle.
- [**Architecture**](docs/architecture/ARCHITECTURE.md) — file-by-file
  walkthrough of `web/` and `server/`.
- [**API reference**](docs/reference/API.md) — every HTTP route.
- [**Auth**](docs/guides/AUTH.md) — password auth, admin-provisioned users,
  Firebase Google sign-in, per-template access gates.
- [**Deploy**](docs/deployment/DEPLOY.md) — docker-compose + Caddy quickstart,
  manual Docker, nginx, Cloudflare Tunnel, backups, a pre-handoff checklist.
- [**CI/CD**](docs/development/CI.md) — what each GitHub Actions job checks
  and how to reproduce it locally.
- [**AI assist**](docs/guides/AI.md) — the optional, off-by-default
  Anthropic-powered assist features.

Phase-by-phase build history: [`docs/planning/`](docs/planning/) and
[`CHANGELOG.md`](CHANGELOG.md). AI-coding-session guidance (stack, conventions,
how to add things) is in [`CLAUDE.md`](CLAUDE.md) / [`GEMINI.md`](GEMINI.md).

## What's working today

- **Auth** — password (argon2id) or Google sign-in (Firebase, verified
  server-side against Google's public JWKS, no Admin SDK); first account ever
  created becomes admin; admins can also provision accounts directly (Admin →
  Users) with a generated or explicit password.
- **Author flow** — detect XML / YAML / JSON / TOML / INI / `.env` / CSV, or
  import a JSON Schema / XML Schema (`.xsd`) for declared-not-guessed
  validation → retype → per-field labels, help text, and validation presets
  → `%tokens%`. A **Generate .xsd** button (XML templates) gives you a
  starting schema from a sample to refine and re-import.
- **Filler flow** — validated fill-only form at `/fill/:id`, export back to
  the original format (order/comment-preserving where the format supports it).
- **Publish + share** — turn a saved form into a public link (`/f/:slug`),
  either open to anyone or gated to signed-in users only; submissions are
  collected server-side with optional approval-before-visible, comments, CSV
  export, per-form submission caps, and HMAC-signed webhooks.
- **Admin** — dedicated Users / Settings / Activity tabs: user management,
  runtime settings (registration, Turnstile, AI beta, webhook policy,
  default submission cap — no restart needed), audit log, and per-user
  GDPR export/erase.
- **Ops hardening** — SSRF-guarded outbound requests (webhooks, async
  checks), Cloudflare Turnstile on public forms, structured JSON logging,
  per-IP rate limits, security headers + CSP, Prometheus metrics.

## Layout

```
web/      Vite + React 19 + TS + Tailwind v4 (emerald theme)
  src/core/form_flow/   ← the parser, copied verbatim from InfraKit, framework-free
  src/formflow_ext/     ← everything built on top (metadata, validation, publish/share, formats)
  src/designer/         ← the schema-tree + live-form UI
  src/api/ src/stores/  ← backend client + Zustand state
server/   Go — chi router, modernc.org/sqlite, argon2id + Firebase auth
docs/     see docs/README.md — guides/, reference/, architecture/, deployment/, development/, planning/
```
