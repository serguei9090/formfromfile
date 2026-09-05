# FormFromFile — plan F32 (admin-provisioned users + auth-gated public forms)

Two independent asks from manual testing:

1. **Admin → Users has no "add user."** Every account today is born through
   self-registration (`/register`, or Firebase sign-in). An admin can
   disable/enable, change role, reset a password, export/erase — but cannot
   create a brand-new account for someone who hasn't signed up themselves.
   For a "local users only, admin provisions everyone" deployment (register
   closed), that's a dead end.
2. **`/f/:slug` is always fully anonymous.** There's no way to say "this
   published form is for our signed-in team only, not the open internet."
   Every published template is reachable by anyone with the link, full stop.

Both are additive — nothing existing changes behavior when unused. Each
phase = its own commit(s) to `main`, green gate first (`bun run build && bun
run test && bun run lint && bun run e2e`; `go build ./... && go vet ./... &&
go test ./... && golangci-lint run ./...`), Conventional Commits +
`Co-Authored-By`.

---

## Progress

- **F32a done** — `auth.Service.CreateUser` (blank password → 20-char
  `crypto/rand`-generated, returned once; explicit password validated like
  `Register`; explicit role, no bootstrap-admin logic). `POST
  /api/admin/users` (`requireAdmin`, audited `user.create`). Admin → Users
  gets an "Add user" form; a generated password shows once in a dismissible
  callout with copy. +6 server tests (generated password logs in, explicit
  password returns none, weak/invalid-role/duplicate rejected, non-admin
  403). Manually verified in-browser: created a user, logged in with the
  generated password over a fresh session. See
  [`docs/AUTH.md`](docs/AUTH.md) §"Admin-provisioned accounts".
- **F32b done** — migration **v9**: `schemas.public_access` (`anyone` |
  `authenticated`, default `anyone`). `sessionUser(r)` resolves an optional
  session for routes outside `requireAuth`; `publicTemplateBySlug` +
  `createPublicSubmission` 401 when gated and no session — also fixed a
  real bug in passing: public submissions were never attributed to a
  signed-in filler because this route never ran `requireAuth`, so
  `currentUser(r)` was always empty. `SetTemplateOps` gained the field;
  every existing `/ops` call site updated so it doesn't reset silently.
  Frontend: ops-panel "Who can access this link" select, a "signed-in only"
  badge on `HomePage`, `PublicFillPage` shows a sign-in prompt on 401
  linking to `/login?redirect=…`, `AuthCard` honors `?redirect=` after
  login/register/Google sign-in (relative-path only, rejects `//host`).
  +4 server tests (gate blocks/allows, attribution, invalid value rejected,
  default unaffected) + 1 e2e (anonymous blocked → sign in → redirected
  back → fills and submits). Manually verified in-browser end to end
  against the built Docker image (migration v9 applies cleanly).

---

## F32a — admin creates a user  ·  S–M

**Backend**

- `auth.Service.CreateUser(email, password string, role Role) (user User, generatedPassword string, err error)`
  in `server/internal/auth/service.go`:
  - Normalizes/validates email (same rule as `Register`), validates `role`
    via `ValidRole`.
  - If `password == ""`, generates a random 16-char password
    (`crypto/rand`, alphanumeric + a couple symbols) and returns it in
    `generatedPassword` — **the only place the plaintext ever exists**,
    never logged, never stored. If the caller supplied one, it's validated
    against `MinPasswordLen` like `Register` and `generatedPassword` comes
    back `""`.
  - Inserts the row directly (no bootstrap-admin logic — role is explicit,
    chosen by the calling admin). Reuses the `ErrTaken` mapping for a
    duplicate email.
- `POST /api/admin/users` (`requireAdmin`) in `server/internal/httpapi/users.go`:
  body `{email, role, password?}` → `h.opts.Auth.CreateUser(...)` →
  `{"user": ..., "generatedPassword": "..."}` (field omitted when the admin
  supplied a password). `h.audit(r, "user.create", user.ID, email)`.
- Route in `httpapi.go`'s admin group, alongside `/admin/users/{id}/...`.

**Frontend**

- `AdminPage.tsx`: an "Add user" disclosure/form above the user list — email
  input, role `<Select>` (`user`/`author`/`admin`), a password field with a
  "generate one for me" default (checkbox or just: leave blank = generate).
  On success: if `generatedPassword` came back, show it once in a dismissible
  callout with a copy button and "this won't be shown again" — then refresh
  the list.

