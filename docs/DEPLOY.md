# Deploying FormFromFile (internal use)

The intended target for now is **an internal tool for one team** — reachable
over a VPN or an SSO-gated tunnel, TLS-terminated, with a backed-up data volume.
Public-internet hardening is a separate track — see
[`PLAN-F19.md`](../PLAN-F19.md) §F28.

The app is one Go binary that serves the SPA and `/api` on a single port
(`8787` in the container). It has no external dependencies — SQLite lives in a
file under `/data`.

---

## 0. Quickest — `docker compose` + Caddy (auto-TLS)

```bash
cp .env.example .env      # set DOMAIN + ACME_EMAIL
docker compose up -d
```

`docker-compose.yml` runs the app (no host ports) + Caddy (fetches a Let's
Encrypt cert for `$DOMAIN`, forwards to the app, adds HSTS + `nosniff` +
`X-Frame-Options: DENY`). The `Caddyfile` has a commented `remote_ip` block to
lock it to your VPN / office ranges.

That's it for a single-team internal deploy. Sections 1–2 below are the manual
equivalents if you don't want compose.

---

## 1. The container (manual)

```bash
docker build -t formfromfile .
docker run -d --name fff \
  -p 127.0.0.1:8787:8787 \
  -v fff-data:/data \
  -e FFF_TRUST_PROXY=true -e FFF_LOG_FORMAT=json \
  formfromfile
```

- Bind to `127.0.0.1` — never expose `8787` directly; a reverse proxy or tunnel
  sits in front and does TLS.
- Runs as `nonroot`; the image is distroless (no shell). `HEALTHCHECK` is
  built in.

### Environment

| env | default | meaning |
|-----|---------|---------|
| `FFF_ADDR` | `0.0.0.0:8787` | listen address (leave as-is in the container) |
| `FFF_DB` | `/data/formfromfile.db` | SQLite path — keep it on the volume |
| `FFF_ALLOW_REGISTER` | `true` | set `false` after the first admin signs up, then create users from `/admin` |
| `FFF_TRUST_PROXY` | — | `true` to read `X-Forwarded-For` / `X-Real-IP` for rate-limit keys. **Only** behind a proxy that overwrites those headers (Caddy/nginx/Cloudflare) — otherwise clients spoof their IP. |
| `FFF_LOG_FORMAT` | text | `json` for structured lines (one per request: id, status, dur, ip). `FFF_LOG_LEVEL` = `debug`\|`info`\|`warn`\|`error`. |
| `FFF_WEBHOOK_ALLOW_PRIVATE` | — | `true` lets webhook targets be LAN / loopback / http (internal deployments). Default blocks them (SSRF). |
| `FFF_TURNSTILE_SITE_KEY` / `FFF_TURNSTILE_SECRET` | — | Cloudflare Turnstile — see §CAPTCHA below. Both set → public-form CAPTCHA. |
| `FFF_SECURITY_HEADERS` | `on` | security headers + CSP on every response (see §security headers); `off` disables |
| `FFF_METRICS_TOKEN` | — | set → `GET /metrics` (Prometheus text) behind `Authorization: Bearer <token>`; unset → route absent |
| `FFF_ERROR_WEBHOOK` | — | recovered panics POST `{time,requestId,method,path,error,stack}` here — point it at Slack/Discord/an alert sink |
| `FFF_ANTHROPIC_API_KEY` | — | AI beta key (see [`AI.md`](AI.md)) |
| `FFF_AI_BETA` | — | `true` to actually turn AI on — **needs the key too** |
| `FFF_AI_MODEL` | `claude-sonnet-5` | AI model override |

Set `FFF_ALLOW_REGISTER=false` once you have your admin — otherwise anyone who
reaches the page can create an account.

### Runtime settings (no restart)

`FFF_ALLOW_REGISTER`, `FFF_TURNSTILE_SITE_KEY` / `_SECRET`,
`FFF_WEBHOOK_ALLOW_PRIVATE`, `FFF_AI_BETA`, plus a default submission cap can
be overridden live from **Admin → Settings** in the app. A stored setting wins
over the env var; "reset" drops it and the env/default applies again. The env
vars are still the right way to seed a fresh deploy and to keep secrets out of
the database UI where possible (the Turnstile secret, if set via the panel, is
stored but never shown back).

---

## CAPTCHA on public forms — Cloudflare Turnstile

