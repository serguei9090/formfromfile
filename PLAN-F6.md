# FormFromFile — plan F6+ (templates, validation, roles, formats)

Follow-on to [`PLAN.md`](PLAN.md) (F0–F5). Driven by the 2026-09-03 review +
live E2E test against `I:\example.Simple.DEFAULT.xml`. That test confirmed the
stack works end-to-end (auth, per-user store, detect → fill → export round-trip)
and surfaced the gaps this plan closes.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the file map and
[`CLAUDE.md`](CLAUDE.md) for conventions before starting a phase.

---

## Why

The product today is a **single-role designer**: whoever opens a form sees the
type-retype controls *and* the fill fields at once, and every saved form is
private to its creator. The real workflow is two roles:

| Role | Does | Today |
|------|------|-------|
| **Template author** (the team) | Defines fields, labels, help text, validation rules, and which parts are fixed boilerplate vs. user blanks. Once. | Partly — type retype only. No labels/help/validation UI. |
| **Filler** (the user) | Opens a published template, fills only the blanks, gets a correctly-formatted file out. | Not possible — no share, no fill-only view, no validation. |

Plus: real-world templates (like the ILS test file) carry **XML attributes** and
**`%TOKEN%` placeholders** that the current parser silently destroys, and the
world has more config formats than XML/YAML/JSON.

---

## Findings this plan addresses

| # | Finding (from the review) | Phase |
|---|---------------------------|-------|
| 1 | XML attributes destroyed — `<field editor="…" name="…"/>` → `<field></field>` | **F7** |
| 2 | Repeated elements seed only 1 form item; source had 2 | **F7** |
| 3 | XML comments + declaration dropped on export | **F7** |
| 4 | No validation (required / regex / min-max / enum); `label`/`help` never authored | **F6, F9, F10** |
| 5 | No author/filler role split; forms are private, no publish/share | **F11** |
| 6 | Retype re-seeds the whole form, losing entered values | **F9** |
| 7 | Only 3 formats; TOML / INI / `.env` / `.properties` / CSV rejected | **F12** |
| 8 | Lossy type inference — `"1.0"` → number → exports `1`; leading zeros mangled | **F6, F12** |
| 9 | `%Name%` / `%IP Address%` placeholders have no first-class handling | **F8** |

---

## Design decision — keep the verbatim core frozen

`web/src/core/form_flow/**` and `core/ports/**` are **verbatim copies** from
InfraKit Studio (`CLAUDE.md` → "Keep the core in sync"). Rule: *do not rewrite
the parser — extend around it.*

**Therefore all F6+ work lands in a new FormFromFile-only layer, not in `core/`:**

```
web/src/formflow_ext/          NEW — FormFromFile-only, may import nothing from React either
  templateModel.ts             FormTemplate = { schema: FormFlowSchema, meta: Record<path, FieldMeta>, tokens: TokenSpec[] }
  fieldMeta.ts                 FieldMeta type + path helpers (path = "Services.FTP.FTPPort")
  validation.ts                FieldMeta[] -> zod schema builder
  presets.ts                   named validators (IPv4, Hostname, Port, Email, Toolname, …) + editor-attr → preset map
  formats/                     format registry: { id, detect, parse, render } per non-core format
    index.ts  toml.ts  ini.ts  dotenv.ts  csv.ts
  tokens.ts                    %X% / ${x} / {{x}} scan + substitute
```

- `FieldMeta` is **keyed by dotted field path**, stored in the template JSON
  next to `schema`. The core `SchemaField` shape is never touched, so upstream
  sync keeps working.
- Where the core already has a field (`label?`, `help?` exist in the verbatim
  `SchemaField`), the ext layer is the source of truth and mirrors into the core
  field only at render time if needed.
- XML-attribute support (F7) is the one change that *may* want to go upstream —
  see F7 "core-sync note".

`FormFlowSchema` in `formJson` stays backward compatible: old saved forms parse
with an empty `meta` / `tokens` and behave exactly as before.

