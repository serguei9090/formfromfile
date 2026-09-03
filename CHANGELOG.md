# Changelog

All notable changes. Format loosely follows [Keep a Changelog](https://keepachangelog.com);
this project versions by milestone rather than semver until 1.0.

## [Unreleased] — v0.2 (F19–F26)

Plan + progress: [`PLAN-F19.md`](PLAN-F19.md). F24 (more formats + bulk CSV)
and F27 (integrations) deferred.

### Added

- **Reverse fill + diff** (F20) — load form values from an already-filled file;
  a value-tree diff on the fill screen and on each submission; "re-run a past
  submission against the current template".
- **Template lifecycle** (F21) — version history + rollback + per-version
  notes; draft/published status; folders + tags + search; duplicate/fork;
  an approval queue (`requires_approval` → submissions land `pending`).
- **Validation depth** (F22) — conditional visibility / requirement
  (structured predicates, no `eval`), computed fields (`${host}:${port}`),
  named cross-field rules, an author-configured async check proxy, richer
  JSON Schema import (`$ref` / `allOf` / `oneOf`-of-consts).
- **AI assist** (F23) — server-side, `FFF_ANTHROPIC_API_KEY`-gated (501 without
  it): suggest labels & validation, explain a diff, generate a starter file
  from a description, fill a form from a plain-English instruction.
- **Team & workflow** (F25) — an `author` role (fillers can't author);
  submission comment threads; HMAC-signed webhooks with a delivery log;
  `submissions.zip` export; an admin Users page.
- **Ops** (F26) — an audit log; per-form submission cap; per-form public-page
  branding (accent colour + logo); completion-rate analytics.
- **Order-preserving XML** (F19) — opt-in render that keeps between-element
  comments in place. `CHANGELOG.md`, `v0.1.0` tag.

### Env

`FFF_ANTHROPIC_API_KEY`, `FFF_AI_MODEL` (default `claude-sonnet-5`). Both
degrade to feature-off.

## [0.1.0] — 2026-09-03

First tagged release. A hosted web app: upload an XML / YAML / JSON / TOML /
INI / `.env` / CSV file (or a JSON Schema), auto-detect its structure, generate
a validated form, fill it, export in the original format. Multi-user, with
publish-a-share-link and server-side submission collection.

### Added

- **Auth & multi-user** (F2–F4) — register / login / logout, argon2id + opaque
  sessions, first user = admin, admin user list, per-user saved forms.
- **The designer** (F4b, F9, F14) — detect → retype fields → per-field ⚙ panel
  (label, help, validation presets, required, enum, regex escape hatch),
  collapsible + filterable schema tree, Design ▏ Fill preview toggle.
- **FormFlow core** (F1) — ported verbatim from InfraKit Studio; all F6+ work
  lives in a `web/src/formflow_ext/` layer that never touches it.
- **Schema model v2** (F6) — `FieldMeta` side-car keyed by dotted path; tolerant
  `formJson` loader (old saves still open); `PRAGMA user_version` migrations.
- **XML fidelity** (F7) — attributes, `#text`, comments and the `<?xml?>`
  declaration round-trip; arrays seed one item per source occurrence.
- **Tokens** (F8) — `%X%` / `${x}` / `{{x}}` placeholders become form fields,
  substituted on export.
- **Validation** (F9, F10) — 10 named presets (IPv4, hostname, port, email, …),
  `editor="…"` attribute → preset auto-mapping, a validated fill-only view at
  `/fill/:id` that blocks export until valid.
- **Publish & share** (F11) — publish a template → `/f/:slug` public fill page
  (no login) → submissions collected server-side; owner review + CSV export +
  per-row delete (F15).
- **Comment/order-preserving YAML + `.env`** (F13) — hand-written configs come
  back looking hand-written; `smartScalar` keeps `"1.0"` / `"007"` intact.
- **Format plugins** (F12) — TOML, INI/`.properties`, `.env`, CSV; JSON Schema
  import maps declared types straight onto fields + validation.
- **Fill polish** (F15) — localStorage draft autosave, "N of M required" progress,
  "Submit another", public-page theme toggle.
- **Onboarding** (F18) — sample-template gallery on the empty state,
  `?sample=` auto-load, first-run tip.
- **Release** (F5) — multi-stage `Dockerfile` (bun → `CGO_ENABLED=0 go build` →
  distroless static, ~14 MB, `nonroot`, `/data` volume, `HEALTHCHECK`);
  GitHub Actions CI (web + server gates + container smoke test).

### Performance / quality

- Route-level `React.lazy` — initial JS 613 → 210 kB (F16).
- a11y pass — `aria-expanded`, `role="alert"`, focus management (F16).
- `internal/httpapi` handler tests, `golangci-lint`, offline banners (F17).
