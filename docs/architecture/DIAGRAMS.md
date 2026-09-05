# Diagrams

Companion to [`ARCHITECTURE.md`](ARCHITECTURE.md) — that doc is the
file-by-file walkthrough, these are the shapes. All diagrams are Mermaid;
they render natively on GitHub.

## System overview

```mermaid
flowchart TB
    subgraph Client["Browser"]
        SPA["React SPA\n(web/src)"]
    end

    subgraph Server["Go binary (server/)"]
        Router["chi Router"]
        MW["middleware\nrequireAuth / requireAdmin\nrequireAuthor / sessionUser"]
        Handlers["httpapi handlers\nauth · users · schemas\nshare · ops · admin"]
        Store["store\n(user-scoped SQL)"]
        Auth["auth.Service\nargon2id + sessions"]
        FBAuth["firebaseauth\nRS256 verify vs Google JWKS"]
        AI["internal/ai\n(Anthropic API, opt-in)"]
        Webhook["internal/webhook\nHMAC delivery"]
        Metrics["internal/metrics"]
    end

    DB[("SQLite\n(modernc.org/sqlite, WAL)")]
    Anthropic[["Anthropic API"]]
    Google[["Google JWKS"]]
    ThirdParty[["Webhook / check-URL\ntargets (SSRF-guarded)"]]

    SPA -- "fetch /api/*\n(cookie session)" --> Router
    Router --> MW --> Handlers
    Handlers --> Store --> DB
    Handlers --> Auth
    Handlers --> FBAuth -. "verify token" .-> Google
    Handlers --> AI -. "optional" .-> Anthropic
    Handlers --> Webhook -. "netguard.SafeOutboundURL" .-> ThirdParty
    Handlers --> Metrics
```

In release builds the same binary also serves the SPA's static assets via
`//go:embed all:dist` — there's no separate frontend server or CDN in the
docker-compose deploy path.

## Request flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant V as Vite proxy (dev)\n/ embedded router (release)
    participant R as chi Router
    participant M as Middleware
    participant H as Handler
    participant S as store (SQLite)

    B->>V: fetch /api/schemas (cookie: fff_session)
    V->>R: proxy (dev) or direct (release)
    R->>M: requireAuth
    M->>S: UserByToken(sha256(token))
    S-->>M: auth.User
    M->>H: ctx carries auth.User
    H->>S: user-scoped query (WHERE ... AND user_id = ?)
    S-->>H: rows
    H-->>B: JSON {"schemas": [...]}
```

Sessions are opaque random tokens; only `sha256(token)` is stored, so a
stolen DB row can't be replayed as a cookie. There's no JWT and nothing to
sign — see `CLAUDE.md` "Why these choices."

## Auth: password vs. Firebase Google

```mermaid
flowchart LR
    subgraph Password
        P1["POST /api/auth/login\n{email, password}"] --> P2["argon2id verify"]
        P2 --> P3["mint session token"]
    end

    subgraph Firebase
        F1["Google sign-in popup\n(client-side, firebase/auth)"] --> F2["ID token (RS256 JWT)"]
        F2 --> F3["POST /api/auth/firebase\n{idToken}"]
        F3 --> F4["firebaseauth: verify signature\nvs cached Google JWKS\n+ check aud/iss/exp/email_verified"]
        F4 --> F5["LoginOrProvisionFirebase:\nknown uid → login\nknown email → link\nnew → auto-provision role=user"]
        F5 --> P3
    end

    P3 --> Cookie["Set-Cookie: fff_session\n(httpOnly)"]
```

First account ever created — via either path — becomes `admin`. No Firebase
Admin SDK and no service-account key: verification is pure JWT-signature
checking against Google's public keys (see
[`../guides/AUTH.md`](../guides/AUTH.md)).

## Template lifecycle: detect → fill → export → publish → submit

```mermaid
stateDiagram-v2
    [*] --> Uploaded: drop XML/YAML/JSON file
    Uploaded --> Detected: form_flow parser infers schema
    Detected --> Designed: author retypes/annotates fields\n(formflow_ext metadata, validation, tokens)
    Designed --> Saved: POST /api/schemas (draft)
    Saved --> Published: POST /schemas/:id/publish\n(choose: anyone / signed-in only)
    Published --> Filled: /f/:slug — anyone/authenticated fills form
    Filled --> Submitted: POST /public/templates/:slug/submissions
    Submitted --> PendingApproval: if requiresApproval
    Submitted --> Approved: if approval not required
    PendingApproval --> Approved: author approves
    PendingApproval --> Rejected: author rejects
    Approved --> Exported: download in original format\n(order/comment-preserving where supported)
    Published --> Unpublished: POST /schemas/:id/unpublish\n(slug kept, private again)
    Unpublished --> Published: republish (reuses slug)
```

`Designed` can also fork/rollback/version — see `store/schemas.go` and
[`../planning/PLAN-F19.md`](../planning/PLAN-F19.md) for the
versioning/draft-publish/fork model.

## Deployment topology (docker-compose path)

```mermaid
flowchart LR
    Internet((Internet)) --> Caddy["Caddy\n(auto-TLS)"]
    Caddy --> App["formfromfile container\n(one Go binary, embeds SPA)"]
    App --> Vol[("named volume\n/data — SQLite + WAL")]
    App -. "optional" .-> Anthropic[["Anthropic API"]]
    App -. "optional" .-> Google[["Google JWKS\n(Firebase)"]]
    App -. "optional" .-> Turnstile[["Cloudflare Turnstile"]]
```

See [`../deployment/DEPLOY.md`](../deployment/DEPLOY.md) for the full
`docker-compose.yml` / `Caddyfile` walkthrough, env vars, backups, and the
pre-handoff checklist; [`../deployment/SCALE.md`](../deployment/SCALE.md)
for where SQLite stops being enough.
