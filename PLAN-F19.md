# FormFromFile — plan F19+ (v0.2: pipeline, lifecycle, AI, fidelity)

Follows [`PLAN.md`](PLAN.md) (F0–F5), [`PLAN-F6.md`](PLAN-F6.md) (F6–F12),
[`PLAN-F13.md`](PLAN-F13.md) (F13–F18 polish). Those got the product to
"author a template → fill it → collect submissions". This plan turns it into a
**config-handoff pipeline**: edit existing files, see what changed, version
templates, deeper validation, AI assist, more formats, and delivery
(webhook / Git / email).

Rules unchanged: everything in `web/src/formflow_ext/**` or the app / server
layers — `core/form_flow/**` stays frozen. Each phase = its own commit(s) to
`main`, no batching, green gate first, Conventional Commits + `Co-Authored-By`.

---

## Phases at a glance

| # | Phase | Effort | Depends on |
|---|-------|--------|-----------|
| **F19** | Release housekeeping | S | — |
| **F20** | Reverse fill + diff | M–L | — |
| **F21** | Template lifecycle (versions, draft/publish, folders, fork, approval) | L | — |
| **F22** | Validation depth (cross-field, conditional, computed, async) | L | F21 |
| **F23** | AI assist (authoring, diff-explain, schema-from-prompt, fill-assist) | L | F21, F22 (more to fill in) |
| **F25** | Team & workflow (roles, comments, webhooks, email, export-to-Git/zip) | L | F21 |
| **F26** | Polish / ops (audit log, captcha, analytics, per-template theming, i18n, PWA) | M–L | F21 |
| **F24** | More formats + full-fidelity round-trip + bulk CSV fill — **deferred (larger effort)** | L–XL | — |
| **F27** | Integrations (GitHub PR, CLI, API tokens, OIDC) — **on request only** | — | F25 |

**Execution order:** F19 → F20 → F21 → F22 → F23 → F25 → F26. **F24 is deferred**
(kept in this doc for scope; pick it up after F26 or when a specific format is
needed). F27 stays parked.

---

## Progress

- **F19 done** — `xml/richXmlOrdered.ts` (opt-in `preserveOrder` render, keeps
  between-element comments; per-template toggle), `CHANGELOG.md`, `v0.1.0` tag
  (local). +4 tests.
- **F20 done** — `reverseFill.ts` (`alignValues` / `valuesFromFilledFile` — pull
  form values from an already-filled file onto the template schema),
  `diff.ts` + `designer/DiffView.tsx` (value-tree diff). "Load values from a
  filled file" in the designer + fill screen; "Show changes from the original"
  on the fill screen; submission detail shows submitted-vs-default diff + a
  "Re-run on current template" that pre-fills `/fill/:id`. +6 tests, E2E
  verified.
- **F21 done** — migration v3: `template_versions` + `schemas` columns
  (`current_version` / `status` / `folder` / `tags` / `forked_from` /
  `requires_approval`) + `submissions` columns (`template_version` / `status` /
  review). Store: version-on-update, `ListVersions` / `GetVersion` /
  `RollbackSchema` / `ForkSchema` / `SetApprovalGate` / `ReviewSubmission`;
  `ListSchemas` gains a folder/tag/query filter. Routes: `/schemas/{id}/`
  `fork` · `versions` · `versions/{n}` · `rollback/{n}` · `approval`,
  `/submissions/{id}/review`. Frontend: designer version-note + folder/tags
  inputs + history panel with rollback; HomePage search + folder/tag chips +
  fork + draft/published badge; SubmissionsPage status badges + approve/reject
  + the approval-gate toggle. +go tests, E2E verified.
- **F22 done** — `formflow_ext/rules.ts`: structured `Cond` (leaf `{path,op,value}`
  + `all`/`any`), `evalCond` (no `eval`), `failingRules`, `evalComputed` /
  `withComputed`. `FieldMeta` gains `visibleWhen` / `requiredWhen` / `computed`
  / `checkUrl`; `FormTemplate.rules`. FormFields hides `visibleWhen`-false
  fields, renders `computed` read-only; `validation` skips hidden fields,
  honours `requiredWhen`, adds form-level rule errors. FieldSettings builders +
  `designer/RulesEditor.tsx`. Server `POST /public/templates/{slug}/check` —
  proxies only the author-stored `checkUrl`, blocks private/loopback targets.
  jsonSchema importer resolves local `$ref`, merges `allOf`, collapses
  `oneOf`/`anyOf` of consts to an enum. +9 tests, E2E verified. **Deferred:**
  OpenAPI / XSD importers.