**Free**, unlimited, no credit card. You do **not** need to proxy your site
through Cloudflare — Turnstile is a standalone widget + a verify API.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Turnstile** → *Add
   widget*. Domain = your `$DOMAIN` (or `localhost` for testing). Copy the
   **site key** and **secret key**.
2. Set `FFF_TURNSTILE_SITE_KEY` + `FFF_TURNSTILE_SECRET` (both, or neither).
3. Restart. `/f/:slug` now shows the challenge; `POST .../submissions` verifies
   the token server-side against `challenges.cloudflare.com`.

Unset → no widget, no verification; the per-IP window (20/min) is the only
control. **Internal-only deployments can skip this.** It can be toggled at any
time by adding/removing the two env vars — no rebuild.

If you *do* front the whole app with Cloudflare (a proxied DNS record), you get
its WAF + DDoS + bot-fight for free on top, and can use **Zero Trust → Access**
for SSO — see §2b.

---

## Security headers

The app sets these on **every** response (turn off with
`FFF_SECURITY_HEADERS=off`):

| header | value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `same-origin` |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=(), payment=(), usb=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Content-Security-Policy` | `default-src 'self'` + `frame-ancestors 'none'`, `object-src 'none'`, `img-src 'self' data:`, `style-src 'self' 'unsafe-inline'`. When Turnstile is configured, `https://challenges.cloudflare.com` is added to `script-src` / `frame-src` / `connect-src`. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` — **only** when the request arrived over TLS (`r.TLS`, or `X-Forwarded-Proto: https` with `FFF_TRUST_PROXY=true`) |

The `Caddyfile` in this repo also sets HSTS / `nosniff` / `Referrer-Policy` /
`X-Frame-Options` — now redundant with the app's own, but harmless (last write
wins, values match). The session cookie is `HttpOnly`, `SameSite=Lax`, and
`Secure` whenever the request is HTTPS (same TLS detection as HSTS). Lax is
deliberate — share links (`/f/:slug`) are top-level GETs that must work from an
email; Lax still blocks the cookie on cross-site POSTs.

---

## Observability

All opt-in — nothing is exposed unless you set the env var.

**Metrics.** `FFF_METRICS_TOKEN=<random>` → scrape `GET /metrics` with
`Authorization: Bearer <token>`. Prometheus text format, no extra port.

```yaml
scrape_configs:
  - job_name: formfromfile
    authorization: { credentials: "<token>" }
    static_configs: [{ targets: ["forms.internal:8787"] }]
```

Series: `fff_http_requests_total{method,route,status}`,
`fff_http_request_duration_seconds` (histogram),
`fff_webhook_deliveries_total{result}`, `fff_ai_requests_total{op,result}`,
and gauges `fff_users_total`, `fff_sessions_active`, `fff_submissions_total`,
`fff_db_bytes`.

**Alert on:** 5xx rate (`fff_http_requests_total{status=~"5.."}`), webhook
failure rate, `fff_db_bytes` growth, p95 latency.

**Errors.** `FFF_ERROR_WEBHOOK=<url>` → every recovered panic POSTs a JSON
report (request id + path + error + stack). Point it at a Slack/Discord
incoming webhook or an alerting endpoint. It is not run through the SSRF guard
(operator-configured, like the DB path) — use a URL you control.

**CI scanning.** `govulncheck` (Go advisories) runs in the server job and
Trivy scans the image in the docker job — both non-blocking for now (flip
`continue-on-error` off in `.github/workflows/ci.yml` once they stay green).

---

## 2a. Reverse proxy — nginx

For a machine that's already on the internal network (office LAN, VPN subnet).
Terminates TLS, forwards to the container on localhost.

`/etc/nginx/sites-available/formfromfile`:

```nginx
server {
    listen 443 ssl http2;
    server_name forms.internal.example.com;

    ssl_certificate     /etc/ssl/internal/forms.crt;
    ssl_certificate_key /etc/ssl/internal/forms.key;

    # keep it off the public internet — allow only the VPN / office ranges
    allow 10.0.0.0/8;
    allow 192.168.0.0/16;
    deny  all;

    client_max_body_size 4m;   # matches the 1 MiB body cap + headroom

    location / {
        proxy_pass         http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 70s;   # AI / webhook calls can take a while
    }
}

server {
    listen 80;
    server_name forms.internal.example.com;
    return 301 https://$host$request_uri;
}
```

