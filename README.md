# FormFromFile

Upload an XML, YAML, or JSON file → the app auto-detects its structure
(including repeating / dynamic-array sections) → you get a generated form →
fill it → export the result in the original format.

A standalone spin-out of **InfraKit Studio**'s FormFlow module, with multi-user
accounts and per-user saved forms.

- **Web only** — a static SPA (`web/`) + a Go backend (`server/`). No desktop build.
- **Multi-user** — register / login (argon2id), per-user schemas stored server-side.
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
| — | `FFF_TURNSTILE_SITE_KEY` / `FFF_TURNSTILE_SECRET` | — | both set → Cloudflare Turnstile CAPTCHA on public forms (free; see [`docs/DEPLOY.md`](docs/DEPLOY.md)) |
| — | `FFF_ANTHROPIC_API_KEY` | — | AI assist key (beta) |
| — | `FFF_AI_BETA` | — | `true` to turn AI on — **needs the key too**; off by default (see [`docs/AI.md`](docs/AI.md)) |
| — | `FFF_AI_MODEL` | `claude-sonnet-5` | AI model override |
| `--session-secret` | `FFF_SESSION_SECRET` | — | *(reserved — sessions are opaque DB tokens, no signing yet)* |

The release binary embeds `web/dist` and serves the SPA + `/api` from one
process. In dev the SPA runs under Vite and proxies `/api` to the server.
Deploying for a team? → [`docs/DEPLOY.md`](docs/DEPLOY.md). Fastest path:
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

## Status

**F0–F12 + F5 done.** See [`PLAN.md`](PLAN.md) / [`PLAN-F6.md`](PLAN-F6.md) for
the phase log and [`docs/`](docs/) for the code walkthrough. AI-session
guidance is in [`CLAUDE.md`](CLAUDE.md) / [`GEMINI.md`](GEMINI.md).

Working today: multi-user auth (register / login / logout, first user = admin,
admin user list); the **template author** flow (detect XML / YAML / JSON / TOML
/ INI / `.env` / CSV or import a JSON Schema → retype → per-field labels, help
and validation presets → `%tokens%`); the **filler** flow (validated
fill-only form at `/fill/:id`, export in the original format); and **sharing**
(publish → `/f/:slug` public link → submissions collected server-side).

## Layout

```
web/      Vite + React 19 + TS + Tailwind v4 (emerald theme)
  src/core/form_flow/   ← the parser, copied verbatim from InfraKit, framework-free
  src/designer/         ← the schema-tree + live-form UI
  src/api/ src/stores/  ← backend client + Zustand state
server/   Go — chi router, modernc.org/sqlite, argon2id auth
docs/     ARCHITECTURE.md, API.md
```