- **F23 done** — `server/internal/ai/` on `anthropic-sdk-go` (Sonnet 5 default,
  `FFF_AI_MODEL`); `Service` interface (fake for tests), no-op without a key.
  Routes `/api/ai/{status,suggest-meta,explain-diff,schema-from-prompt,
  fill-assist}` — `requireAuth`, 30/user/hr, **501 without `FFF_ANTHROPIC_API_KEY`**.
  Frontend: `authStore.aiEnabled`; designer "✨ Suggest labels & validation" +
  "describe the config you need"; fill screen "✨ Fill" + "Explain these
  changes". `docs/AI.md`. +go test (501 path). Live calls not exercised in CI.
- **F25 done** — migration v4: `author` role (existing `user` accounts → `author`,
  new sign-ups are fillers), `submission_comments`, `webhooks`,
  `webhook_deliveries`. `auth.SetRole` + `requireAuthor` (gates create / update /
  publish / fork / rollback / webhook-config). `internal/webhook` — HMAC-SHA256
  signed POST, 3 attempts w/ backoff, delivery log; fires on
  `submission.created` (auto-approved) and `submission.approved`. Store comment
  + webhook CRUD; `GET /schemas/{id}/submissions.zip` (streamed). Frontend:
  `AdminPage` at `/admin` (role + disable), SubmissionsPage comment thread +
  ZIP + webhooks section, HomePage hides authoring for fillers. +go tests
  (webhook payload + HMAC, comments, zip). **Deferred:** email-on-submit,
  Git-repo commit target.
- **F26 done** (partial) — migration v5: `audit_log`, `schemas.submission_cap`
  / `brand` / `view_count`. `store.Audit` / `RecentAudit` / `BumpViewCount` /
  `SubmissionCount` / `SetTemplateOps`. Audit recorded on publish / unpublish /
  rollback / fork / delete / review / role / ops; `GET /api/admin/audit`.
  Per-slug submission cap enforced (403 "no longer accepting"); public view
  bumps `view_count` → completion-rate on SubmissionsPage. Per-template brand
  (accent colour + optional logo) applied on `/f/:slug`. AdminPage audit-log
  panel. +go test. **Deferred:** hCaptcha/Turnstile, i18n, offline PWA.

---

### F19 — release housekeeping  ·  S

- **`v0.1.0`** — annotated tag on the current tip once CI is green on `main`
  (push only when the user asks). A `CHANGELOG.md` seeded from the F0–F18
  commit log.
- **XML inline-comment position** — add an opt-in `preserveOrder` path to
  `xml/richXml.ts` for files where a comment sits *between* two elements and
  must stay there. Keep the current fast (bunched) path as the default; a
  per-template toggle picks it. (`PLAN-F13.md` deferred item.)
- **README media** — a short screen capture of author → publish → fill →
  collect, plus a screenshot of the designer; embed in `README.md`. The
  `data/samples.ts` gallery gives a repeatable script.
- `golangci-lint` — run it locally once (or in a throwaway CI branch) and fix
  whatever the first real run surfaces.

**Acceptance:** `git tag v0.1.0` exists; a `.editorconfig`-style file with a
between-elements comment round-trips in `preserveOrder` mode; README shows the
loop.

---

### F20 — reverse fill + diff  ·  M–L   *(highest ROI)*

Turn the tool from "make one file" into "edit the file you already have".

