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
