# Scale notes (F29f)

An honest read on how far the single-binary + SQLite design goes, and what a
Postgres move would take. Short version: **for a config-handoff tool used by
one team — or several — SQLite is the right call and likely always will be.**

## Current shape

- One Go process, one SQLite file, `SetMaxOpenConns(1)` — every write
  serializes through Go, so `database is locked` cannot occur under normal
  operation.
- PRAGMAs (set in `store.Open`, F29f): `journal_mode=WAL`,
  `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`.
- Reads and writes are all short, indexed, single-row or small-range. No
  analytical queries, no full-table scans on the hot paths (the retention
  sweep scans `submissions` once/hour — acceptable).
- Blobs (`body`, `form_json`, `values_json`, `output`) are capped at 1 MiB
  each and live in-row.

## Where it tips over

The binding constraint is **write throughput**, because writes are serialized.
A write here is: a submission insert (+ maybe a version row), an auth
register/login (argon2id dominates — ~50–100 ms of CPU, not disk), a template
save. Realistic ceiling on a small VM:

| workload | sustained rate before latency climbs |
|---|---|
| public submissions | ~100–300 / sec (WAL commit is sub-ms; the insert + FK checks + webhook fan-out enqueue are the cost) |
| logins | ~10–30 / sec (argon2id CPU-bound — raise/lower with the argon params, not the DB) |
| template saves | irrelevant (authors are a handful of people) |

Reads are not a constraint: WAL lets the single connection serve reads without
blocking the writer, and every read is indexed.

**Rule of thumb:** below ~dozens of concurrent *authors* and a few hundred
submissions/minute, SQLite is comfortable. Above that — hundreds of concurrent
writers, or a multi-tenant SaaS with thousands of orgs — Postgres earns its
keep.

## If Postgres is ever needed

The codebase is already shaped for it: **no raw SQL escapes the `store`
package** (`grep -rn "s.DB" internal/httpapi` → nothing). A `store` interface +
a `pgx` implementation is a contained change. The SQLite-isms to rewrite:

- `PRAGMA user_version` migrations → a `schema_migrations` table (or adopt
  `golang-migrate`).
- `INSERT … ON CONFLICT(key) DO UPDATE` — works in Postgres as-is.
- `strftime('%s','now')`, `lower(...)` `LIKE` — swap for `extract(epoch …)`,
  `ilike`.
- `randomblob`/`hex` id generation in v3's data migration — move to Go.
- `AUTOINCREMENT` — none used (all ids are app-generated `xxx_<hex>`).
- Drop `SetMaxOpenConns(1)`; Postgres does its own concurrency.
- FK `ON DELETE SET NULL` / `CASCADE` — identical syntax.

Estimate: **2–4 days** for the adapter + migration tooling + a CI matrix that
runs the store tests against both.

## Load-test recipe (not yet run)

```bash
# submissions — needs a published template's slug
cat > sub.js <<'EOF'
import http from 'k6/http'
export const options = { vus: 50, duration: '2m' }
export default function () {
  http.post('https://forms.internal/api/public/templates/<slug>/submissions',
    JSON.stringify({ valuesJson: '{}', output: 'x' }),
    { headers: { 'Content-Type': 'application/json' } })
}
EOF
k6 run sub.js
```

Record: submissions/sec at p95 < 200 ms, `fff_db_bytes` vs. row count,
`fff_http_request_duration_seconds` histogram, and whether any
`database is locked` shows up in the logs (it should not).

## Backups with WAL

A plain `cp formfromfile.db` can miss the `-wal` file. Use
`sqlite3 db ".backup out.db"`, `VACUUM INTO`, or **Litestream** (handles WAL
natively — see [`DEPLOY.md`](DEPLOY.md) §backups). This is already the
recommendation there.