- **Reverse fill** — `web/src/formflow_ext/reverseFill.ts`:
  `alignValues(schema, decoded)` walks the template schema and pulls each leaf's
  value out of an *already-filled* file's decoded tree (by dotted path; arrays
  matched by index, then by a key heuristic). Unmatched template fields keep
  their default; unknown source keys are dropped from the form but preserved on
  render (the rich layers already do this).
  - Designer + fill: a second drop zone — "load values from a filled file" —
    that runs `parseSource` on the upload, then `alignValues`, then
    `form.reset(...)`.
  - `/f/:slug?prefill=` accepts a pasted filled file too (so a filler can start
    from last quarter's config).
- **Diff** — `web/src/formflow_ext/diff.ts`: `diffValues(before, after)` →
  `Change[] = { path, label, before, after, kind: 'added'|'removed'|'changed' }`.
  - `web/src/designer/DiffView.tsx` — grouped by section, changed values
    highlighted, "N changed · M added · K removed" summary. Shown in the fill
    screen ("what you changed from the original") and on a submission
    (`SubmissionsPage`: original vs submitted).
  - Text-level diff of the rendered output as a fallback view (line-based).
- **Re-apply** — on `SubmissionsPage`, "Re-run against current template": load
  a past submission's values, `alignValues` them onto the *current* template
  version, open the fill screen with a diff banner ("3 values no longer apply").

**Acceptance:** upload the ILS file *and* a modified copy → the form shows the
modified values, the diff lists exactly what changed; a submission's detail view
shows original-vs-submitted side by side.

---

### F21 — template lifecycle  ·  L

- **Version history** — new `template_versions` table (`id`, `template_id`,
  `version`, `body`, `form_json`, `notes`, `created_by`, `created_at`);
  `schemas.current_version`. Every `PUT /api/schemas/{id}` writes a new version
  (with an optional `notes` field) instead of overwriting; `body`/`form_json`
  on `schemas` mirror the current version for fast reads.
  - `GET /api/schemas/{id}/versions`, `GET /api/schemas/{id}/versions/{n}`,
    `POST /api/schemas/{id}/rollback/{n}` (owner).
  - `submissions.template_version` records which version was filled.
  - UI: a version dropdown in the designer + a "History" panel (notes, date,
    diff between any two versions — reuses F20 `diffValues`).
- **Draft vs published** — `schemas.status` (`draft` | `published`);
  `visibility` stays for share scope. A draft can't be shared; publishing snaps
  a version and can carry a changelog note. "Unpublish" → back to `draft`.
- **Folders + tags + search** — `schemas.folder` (text path), `schemas.tags`
  (JSON array). `GET /api/schemas?folder=&tag=&q=` filters server-side.
  HomePage gets a sidebar (folders), a tag filter, and a search box.
- **Duplicate / fork** — `POST /api/schemas/{id}/fork` copies body + form_json +
  meta into a new template owned by the caller (`forked_from` column for
  lineage).
- **Approval gate** — `schemas.requires_approval` (bool). When set, a public
  submission lands `status='pending'`; the owner sees a review queue and
  Approve / Reject (`review_note`). Only `approved` submissions count in
  analytics / exports / webhooks.
  - `POST /api/submissions/{id}/review` `{ approved: bool, note?: string }`.

**Acceptance:** edit a published template twice with notes → History shows both
versions and the diff; roll back → the live form reverts; fork a template →
independent copy; a `requires_approval` template's submission sits in the queue
until approved.

---

### F22 — validation depth  ·  L

Extends `FieldMeta` (still the side-car, still per dotted path):

- **Conditional visibility / requirement** — `visibleWhen?: Cond`,
  `requiredWhen?: Cond` where `Cond` is a small structured predicate
  (`{ path, op: 'eq'|'ne'|'in'|'gt'|'lt'|'truthy', value }`, optionally
  `all`/`any` of sub-conds). `web/src/formflow_ext/rules.ts` evaluates it against
  the current values — **a tiny structured evaluator, never `eval`**.
  - `FormFields` hides a field whose `visibleWhen` is false (and skips it in
    validation); `FieldSettings` gets a "show this field only when…" builder
    (pick a sibling field + operator + value).
- **Computed / derived fields** — `computed?: string` — a token template over
  other field paths (`"${host}:${port}/${basePath}"`). Rendered read-only in the
  form, evaluated at export. Reuses the F8 token engine, pointed at field paths
  instead of `%tokens%`.
- **Cross-field rules** — `FormTemplate.rules: Rule[]` — named checks
  (`{ id, when: Cond, message }`) surfaced as form-level errors ("Passive mode
  needs a port"). Authored in a new "Rules" tab on the designer.
- **Async validation** — `FieldMeta.checkUrl?: string` (+ method / body
  template). On blur the fill screen POSTs `{ value }` and shows the JSON
  `{ ok, message }` result. Server proxies it (`POST /api/validate-proxy`,
  author-allowlisted hosts only) so the browser isn't blocked by CORS and the
  target URL isn't exposed to the filler.
- **Richer schema import** — `importers/jsonSchema.ts` resolves local `$ref`,
  flattens `allOf`, maps `oneOf`/`anyOf` of `const`s to an enum, reads
  `if/then` into a `visibleWhen`. New `importers/openapi.ts` (pull a request-body
  schema from an OpenAPI doc). `importers/xsd.ts` (elements, `xs:restriction`
  → pattern / enum / min-max, `minOccurs`/`maxOccurs` → array).

**Acceptance:** on a template, "FTP host" only appears when "mode = active", a
computed `endpoint` field shows `10.0.0.5:21` live, a rule blocks export when
"start ≥ end", and an XSD import arrives with `pattern` + `enum` already set.

---

### F23 — AI assist  ·  L   *(needs an API key; degrades cleanly without one)*

Server-side only — the key never reaches the browser. New `server/internal/ai/`
using **`github.com/anthropics/anthropic-sdk-go`**. Model: default
`claude-sonnet-5` for the labeling / extraction calls (cheap, fast, plenty);
`claude-opus-5` reserved for the harder "schema from a paragraph" call — both
configurable via `FFF_AI_MODEL`. Adaptive thinking on; structured outputs
(`output_config.format`) so responses are typed JSON, not prose. Every endpoint
is `requireAuth` + author-gated + per-user rate-limited, and returns `501` with
`{ "error": "AI features are not configured" }` when `FFF_ANTHROPIC_API_KEY` is
unset. An `ai_usage` row per call (user, endpoint, input/output tokens) for cost
visibility.

- **Template authoring assist** — `POST /api/ai/suggest-meta`
  `{ schema, sampleValues }` → a `FieldMetaMap`: proposed labels, help text,
  validation presets, which fields look sensitive (→ `editable:false` or a
  "secret" hint), and a section grouping. Designer: a "✨ Suggest labels &
  validation" button; changes land as a reviewable diff the author accepts or
  edits (never auto-applied).
- **Diff explanation** — `POST /api/ai/explain-diff` `{ before, after, format }`
  → a short plain-English summary + a risk flag per change ("TLS disabled —
  check this is intended"). Shown in the F20 DiffView and on a submission.
- **Schema from a description** — `POST /api/ai/schema-from-prompt`
  `{ description, format }` → `{ body, kind }` a starter file the designer then
  detects normally. Empty-designer CTA: "Describe the config you need…".
- **Fill assist** — `POST /api/ai/fill-assist` `{ schema, meta, instruction }`
  → a partial values tree. Filler types "passive FTP on 10.0.0.5, RTO with
  auto-approve" → the form pre-fills; every AI-set field is badged and easily
  cleared.
- **Submission review assist** — with F21 approval on: `POST /api/ai/review`
  flags a pending submission's anomalies vs. the template defaults / other
  submissions ("port 9999 — every other submission uses 9000").

All prompts live in `server/internal/ai/prompts/` as files, versioned, with a
"why this is safe" note (inputs are user config data, output is advisory, no
tool use, no code execution).

**Acceptance:** with a key set, "Suggest labels & validation" on the ILS file
returns sensible labels + the IPv4 preset on the address field; without a key,
the button is hidden and the endpoints 501.

---

### F24 — more formats + full-fidelity round-trip  ·  L–XL   *(DEFERRED — larger effort)*

- **New format plugins** (same `FormatPlugin` contract, `formflow_ext/formats/`):
  - **HCL** (Terraform) — `hcl2-parser` or a hand-rolled block/attr reader.
  - **Java `.properties`** — line continuations (`\`), `\uXXXX` escapes,
    `!`/`#` comments (the current `ini` plugin is too loose for these).
  - **`.editorconfig`** — INI-ish with `[glob]` sections + `root=true`.
  - **Nginx / Apache** — brace / directive blocks (read-mostly; round-trip the
    common subset).
  - **systemd unit** — INI with repeated keys (`ExecStartPre=` ×N) → arrays.
  - **Dockerfile** — instruction list; edit `ENV` / `ARG` / `EXPOSE` values.
  - **Caddyfile** — block structure.
  - **protobuf text format** — `key: value` + nested `{}`.
- **Multi-document YAML** — `---`-separated docs → a top-level array the form
  can add/remove docs to; `richYaml` handles the `Document` collection.
- **Full-fidelity round-trip** — for the formats that have a CST
  (YAML via `yaml`, and a new order-aware XML path from F19), preserve *quote
  style*, *indentation width*, and *comment position* — not just the values.
  Document per-format what is and isn't preserved in `docs/ARCHITECTURE.md`.
- **Bulk CSV fill** — a filled CSV where each row is one submission: upload on
  the fill screen → N previews → submit all (or download all rendered files).
  The ROI item from the feature review.

**Acceptance:** a real `Cargo.toml`, a `systemd` unit with three `ExecStartPre=`
lines, and a 3-document `kustomization`-style YAML each round-trip; a 20-row CSV
produces 20 rendered files.

---

### F25 — team & workflow  ·  L   *(needs F21)*

- **Roles** — `users.role` gains `author`. `admin` > `author` > `user`.
  Only `author`/`admin` may create + publish templates; `user` fills only.
  Admin screen: change a user's role. First user stays `admin`.
- **Submission comments** — `submission_comments` table (`submission_id`,
  `user_id`, `body`, `created_at`); a thread on `SubmissionsPage` for the owner
  and (optionally, by a claim token in the share link) the submitter.
- **Webhooks** — `webhooks` table (`template_id`, `url`, `secret`, `events`
  JSON — `submission.created` / `submission.approved`). On the event, POST the
  rendered file + metadata with an HMAC-SHA256 signature header; retries with
  backoff; a delivery log (`webhook_deliveries`). UI on the template settings.
- **Email on submit** — `schemas.notify_emails` (JSON list). The server sends
  the rendered file as an attachment. SMTP config via `FFF_SMTP_*`; feature off
  (no send, just a note) when unset.
- **Export all submissions** — `GET /api/schemas/{id}/submissions.zip`
  (streaming zip of rendered outputs, one file per submission, names from
  submitter + date) and the F15 CSV. A "commit to a Git repo" target
  (`git_remote` + `path` + a deploy key) that opens a branch/PR with the
  generated files — lands here if F27 (integrations) isn't pulled forward.

**Acceptance:** a webhook fires on an approved submission with a valid HMAC; the
owner and submitter exchange comments on a submission; `submissions.zip`
downloads every rendered file.

---

### F26 — polish / ops  ·  M–L

- **Audit log** — `audit_log` table (`actor`, `action`, `target_type`,
  `target_id`, `meta`, `at`). Record publish / unpublish / rollback / fork /
  delete / role-change / review / webhook-config. Admin view with filters;
  retention window.
- **Public-share abuse controls** — a proof-of-work or hCaptcha/Turnstile
  challenge on `POST /public/templates/{slug}/submissions` (config
  `FFF_CAPTCHA_*`; off → current per-IP limiter only). Per-slug submission
  cap + cooldown.
- **Template usage analytics** — count fills / completions / abandons per
  template + per version; per-field "reached vs. filled" (drop-off) from a
  lightweight beacon on the fill screen. Owner dashboard, no third-party
  tracker.
- **Per-template theming** — `schemas.brand` (`{ logoDataUri?, accent? }`) shown
  on the public fill page.
- **i18n (fill side)** — extract the fill / public-fill strings to a message
  catalog; `?lang=` + `Accept-Language`. Author UI stays English for now.
- **Offline PWA** — a service worker so a started public fill survives a
  connection drop; the draft autosave (F15) already covers the data.

**Acceptance:** every state-changing action shows in the audit log; a slug over
its cap returns a friendly "closed" screen; the owner sees fills-per-version and
the field with the highest drop-off.

---

### F27 — integrations  ·  on request only

Parked at the end per the feature review — build a slice when a concrete need
lands:

- GitHub / GitLab: open a PR with the generated file into a target repo/path.
- CLI: `fff fill <template> --values values.json > out.xml` (headless render).
- Programmatic API tokens (`sk-fff-…`) for scripted template fill.
- OIDC / SSO login (the long-standing `PLAN.md` open item).
- Store output to S3 / object storage.

---

## Cross-cutting

- **Migrations** — F21 (`template_versions`, new `schemas` columns), F23
  (`ai_usage`), F25 (`submission_comments`, `webhooks`, `webhook_deliveries`),
  F26 (`audit_log`, analytics) each append one entry to the `migrations` slice
  (`PRAGMA user_version`). Never edit a shipped migration.
- **`FFF_*` env additions** — `FFF_ANTHROPIC_API_KEY`, `FFF_AI_MODEL`,
  `FFF_SMTP_*`, `FFF_CAPTCHA_*`, `FFF_GIT_*`. Every one degrades to
  feature-off, not a crash. Document in `README.md`.
- **Docs** — each phase updates `docs/ARCHITECTURE.md` and `docs/API.md`; new
  `docs/AI.md` (F23) covering the prompts, the safety rationale, and cost.
- **Tests** — `formflow_ext` unit tests per new module (`reverseFill`, `diff`,
  `rules`, each importer, each format plugin); Go `httpapi` tests for every new
  route; the AI client behind an interface with a fake for tests (no live calls
  in CI).
- **No `core/form_flow/**` changes.**

## Effort

F19 S · F20 M–L · F21 L · F22 L · F23 L · F24 L–XL · F25 L · F26 M–L →
**XL total**, several weeks. F19/F20 land fast and are immediately useful; F21 is
the spine the rest hangs off.

## Out of scope (still)

Real-time multi-user co-editing, a plugin marketplace, self-serve billing,
on-prem license management, mobile native apps.