**Tests**

- `auth`: weak password rejected, duplicate email → `ErrTaken`, invalid role
  rejected, blank password generates one that actually logs in, explicit
  password path returns no `generatedPassword`.
- `httpapi`: non-admin → 403; admin → 201 + audit entry; generated password
  round-trips through `/api/auth/login`.

---

## F32b — per-template "who can access this link"  ·  M–L

**Data model**

- Migration **v9**: `ALTER TABLE schemas ADD COLUMN public_access TEXT NOT
  NULL DEFAULT 'anyone';` — values `'anyone'` (today's behavior) |
  `'authenticated'`. Meaningful only while `visibility = 'shared'`; ignored
  for private/draft templates.
- `Schema.PublicAccess string` field; add to `opsCols` (same slot as
  `retention_days` in F29e) so summary/detail scans pick it up for free.

**Backend enforcement**

- `SetTemplateOps` (`store/ops.go`) gains a `publicAccess string` param,
  validated against the two allowed values (reject anything else — 400 from
  the handler, not a silent fallback).
- New helper in `httpapi/middleware.go`: `func (h *handlers) sessionUser(r
  *http.Request) (auth.User, bool)` — reads the session cookie and resolves
  it via `h.opts.Auth.UserByToken`, **without** requiring one (unlike
  `requireAuth`, which 401s). Used only by the two public routes below,
  since they intentionally sit outside the `requireAuth` group.
- `publicTemplateBySlug` (`share.go`): after loading `sc`, if
  `sc.PublicAccess == "authenticated"`, call `sessionUser(r)` — no valid
  session → `401 {"error": "sign in to view this form"}` before any template
  data is returned (don't leak the schema to an anonymous caller).
- `createPublicSubmission` (`share.go`): same check, same 401. When it
  passes, use the resolved user's ID for `filledBy` instead of the always-
  empty `currentUser(r).ID` this route has today (a real fix in passing —
  currently no public submission is ever attributed even when the filler is
  logged in, because this route isn't behind `requireAuth`).
- `validateProxy` (the async per-field check) stays ungated in v1 — it only
  proxies the author's own `checkUrl`, no schema/submission data exposed;
  note as an explicit non-goal.

**Frontend**

- `SubmissionsPage.tsx` ops panel: a new control next to submission
  cap/retention — "Who can access this link" — **Anyone with the link** /
  **Signed-in users only**. POSTs `publicAccess` alongside the existing
  `submissionCap`/`brand`/`retentionDays` fields (same gotcha as F29e:
  every existing `/ops` POST call site must include the new field too, or
  it silently resets to `'anyone'`).
- `PublicFillPage.tsx`: on a 401 from `GET /public/templates/{slug}`, render
  "This form requires you to sign in" + a link to
  `/login?redirect=/f/<slug>` instead of the current generic error text.
- **Login redirect support** (`AuthCard.tsx` + wherever routes are read):
  after a successful login/register, if `?redirect=` is present **and**
  starts with `/` (reject anything else — no open redirect to another
  origin), `navigate(redirect)` instead of always `navigate('/')`. Firebase
  sign-in gets the same treatment for consistency.
- `HomePage.tsx` / `SubmissionsPage.tsx`: a small badge next to
  `published`/`draft` when `publicAccess === 'authenticated'` so an author
  can tell at a glance which links are gated.

**Tests**

- `store`: `SetTemplateOps` round-trips `public_access`; rejects an invalid
  value.
- `httpapi`: anonymous `GET`/`POST` on an `authenticated`-gated slug → 401;
  same calls succeed with a valid session cookie and `filledBy` is now set;
  an `anyone` template is unaffected (regression guard against this becoming
  the new default).
- `e2e`: publish a template as authenticated-only, confirm an anonymous
  context gets the sign-in prompt, log in, confirm the fill form now loads
  and a submission attributes `filledBy`.

**Non-goals for this pass:** per-role gating (e.g. "only `author`s can fill
this"), an allow-list of specific emails, gating the async-check proxy.
Those are natural follow-ups if the plain "signed in or not" gate isn't
enough — flagged in `PLAN-F19.md` §F28 territory, not built here.

---

## Effort

F32a: S–M (one new service method, one route, one admin-panel form).
F32b: M–L (a migration, two enforcement points, a redirect-after-login
mechanism that touches the shared auth UI, ops-panel wiring across every
existing call site). Ship F32a first — it's smaller and unblocks the
"no public registration" deployment story on its own; F32b can follow
independently.
