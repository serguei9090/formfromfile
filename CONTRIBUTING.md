# Contributing

Thanks for looking. This is a small project — the bar is "does it work and is
it tested," not ceremony.

## Setup

```bash
# backend — http://localhost:8787
cd server && go run ./cmd/formfromfile --addr 127.0.0.1:8787 --db formfromfile.db

# frontend — http://localhost:5273, proxies /api → :8787
cd web && bun install && bun run dev
```

See [`README.md`](README.md) for the full quickstart and
[`CLAUDE.md`](CLAUDE.md) for stack decisions, conventions, and "how to add a
new endpoint / page" recipes — it's written for AI coding sessions but is
equally the map for a human.

## Before opening a PR

Green gate, both sides that apply to your change:

```bash
cd web    && bun run build && bun run test && bun run lint
cd server && go build ./... && go vet ./... && go test ./...
```

`golangci-lint run ./...` if you touched Go (CI enforces it; not everyone has
it installed locally — CI will catch it either way).

For a UI change, actually click through it in a browser before opening the
PR — type-checking and unit tests verify correctness, not that the feature
works. `bun run e2e` runs the Playwright suite (`web/e2e/`) if your change
touches a flow that's covered there.

If your change is visible in the README's screenshots/demo GIF, regenerate
them: `bun run demo` (from `web/`) drives a headless browser through the
real detect → publish → fill → submit lifecycle and re-encodes
`docs/assets/*.png`/`demo.gif`/`demo.mp4` via `ffmpeg` (must be on `PATH`).

## Conventions worth knowing before you dive in

- `web/src/core/form_flow/**` is a **verbatim port** from a sibling project
  (InfraKit Studio) and is intentionally frozen — framework-free, zero React
  imports (`grep -rl "from 'react" web/src/core` must print nothing). Extend
  around it in `web/src/formflow_ext/**`, don't edit the core parser itself.
- Backend queries touching user data always carry `WHERE ... AND user_id = ?`.
  `store.ErrNotFound` doubles as "not yours" — don't leak a 403 vs 404
  difference for another user's row.
- No hardcoded hex colors in the frontend — the emerald theme lives in CSS
  custom properties (`src/index.css`); use a Tailwind token (`bg-primary`,
  `text-muted-foreground`, …).
- One logical change per commit, present-tense Conventional Commit style
  (`feat: …`, `fix: …`, `docs: …`) — see `git log` for the pattern this repo
  already follows.

## Reporting a bug

Open a GitHub issue. Include: what you did, what you expected, what
happened, and the server/browser console output if there's an error.
Backend errors are always `{"error": "..."}` with a status code — include
that if it's an API issue.

## Reporting a security issue

Don't open a public issue for anything exploitable. See
[`SECURITY.md`](SECURITY.md).

## Scope note

This is a spin-out of a larger internal tool (see `README.md`'s "Spun out
of InfraKit Studio" line) maintained by one person as a public side project.
PRs are welcome; response time varies. If you're planning something large,
open an issue first so we can agree on direction before you invest the time.
