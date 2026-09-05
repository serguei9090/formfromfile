# FormFromFile — plan F29 (enable-when-needed: settings, observability, hardening)

Follows [`PLAN.md`](PLAN.md) (F0–F5), [`PLAN-F6.md`](PLAN-F6.md) (F6–F12),
[`PLAN-F13.md`](PLAN-F13.md) (F13–F18), [`PLAN-F19.md`](PLAN-F19.md) (F19–F28).

**Why this plan.** The app is production-ready for one internal team behind a
VPN / SSO proxy (8/10). The two missing points:

1. **Can't see it in prod** — no metrics, no error aggregation, no dependency
   scanning. An incident = grep JSON logs and guess.
2. **No scale/retention story** — SQLite tip-over point unmeasured, no
   Postgres path, no submission auto-delete / GDPR export.

Plus a recurring ask: security controls today are **env vars only** (Turnstile,
webhook-allow-private, allow-register, AI beta). Flipping one needs a container
restart. Want them **toggleable from the admin UI, off by default**.

**Design rule for every phase:** ships **dormant**. Default behaviour is
identical to today. A flag, an env var, or an admin toggle turns it on. No new
required config. `core/form_flow/**` stays frozen; work lands in the app /
server layers + `web/src/formflow_ext/**`. Each phase = its own commit(s) to
`main`, green gate first (`bun run build && bun run test && bun run lint && bun
run e2e`; `go build ./... && go vet ./... && go test ./... && golangci-lint run
./...`), Conventional Commits + `Co-Authored-By`.

---

## Phases at a glance

| # | Phase | Effort | Depends on | Ships on/off |
|---|-------|--------|-----------|--------------|
| **F29a** | Security headers + CSP middleware | S | — | on by default (safe), `FFF_SECURITY_HEADERS=off` to disable |
| **F29b** | Runtime settings — admin panel + `settings` table | M–L | — | table empty → env/defaults win (= today) |
| **F29c** | Observability — `/metrics`, error hook, CI scanning | M | — | off unless `FFF_METRICS_TOKEN` / `FFF_SENTRY_DSN` set |
| **F29d** | Rate-limit depth — per-slug cooldown + global ceiling | S–M | F29b | limits `0` = disabled (= today) |
| **F29e** | Data retention + GDPR export/delete | M | F29b | `retention_days` `0` = keep forever (= today) |
| **F29f** | Scale spike — Postgres adapter shape + load numbers | S | — | investigation only, no runtime change |

**Execution order:** F29a → F29b → F29c → F29d → F29e. F29f is a written
investigation, do it whenever.

**Migrations:** F29b adds `settings` (→ user_version v6). F29e adds
`schemas.retention_days` + `data_ops_log` (→ v7). Append-only as always.

---

## Progress

- **F29a done** — `httpapi/securityheaders.go`: `nosniff`, `X-Frame-Options
  DENY`, `Referrer-Policy same-origin`, `Permissions-Policy`, COOP, CSP
  (`default-src 'self'` + Turnstile host only when configured), HSTS on TLS
  only. `FFF_SECURITY_HEADERS=off` / `Options.DisableSecurityHeaders`. Cookie
  `Secure` uses shared `requestIsHTTPS` (proxy-aware). `--session-secret`
  dropped from docs. +3 tests.
- **F29b done** — `settings` table (migration v6) + `store/settings.go`.
  `httpapi/config.go` `effConfig` / `h.cfg()` merges DB row › Router value,
  5s cache + `invalidateCfg()` on write, keeps `ai.Service` enabled-flag in
  sync. `GET`/`PUT /api/admin/settings` (admin, audited, secret masked).
  Keys: `allow_register`, `turnstile_site_key`/`_secret`,
  `webhook_allow_private`, `ai_beta` (needs the key too), `submission_cap_default`.
  `/api/config`, register gate, Turnstile verify, webhook allow-list,
  submission cap + CSP all read `h.cfg()` → live toggles, no restart. AI
  service split: `New()` builds the client whenever the key is present,
  `SetEnabled`/`HasKey` added. UI: `AdminSettings` component folded into
  `/admin` (source badges, reset per key). +2 server tests, +1 e2e.
