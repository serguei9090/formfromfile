# HTTP API

Base: `/api`. JSON in, JSON out. Auth is a session cookie `fff_session` (HttpOnly,
`SameSite=Lax`, `Secure` under TLS, 30-day sliding). Errors are
`{ "error": "message" }` with a matching status code.

Handlers: `server/internal/httpapi/`. Route table: `httpapi.go` `Router()`.

---

## Public

### `GET /healthz`
`200 → { "ok": true }`. No auth. (Note: this one is at the server root, not
under `/api`.)

### `GET /api/config`
`200 → { "allowRegister": bool }` — mirrors the `--allow-register` flag.

### `POST /api/auth/register`
Body `{ "email": string, "password": string }` (password ≥ 10 chars).
- The **first account ever** becomes `admin`; the rest are `user`.
- Blocked with `403` if `allowRegister` is false **and** at least one account
  already exists (the bootstrap admin is always allowed).
- On success also logs the user in (sets the cookie).
- `201 → { "user": User }` · `409` email taken · `400` validation.

### `POST /api/auth/login`
Body `{ "email", "password" }`.
- `200 → { "user": User }` + `Set-Cookie` · `401` bad credentials ·
  `403` account disabled · `429` throttled (after 3 failed attempts for that
  `ip|email`, exponential backoff, 15-min cap).

### `POST /api/auth/logout`
Revokes the current session. `200 → { "ok": true }`. Always clears the cookie.

### `GET /api/auth/me`
`200 → { "user": User | null }` — `null` (not `401`) when there's no valid
session.

---

## Authenticated (`requireAuth`)

### `GET /api/schemas`
`200 → { "schemas": SchemaSummary[] }` — the caller's forms, newest edit first,
**without** `body`/`formJson`.

### `POST /api/schemas`
Body `{ "name", "kind": "xml"|"yaml"|"json", "body": string, "formJson": string }`
(`body` and `formJson` ≤ 1 MiB each).
`201 → { "schema": SchemaRecord }` · `400` validation.

### `GET /api/schemas/{id}`
`200 → { "schema": SchemaRecord }` (with bodies) · `404` missing **or not
yours**.

### `PUT /api/schemas/{id}`
Same body as POST. `200 → { "schema": SchemaRecord }` · `404`.

### `DELETE /api/schemas/{id}`
`200 → { "ok": true }` · `404`.

### `POST /api/schemas/{id}/publish`
Marks the template `shared`, minting a `share_slug` on first publish (kept on
re-publish). `200 → { "schema": SchemaRecord }` · `404`.

### `POST /api/schemas/{id}/unpublish`
Back to `private` (slug retained). `200 → { "schema": SchemaRecord }` · `404`.

### `GET /api/schemas/{id}/submissions`
`200 → { "submissions": SubmissionSummary[] }` — newest first, **without**
`valuesJson` / `output`. `404` if not yours.

### `GET /api/submissions/{id}`
`200 → { "submission": SubmissionRecord }` (with blobs) · `404` missing or the
template isn't yours.

### `DELETE /api/submissions/{id}`
`200 → { "ok": true }` · `404` missing or the template isn't yours.

---

## Public share (no auth)

### `GET /api/public/templates/{slug}`
`200 → { "template": { name, kind, body, formJson } }` — no owner id, no other
templates. `404` if the slug isn't currently shared.

### `POST /api/public/templates/{slug}/submissions`
Body `{ "submitter"?: string, "valuesJson": string, "output": string }`
(`valuesJson`/`output` ≤ 1 MiB). Client renders `output`; the server stores it.
A logged-in caller is attributed, otherwise anonymous. Per-IP fixed window
(20/min) → `429`. `201 → { "submission": { id, createdAt } }` · `404` · `400`.

---

## Admin (`requireAuth` + `requireAdmin`)

### `GET /api/admin/users`
`200 → { "users": User[] }` — every account, newest first.

### `POST /api/admin/users/{id}/disable`
Body `{ "disabled": bool }`. Disabling kills that user's sessions.
`409` if it would disable the last active admin. `404` unknown id.

### `POST /api/admin/users/{id}/reset`
Body `{ "password": string }` (≥ 10). Kills that user's sessions.
`200 → { "ok": true }` · `400` weak · `404`.

