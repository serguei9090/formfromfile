# Security Policy

## Reporting a vulnerability

Please **don't** open a public GitHub issue for a security vulnerability.

Use GitHub's private reporting instead: go to the
[Security tab](https://github.com/serguei9090/formfromfile/security) →
"Report a vulnerability". If that's unavailable, open an issue asking for a
contact channel without describing the vulnerability itself.

Include: what you found, how to reproduce it, and the impact you think it
has. A minimal repro is more useful than a long writeup.

There's no bug bounty — this is a small open-source project maintained by
one person. You'll get a response and credit in the fix commit/release
notes (unless you'd rather stay anonymous).

## Supported versions

Only the latest tagged release and `main` get security fixes. There's no
long-term-support branch.

## What's already been hardened

So you're not reporting known, already-mitigated territory — see
[`docs/architecture/DIAGRAMS.md`](docs/architecture/DIAGRAMS.md) and
[`CLAUDE.md`](CLAUDE.md) "Status & what's next" for the full list, but in
short: argon2id passwords, opaque hashed session tokens (no JWT to forge),
per-IP rate limits on auth/submit routes, an SSRF guard
(`internal/netguard`) on webhook and async-check outbound requests,
security headers + CSP (`FFF_SECURITY_HEADERS`), optional Cloudflare
Turnstile on public forms, and user-scoped SQL everywhere (`WHERE ... AND
user_id = ?`).

**Known, deliberate non-goal:** the async-check proxy
(`POST /api/public/templates/{slug}/check`) isn't gated by a template's
`public_access` setting — an anonymous caller can still confirm a
"signed-in only" slug exists and trigger the author's configured check URL.
It only proxies the author's own URL (no schema/submission data exposed)
and is tracked in `docs/planning/PLAN-F32.md`. Not a surprise if you find it.
