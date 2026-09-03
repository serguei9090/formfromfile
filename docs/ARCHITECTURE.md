# Architecture & code walkthrough

A file-by-file tour so a fresh session can pick up cold. Pairs with
[`../CLAUDE.md`](../CLAUDE.md) (conventions) and [`API.md`](API.md) (HTTP contract).

---

## 1. Big picture

```
                    ┌─────────────── web/ (Vite SPA) ───────────────┐
 browser ──────────►│ pages → stores → api/client.ts                │
                    └───────────────────────┬──────────────────────┘
                                            │ fetch /api/*  (cookie: fff_session)
        dev: Vite proxy :5273→:8787         │        release: same-origin
                                            ▼
                    ┌─────────────── server/ (Go) ──────────────────┐
                    │ chi Router                                     │
                    │  ├─ /healthz, /api/config      (public)        │
                    │  ├─ /api/auth/*                (public)        │
                    │  ├─ /api/schemas*     requireAuth              │
                    │  ├─ /api/admin/*      requireAuth + requireAdmin│
                    │  └─ /*   → embedded SPA (release) / absent (dev)│
                    │                                                │
                    │ handlers → auth.Service / store.Store → SQLite │
                    └────────────────────────────────────────────────┘
```

One SQLite file. Three tables: `users`, `sessions`, `schemas` (see
`server/internal/store/store.go`).

---

## 2. Frontend (`web/src/`)

### Entry & shell

| File | What it does |
|------|--------------|
| `main.tsx` | Mounts `<App/>` inside `<BrowserRouter>`. |
| `App.tsx` | Route table. Public: `/login`, `/register`. Authed: everything under `<AuthGate><Shell/></AuthGate>` — `/` (My Forms), `/designer`, `/designer/:id`. |
| `index.css` | Tailwind v4 import + the **emerald theme**: CSS custom properties on `:root`, redefined under `.dark`, exposed to Tailwind via `@theme inline`. The radiant green-leaf page background is two radial gradients on `body`. |
| `app/Shell.tsx` | Sticky header (leaf mark, signed-in email, theme toggle, Sign out) + `<Outlet/>`. Calls `useApplyTheme()`. |
| `app/AuthGate.tsx` | On mount: registers the 401 handler (`setUnauthorizedHandler`) and calls `authStore.refresh()`. While `loading` → a pulsing leaf. Then renders children, or `<Navigate to="/login">`. |
| `app/Leaf.tsx` | The inline-SVG leaf logo (gradient fill). |
| `app/AuthCard.tsx` | The login **and** register form (`mode` prop). Real submit → `authStore.login/register` → navigate `/`. Redirects away if already authed. Honors `allowRegister`. |
| `app/FileDropField.tsx` | A `<Textarea>` that also takes a chosen/dropped file (reads it as UTF-8 text, shows the filename until edited). |

### State (`stores/`, Zustand)

| Store | Shape / actions |
|-------|-----------------|
| `authStore.ts` | `{ user, loading, allowRegister }` · `refresh()` (parallel `/auth/me` + `/config`), `login`, `register`, `logout`. |
| `schemasStore.ts` | `{ list, loading }` · `refresh()` (GET `/schemas`), `get(id)`, `create(input)`, `update(id, input)`, `remove(id)`. `create`/`update` re-`refresh()` the list. |
| `themeStore.ts` | `{ theme }` + `toggle()`, persisted to `localStorage['fff:theme']` (falls back to `prefers-color-scheme`). `useApplyTheme()` toggles `.dark` on `<html>`. |

### API layer (`api/`)

- `client.ts` — `api.get/post/put/del`. Always `credentials: 'include'`.
  Parses the JSON body, throws `ApiError(status, message)` on non-2xx (message
  from the `{error}` field). On a 401 it calls the registered
  `onUnauthorized` handler (AuthGate sets `user = null`).
- `types.ts` — `User`, `Role`, `SchemaKind`, `SchemaSummary`, `SchemaRecord`.

### The parser core (`core/form_flow/`, **verbatim from InfraKit**)

