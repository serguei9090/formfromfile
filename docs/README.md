# FormFromFile documentation

Start with the root [`README.md`](../README.md) for the pitch, quickstart, and
env-var reference. Everything below is organized by what you're trying to do.

## Guides

Feature-level how-tos, for someone configuring or using the app.

- [**Authentication**](guides/AUTH.md) — password auth, admin-provisioned
  users, Firebase Google sign-in, per-template access gates.
- [**AI assist**](guides/AI.md) — the optional (beta, off by default)
  Anthropic-powered suggest/explain/generate/fill-assist features.

## Reference

- [**API**](reference/API.md) — the HTTP contract: every route, request/response
  shape, status codes.

## Architecture

How the code is put together.

- [**Architecture**](architecture/ARCHITECTURE.md) — file-by-file walkthrough
  of both `web/` and `server/`.
- [**Diagrams**](architecture/DIAGRAMS.md) — system overview, request flow,
  auth flow, and the detect → fill → export → publish → submit lifecycle.

## Deployment

- [**Deploy**](deployment/DEPLOY.md) — `docker compose up -d` quickstart,
  manual Docker, nginx, Cloudflare Tunnel + Access, security headers,
  observability, backups, upgrades, a pre-handoff checklist.
- [**Scale**](deployment/SCALE.md) — where SQLite tips over, what a Postgres
  migration would take, a load-test recipe.

## Development

- [**CI/CD**](development/CI.md) — what each GitHub Actions job does and how
  to read a failure.

## Planning (phase logs)

Working history of how the project got here, phase by phase — most useful if
you're picking up an in-progress thread or curious about a past decision's
"why." Not required reading to use or deploy the app.

- [`planning/PLAN.md`](planning/PLAN.md) — F0–F5 (the original build-out)
- [`planning/PLAN-F6.md`](planning/PLAN-F6.md) — F6–F12 (extension layer:
  metadata, validation, tokens, publish/share)
- [`planning/PLAN-F13.md`](planning/PLAN-F13.md) — F13–F18 (polish: fidelity,
  quality gate, a11y, onboarding)
- [`planning/PLAN-F19.md`](planning/PLAN-F19.md) — F19–F28 (v0.2: lifecycle,
  AI, more formats, team/workflow, ops, public-internet hardening roadmap)
- [`planning/PLAN-F29.md`](planning/PLAN-F29.md) — F29 (runtime settings,
  observability, rate limits, data retention/GDPR, scale notes)
- [`planning/PLAN-F32.md`](planning/PLAN-F32.md) — F32 (admin-provisioned
  users, per-template auth gate)

See also [`../CHANGELOG.md`](../CHANGELOG.md) for the release-notes view of
the same history, and [`../CLAUDE.md`](../CLAUDE.md) for the standing
AI-coding-session brief (stack, conventions, how to add things).
