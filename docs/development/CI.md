# CI/CD

One workflow, [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml),
runs on every push to `main` and every pull request. Four jobs, two of them
gating the other two.

```mermaid
flowchart LR
    web[web] --> e2e[e2e]
    server[server] --> e2e
    web --> docker[docker]
    server --> docker
```

There is no separate release/publish workflow yet — a tag doesn't build or
push an image anywhere. See "What's not here" below.

## `web`

Runs in `web/`, using `bun`.

1. `bun install --frozen-lockfile`
2. `bun run build` — `tsc -b` (typecheck) + `vite build`
3. `bun run test` — Vitest, jsdom
4. `bun run lint` — oxlint

Reproduce locally exactly as CI does:

```bash
cd web
bun install --frozen-lockfile
bun run build && bun run test && bun run lint
```

## `server`

Runs in `server/`, Go 1.26.

1. `go vet ./...`
2. `go test ./...`
3. `go build ./...`
4. `golangci-lint` (v2, via `golangci/golangci-lint-action`) — must be clean,
   this one blocks the job.
5. `govulncheck` — **non-blocking** (`continue-on-error: true`). Stdlib
   advisories often just need the next Go patch release; flip this to
   blocking once it's been green for a while.

Reproduce locally:

```bash
cd server
go vet ./... && go test ./... && go build ./...
golangci-lint run ./...   # go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
```

## `e2e`

Needs `web` and `server` to pass first. Installs both toolchains, installs
the Playwright Chromium browser, then runs `bun run e2e` from `web/` — the
Playwright config boots a throwaway `go run` API server (temp SQLite file)
and the Vite dev server, then drives Chromium against them
(`web/e2e/*.spec.ts`). On failure, the HTML report is uploaded as a build
artifact (`playwright-report/`, 7-day retention) — download it from the
failed run's Summary page to see traces/screenshots per failing test.

Reproduce locally:

```bash
cd web
bunx playwright install --with-deps chromium   # once
bun run e2e
```

## `docker`

Needs `web` and `server` to pass first.

1. Builds the multi-stage `Dockerfile` (bun → distroless static) and loads
   it locally as `formfromfile:ci` (build cache via GitHub Actions cache).
2. Trivy scans the image for HIGH/CRITICAL CVEs — **non-blocking** for the
   same reason as `govulncheck`.
3. Smoke test: runs the container, polls `/healthz`, then curls
   `/healthz`, `/api/config`, `/` (confirms the real SPA is embedded, not
   the placeholder `dist/`), and `/api/auth/register` (confirms the
   first-user-is-admin bootstrap works end-to-end in the packaged image).
4. Always dumps container logs and removes the container, pass or fail.

Reproduce locally:

```bash
docker build -t formfromfile:ci .
docker run -d --name fff -p 8787:8787 formfromfile:ci
curl -fsS http://localhost:8787/healthz
docker rm -f fff
```

## What's not here

- **No release/publish job.** Tagging a version doesn't push an image to any
  registry — the `docker` job only builds+smoke-tests, `load: true`, nothing
  is pushed. If you want `git tag v0.x.y` to publish to GHCR/Docker Hub,
  that's a new job (or workflow) to add, gated on tag pushes
  (`on.push.tags`), using `docker/login-action` + `push: true`.
  [`docs/planning/PLAN.md`](../planning/PLAN.md) tracks the `v0.1.0`
  tag itself as still open.
- **No dependency-update automation** (Dependabot/Renovate) configured.
- **No CodeQL / SAST workflow** — `govulncheck` and Trivy cover known-CVE
  scanning of dependencies and the built image, not static analysis of this
  repo's own code beyond what `go vet`/`golangci-lint`/`oxlint` already do.