---

## Types

```ts
type Role = 'admin' | 'user'
interface User { id: string; email: string; role: Role; disabled: boolean; createdAt: number }

type SchemaKind = 'xml' | 'yaml' | 'json'
type Visibility = 'private' | 'shared'
interface SchemaSummary {
  id: string; name: string; kind: SchemaKind
  visibility: Visibility; shareSlug?: string; publishedAt?: number
  createdAt: number; updatedAt: number
}
interface SchemaRecord extends SchemaSummary { body: string; formJson: string }

interface SubmissionSummary {
  id: string; templateId: string; filledBy?: string; submitter: string; createdAt: number
}
interface SubmissionRecord extends SubmissionSummary { valuesJson: string; output: string }
```

`formJson` is `JSON.stringify({ schema: FormFlowSchema, values })` — the frontend
owns that shape; the server stores it opaquely.

---

## Static / SPA

In the **release** build (`StaticFS` set), any non-`/api`, non-`/healthz` path
serves the embedded SPA, falling back to `index.html` for client-side routes.
In **dev** there is no `StaticFS` — Vite serves the SPA on `:5273` and proxies
`/api` to `:8787`.

---

## v0.2 routes (F19–F26)

Roles: `admin` > `author` > `user`. **Template writes** (`POST /api/schemas`,
`PUT`, `DELETE`, `fork`, `rollback`, `publish`, `unpublish`, `approval`,
`webhooks`, `ops`) require `author` or `admin` — a `user` gets `403`.

### Templates

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/schemas?folder=&tag=&q=` | filtered list |
| `POST` | `/api/schemas/{id}/fork` | copy → new template, `forkedFrom` set |
| `GET` | `/api/schemas/{id}/versions` · `/versions/{n}` | history; `{n}` has bodies |
| `POST` | `/api/schemas/{id}/rollback/{n}` | copies v`n` into a fresh version |
| `POST` | `/api/schemas/{id}/approval` | `{ requiresApproval }` |
| `POST` | `/api/schemas/{id}/ops` | `{ submissionCap, brand }` (brand = JSON `{accent?, logoDataUri?}`) |
| `GET` | `/api/schemas/{id}/submissions.zip` | streamed zip of rendered outputs |

`PUT /api/schemas/{id}` body also takes `folder`, `tags[]`, `notes` (the
version note). `SchemaSummary` gains `currentVersion`, `status`, `folder`,
`tags`, `forkedFrom`, `requiresApproval`, `submissionCap`, `brand`, `viewCount`.

### Submissions

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/submissions/{id}/review` | `{ approved, note? }` — owner |
| `GET` `POST` | `/api/submissions/{id}/comments` | thread |

A submission carries `templateVersion` and `status` (`pending` when the
template gates on approval, else `approved`).

### Webhooks

| Method | Path | Notes |
|--------|------|-------|
| `GET` `POST` | `/api/schemas/{id}/webhooks` | `{ url, events[] }` — secret returned once |
| `DELETE` | `/api/webhooks/{id}` | |
| `GET` | `/api/webhooks/{id}/deliveries` | last 50 attempts |

Delivery: `POST { event, templateId, submission, output }` with
`X-FFF-Signature: sha256=<hmac>`, 3 attempts, backoff. Events:
`submission.created`, `submission.approved`.

### Public share

- `GET /api/public/templates/{slug}` now returns `brand`; each call bumps
  `view_count`.
- `POST /api/public/templates/{slug}/submissions` → `403` when the
  per-slug `submissionCap` is reached.
- `POST /api/public/templates/{slug}/check` — `{ path, value }` runs the
  field's author-stored `checkUrl` (private/loopback/non-https rejected) →
  `{ ok, message? }`.

### AI (all `requireAuth`, 30/user/hour, `501` without `FFF_ANTHROPIC_API_KEY`)

`GET /api/ai/status` · `POST /api/ai/{suggest-meta,explain-diff,
schema-from-prompt,fill-assist}` — see [`AI.md`](AI.md).

### Admin

`POST /api/admin/users/{id}/role` `{ role }` · `GET /api/admin/audit?limit=`.