- **F29c done** — `internal/metrics` (hand-rolled Prometheus text, no
  client_golang): labelled counters + one histogram + scrape-time gauges.
  `GET /metrics` gated by `FFF_METRICS_TOKEN` (bearer). `requestLogger` feeds
  `fff_http_requests_total` / `_duration_seconds` (route pattern, not path);
  webhook + AI paths tapped. `h.recoverer` replaces `middleware.Recoverer` —
  logs the panic with the request id and POSTs `FFF_ERROR_WEBHOOK` if set.
  CI: `govulncheck` + Trivy image scan, both `continue-on-error` for now.
  **Deferred:** AI $ budget (needs an `ai_usage` table — folds into F29e's
  migration) + Sentry SDK (the generic webhook covers it). +4 tests.
- **F29d done** — `httpapi/submitguard.go`: per-slug cooldown
  (`submission_cooldown_seconds`) + process-wide UTC-daily ceiling
  (`submission_global_daily_max`), both settings-driven, `0` = off, checked
  before the schema load and committed only after the row is stored.
  `Retry-After` on the cooldown 429. Overridable `clock` for tests. Admin
  panel gains the two number fields. +1 test (fake clock).
- **F29e done** — migration **v7**: `schemas.retention_days` + `data_ops_log`.
  `store/retention.go`: `PurgeExpiredSubmissions` (per-template window ›
  `retention_days_default` setting), `ExportUser` / `EraseUser` (FK-cascade
  hard delete, last-admin guard), `LogDataOp` / `RecentDataOps`. Hourly sweep
  goroutine in `main.go` (no-op until a window is set).
  `GET /api/admin/users/{id}/export` (JSON attachment),
  `POST .../erase` (`{"confirm":"ERASE"}`), `GET /api/admin/data-ops`. Ops
  panel + admin page gain the controls. +6 tests. **AI $ budget still
  deferred** — needs token accounting from the SDK response, not just the
  table.
- **F29f done** — `store.Open` sets `journal_mode=WAL`, `synchronous=NORMAL`,
  `busy_timeout=5000` (kept `SetMaxOpenConns(1)`). `docs/SCALE.md`: write
  throughput is the ceiling (~100–300 submissions/s; logins are
  argon2id-bound), the `pgx` adapter is ~2–4 days (`store` has no raw-SQL
  leaks), plus a `k6` recipe. Conclusion: SQLite fits this workload.

**PLAN-F29 complete (F29a–F29f).** The 8/10 gaps are closed — observability
(`/metrics`, error webhook, CI scanning) and a scale/retention story (WAL,
retention + GDPR, SCALE.md). Everything shipped dormant.

---

## F29a — security headers + CSP  ·  S

The `Caddyfile` already sets HSTS / `nosniff` / `Referrer-Policy` /
`X-Frame-Options` for the compose deploy. Move the baseline into the app so
every deploy (nginx, bare binary, Tunnel) gets it, and add a real CSP.

- New `httpapi/securityheaders.go` middleware, added to the chain after
  `requestLogger`:
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: same-origin`
  - `X-Frame-Options: DENY` + `frame-ancestors 'none'` in CSP
  - `Permissions-Policy: geolocation=(), camera=(), microphone=()`
  - `Content-Security-Policy` — the SPA is self-hosted and asset hashes are
    known at build time, so: `default-src 'self'; img-src 'self' data:;
    style-src 'self' 'unsafe-inline'; script-src 'self'` **plus**
    `https://challenges.cloudflare.com` and `frame-src` the same, only when
    Turnstile is configured (compose that string from `opts`).
  - `Strict-Transport-Security` only when the request arrived over TLS
    (`r.TLS != nil` or `X-Forwarded-Proto: https` under `TrustProxy`).
- `FFF_SECURITY_HEADERS` — default `on`; `off` for debugging / an odd proxy.
- Cookie review: app routes `SameSite=Strict`, keep the share/submission flow
  on `Lax` only where cross-site POST is actually needed. Verify the current
  `Set-Cookie` and tighten.
- Decide `--session-secret`: either sign the cookie (`hmac` the token) or
  delete the flag + the README row. Lean **delete** — tokens are already
  opaque random + `sha256`-at-rest; signing adds nothing.
- Tests: `httpapi_test.go` — assert headers present, CSP includes the
  Turnstile host only when a site key is set, HSTS absent on plain HTTP.
- Docs: fold the header list out of `Caddyfile` comments into `docs/DEPLOY.md`
  §security; note Caddy's copies are now redundant but harmless.

---

## F29b — runtime settings (admin panel)  ·  M–L

A small key/value settings store, editable at `/admin/settings`, that overrides
env defaults **when a row exists**. Empty table → behaviour identical to today.