---

## Progress

- **F6 done** (`a190987`) — `formflow_ext/{fieldMeta,templateModel}.ts`, DesignerPage
  plumbs `meta`/`tokens`, `PRAGMA user_version` migration runner + v1 columns
  (`visibility`/`share_slug`/`published_at`), `validKinds` var. +8 web, +2 go tests.
- **F7 done** (`d596f1b`) — `formflow_ext/xml/richXml.ts`: XML attributes, `#text`,
  comments, `<?xml?>` declaration, N-item array seeding. Fixes findings 1–3.
  +8 web tests, E2E verified.
- **F8 done** — `formflow_ext/tokens.ts`: `scanTokens` / `applyTokens` /
  `pruneTokenValues`; `%…%`, `${…}`, `{{…}}`. DesignerPage "Tokens" section,
  substitution on export, `tokenValues` persisted. +6 web tests, E2E verified.
- **F9 done** — `presets.ts` (10 named validators + `editor=` attr map),
  `validation.ts` (`collectErrors` / `makeResolver`, no zod), `autoMeta.ts`
  (`editor="…"` → preset on sibling), `FieldSettings.tsx` panel wired into
  `SchemaTree` (⚙ per row), `reseedPreserving` retype (finding #6), FormFields
  shows label / help / required / enum-select. +20 web tests, E2E verified.
- **F10 done** — `designer/FillForm.tsx` (validated fill-only view, Export
  gated on `formState.isValid` + all tokens filled, locked fields hidden but
  emitted), `pages/FillPage.tsx` at `/fill/:id`, `errorMessageAt` helper,
  HomePage "Fill" / edit / delete actions. +2 web tests (RTL), E2E verified.
- **F11 done** — `submissions` table (migration v2) + unique slug index;
  store `PublishSchema` / `UnpublishSchema` / `SchemaBySlug` / submission CRUD;
  routes `/schemas/{id}/publish|unpublish|submissions`, `/submissions/{id}`,
  public `/public/templates/{slug}` + `/submissions` (per-IP 20/min); frontend
  `PublicFillPage` (`/f/:slug`, no Shell), `SubmissionsPage`, HomePage
  publish/copy-link/unpublish, `FillForm` "Send to team". +2 go tests, E2E
  verified (publish → anon fill → owner reads → unpublish 404).
- **F12 done** — `formflow_ext/formats/` registry (`parseSource` core-first
  then plugins, `renderTemplate` dispatch): TOML (`smol-toml`), INI/.properties,
  `.env`, CSV (`papaparse`); `formflow_ext/importers/jsonSchema.ts` (declared
  types → `SchemaField` + `FieldMeta`, fixes finding #8). `formatId` threaded
  through StoredForm / DesignerPage / FillForm / Fill pages; backend
  `validKinds` extended. +18 web tests, E2E verified (TOML round trip).

## Phases

Ship order is roughly value-first: **F6 → F7 → F8 → F9 → F10 → F11 → F12**, but
F7 and F12 are independent and can be done any time. F5 (deploy, from `PLAN.md`)
should land before or alongside F11 (sharing needs a real deployed URL).

**Commit discipline:** each phase = its own commit(s) straight to `main`, one
logical change per commit, **no batching phases together**. Green gate first
(`bun run build && bun run test && bun run lint`; `go build ./... && go vet ./...
&& go test ./...`). Conventional Commits subject (`feat:`/`fix:`/`docs:`/
`refactor:`/`test:`/`chore:`, imperative, <=50 chars); body names the phase
(e.g. `F7 — XML attribute round-trip`) only when the "why" isn't obvious.
Trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. No `git push`
unless asked.

---

### F6 — schema model v2: field metadata + validation model  ·  M

**Goal:** a place to store per-field authoring data (label, help, required,
pattern, enum, min/max, number format, fixed/editable) without touching the
verbatim core.

- `web/src/formflow_ext/fieldMeta.ts`:
  ```ts
  type FieldPath = string // "Services.FTP.FTPPort"; array items use the template path, no index
  interface FieldMeta {
    label?: string
    help?: string
    editable?: boolean          // default true; false = locked boilerplate, hidden from filler
    required?: boolean
    pattern?: string            // raw regex, the escape hatch
    patternMessage?: string
    preset?: string             // named validator id (see F9 presets) — UI shows this, not the regex
    enumValues?: string[]       // renders a <select> instead of <input>
    min?: number; max?: number; step?: number
    numberFormat?: 'integer' | 'decimal' | 'string'  // 'string' = keep "1.0" / "007" verbatim, fixes finding #8
    multiline?: boolean
  }
  ```
- `templateModel.ts`: `FormTemplate = { schema: FormFlowSchema; meta: Record<FieldPath, FieldMeta>; tokens: TokenSpec[] }`.
  Helpers: `metaAt(template, path)`, `setMetaAt`, `walkPaths(schema)`.
- `formJson` payload becomes `JSON.stringify({ schema, values, meta, tokens })`.
  Loader in `DesignerPage` tolerates the old 2-key shape (`meta = {}`, `tokens = []`).
- **Backend:** widen the `schemas` table + add a migration runner.
  - `server/internal/store/store.go`: introduce `PRAGMA user_version` migrations
    (the `schema` const is create-only today — no ALTER path exists). v1 → v2:
    `ALTER TABLE schemas ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`,
    `... ADD COLUMN share_slug TEXT`, `... ADD COLUMN published_at INTEGER`.
    (columns used by F11; add them now so there's one migration, not three.)
  - Fix the stale `kind` comment (`-- 'xml' | 'yaml'` → include `json` + F12 formats).
  - `schemaBody.validate()` in `httpapi/schemas.go`: `kind` allowlist becomes a
    package var so F12 can extend it.
- **Tests:** `fieldMeta.test.ts` (path walk, get/set immutability), a store
  migration test (`v1 db → Open → user_version = 2, columns present, existing
  rows intact`).

**Acceptance:** save a form, reload it — `meta`/`tokens` round-trip; an
F4b-era `formJson` still opens. `go test ./...` proves the migration is
idempotent and non-destructive.

---

### F7 — parser fidelity: XML attributes, comments, array count  ·  M

**Goal:** the ILS test file round-trips without data loss.

- New `web/src/formflow_ext/formats/xmlAttrs.ts` — a thin wrapper around the
  core parser's XML path:
  - Re-parse the raw XML a second time with `ignoreAttributes: false`,
    `attributeNamePrefix: '@_'`, `commentPropName: '#comment'`.
  - Produce an **attribute overlay**: `Record<FieldPath, Record<attr, value>>`
    plus an ordered comment list, stored on the `FormTemplate`.
  - On render, merge the overlay back: `XMLBuilder({ ignoreAttributes: false,
    attributeNamePrefix: '@_', commentPropName: '#comment', format: true })`.
  - Attributes become their own `FieldMeta`-driven inputs in the author UI
    (path `Tool.newToolUI.fields.field@editor`).
- **Array item count:** `defaultValuesFromFields` seeds 1 item per array. Add
  `seedValuesFromSource(schema, rawDecoded)` in the ext layer that seeds *N*
  items to match the source, used by `detect()` in `DesignerPage`. Core helper
  untouched (still used for "+ Add item").
- **XML declaration / encoding:** preserve the original `<?xml …?>` line verbatim
  instead of hard-coding `version="1.0" encoding="UTF-8"`.
- **Comments:** round-trip top-level + inline comments via `commentPropName`.
- **Tests:** add `xmlAttrs.test.ts` — parse `I:\example.Simple.DEFAULT.xml`
  (copy it to `web/src/formflow_ext/formats/__fixtures__/`), render, assert the
  output is structurally equal *including* `<field editor="Toolname"
  isRequired="true" name="Name"/>` and both `<field>` siblings.

**core-sync note:** if InfraKit wants attribute support too, promote
`XML_PARSER_OPTIONS` / `renderXml` changes into `core/form_flow/formFlowParser.ts`
and port back. Otherwise keep it in the ext wrapper. **Decision: keep in ext**
unless InfraKit files a matching request — divergence risk is lower than a
shared behavioural change.

**Acceptance:** the fixture round-trips byte-for-byte modulo whitespace; both
`<field>` elements and all their attributes survive; comments survive.

---

### F8 — token / placeholder templates  ·  S–M

**Goal:** first-class handling of `%Name%`, `${host}`, `{{port}}` — the actual
shape of the ILS `instanceXML` block.

- `web/src/formflow_ext/tokens.ts`:
  - `scanTokens(values)` → unique `TokenSpec[] = { token, name, occurrences: FieldPath[] }`.
    Patterns: `%…%`, `${…}`, `{{…}}` (configurable per template).
  - `applyTokens(rendered, tokenValues)` → string replace on the final output.
- **Author UI:** a "Tokens" section — one row per unique token, with a `FieldMeta`
  (label, help, preset/validation). Occurrences listed read-only.
- **Filler UI:** tokens render as their own top section, above / instead of the
  structural fields when the template is token-only.
- `FormTemplate.tokens` persisted in `formJson` (F6).
- **Tests:** `tokens.test.ts` — scan the ILS `instanceXML` block → `{Name, IP
  Address}`; fill → substituted in every occurrence.

**Acceptance:** load the ILS file, the two `%…%` tokens appear as exactly two
fields, filling them updates `%Name%` (1×) and `%IP Address%` (4×) on export.

---

### F9 — author UX: field settings + validation authoring  ·  L

**Goal:** the team can fully define a template.

- `web/src/designer/FieldSettings.tsx` — a panel (drawer or inline expander per
  `SchemaTree` row) editing the `FieldMeta` for the selected path:
  label · help · editable toggle · required · **preset picker** · min/max/step ·
  enum values · "advanced → raw regex + message".
- `web/src/formflow_ext/presets.ts`:
  ```ts
  interface Preset { id: string; label: string; pattern: RegExp; message: string; example?: string }
  // IPv4, IPv4-or-Hostname, Hostname, Port (1–65535), Email, Toolname, NonEmpty, Integer, Decimal, Slug
  const EDITOR_ATTR_TO_PRESET: Record<string, string> // "IPv4-or-Hostname" → "ipv4-or-hostname", "Toolname" → "toolname"
  ```
  On detect, if an XML attribute `editor="…"` (from F7) maps to a preset,
  pre-select it. The ILS file's `editor="Toolname"` / `editor="IPv4-or-Hostname"`
  become validation automatically.
- **Regex stays the escape hatch** — but the filler never sees it; presets are
  the surface. Non-regex users pick "IPv4" from a list.
- **Per-branch retype (finding #6):** `schemaEdit.setFieldTypeAt` +
  `DesignerPage.retype` — only re-seed the *subtree* that changed, `form.reset`
  with a merged value tree (`{ ...current, [path]: newDefaults }`) instead of a
  full `form.reset(defaultValuesFromFields(next.fields))`.
- **Editable label/help** feed `fieldDisplayLabel` and a `?` tooltip in `FormFields`.
- **Tests:** `presets.test.ts` (each preset accepts/rejects known good/bad),
  `validation.test.ts` (`FieldMeta[] → zod` shape), a `FieldSettings` RTL test.

**Acceptance:** on the ILS file, an author can: rename `FTPPort` → "FTP port",
add help text, mark `FTPPort` required + Port preset, lock `FTPServiceName`
(editable = false), and save — all of it reloads intact.

---

### F10 — filler runtime: enforce validation + fill-only view  ·  M

**Goal:** the user fills a safe, guided form and can't export garbage.

- `web/src/formflow_ext/validation.ts`: `buildResolver(template)` → a
  `zodResolver` fed to `useForm({ resolver })` in a new
  `web/src/pages/FillPage.tsx`.
- `FillPage` = fill-only: no `SchemaTree`, no type controls. Renders `FormFields`
  + tokens, shows inline errors, disables **Export** / **Submit** until valid.
  Locked (`editable:false`) fields are rendered read-only or hidden entirely
  (author's choice, default hidden with values still emitted on render).
- `FormFields.tsx`: pass `meta` down; wire `required`, `min`/`max`/`step`,
  `pattern`, enum `<select>`, `aria-invalid`, error text. Number fields with
  `numberFormat:'string'` register as text (fixes finding #8 end-to-end).
- Route: `/fill/:id` (own templates, preview) and `/f/:slug` (F11 shared).
- **Tests:** RTL — invalid IPv4 blocks export; fixing it enables export;
  a `numberFormat:'string'` field keeps `"1.0"` through export.

**Acceptance:** filling the ILS token form with `IP Address = "not an ip"` shows
an error and blocks export; `"10.0.0.5"` passes and the export substitutes it.

---

### F11 — roles & sharing: templates vs. submissions  ·  L

**Goal:** author publishes once; many users fill; team collects formatted files.

- **Data model** (columns added in F6):
  - `schemas.visibility`: `'private' | 'shared'`. `share_slug` (random,
    URL-safe), `published_at`.
  - New table `submissions`:
    ```sql
    CREATE TABLE submissions (
      id           TEXT PRIMARY KEY,
      template_id  TEXT NOT NULL REFERENCES schemas(id) ON DELETE CASCADE,
      filled_by    TEXT REFERENCES users(id) ON DELETE SET NULL,  -- null = anonymous
      submitter    TEXT,                                          -- free-text name/email if anon
      values_json  TEXT NOT NULL,
      output       TEXT NOT NULL,                                 -- the rendered file
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX ix_submissions_template ON submissions(template_id, created_at DESC);
    ```
- **Roles:** add `'author'` between `user` and `admin`, OR simplest: any
  authenticated user may author + publish their own templates; `user` role can
  only fill. Pick per product call — **default: any user can author** (matches
  today), gate nothing new except the admin screens that already exist.
- **API** (`server/internal/httpapi/`):
  | Method | Path | Auth | Purpose |
  |--------|------|------|---------|
  | `POST` | `/api/schemas/{id}/publish` | owner | set `visibility='shared'`, mint `share_slug` |
  | `POST` | `/api/schemas/{id}/unpublish` | owner | back to private, keep slug |
  | `GET`  | `/api/public/templates/{slug}` | none | template + meta + tokens, **no** owner data, `body` stripped to what the renderer needs |
  | `POST` | `/api/public/templates/{slug}/submissions` | none (rate-limited, reuse `auth/throttle.go`) | `{ values, submitter? }` → server renders via a Go port… see note → stores + returns `{ output }` |
  | `GET`  | `/api/schemas/{id}/submissions` | owner | list |
  | `GET`  | `/api/submissions/{id}` | owner of template | one, with `output` |
  - **Render-on-server note:** the renderer is TS (`FormFlowParser.render`). Two
    options: (a) render client-side in `FillPage`, POST the already-rendered
    `output` (server just stores + re-validates size) — **pick this, least
    work**; (b) port `render` to Go — deferred. Server still re-runs zod-
    equivalent required/pattern checks? No — keep server dumb, trust the
    client render, cap size. Security: `output` is just stored text shown back
    to the owner; no execution.
- **Frontend:**
  - `HomePage`: per-card "Publish" → copy share link; a "Submissions (N)" link.
  - `web/src/pages/SubmissionsPage.tsx` — table, open one, download its `output`.
  - `web/src/pages/PublicFillPage.tsx` at `/f/:slug` — `AuthGate`-exempt route
    in `App.tsx`, reuses `FillPage`'s form guts.
  - `authStore`/new `publicStore` for the unauthenticated calls.
- **Tests:** `submissions_test.go` (publish → slug resolves → submit → owner
  lists it → other user 404s the private endpoints), cross-user isolation.

**Acceptance:** author publishes the ILS token template, opens `/f/<slug>` in a
logged-out browser, fills `Name` + `IP Address`, submits; author sees the
submission and downloads the exact `instanceXML` with tokens substituted.

---

### F12 — format plugins + schema import  ·  M–L

**Goal:** "future forms, not just XML/YAML/JSON."

- `web/src/formflow_ext/formats/index.ts` — a registry:
  ```ts
  interface FormatPlugin {
    id: string                 // 'toml' | 'ini' | 'dotenv' | 'csv'
    label: string
    extensions: string[]
    detect(raw: string): boolean
    parse(raw: string): FormFlowSchema
    render(schema: FormFlowSchema, values: Record<string, unknown>): string
  }
  ```
  `DesignerPage.detect()` tries the core parser first (JSON/XML/YAML), then the
  registry. `FileDropField accept` + `EXT` map + `schema.format` widen.
- Plugins:
  - **TOML** — `smol-toml` (small, no deps). Nested tables → objects, arrays of
    tables → arrays.
  - **INI / `.properties`** — hand-rolled (~60 lines) or `ini`. Sections →
    objects, `key=value` → leaves. `.properties` = INI with no sections.
  - **`.env`** — flat `KEY=VALUE`, quoted-value aware. Trivial.
  - **CSV** — `Papa Parse`. Header row → object template, rows → array. Round-
    trip to CSV on render.
- **Backend:** `kind` allowlist var (F6) gains the new ids; `schemas` migration
  not needed (column is free-text `TEXT`).
- **Schema import (skip inference):** accept a **JSON Schema** or **XSD** as the
  dropped file → build `FormFlowSchema` + `FieldMeta` directly from it
  (`type`, `required`, `enum`, `pattern`, `minimum`/`maximum` map 1:1 onto
  `FieldMeta`). New `formflow_ext/importers/{jsonSchema.ts,xsd.ts}`. This is the
  clean path for finding #8 — declared types beat guessed ones.
- **Tests:** one round-trip test per format (fixture in `__fixtures__/`),
  `jsonSchema.test.ts` (a JSON Schema with `pattern`+`enum`+`required` →
  `FieldMeta` carries them).

**Acceptance:** drop a `.toml`, `.env`, `.ini`, `.csv` and a `.schema.json` —
each detects, generates a form, round-trips. The JSON Schema's `pattern` shows
up as a filler-side validation with no authoring step.

---

## Cross-cutting

- **Docs:** every phase updates [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
  (new `formflow_ext/` section) and [`docs/API.md`](docs/API.md) (F11 routes).
  Update [`PLAN.md`](PLAN.md) status + [`CLAUDE.md`](CLAUDE.md) "Status & what's
  next" as phases land.
- **`erasableSyntaxOnly`** is on — no `enum`, no parameter properties. Use union
  types + plain objects (already assumed above).
- **Emerald theme** — new UI uses tokens only, no hex.
- **Backend rule** — every new query stays `WHERE … AND user_id = ?`; public
  endpoints resolve by `share_slug` and never join to owner PII.
- **InfraKit sync** — nothing in this plan edits `core/form_flow/**` or
  `core/ports/**`. If F7 attribute support is promoted upstream, note it in the
  commit and port both ways.

## Effort

F6 M · F7 M · F8 S–M · F9 L · F10 M · F11 L · F12 M–L → **XL total**, ~2–3
focused weeks. F6 unblocks everything; F7 + F12 are parallelizable; F11 wants F5
(deploy) done first.

## Sequencing with F5

F5 (release + Docker + CI, from `PLAN.md`) is still open. Recommended order:
**F6 → F7 → F8 → F9 → F10 → F5 → F11 → F12**. F5 before F11 so the share links
point at a real hosted URL and CI covers the new Go endpoints.
