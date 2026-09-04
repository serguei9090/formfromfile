# Authentication (F31)

Two sign-in paths, both live at once:

- **Local password** — always on. Email + argon2id password. The first
  account ever created (by *either* path) becomes admin; an admin creates or
  promotes everyone after that from **Admin → Users**. Nothing to configure —
  this is what a fresh install has today.
- **Firebase (Google sign-in)** — opt-in via env vars. A "Continue with
  Google" button appears on `/login` and `/register` only when configured.
  Off by default; unset the env vars and the app is exactly as it was before
  this existed.

Use local password for a small internal team you manage by hand. Use
Firebase when you want self-serve sign-up via a Google account (public forms,
a bigger org) without building your own OAuth flow.

---

## Admin-provisioned accounts (F32a)

For a "no public sign-up, admin adds everyone" deployment: set
`FFF_ALLOW_REGISTER=false` (or flip it off live from Admin → Settings — see
`PLAN-F29.md`), then use the **Add user** form at the top of Admin → Users.

- Pick an email + role. Leave the password field blank to have one generated
  (20 chars, `crypto/rand`) — it's shown **once**, in a dismissible callout
  with a copy button, right after creation. It is never logged and never
  stored anywhere in plaintext; only its argon2id hash is kept, same as any
  other account. Hand it to the person and they change it themselves (no
  self-service "change my password" screen exists yet — an admin resets it
  from the same page if they lose it).
- Or set an explicit password yourself (min 10 chars, same rule as
  self-registration) if you're handing it over some other way.
- The account is usable immediately — no separate "activate" step.

This bypasses the normal bootstrap-admin rule (role is whatever you pick, not
auto-admin-if-first) — it's meant for an admin who already exists adding
more people, not for creating the very first account. Use plain
self-registration for that first one, as today.

## How Firebase sign-in works here

**No Firebase Admin SDK, no service-account key.** A Firebase ID token is a
standard RS256-signed JWT. The server verifies its signature against
Google's own published public keys and checks `iss`/`aud`/`exp` — that only
needs the (public) Firebase **project id**, not a credential. This keeps the
dependency footprint small (one JWT library, ~0 transitive deps) instead of
pulling the full `cloud.google.com/go` tree the official Admin SDK needs.

Flow: browser gets a Google ID token via the Firebase Web SDK's popup sign-in
→ POSTs it to `POST /api/auth/firebase` → server verifies it
(`internal/firebaseauth`) → looks up the account by the token's email → mints
the *same* opaque session cookie a password login gets. From that point on,
a Firebase-signed-in user is indistinguishable from a password user to the
rest of the app (roles, sessions, `requireAuth`, everything).

**Account behavior:**
- **Unknown email** → a new account is created automatically, role `user`.
  An admin promotes them via Admin → Users, same as any other account.
- **Existing email** (registered with a password previously) → the Firebase
  sign-in **links** to that same account (by email) instead of creating a
  duplicate. That person can now sign in either way.
- **First account ever, on a fresh database** → admin, whether they arrived
  via password register or Google sign-in first. Same bootstrap rule either
  way — see [`CLAUDE.md`](../CLAUDE.md) "first user = admin".
- **Disabled account** → Firebase sign-in is rejected the same as a disabled
  password login.
- Firebase's own `email_verified` claim is required to be `true`. Google
  accounts always satisfy this; if you also enable Firebase's
  **Email/Password** sign-in method, an unverified email is rejected here —
  intentional, since email is the join key to a local account.

---

## Setting it up

1. **Create a Firebase project** — [console.firebase.google.com](https://console.firebase.google.com) → *Add project* (the free Spark plan is enough — auth has no cost for this use).
2. **Enable a sign-in method** — *Build → Authentication → Sign-in method* → enable **Google** (and optionally **Email/Password**, if you want Firebase's own email flow instead of / alongside this app's).
3. **Register a Web app** — *Project settings → General → Your apps → Add app → Web* (`</>`  icon). No hosting needed, just the config. Copy the four values:
   `apiKey`, `authDomain`, `projectId`, `appId`.
4. **Set the env vars** and restart:

   | env | example |
   |---|---|
   | `FFF_FIREBASE_PROJECT_ID` | `my-app-a1b2c` |
   | `FFF_FIREBASE_API_KEY` | `AIzaSy...` |
   | `FFF_FIREBASE_AUTH_DOMAIN` | `my-app-a1b2c.firebaseapp.com` |
   | `FFF_FIREBASE_APP_ID` | `1:123456789:web:abcdef` |

   All four are **public client config**, not secrets — Firebase's own docs
   say these are safe to ship in browser code (see
   [Firebase docs: is it safe to expose config](https://firebase.google.com/docs/projects/api-keys)).
   Server-side trust comes from `FFF_FIREBASE_PROJECT_ID` alone (it's what
   the JWT's `aud`/`iss` are checked against), not from the other three.

5. **Authorize your domain** — *Authentication → Settings → Authorized
   domains* → add the domain you're deploying to (`forms.example.com`).
   Firebase's popup sign-in refuses unlisted domains. `localhost` is
   authorized by default, so local dev needs no extra step.
6. Reload `/login` — "Continue with Google" appears.

Unset any of the four vars (or don't set them at all) → the button doesn't
render and `/api/auth/firebase` answers 501. Nothing else changes.

**Security headers adjust automatically when Firebase is configured** (see
[`DEPLOY.md`](DEPLOY.md#security-headers)): the CSP's `connect-src` allows
Google's identity APIs and `frame-src` allows your `authDomain` (the popup
handshake's helper page), and `Cross-Origin-Opener-Policy` relaxes from
`same-origin` to `same-origin-allow-popups` — strict `same-origin` COOP
silently breaks `signInWithPopup`'s `window.opener` handshake, which is a
common "the button does nothing" gotcha with Firebase Auth behind a
security-headers proxy or app. Both stay at their strictest default when
Firebase isn't configured.

### A note on the "seed an admin without a human clicking register" need

If you need an admin to exist the moment a fresh container boots (CI, an
automated first-deploy) without anyone visiting `/register` — **don't** use a
fixed default credential like `admin`/`admin`. That pattern is how a lot of
real breaches start (default creds on an exposed dashboard). The safer
options, in order of preference:
- Register through the UI once, right after first boot, before opening the
  deployment to anyone else — the existing bootstrap rule handles it with no
  extra code.
- Ask for a `--seed-admin-email` / `--seed-admin-password` flag (not built
  yet) that creates one admin account on first boot from operator-supplied
  values passed at deploy time — never baked into the image.

---

## Current limitations

- Firebase config is **env-only** — unlike Turnstile/AI-beta/etc it does not
  yet have a live toggle in **Admin → Settings** (see
  [`PLAN-F29.md`](../PLAN-F29.md) for that pattern). Changing it needs a
  restart. A fast-follow if wanted.
- No account **un-linking** — once a Firebase uid is linked to an account
  there's no UI to detach it. An admin can still reset that account's local
  password from Admin → Users, which doesn't touch the link.
- Only Google is wired on the frontend today. Firebase itself supports many
  more providers (Microsoft, Apple, GitHub, email link, phone…) — adding one
  is a frontend-only change (`web/src/app/firebase.ts` + a button in
  `AuthCard.tsx`); the backend verification path is provider-agnostic (any
  Firebase ID token verifies the same way).
