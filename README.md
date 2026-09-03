# FormFromFile

Upload an XML or YAML file, auto-detect its schema (including repeating /
dynamic-array sections), get a generated form, fill it, export the result.

A standalone spin-out of **InfraKit Studio**'s FormFlow module, with multi-user
accounts and per-user saved forms.

- **Web only** — a static SPA + a Go backend. No desktop build.
- **Multi-user** — register / login (argon2id), per-user schemas stored
  server-side.
- MIT licensed.

## Layout

```
web/      Vite + React 19 + TS + Tailwind v4, emerald theme
server/   Go — chi router, modernc.org/sqlite, argon2id auth
PLAN.md   phased build plan (F0–F5)
```

## Develop

```bash
# frontend (http://localhost:5273, proxies /api → :8787)
cd web && bun install && bun run dev

# backend
cd server && go run ./cmd/formfromfile --addr 127.0.0.1:8787 --db formfromfile.db
```

Frontend checks: `bun run build`, `bun run test`, `bun run lint`.
Backend checks: `go build ./...`, `go vet ./...`, `go test ./...`.

## Server flags / env

| flag | env | default |
|------|-----|---------|
| `--addr` | `FFF_ADDR` | `127.0.0.1:8787` |
| `--db` | `FFF_DB` | `formfromfile.db` |
| `--session-secret` | `FFF_SESSION_SECRET` | random (sessions drop on restart) |
| `--allow-register` | `FFF_ALLOW_REGISTER` | `true` |

The release binary embeds `web/dist` and serves the SPA + `/api` from one
process. In dev the SPA runs under Vite and proxies `/api` to the server.

## Status

**F0 done** — scaffold: web app shell (router, emerald theme, theme toggle,
placeholder pages), Go server (`/healthz`, `/api/config`, SQLite schema for
`users` / `sessions` / `schemas`). Next: F1 port the FormFlow core, F2 auth
backend. See [`PLAN.md`](PLAN.md).