**Store**

- Migration v6: `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL,
  updated_at INTEGER, updated_by TEXT)`.
- `store/settings.go` — `GetSetting(key) (string, bool)`,
  `SetSetting(key, value, userID)`, `AllSettings() map[string]string`.
- Typed accessor layer `httpapi/config.go` — `func (h *handlers) cfg()
  effConfig` merges: **DB row › env var › built-in default**. One struct,
  computed per request (cheap — settings cache with a 5s TTL + invalidate on
  write).
- Keys (all optional):
  | key | overrides | type |
  |-----|-----------|------|
  | `allow_register` | `FFF_ALLOW_REGISTER` | bool |
  | `turnstile_site_key` / `turnstile_secret` | `FFF_TURNSTILE_*` | string |
  | `webhook_allow_private` | `FFF_WEBHOOK_ALLOW_PRIVATE` | bool |
  | `ai_beta` | `FFF_AI_BETA` | bool (still needs the key in env — secret stays out of the DB) |
  | `submission_cap_default` | — | int |
  | `submission_cooldown_seconds` | — | int (F29d) |
  | `submission_global_daily_max` | — | int (F29d) |
  | `retention_days_default` | — | int (F29e) |

  Secrets (`turnstile_secret`) stored, but **write-only** in the API response
  (return `"set"` / `""`, never the value) and masked in the UI.

**API**

- `GET /api/admin/settings` → `{ settings: {...}, effective: {...}, sources:
  {key: "db"|"env"|"default"} }` so the UI shows where each value comes from.
- `PUT /api/admin/settings` `{ key: value, ... }` — `requireAdmin`, validates
  types, writes changed keys, `h.audit("settings.update", ...)`.
- `/api/config` (public) starts reading `cfg()` instead of raw `opts` — so
  `allowRegister` / `turnstileSiteKey` reflect a live toggle with no restart.
- Everything that reads `h.opts.TurnstileSecret` / `WebhookAllowPrivate` /
  `AllowRegister` switches to `h.cfg().X`. `ai.Service` gets a
  `SetEnabled(bool)` or is re-created via a small factory the settings write
  calls.

**UI**

- `web/src/pages/AdminSettingsPage.tsx` — grouped form (Access, Anti-abuse,
  Webhooks, AI, Retention). Each field shows a badge: `env` / `default` /
  `overridden`. "Reset to default" per key = DELETE that row.
- `stores/authStore` already fetches `/config`; add `adminSettings` load/save
  to a new `settingsStore` or fold into an admin store.
- Route behind `requireAdmin` in `App.tsx`; link from `AdminPage`.
- e2e: `web/e2e/settings.spec.ts` — admin flips `allow_register` off, a fresh
  `/register` is rejected; flips it back on.

**Non-goals:** per-workspace settings (there are no workspaces — F28), hot-
reloading `--addr` / `--db` (process-level, stays env/flag).

---

## F29c — observability  ·  M

Make a prod incident debuggable without shell-diving. All opt-in.

- **Metrics** — `GET /metrics` (Prometheus text). Gated: served only when
  `FFF_METRICS_TOKEN` is set, requires `Authorization: Bearer <token>`
  (simplest safe default; no separate port needed). Use
  `prometheus/client_golang`.
  - `http_requests_total{method,route,status}`, `http_request_duration_seconds`
    (histogram) — from the existing `requestLogger`, add a metrics tap.
  - `fff_db_bytes` (stat the SQLite file, 30s refresh),
    `fff_sessions_active`, `fff_users_total`, `fff_submissions_total`.
  - `fff_webhook_deliveries_total{result}`,
    `fff_webhook_delivery_duration_seconds`.
  - `fff_ai_requests_total{op,status}`, `fff_ai_tokens_total{kind}`,
    `fff_ai_cost_usd_total` — wire into `ai.ask()`.
- **Error capture** — `FFF_SENTRY_DSN` optional. Thin wrapper (`sentry-go` or
  just a `func reportPanic(err, ctx)` posting to a generic webhook if we want
  zero deps). `middleware.Recoverer` already catches panics — add the report
  call + keep the structured log line + 500.
- **AI global budget** — `settings.ai_monthly_budget_usd` (F29b key). `ai.ask()`
  checks month-to-date spend (`ai_usage` table sum) before calling; over budget
  → `ErrBudgetExceeded` → 429 with a clear message. Admin sees spend on the
  settings page.
