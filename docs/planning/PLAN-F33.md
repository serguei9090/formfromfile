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

## Out of scope for F33
- Automatic SQLite→Postgres data migration (document `pgloader` or a manual
  dump/load; most adopters start fresh).
- MySQL / other engines.
- Read replicas / connection routing.

## Sequencing (each its own commit, green gate first)

1. `store.Open` scheme switch + pgx dep + `rebind` wrapper + `schema_migrations`
   table (SQLite path routed through the same wrapper, behavior identical).
2. Migration-string dialect audit + the 3 function swaps.
3. Transaction-wrap the 6 TOCTOU sites (lands for both backends).
4. `TEST_DATABASE_URL` test path + CI service container.
5. Docs + compose + `.env.example`.

Estimate: 1–2 focused days. Ships behind an unset env var — zero risk to
existing SQLite deployments until someone sets `FFF_DATABASE_URL`.