```bash
ln -s ../sites-available/formfromfile /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

- The `X-Forwarded-Proto: https` header is what makes the session cookie get
  its `Secure` flag — don't drop it.
- `chi`'s `RealIP` middleware reads `X-Forwarded-For`, so the per-IP rate limits
  see the real client, not nginx. Only run this behind a proxy you trust.
- Public share links (`/f/:slug`) sit under the same `allow`/`deny` — fine for
  "share with a colleague on the VPN". If you need external fillers, that's the
  §F28 track.

---

## 2b. Zero open ports — Cloudflare Tunnel + Access

Best option when the host can't take inbound connections (home lab, a box
behind CGNAT) or when you want SSO in front without running your own IdP.
`cloudflared` dials **out** to Cloudflare; nothing listens on the public IP.

`docker-compose.yml`:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      FFF_ALLOW_REGISTER: "false"
    volumes:
      - fff-data:/data
    # no ports: — only the tunnel talks to it, over the compose network

  tunnel:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}

volumes:
  fff-data:
```

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels** → create a tunnel,
   copy its token into `CLOUDFLARE_TUNNEL_TOKEN` (`.env`, not committed).
2. Add a **public hostname** on the tunnel:
   `forms.example.com` → service `http://app:8787`.
3. **Zero Trust → Access → Applications** → add `forms.example.com`, policy
   "Emails ending in `@yourcompany.com`" (or a specific list, or your Google /
   Okta / GitHub IdP). Now every request is authenticated by Cloudflare before
   it reaches the app.
4. FormFromFile still runs its own login on top — Access gates *who can reach
   it*, the app gates *what they can do* (roles). If you want Access to be the
   only login, keep `FFF_ALLOW_REGISTER=true` behind Access so the first
   colleague to visit self-registers, then flip it off.

Cloudflare also gives you TLS, a WAF, and DDoS protection for free — useful even
for an internal tool if the tunnel hostname is guessable.

**Public share links caveat:** an Access policy blocks anonymous `/f/:slug`
fillers too. If you need those, put a *bypass* policy on the `/f/*` and
`/api/public/*` paths — and read §F28 first, because that re-exposes the
anonymous surface.

---

## 3. Backups

The whole app is one file: `/data/formfromfile.db`.

**Simplest — a nightly copy:**

```bash
# cron on the host
0 3 * * *  docker exec fff sh -c 'true' 2>/dev/null; \
           docker run --rm -v fff-data:/data -v /backups:/out alpine \
           sh -c 'cp /data/formfromfile.db /out/fff-$(date +\%F).db' && \
           find /backups -name 'fff-*.db' -mtime +14 -delete
```

SQLite is safe to copy while the app runs *only if* you use its backup API or
`VACUUM INTO`. The one-liner above is a plain `cp` — acceptable for low write
volume (a form tool), but for correctness use `sqlite3 /data/formfromfile.db
".backup /out/fff.db"` (add `sqlite3` to a sidecar image), or:

**Better — continuous replication with Litestream:**

```yaml
  litestream:
    image: litestream/litestream:latest
    restart: unless-stopped
    command: replicate
    volumes:
      - fff-data:/data
      - ./litestream.yml:/etc/litestream.yml:ro
    environment:
      LITESTREAM_ACCESS_KEY_ID: ${S3_KEY}
      LITESTREAM_SECRET_ACCESS_KEY: ${S3_SECRET}
```

`litestream.yml`:

```yaml
dbs:
  - path: /data/formfromfile.db
    replicas:
      - type: s3
        bucket: my-backups
        path: formfromfile
```

Restore: `litestream restore -o /data/formfromfile.db s3://my-backups/formfromfile`.
Point-in-time, ~1s RPO, works with any S3-compatible store (Backblaze B2,
MinIO, R2).

---

## 4. Upgrades

```bash
docker compose build app && docker compose up -d app
```

Migrations run automatically on boot (`PRAGMA user_version`, currently v5) and
are append-only — a newer binary upgrades an older DB in place. **Take a backup
before a major bump anyway.** Rolling back to an older binary against a
migrated DB is *not* supported (the schema is ahead).

---

## 5. Checklist before you hand it to the team

- [ ] TLS in front (nginx cert or Cloudflare) — the login cookie needs it
- [ ] `X-Forwarded-Proto` reaches the app
- [ ] `FFF_ALLOW_REGISTER=false` after your admin exists
- [ ] `/data` is a named volume (not the container's writable layer)
- [ ] A backup job that you've **tested a restore from**
- [ ] Network ACL or Access policy — the app is not hardened for anonymous
      internet traffic yet (§F28)
- [ ] `docker inspect fff --format '{{.State.Health.Status}}'` → `healthy`
