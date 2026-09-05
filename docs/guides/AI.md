# AI assist (F23) — **beta, off by default**

Not yet exercised against a live key in CI. It activates only when **both**:

| env | value |
|-----|-------|
| `FFF_ANTHROPIC_API_KEY` | your Anthropic API key |
| `FFF_AI_BETA` | `true` (also accepts `1` / `yes` / `on`) |

Missing either → every `/api/ai/*` endpoint returns
`501 { "error": "AI features are not configured" }`, the frontend's
`/api/ai/status` reports `enabled: false`, and the ✨ buttons never render.
The server log line shows `ai=true` / `ai=false` at startup.

## Design

- **Server-side only.** The key lives in the Go process; the browser never sees
  it. `server/internal/ai/` wraps `github.com/anthropics/anthropic-sdk-go`.
- **One Messages call per request.** No tool use, no code execution, no MCP.
  Each prompt asks for a JSON object (or short prose for explain-diff); the
  reply is parsed with a balanced-brace scan and `json.Valid`.
- **Beta gate:** `FFF_AI_BETA` must be truthy on top of the key (above).
- **Model:** `FFF_AI_MODEL` or `claude-sonnet-5` by default (cheap + fast for
  labeling / extraction). Set `FFF_AI_MODEL=claude-opus-5` for harder work.
- **Quota:** 30 calls / user / hour (`aiLimiter`), plus the shared per-IP
  window. An `ai` interface + a fake keep live calls out of tests.
- **Inputs are the user's own config data**; outputs are advisory and always
  land as a reviewable diff / editable field — never auto-applied silently
  server-side.

## Endpoints (all `requireAuth`)

| Method | Path | In | Out |
|---|---|---|---|
| `GET` | `/api/ai/status` | — | `{ enabled: bool }` |
| `POST` | `/api/ai/suggest-meta` | `{ schema, values }` (JSON strings) | `{ meta: FieldMetaMap patch }` — labels, help, presets, `editable:false` for secrets |
| `POST` | `/api/ai/explain-diff` | `{ format, before, after }` | `{ text }` — plain-English summary, `⚠` on risky changes |
| `POST` | `/api/ai/schema-from-prompt` | `{ description, format? }` | `{ body, kind }` — a starter file the designer then detects |
| `POST` | `/api/ai/fill-assist` | `{ schema, meta, instruction }` | `{ values }` — a partial values tree merged into the form |

## UI

- Designer header: **✨ Suggest labels & validation** (merges the returned meta).
- Empty designer: **…or describe the config you need** → `schema-from-prompt`.
- Fill screen: **✨ Fill** from a plain-English instruction; **✨ Explain these
  changes** next to the value diff.

## Prompts

Inlined as `const` strings in `server/internal/ai/ai.go` (short, versioned with
the code). Each states the exact output contract and "no prose".