- **CI** — add `govulncheck ./...` to the server job and Trivy image scan to
  the docker job (`aquasecurity/trivy-action`, `severity: HIGH,CRITICAL`,
  `exit-code: 1`, ignore-unfixed). Non-blocking for 1 sprint, then blocking.
- Docs: `docs/DEPLOY.md` §observability — scrape config snippet, the env vars,
  "what to alert on" (5xx rate, webhook failure rate, db size, AI budget).

---

## F29d — rate-limit depth  ·  S–M   *(needs F29b)*

Today: one per-IP sliding window on public submissions. Add, all `0` = off:

- **Per-slug cooldown** — `settings.submission_cooldown_seconds`. In-memory
  `map[slug]time.Time` (last accepted), 429 + `Retry-After` if too soon.
  Per-process is fine (single binary).
- **Global daily ceiling** — `settings.submission_global_daily_max`. Counter
  reset at UTC midnight; protects against a single template getting hammered.
- **Per-template cap** already exists (F26) — surface its default in settings.
- Keep the per-IP window as the always-on floor.
- Consider `X-Forwarded-For` trust here too (only count real client IP under
  `TrustProxy`).
- Tests: table-driven in `httpapi_test.go` with a fake clock.

---

## F29e — data retention + GDPR  ·  M   *(needs F29b)*

- Migration v7: `schemas.retention_days INTEGER NOT NULL DEFAULT 0`
  (`0` = keep forever), `data_ops_log (id, actor, action, subject, at)`.
- **Auto-delete** — a background goroutine in `main.go` (ticker, hourly):
  `DELETE FROM submissions WHERE created_at < now - retention_days` per
  template, respecting `settings.retention_days_default` when a template's own
  value is `0`. Log a `data_ops_log` row with the count. Skip entirely if all
  effective values are `0`.
- **Per-template control** — a "Delete submissions older than ___ days" field
  in the template ops panel (`setTemplateOps` already exists — add the key).
- **GDPR endpoints** (`requireAdmin`):
  - `GET /api/admin/users/{id}/export` → a zip: the user's account row
    (sanitised), their templates, their submissions. Reuse `submissionsZip`
    plumbing.
  - `POST /api/admin/users/{id}/erase` → hard-delete the user + their
    templates + submissions + sessions, or anonymise submissions
    (`submitter` → `null`, keep the config payload) — make it a choice.
    Confirmation string required. `data_ops_log` entry.
- **Retention notice** — `docs/` a short `PRIVACY.md` stub + a config line for
  a custom privacy URL shown on `/f/:slug` (ties to F26 branding).
- Tests: retention deletes only aged rows; export zip contains the right
  files; erase leaves no orphan rows (`PRAGMA foreign_keys` / manual cascade
  check).

---

## F29f — scale spike  ·  S   *(investigation, no code)*

Write `docs/SCALE.md`:

- **Load test** — a `k6` or `vegeta` script hitting `/f/:slug` +
  `POST .../submissions` + authed `/schemas`. Run against the Docker image on
  one box. Record: req/s at p95 < 200ms, where write contention starts
  (`database is locked`), DB size vs. row count.
- **SQLite tuning already in place?** — check `busy_timeout`, `journal_mode`
  (WAL?), `synchronous`. Document current PRAGMAs, recommend WAL +
  `busy_timeout=5000` if not set (cheap win, could be a tiny F29a-ish commit).
- **Postgres adapter shape** — confirm `store` is a clean interface (it is —
  no raw SQL in handlers). Sketch the `pgx` implementation surface: which
  queries, which SQLite-isms (`INSERT OR REPLACE`, `PRAGMA user_version`,
  `AUTOINCREMENT`) need rewriting. Estimate effort.
- **Recommendation** — a concurrency number below which SQLite + Litestream is
  the right call, above which Postgres. For a config-handoff tool it's almost
  certainly "SQLite is fine forever"; the doc makes that defensible.

---

## Effort

F29a S · F29b M–L · F29c M · F29d S–M · F29e M · F29f S → **L total**,
~1 week. F29a + F29b are the load-bearing ones (headers + the toggle UI the
user asked for); F29c–F29e are independent and can land in any order or be
dropped until needed.

## Out of scope (still — see F28)

OIDC / SSO, workspaces / multi-tenancy, 2FA / WebAuthn, Postgres
*implementation* (F29f only sketches it), email-on-submit, i18n, PWA.