- `schemaModel.ts` — the data model. `SchemaField { key, type, label?, help?,
  defaultValue?, children[] }` where `type` ∈ `text | number | boolean | object
  | array`. `FormFlowSchema { format, rootName, fields[] }`. Helpers:
  `defaultValuesFromFields(fields)` (seed a values tree — one item per array),
  `isScalarArrayTemplate(children)` (true when the sole child key is `value` —
  the synthetic wrapper for a list of scalars), `fieldDisplayLabel`.
  **Everything here is plain-JSON-serializable** — that's why persistence is just
  `JSON.stringify`.
- `formFlowParser.ts` — `class FormFlowParser`:
  - `parse(raw, formatHint?)` — tries JSON → XML → YAML (first that parses
    wins); `formatHint` skips detection. Returns a `FormFlowSchema`.
  - `render(schema, values)` — serializes a values tree back to the original
    format. `values` is nested objects for `object`, arrays-of-objects for
    `array` (bare scalars unwrapped from the `{value:…}` template on render).
  - Type inference is content-based (`"true"`→boolean, `/^-?\d+(\.\d+)?$/`
    →number). Documented limitations in the file header (attributes ignored,
    `null`→empty text, empty arrays can't infer a template).
- `formFlowParser.test.ts` — 14 tests (XML/YAML/JSON shape detection,
  scalar-sibling arrays, round trips, auto-detection). **Keep passing.**
- `core/ports/` — `IFormFlowUseCase<TSchema>` (parse/render), `ISchemaRepository`
  (persistence port — currently unused; the app talks to the backend directly
  via `schemasStore`).

### The extension layer (`formflow_ext/`, **FormFromFile-only**)

Everything the app adds on top of the frozen core lives here (see
[`../PLAN-F6.md`](../PLAN-F6.md) → "keep the verbatim core frozen"). No imports
from `core/**` internals, no React.

- `fieldMeta.ts` — `FieldMeta` (label / help / editable / required / pattern /
  preset / enumValues / min·max·step / numberFormat), keyed by **dotted field
  path** (`"Services.FTP.FTPPort"`, array items un-indexed). `walkPaths`,
  immutable `setMetaAt`, `pruneMetaMap` (drop meta whose path vanished after a
  retype). `FieldMetaMap = Record<FieldPath, FieldMeta>`.
- `templateModel.ts` — `FormTemplate = { schema, meta, tokens }` + `TokenSpec`.
  `parseStoredForm(raw)` tolerantly decodes a saved form's `formJson`: the v2
  `{ schema, values, meta, tokens }` shape *and* the F4b-era `{ schema, values }`
  one. `serializeStoredForm` writes v2.
- `xml/richXml.ts` — attribute- and comment-preserving XML (the core sets
  `ignoreAttributes: true` and drops the `<?xml?>` line). `parseRichXml(raw)` →
  `{ schema, seed }`: attributes become leaf fields keyed `@_name` (label = bare
  name), mixed text → `#text`, comments → passthrough fields keyed `#comment`
  (re-emitted verbatim, filtered from the UIs via `isStructuralKey`, position
  not preserved). `seed` has **one array item per source occurrence**.
  `renderRichXml(schema, values, source)` rebuilds, restoring the declaration
  and leading comments from `source`. `xml/__fixtures__/` holds the ILS test
  file; `richXml.test.ts` asserts a lossless round trip.

- `tokens.ts` — `%X%` / `${x}` / `{{x}}` placeholders found in *values*.
  `scanTokens(values)` → `TokenSpec[]` (name + occurrence paths); `applyTokens`
  substitutes on the rendered string, format-agnostic; `pruneTokenValues`.
- `presets.ts` — 10 named validators (`ipv4`, `ipv4-or-hostname`, `hostname`,
  `port`, `email`, `toolname`, `slug`, `integer`, `decimal`, `nonempty`) each
  `{ id, label, types, test, message }`. `EDITOR_ATTR_TO_PRESET` /
  `presetForEditorAttr` map an `editor="…"` attribute value to a preset id.
- `autoMeta.ts` — `autoMetaFromSchema(schema)` seeds `FieldMeta` from the
  source: an `editor="…"` attribute sets a preset on its sibling value
  (`#text` → `@_value` → `@_name` → first text leaf).
- `validation.ts` — `collectErrors(schema, meta, values)` → `FieldError[]`
  (required / preset / regex / enum / number min·max·integer), keyed by rhf
  field name; `makeResolver(schema, meta)` adapts it to the rhf `Resolver`
  contract (used by the fill screen, F10); `errorMessageAt`. No zod.
- `formats/` — the non-core format registry. `types.ts` (`FormatPlugin`),
  `tree.ts` (generic value-tree ↔ `SchemaField[]`, core semantics),
  `toml.ts` (`smol-toml`), `ini.ts` (INI + `.properties`), `dotenv.ts`,
  `csv.ts` (`papaparse`, header row → `rows` array). `index.ts` —
  `parseSource(raw)` tries the core (JSON→XML→YAML) then each plugin's
  `detect`; `renderTemplate(formatId, …)` dispatches; `FORMAT_ACCEPT` /
  `extensionFor`. `schema.format` stays `'json'` for plugin formats —
  **`formatId` is the round-trip source of truth**, stored on `FormTemplate` /
  `StoredForm` (falls back to `schema.format` for pre-F12 saves).
- `importers/jsonSchema.ts` — `looksLikeJsonSchema` + `importJsonSchema`: a
  JSON Schema builds the form directly, mapping `type` / `required` / `enum` /
  `pattern` / `minimum·maximum` / `title` / `description` straight onto
  `SchemaField` + `FieldMeta` (no content inference — review finding #8).

`DesignerPage` uses `parseRichXml` / `renderRichXml` for XML, threads
`meta` + `tokens` + `tokenValues` through load / detect / retype / save,
seeds `meta` from `autoMetaFromSchema` on detect, and retypes with
`reseedPreserving` (only the reshaped branch loses values).

### Field authoring (`designer/`)

- `SchemaTree.tsx` — one row per field: key · type `<Select>` · ⚙ toggle. The
  ⚙ expands `FieldSettings` for that field's path. Structural keys (`#comment`)
  are skipped in-place so retype path indices stay correct.
- `FieldSettings.tsx` — label · help · "filler can edit" · required · preset
  picker (filtered by field type) · number min/max · enum values (comma list →
  dropdown) · advanced: raw regex + message. Emits `Partial<FieldMeta>` patches.
- `schemaEdit.ts` — `setFieldTypeAt` (retype, immutable) + `reseedPreserving`
  (re-seed keeping values that still fit their field's type).
- `FormFields.tsx` — recursive form. `FieldCtx` now carries `meta`, optional
  `errorFor(name)` and `hideLocked` (filler view). Renders label/help from
  meta, `*` for required, `<select>` for `enumValues`, `disabled` for
  `editable:false`, inline error text.
- `FillForm.tsx` — the fill-only view (no schema tree). `useForm` with
  `makeResolver(schema, meta)` cast to `Resolver`; Export stays disabled until
  `formState.isValid` **and** every token is filled; locked fields are hidden
  but their values still render. Reused by `FillPage` and (F11) the public
  share route.

### Pages

- `pages/HomePage.tsx` — "My Forms": per card — Publish/Copy-link/Unpublish,
  a "shared" badge + submissions link, **Fill** (`/fill/:id`), edit, delete.
- `pages/FillPage.tsx` — fill one of your own saved templates (preview, no
  submission). Falls back to `parseRichXml` + `autoMetaFromSchema` for a
  pre-F6 `formJson`.
- `pages/PublicFillPage.tsx` — `/f/:slug`, **outside** `AuthGate` (own minimal
  header). `GET /api/public/templates/:slug` → `<FillForm onSubmit=…>` that
  POSTs the filled result to `/api/public/templates/:slug/submissions`.
- `pages/SubmissionsPage.tsx` — `/schemas/:id/submissions`: list → view one →
  download its `output`.
- `pages/DesignerPage.tsx` — the authoring orchestrator (below).

### The designer (`designer/` + `pages/DesignerPage.tsx`)

`DesignerPage` is the orchestrator:

1. **Load a file** — `<FileDropField>` fills `source`; **Detect schema** →
   `parser.parse(source)` → `schema` + `form.reset(defaultValuesFromFields(...))`.
   `/designer/:id` instead loads via `schemasStore.get(id)` and restores
   `{schema, values}` from the stored `formJson` (falling back to re-parsing
   `body`).
2. **Retype** — `<SchemaTree>` shows every field with a `<Select>` of the 5
   types. Change → `schemaEdit.setFieldTypeAt(fields, path, type)` (immutable,
   `path` = indices into nested `children`) → `form.reset(...)` again
   (re-seeds; documented in the UI).
3. **Fill** — `<FormFields fields prefix ctx>` recurses the tree:
   - `object` → `<fieldset>` + recurse with `prefix = name`
   - `array` → `<ArrayField>` uses `react-hook-form`'s **`useFieldArray`**:
     Add / Remove items. Scalar-array template → one `<Input>` at
     `` `${name}.${i}.value` ``; object template → recurse at
     `` `${name}.${i}` ``.
   - `boolean` → checkbox, `number` → `<Input type=number>` with
     `valueAsNumber`, `text` → `<Input>`.
   - Dynamic string paths go through `ctx.reg(name, opts)` — a wrapper that does
     `form.register(name as never, opts)` (the `never` cast is contained here
     because `Values` is `Record<string, unknown>`).
4. **Export** — `parser.render(schema, form.getValues())` → shown in a `<pre>`
   with Copy + Download.
5. **Save** — `POST /api/schemas` (new) or `PUT /api/schemas/:id`, body
   `{ name, kind: schema.format, body: source, formJson: JSON({schema, values}) }`.
   New → `navigate('/designer/:id')`.

`schemaEdit.setFieldTypeAt` retype rules: →`object` keeps existing children;
→`array` seeds a scalar `value` template if there were no children; →leaf clears
children.

### UI primitives (`components/ui/`)

`Button` (CVA variants + `buttonVariants` export for `<Link className>`),
`Input`, `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Textarea`, `Select`
(native `<select>`, styled), `Label`. All use `cn()` (`clsx` + `tailwind-merge`).
No Radix / Base UI.

### Pages

- `HomePage.tsx` — **My Forms**. `schemasStore.refresh()` on mount → cards
  (open link + delete). Empty state.
- `LoginPage.tsx` / `RegisterPage.tsx` — one-liners around `<AuthCard mode=…>`.

---

## 3. Backend (`server/`)

### `cmd/formfromfile/`

- `main.go` — flags (`--addr --db --allow-register`, `FFF_*` env), opens the
  store, `auth.NewService(st)`, resolves the embedded SPA (`fs.Sub(distFS,
  "dist")` — only used if `dist/index.html` exists), builds the router, serves.
- `embed.go` — `//go:embed all:dist` → `distFS`. `dist/.gitkeep` keeps the dir
  present so `go build` works in dev; F5 copies the real `web/dist` in.

### `internal/store/`

- `store.go` — `Store{ DB *sql.DB }`. `Open(dsn)` opens SQLite
  (`modernc.org/sqlite`, `SetMaxOpenConns(1)`, `PRAGMA foreign_keys = ON`) and
  applies the schema (`users`, `sessions`, `schemas`). `CountUsers()` (the
  first registrant becomes admin).
- `store.go` — also holds `migrations []string` + `migrate(db)`: `PRAGMA
  user_version` tracks how many have run; append-only. v1 adds the
  `schemas.visibility` / `share_slug` / `published_at` columns, v2 the
  `submissions` table + a unique partial index on `share_slug`.
- `schemas.go` — `Schema` struct + user-scoped `ListSchemas` (bodies stripped),
  `GetSchema`, `CreateSchema`, `UpdateSchema`, `DeleteSchema`, plus
  `PublishSchema` (mints `share_slug` via `COALESCE`, sets `visibility='shared'`),
  `UnpublishSchema`, and `SchemaBySlug` (no user scope, `visibility='shared'`
  only). Every user query has `AND user_id = ?`. `ErrNotFound` for both
  "missing" and "not yours". `MaxSchemaBody = 1 MiB`.
- `submissions.go` — `Submission` + `CreateSubmission` (anon when `filledBy` is
  ""), `ListSubmissions` (owner-checked via `GetSchema`, blobs stripped),
  `GetSubmission` (joins `schemas` for ownership). `MaxSubmissionBody = 1 MiB`.
- `schemas_test.go` / `submissions_test.go` — cross-user isolation, publish /
  unpublish / slug reuse, anonymous vs attributed submissions.

### `internal/auth/`

- `auth.go` — `User`, `Session`, `Role` (`admin` | `user`), the typed errors
  (`ErrInvalidCredentials`, `ErrLockedOut`, `ErrTaken`, …), `MinPasswordLen = 10`.
  `User.passwordHash` is unexported — never serialized.
- `password.go` — **copied from InfraKit.** argon2id, PHC-style self-describing
  hash (`$argon2id$v=19$m=65536,t=3,p=4$salt$hash`), constant-time verify.
- `throttle.go` — **copied from InfraKit.** In-memory failed-login limiter keyed
  by `ip|email`; exponential backoff after 3 fails, 15-min cap, cleared on
  success.
- `service.go` — `Service{ st, thr }`:
  - `Register(email, pw)` — normalizes email, checks length, first user →
    `admin`, `INSERT`; `UNIQUE` violation → `ErrTaken`.
  - `Login(email, pw, throttleKey)` — throttle check → lookup → `verifyPassword`
    → issue a random 32-byte token, store `sha256(token)` in `sessions` with a
    30-day expiry, return the raw token.
  - `UserByToken(ctx, token)` — `sha256` lookup, expiry check (deletes if
    stale), loads the user, **slides** the expiry 30 days.
  - `Logout(token)` — deletes the session row.
  - `ListUsers`, `SetDisabled` (refuses the last admin; kills that user's
    sessions), `ResetPassword` (kills sessions).
- `service_test.go` — 7 tests (first-user-admin, validation, login + session,
  throttle after 3 fails, last-admin guard, reset revokes sessions).

### `internal/httpapi/`

- `httpapi.go` — `Options{ Store, Auth, AllowRegister, StaticFS }`, `Router()`
  builds the chi tree (route list in [`API.md`](API.md)). `handlers` holds
  `opts`. Helpers: `writeJSON`, `writeErr`, `decode` (1 MiB `MaxBytesReader`).
  `spaHandler` serves `StaticFS` and falls back to `index.html` for client
  routes.
- `middleware.go` — `sessionCookie = "fff_session"` (HttpOnly, `Secure` under
  TLS, `SameSite=Lax`, 30-day MaxAge). `requireAuth` (cookie → `UserByToken` →
  `context.WithValue(userKey, user)`; 401 + clears the cookie on failure).
  `requireAdmin` (403 unless `currentUser(r).IsAdmin()`). `currentUser(r)`
  reads it back.
- `auth.go` — `register` (auto-logs-in; honors `AllowRegister` but always lets
  the first account through), `login`, `logout`, `me` (returns `{user: null}`
  rather than 401 when there's no session). `throttleKey(r, email)` =
  `host|email`.
- `users.go` — `listUsers`, `setUserDisabled`, `resetUserPassword` (admin).
- `schemas.go` — the 5 schema handlers behind `requireAuth`. `schemaBody.validate()`
  checks name + `kind ∈ {xml,yaml,json}` + size.

---

## 4. Data flow examples

**Register**
`AuthCard.submit` → `authStore.register` → `POST /api/auth/register`
→ handler: `AllowRegister` gate → `auth.Service.Register` (first → admin, insert)
→ `auth.Service.Login` (issue token) → `Set-Cookie: fff_session` → `{user}` (201)
→ store sets `user` → `AuthCard` effect navigates `/`.

**Save a form**
`DesignerPage.save` → `schemasStore.create({name,kind,body,formJson})`
→ `POST /api/schemas` → `requireAuth` (cookie → user in ctx) → `createSchema`
handler → `schemaBody.validate()` → `store.CreateSchema(user.ID, sc)` (INSERT with
`user_id`) → `{schema}` (201) → store re-`refresh()`es the list → page navigates
to `/designer/:id`.

**Open a saved form**
`/designer/:id` mount → `schemasStore.get(id)` → `GET /api/schemas/:id`
→ `getSchema` handler → `store.GetSchema(user.ID, id)` (scoped; `ErrNotFound` →
404) → `{schema}` → `DesignerPage` parses `formJson` → `setSchema` +
`form.reset(values)`.

---

## 5. Tests

```bash
cd web    && bun run test     # 69: parser/cn 15 + fieldMeta 8 + richXml 8 + tokens 6
                              #     + presets 12 + validation 6 + autoMeta 2 + FillForm 2
                              #     + formats 6 + jsonSchema 6
cd server && go test ./...     # auth (7) + store (CRUD + migration + publish/submissions)
```

Add backend tests with a temp-file SQLite: `store.Open(filepath.Join(t.TempDir(),
"t.db"))`.
