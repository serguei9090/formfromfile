# Deploying FormFromFile (internal use)

The intended target for now is **an internal tool for one team** — reachable
over a VPN or an SSO-gated tunnel, TLS-terminated, with a backed-up data volume.
Public-internet hardening is a separate track — see
[`PLAN-F19.md`](../PLAN-F19.md) §F28.

The app is one Go binary that serves the SPA and `/api` on a single port
(`8787` in the container). It has no external dependencies — SQLite lives in a
file under `/data`.

---

## 1. The container

```bash
docker build -t formfromfile .
docker run -d --name fff \
  -p 127.0.0.1:8787:8787 \
  -v fff-data:/data \
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
| `FFF_ANTHROPIC_API_KEY` | — | AI beta (see [`AI.md`](AI.md)) |
| `FFF_AI_BETA` | — | `true` to actually turn AI on |
| `FFF_AI_MODEL` | `claude-sonnet-5` | AI model override |
| `FFF_SESSION_SECRET` | — | reserved; unused today (sessions are opaque DB tokens) |

Set `FFF_ALLOW_REGISTER=false` once you have your admin — otherwise anyone who
reaches the page can create an account.

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
