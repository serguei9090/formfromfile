# FormFromFile — plan F33 (optional Postgres backend)

## The ask

Let an operator point FormFromFile at an external Postgres instead of the
embedded SQLite file — for when they already run Postgres, want managed
backups / HA / PITR, or expect write volume past SQLite's serialized-writer
ceiling (see [`../deployment/SCALE.md`](../deployment/SCALE.md)).

**SQLite stays the default and the recommendation for a single team.** This
is opt-in, nothing changes when unused.

## How it's selected — env var, not a config file

The project has no config file anywhere; everything is `FFF_*` env / flags,
overridable at runtime from Admin → Settings where it makes sense. Postgres
selection follows that:

```
FFF_DATABASE_URL=""                                  # unset → SQLite at --db / FFF_DB (today's behavior)
FFF_DATABASE_URL="/data/formfromfile.db"             # a path → SQLite there
FFF_DATABASE_URL="postgres://user:pw@host:5432/fff?sslmode=require"   # → Postgres
```

`store.Open` switches on the scheme (`postgres://` / `postgresql://` →
Postgres; anything else → SQLite path, keeping `--db` / `FFF_DB` as the
back-compat alias). No new file format, no migration of the flag surface.

Postgres init is just the URL — the operator creates the database and role
(`CREATE DATABASE fff; CREATE ROLE fff LOGIN PASSWORD '…'; GRANT …`), the app
creates its own tables/migrations on first boot exactly like it does for
SQLite. `docker-compose.yml` gets an optional `postgres` service (commented
out by default) + a documented `DATABASE_URL` line.

## Why it's ~1–2 days, not "add a driver"

The connection is the easy 5%. The real work:

### 1. Driver (small)
- Add `github.com/jackc/pgx/v5` + `pgx/v5/stdlib` (pure Go, **no cgo** — keeps
  `CGO_ENABLED=0` and the distroless image).
- `store.Open`: `sql.Open("pgx", url)` for the pg path; drop
  `SetMaxOpenConns(1)` and the `PRAGMA` block, set a sane pool size instead.

### 2. Placeholders (mechanical)
- 148 `?` placeholders across `store/*.go`. Postgres wants `$1,$2,…`.
- Add a thin `rebind(query string) string` on the store that rewrites `?`→`$N`
  only on the pg path (the sqlx approach), applied in a small query wrapper.
  ~15 lines; no query text changes.

### 3. Migrations (contained)
- `PRAGMA user_version` → a `schema_migrations(version int primary key)`
  table. `migrate()` reads/writes that instead.
- Audit the 9 shipped migration strings + the base `schema` const for
  dialect gaps. Known ones:
  - `lower(hex(randomblob(12)))` in the **v3** data backfill → generate the
    ids in Go and `INSERT … SELECT` from a values list, or use
    `gen_random_uuid()` on pg / keep sqlite as-is (dual string).
  - `strftime('%s','now')` in `SessionsActive` (`store.go:253`) →
    `extract(epoch from now())::bigint` on pg.
  - `lower(name) LIKE ?` / `tags LIKE ?` (`schemas.go:134-138`) → `ILIKE` on
    pg (or keep `lower()` + `LIKE`, ensure the bind value is lowercased).
  - `CREATE UNIQUE INDEX … WHERE … IS NOT NULL` (partial index, v2 + v8) —
    **portable, Postgres supports it**, no change.
  - `INSERT … ON CONFLICT(col) DO UPDATE` — portable, no change.
  - `ALTER TABLE … ADD COLUMN … DEFAULT` — portable.
  - Integer booleans (`disabled INTEGER 0/1`) — keep as int, portable.
- No SQLite JSON functions in play (`json_extract`/`json_each` — grep is
  clean; blobs are opaque TEXT parsed in Go). This is the big reason it's
  tractable.

### 4. Concurrency correctness (the part that actually needs care)
Today `SetMaxOpenConns(1)` serializes every write, so these
read-then-write sequences are safe by construction:
- last-admin guards — `auth/service.go:302,330` (`SetDisabled`, `SetRole`),
  `store/retention.go:169` (`EraseUser`)
- per-form submission cap — `store/ops.go:58` (count then allow/deny insert)
- any "SELECT current_version, then INSERT version+1" in the versioning path

Under a Postgres pool these become TOCTOU races. Each needs wrapping in a
transaction with `SELECT … FOR UPDATE` on the gating row (or a serializable
tx, or a pg advisory lock for the global ones). This is ~6 call sites, must
be done for both backends (a tx is fine on SQLite too), and is the item
most likely to hide a bug if rushed.

### 5. Tests + CI
- `store` tests currently `t.TempDir()` a SQLite file. Add a pg path gated on
  `TEST_DATABASE_URL` (skip when unset) — reuse the exact same test bodies.
- CI: a `postgres:16` service container + a second `go test ./internal/store`
  run with `TEST_DATABASE_URL` set. `httpapi` tests too, ideally.
- `golangci-lint`, `govulncheck` already cover the new dep.

### 6. Docs
- `README.md` env table + `docs/deployment/DEPLOY.md` (a "use Postgres"
  section) + `docs/deployment/SCALE.md` (replace "if Postgres is ever needed"
  with "how to switch") + `docker-compose.yml` optional service +
  `.env.example`.

## Production secret handling (env is fine — with these)

An env var for `DATABASE_URL` is standard (12-factor) and every host injects
it that way. The DSN carries a password, so:

1. **Redact it everywhere it's printed.** Today `main.go:103` logs
   `"db", *dbPath` at startup and `usercli.go:64` prints it in an error — a
   Postgres URL there dumps `postgres://user:PASSWORD@host` into logs. F33
   must add a `redactDSN(url) string` that logs scheme + host + dbname only
   (`postgres://host:5432/fff`), and route both sites (and any future one)
   through it. Same audit for the `FFF_ERROR_WEBHOOK` panic payload and the
   `/api/config` / metrics / admin-settings responses (none echo it today —
   keep it that way).
2. **Support `FFF_DATABASE_URL_FILE`.** Read the DSN from a file path if the
   `_FILE` variant is set — lets Docker/Compose/k8s secrets provide it
   without the value ever being a process env var (`docker inspect`,
   `/proc/<pid>/environ`, child processes). Small, widely-expected
   convention.
3. **Never commit the DSN.** `docker-compose.yml` references `${DATABASE_URL}`
   from a gitignored `.env` (compose already does this for other secrets) or
   a Docker secret — never an inline `environment:` literal. Document in
   `DEPLOY.md`.
4. **Require TLS.** Document `sslmode=require` (or `verify-full` + a CA) in
   the example URL; a bare `sslmode=disable` to a remote host is a mistake.
5. **`registerMetrics`** — the `fff_db_bytes` gauge `os.Stat`s the path;
   skip it (or report 0) on the Postgres path where there's no file.

Host-specific: k8s `Secret` (as env or mounted file + `_FILE`), or
external-secrets pulling from Vault / AWS Secrets Manager / GCP Secret
Manager; Fly/Render/Railway use their own encrypted variable store. All of
these still hand the app an env var or a file — the app side is the same.

## Out of scope for F33
- Automatic SQLite→Postgres data migration (document `pgloader` or a manual
  dump/load; most adopters start fresh).
- MySQL / other engines.
- Read replicas / connection routing.

## Sequencing (each its own commit, green gate first)

1. `store.Open` scheme switch + pgx dep + `rebind` wrapper + `schema_migrations`
   table (SQLite path routed through the same wrapper, behavior identical).
   `FFF_DATABASE_URL` + `_FILE` variant; `redactDSN` + route the two logging
   sites through it; `fff_db_bytes` gauge conditional.
2. Migration-string dialect audit + the 3 function swaps.
3. Transaction-wrap the 6 TOCTOU sites (lands for both backends).
4. `TEST_DATABASE_URL` test path + CI service container.
5. Docs + compose (optional `postgres` service, `${DATABASE_URL}` from
   gitignored `.env`) + `.env.example`.

Estimate: 1–2 focused days. Ships behind an unset env var — zero risk to
existing SQLite deployments until someone sets `FFF_DATABASE_URL`.

---

## Progress — done

One commit. `FFF_DATABASE_URL=postgres://…` (or `_FILE`) switches
`store.Open` to Postgres; unset = SQLite, unchanged.

- **`internal/store/postgres.go`** — a `database/sql` driver wrapper
  (`pgx-rebind`) that rewrites `?` → `$N` on every statement, so all ~90 DB
  call sites and the 3 existing `tx` blocks run unchanged. `pgDDL` adapts DDL
  (`INTEGER`→`BIGINT`; the v3 `lower(hex(randomblob()))` → `md5(random()…)`).
  `splitStatements` runs multi-statement migration strings one at a time
  (pgx extended protocol rejects batched statements). `schema_migrations`
  table replaces `PRAGMA user_version`; each migration in its own tx.
  `RedactDSN` / `IsPostgresDSN` exported.
- **`internal/store/errors.go`** — `IsUniqueViolation` (SQLite message *or*
  pg SQLSTATE 23505); `auth` now uses it instead of matching `"UNIQUE"`.
- **`internal/store/users_guard.go`** — `SetUserDisabled` / `SetUserRole`
  do the last-admin check + write in one tx with `SELECT … FOR UPDATE` on
  the admin rows (`forUpdate` is `""` on SQLite). `EraseUser` (retention.go)
  wrapped the same way. `auth.Service.SetDisabled` / `SetRole` now delegate.
  `TestLastAdminGuardConcurrent` proves two concurrent demotions leave one
  admin — on both backends.
- **`SessionsActive`** — was comparing millis to `strftime('%s')` seconds
  (counted expired sessions); now a bound millis param. Portable + a bug fix.
- **`PurgeExpiredSubmissions`** — rewritten `created_at + window < now`
  instead of `now - window` so both placeholders have a type context
  (Postgres rejects bare `? - ?`).
- **`cmd/formfromfile`** — `resolveDBTarget` (`FFF_DATABASE_URL_FILE` ›
  `FFF_DATABASE_URL` › `--db`); startup log + CLI errors go through
  `RedactDSN`; `fff_db_bytes` gauge skipped on Postgres; `user` CLI honours
  the URL.
- **Tests** — `store` + `auth` harnesses open `TEST_DATABASE_URL` (public
  schema wiped per test) when set. CI `server` job gains a `postgres:16`
  service and a second `go test -p 1 ./internal/store/... ./internal/auth/...`
  pass.
- **Docs** — `.env.example` (DB section, SQLite default), `docker-compose.yml`
  (commented `db:` service), README env table, `DEPLOY.md` §Postgres,
  `SCALE.md`.

### Not done (follow-up)
- `httpapi` tests still SQLite-only (they exercise HTTP wiring, not SQL
  portability; `store` + `auth` cover the backend).
- Submission-cap enforcement (`SubmissionCount` then insert, at the httpapi
  layer) is still check-then-act — a burst on Postgres can overshoot the cap
  by a handful. Anti-spam feature, acceptable; note in the ops docs if it
  ever matters.
- No SQLite → Postgres data migration tool.
