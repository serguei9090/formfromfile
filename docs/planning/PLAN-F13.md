# FormFromFile — plan F13+ (polish)

Follow-on to [`PLAN.md`](PLAN.md) (F0–F5) and [`PLAN-F6.md`](PLAN-F6.md)
(F6–F12). The product works end to end; this plan is about fidelity, UX
friction, and shipping confidence. Nothing here adds a new capability — it
makes the existing ones trustworthy.

Read [`docs/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md) and [`CLAUDE.md`](../../CLAUDE.md)
before starting a phase. Same rules: everything lands in
`web/src/formflow_ext/**` or the app layer — the verbatim `core/form_flow/**`
stays frozen.

---

## What's rough today

| area | symptom | phase |
|------|---------|-------|
| YAML round trip | comments + key order lost on export (js-yaml `dump`); a real `.yaml` config comes back stripped | **F13** |
| `.env` round trip | comments, blank-line grouping, and key order lost | **F13** |
| XML comments | preserved but re-positioned to the top of their parent (fast-xml-parser is not order-aware) | **F13** |
| number `"1.0"` / `"007"` | still coerced to `1` / `7` unless the author retypes the field to text; `numberFormat: 'string'` exists in the model but no UI sets it | **F13** |
| big schemas | the ILS full file → one long flat tree, no collapse, no search | **F14** |
| designer preview | to see the validated fill view you must save first, then open `/fill/:id` | **F14** |
| tokens | authored with zero metadata — no label/help/validation per token (the F8 plan intended `FieldMeta` for tokens) | **F14** |
| submissions | no CSV export, no delete, no bulk download; one-by-one only | **F15** |
| public fill | no theme control, thin "link expired" state, no progress indicator, draft lost on reload | **F15** |
| bundle | ~515 kB JS (one chunk) — `papaparse` + `smol-toml` + the whole app load up front | **F16** |
| mobile | designer is a fixed 2-column grid; unusable under ~700 px | **F16** |
| a11y | the ⚙ panel and inline errors aren't announced; focus isn't moved on open | **F16** |
| errors | `authStore` / `schemasStore` swallow fetch failures in `catch {}` — a down backend looks like an empty list | **F17** |
| tests | every end-to-end flow has only ever been checked by hand in the browser | **F17** |
| onboarding | first run is an empty "My Forms" and a blank designer — no examples, no guidance | **F18** |

`CLAUDE.md` "Known rough edges" also still claims retype "re-seeds the whole
form" — F9's `reseedPreserving` fixed that for branches that keep their shape;
update the note in F14.

---

## Progress

- **F13 done** (partial) — `formflow_ext/yaml/richYaml.ts` (comment + key-order
  preserving YAML via the `yaml` package's `Document`), `.env` line model in
  `formats/dotenv.ts` (comments / blanks / order kept), `coerce.ts` `smartScalar`
  (keeps `"1.0"` / `"007"` — review finding #8), FormFields drops `valueAsNumber`
  so number text reaches the renderer intact. `FormatPlugin.render` gains
  `source`. +8 web tests, E2E verified. **Deferred:** XML inline-comment
  position (`preserveOrder` opt-in) — current bunched-to-parent-top behaviour
  kept.
- **F16 done** (partial) — route-level `React.lazy` + `Suspense`: initial JS
  208 kB (67 kB gzip, was 613/194); the format libs (`yaml` / `papaparse` /
  `smol-toml`) split into a 315 kB chunk that loads only on designer/fill
  routes. A11y: `aria-expanded` on the ⚙ toggle, `role="alert"` on field +
  send errors, focus moves into the `FieldSettings` panel on open, descriptive
  `aria-label`s. Responsive designer was already 1-col below `lg` — the
  segmented small-screen control is **deferred** (authors use desktop).
- **F17 done** (partial) — `internal/httpapi/httpapi_test.go` (was zero): schema
  lifecycle + publish + public share + anonymous submission + owner scoping +
  the per-IP 429 + admin 403 + health/config. CI gains `golangci-lint`
  (`server/.golangci.yml`). `authStore.offline` + `schemasStore.error` — stores
  stop swallowing; `Shell` shows a "can't reach the server" banner with retry,
  `HomePage` shows a load-error card. Dockerfile `HEALTHCHECK` via a new
  `--healthcheck` flag (distroless has no curl).
- **F17 e2e done** — `web/e2e/` Playwright suite (`bun run e2e`): a `setup`
  project registers the bootstrap admin, then specs cover register→app,
  unknown share link, detect→export→save in the designer, and
  publish→anonymous fill→owner-reads-submission. Two `webServer`s: `go run` the
  API against a throwaway SQLite (`e2e/api-server.mjs`) + Vite. Auth over the
  API (`page.request`), not the flaky login form. CI `e2e` job.
- **F14 done** (partial) — `SchemaTree` rows collapse (chevron, `aria-expanded`),
  container rows show a child + "N set" count; a filter box on the Schema card
  (matches key/label, keeps ancestors, force-expands); a **Design ▏ Fill
  preview** toggle on `DesignerPage` renders `<FillForm>` against the current
  unsaved schema/meta/tokens. `CLAUDE.md` rough-edges note corrected.
  **Deferred:** per-token `FieldMeta`, array reorder, source-default display.
- **F15 done** (partial) — `DELETE /api/submissions/{id}` (store + route +
  tests); `SubmissionsPage` gets a delete button + **Export CSV** (flattens
  each submission's `valuesJson`, union of keys as columns). `FillForm`:
  localStorage **draft autosave** (`draftKey` per template/slug, restored on
  load, cleared on submit), a **"N of M required done"** progress line, and a
  **"Submit another"** step after sending. `PublicFillPage` header gets a theme
  toggle. **Deferred:** zip download + QR share dialog (need libs), "new since
  last visit" marker.
- **F18 done** (partial) — `data/samples.ts` (Tool XML, k8s YAML, `.env`,
  `pyproject.toml`); empty "My Forms" shows the supported-format list + sample
  cards; `?sample=<id>` loads + auto-detects in the designer; a dismissible
  first-run tip (localStorage); MIT / InfraKit-lineage / source footer in
  `Shell`. **Deferred:** README screenshots/GIF (needs a running capture).

## Phases

Ship order: **F13 → F16 → F17 → F14 → F15 → F18**. Fidelity and the
perf/a11y/tests base come first (they touch shared code); the UX phases build on
a stable base; onboarding is last because it depends on the final UI.

Each phase = its own commit(s) to `main`, **no batching**, green gate first
(`bun run build && bun run test && bun run lint`; `go build ./... && go vet
./... && go test ./...`), Conventional Commits, `Co-Authored-By` trailer.

---

### F13 — format fidelity (XML → YAML → .env)  ·  L

**Goal:** a hand-written config comes back out looking like a human wrote it.

- **YAML rich layer** — `web/src/formflow_ext/yaml/richYaml.ts`, same shape as
  `xml/richXml.ts`. Use the `yaml` package (eemeli, CST/Document API — new dep,
  ext-layer only, the frozen core keeps js-yaml).
  - `parseRichYaml(raw)` → `{ schema, seed }`, preserving key order.
  - `renderRichYaml(schema, values, source)` — edit the parsed `Document`
    in place so **comments and key order survive**; only changed scalar nodes
    are rewritten.
  - `DesignerPage` / `FillForm` route YAML through it (like XML today).
  - Test: a `.yaml` with `# comments`, a specific key order, and a nested block
    round-trips with comments intact.
- **`.env` fidelity** — rework `formats/dotenv.ts` to keep a line model
  (comment / blank / pair) instead of a flat map; render replays it, swapping
  only the values. Blank-line groups and `#` comments preserved.
- **XML inline comments** — add an opt-in `preserveOrder` path to `richXml`
  for files where comment position matters; keep the current fast path as the
  default. Document the trade-off.
- **`numberFormat: 'string'` in the UI** — `FieldSettings` gets a "keep exact
  text (don't parse as a number)" checkbox for number fields; `richXml` /
  `formats` renderers honour it so `"1.0"` / `"007"` survive. Closes review
  finding #8 without needing a retype.
- Update `docs/ARCHITECTURE.md` (`formflow_ext/yaml/`), bump the test count.

**Acceptance:** a real `docker-compose.yml`-style file (comments, anchors
aside) round-trips with every comment and the original key order; a `.env` with
grouped sections + comments round-trips; a version field `"1.0"` exports as
`1.0`.

---

### F14 — designer UX  ·  L

**Goal:** editing a 100-field template isn't a chore.

- **Collapsible tree** — `SchemaTree` object/array rows collapse; show a child
  count and a "configured N" badge. Persist expanded state per template id in
  `localStorage`.
- **Filter box** — type to filter fields by key/label; matches stay expanded.
- **Preview toggle** — a "Design ▏ Fill" switch on `DesignerPage` that renders
  `<FillForm>` (validated, `hideLocked`) against the *current unsaved*
  schema+meta, so the author sees exactly what the filler gets without saving.
- **Token authoring** — a `FieldMeta` per token: label, help, preset/required.
  `TokenSpec` gains an optional `meta` ref or the token uses a synthetic path
  in the same `FieldMetaMap`. Filler + validation pick it up.
- **Array controls** — "seed N items to match source" button; drag-reorder
  items; per-item collapse.
- **Per-field affordances** — show the detected source default under the input;
  a "reset to source" link; a copy-path button (for regex authors).
- Fix the stale `CLAUDE.md` "Known rough edges" retype note.

**Acceptance:** load the full ILS file — collapse `Services`, filter to
`RTO*`, flip to Fill preview, see validation live, flip back. Author a token
with a `port` preset; the filler sees the error.

---

### F15 — filler + sharing polish  ·  M

**Goal:** the round trip feels finished on both ends.

- **Submissions** — `SubmissionsPage`: select rows → **download all** (zip of
  outputs) or **export CSV** (submitter, date, values flattened); delete a
  submission (`DELETE /api/submissions/{id}`, owner-scoped); a "new since last
  visit" marker.
- **Public fill** — theme toggle in the minimal header; a proper "this link is
  no longer active" screen (unpublished vs never-existed look the same to the
  visitor by design — keep that, just make it friendly); a post-submit screen
  with the rendered file + copy/download and a "submit another" link.
- **Draft autosave** — `FillForm` writes `values` + `tokenValues` to
  `localStorage` (keyed by template id / slug), restores on reload, clears on
  successful submit. Per-viewer, best-effort (wrap every access in try/catch).
- **Progress** — "3 of 8 required fields done" on the fill screen.
- **Share affordance** — the HomePage "Publish" turns into a small dialog:
  copyable link, "open preview", a QR (inline SVG, no dep), unpublish.

**Acceptance:** publish → fill half → reload → draft restored → finish →
submit → "submit another" → owner selects both submissions → downloads a zip.

---

### F16 — performance, responsive, a11y  ·  M

**Goal:** fast first paint, usable on a phone, usable with a keyboard.

- **Code-split** — `React.lazy` + `Suspense` per route; move `papaparse` /
  `smol-toml` behind the format registry's first use (dynamic `import()` inside
  the plugin). Target < 200 kB gzip initial.
- **Responsive designer** — under `lg`, stack the Schema and Form cards; a
  segmented "Schema ▏ Form ▏ Output" control on small screens.
- **A11y pass** — `aria-live="polite"` region for form errors; move focus into
  the `FieldSettings` panel on open and back to the ⚙ on close; `aria-expanded`
  on tree toggles; label every icon-only button (audit — most are done);
  visible focus rings on the tree rows.
- **Dark-mode audit** — walk every F6–F15 screen in both themes; the token
  system already covers it, this is a look-for-regressions pass.

**Acceptance:** Lighthouse: initial JS < 200 kB gzip, a11y ≥ 95; the designer
is operable at 375 px wide; tab-through reaches every control and errors are
announced.

---

### F17 — quality gate  ·  M

**Goal:** CI catches what the browser sessions caught.

- **Playwright e2e** (`web/e2e/`, its own `bun run e2e`, added to CI):
  - register → first user admin → logout → login
  - detect (XML with attrs) → retype → add validation → fill → export → verify
    the output string
  - save → publish → open `/f/:slug` in a fresh context → fill → submit →
    owner sees the submission
  - each of the 7 formats: paste a fixture → detect → export → assert round trip
- **Backend** — add `golangci-lint` to CI; a `httpapi` handler test package
  (currently zero — `internal/httpapi` has no `_test.go`), covering the
  publish/submission routes and the public rate-limit 429.
- **Frontend** — `tsc --noEmit` as its own CI step (build already runs it, but
  a named step fails faster and clearer).
- **Error surfacing** — `authStore` / `schemasStore` stop swallowing:
  `refresh` sets an `error` field; a dismissible banner in `Shell` when the API
  is unreachable; `ApiError` messages shown, not eaten.
- **Dockerfile `HEALTHCHECK`** — add a `--healthcheck` flag to the binary that
  hits its own `/healthz` and exits 0/1 (distroless has no shell/curl), wire it
  into the Dockerfile.
- CI: cache `bun` and Playwright browsers; run e2e against the built container.

**Acceptance:** `bun run e2e` green locally and in CI; killing the backend
shows a banner, not a blank list; `docker inspect` shows `healthy`.

---

### F18 — onboarding & product surface  ·  S–M

**Goal:** a first-time visitor understands it in 30 seconds.

- **Sample templates** — a small gallery on the empty "My Forms": ILS-style
  tool XML, a Kubernetes Deployment YAML, a `.env`, a `pyproject.toml`. One
  click loads it into the designer (not saved until the user saves).
- **Empty / first-run states** — designer: a short "drop a file or pick a
  sample" with the supported-format list; My Forms empty state points at the
  gallery; Submissions empty state explains publish → share.
- **Inline guidance** — a dismissible first-run tip on the designer explaining
  the ⚙ panel and the Design/Fill toggle; persisted dismissed in
  `localStorage`.
- **README** — screenshots / a short GIF of the author→fill→collect loop; a
  "supported formats" table (mirror of the one in this repo's chat history).
- **`/about` or a footer** — MIT, the InfraKit lineage, a link to the repo.

**Acceptance:** a logged-in user with no forms can load a sample, see a
generated form, flip to Fill preview, and export — without reading docs.

---

## Cross-cutting

- New dep in F13 (`yaml`), F15 has none (QR + zip done inline / tiny), F16
  removes weight (dynamic imports). Keep `papaparse` / `smol-toml` — just lazy.
- Every phase updates `docs/ARCHITECTURE.md` and, where routes change,
  `docs/API.md` (F15 adds `DELETE /api/submissions/{id}`).
- `PLAN-F13.md` gets a progress log at the top as phases land (same style as
  `PLAN-F6.md`).
- No change to `core/form_flow/**` or `core/ports/**`.

## Effort

F13 L · F14 L · F15 M · F16 M · F17 M · F18 S–M → **L–XL total**, ~1.5–2 weeks.
F13/F16/F17 are the load-bearing ones; F14/F15/F18 are independent and can drop
if time is short.

## Explicitly out of scope

XSD import, HCL / protobuf formats, real-time collaboration, template version
history + diff, OIDC/SSO, a hosted multi-tenant deployment story, i18n.
