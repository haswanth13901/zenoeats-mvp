# Steps before production

Everything that has to be done, decided or fixed before Zenoeats takes real
orders and real money. Work top to bottom; later sections assume earlier ones.

**Priority labels**

| Label | Meaning |
|---|---|
| **[BLOCKER]** | Do not launch without it. Security, money or data-loss risk. |
| **[LAUNCH]** | Needed for a credible launch; small risk if it slips a few days. |
| **[SOON]** | Fine to go live without; schedule it for the first weeks. |

Items marked *(code)* need a change in this repository. Everything else is
configuration, accounts or process on your side. Ticked items are done; each
says what changed and where, so it can be checked.

---

## 1. Repository and release hygiene

- [ ] **[BLOCKER]** Commit the working tree. Today almost everything is
      uncommitted: the new `web/` app is untracked, the old `frontend/` is
      staged for deletion, migrations `0004`–`0012` are untracked, and the
      Clerk/staff-invite work is unstaged. Nothing uncommitted can be
      reproduced on a server.
- [ ] **[BLOCKER]** CI green on the commit you deploy: backend tests, the RLS
      isolation gates (`tests/test_rls_isolation.py`), the reversible-migration
      check, web lint/typecheck/build.
- [ ] **[LAUNCH]** Tag the release (e.g. `v1.0.0`) and deploy images built
      from that tag only.
- [x] **[LAUNCH]** `README.md` → "Before real money" was stale (it said rate
      limiting was unused). *Fixed:* it now points here as the source of truth.

---

## 2. Code changes required before launch

These were found by reading the code. All of them are now fixed, including the
three that needed a business decision (Stripe Tax, Resend, refunds in the
Stripe Dashboard).

### 2.1 Security

- [x] **[BLOCKER] Rate limits could be bypassed by forging an IP header.** *(code)*
      The limiter trusted the left-most `X-Forwarded-For` entry, which the
      client writes. *Fixed:* `app/core/ratelimit.py::_client_ip` believes
      forwarding headers only from our own proxies (`TRUSTED_PROXY_CIDRS`),
      prefers `X-Real-IP`, and walks `X-Forwarded-For` from the right. Both
      nginx configs now overwrite `X-Forwarded-For` instead of appending, and
      the production edge takes the real visitor IP from Cloudflare only on
      connections from Cloudflare's ranges. Verified live: 12 sign-in attempts
      with forged IPs were refused at the limit. Tests: `tests/test_client_ip.py`.
- [x] **[BLOCKER] Refuse to start with unsafe configuration.** *(code)*
      *Fixed:* `app/core/startup_checks.py`. With `ENV=production` the API
      refuses to start, listing every problem at once, if `SESSION_SECRET` is
      under 32 characters, `FIELD_ENCRYPTION_KEY` is not a valid key, any of
      `CLERK_JWKS_URL` / `CLERK_ISSUER` / `CLERK_SECRET_KEY` or the Stripe
      secrets are missing, `ADMIN_USERS` is empty, `ROOT_DOMAIN` is `.local`,
      `AUTH_DEV_BYPASS` is on, or `DATABASE_URL_MIGRATE` is present.
      Development only logs. Tests: `tests/test_startup_checks.py`.
- [x] **[LAUNCH] Security headers.** *(code)* *Fixed:* HSTS (one year,
      subdomains) at the production edge. A Content-Security-Policy is written
      by the web container at start (`web/docker-entrypoint.d/40-zenoeats-config.sh`)
      from Clerk's and Stripe's published requirements, with this environment's
      Clerk host read from the publishable key. `CSP_EXTRA_IMG_SRC` adds image
      origins; `CSP_REPORT_ONLY=true` reports without blocking.
      **Still to do:** see §10 — run staging with `CSP_REPORT_ONLY=true` first
      and check the browser console before enforcing.
- [x] **[LAUNCH] Uvicorn proxy trust.** *(code)* *Fixed:* `FORWARDED_ALLOW_IPS`
      set in `backend/Dockerfile` and compose. Verified on Linux: behind a
      trusted proxy uvicorn now sees `https` and the real client address.
- [x] **[SOON] Dependency updates and audits.** *(code)* *Fixed:* pip-audit found
      87 advisories in cryptography, Pillow, PyJWT, python-multipart, Starlette
      and pytest. Upgraded (FastAPI 0.141.1 / Starlette 1.6.0, cryptography
      50.0.1, Pillow 12.3.0, PyJWT 2.14.0, python-multipart 0.0.31,
      SQLAlchemy 2.0.52, pytest 9.0.3); full suite and a live boot pass; audit
      now clean. CI runs `pip-audit` and `npm audit --omit=dev` on every build.
- [x] **[SOON] PII in logs.** *(code)* *Fixed:* failed staff and admin sign-ins
      log `s***@example.com#3f9c1a2b` (masked address + keyed fingerprint)
      instead of the address. `app/core/logsafe.py`, `tests/test_logsafe.py`.
      The `ADMIN_USERS` configuration errors still name the entry, on purpose.

### 2.2 Deployment shape

- [x] **[BLOCKER] The web image could not be promoted between environments.** *(code)*
      *Fixed:* the bundle carries no key. The web container writes `/config.js`
      at start from `CLERK_PUBLISHABLE_KEY` (validated, so nothing injected can
      become script), and the app reads it before `VITE_CLERK_PUBLISHABLE_KEY`,
      which remains the development fallback. CI builds without a key and
      checks `config.js` is in the bundle.
- [x] **[BLOCKER] Migrations ran on every API start with owner credentials.** *(code)*
      *Fixed:* a one-off `migrate` compose service runs `alembic upgrade head`
      and exits; `api` and `worker` wait for it. Runtime containers no longer
      receive `DATABASE_URL_MIGRATE`, `DOCKER_DATABASE_URL_MIGRATE` or
      `POSTGRES_PASSWORD`. Alembic refuses to run without the owner URL, and a
      production API refuses to start with it. **In production:** run the same
      image with `alembic upgrade head` as a release step before rolling out.
- [x] **[BLOCKER] nginx was hard-wired to `zenoeats.local`.** *(code)*
      *Fixed:* `infra/nginx/production/zenoeats.conf.template` (domain from
      `ROOT_DOMAIN`), used by `docker-compose.prod.yml`. HTTPS only, HTTP→HTTPS
      redirect, unknown hosts and unknown TLS names refused, forwarding headers
      overwritten, Cloudflare real-IP (`cloudflare-realip.conf`). It also
      routes `/images/` to the API — previously every menu photo would have
      broken in production. Tested in the nginx image with a throwaway
      certificate.
      Run: `docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app up -d`
- [x] **[LAUNCH] More than one API process.** *(code)* *Fixed:* `WEB_CONCURRENCY`
      (`API_WORKERS` in compose, default 2). Verified two workers on Linux.
      Size workers × database pools under Postgres' `max_connections`.

### 2.3 Payments and money

- [x] **[LAUNCH] Receipt email must be real.** *(code)* *Fixed:* a
      `…@pending.local` placeholder is never sent to Stripe as `receipt_email`;
      payment still goes through. `clerk_customers.receipt_address`.
- [x] **[BLOCKER] Platform fee mechanism.** *(code)* *Fixed:* `PLATFORM_FEE_BPS`
      and `PLATFORM_FEE_FIXED_MINOR` become a Stripe `application_fee_amount`
      on each charge, capped at the order total. Default 0.
      **Still to decide:** the fee itself. Tests: `tests/test_platform_fee.py`.
- [x] **[BLOCKER] Tax.** *(code)* *Fixed — Stripe Tax:* each restaurant has a
      tax mode. `FLAT` keeps `tax_rate_bps`; `STRIPE_TAX` calculates every
      quote and order on the restaurant's own connected account, at its pickup
      address, with product tax code `txcd_40060003` (Food for Immediate
      Consumption). Discounts are spread across lines exactly; identical carts
      reuse a cached calculation (Stripe bills per calculation) and uncached
      calculations are capped per restaurant. The PaymentIntent carries the
      calculation id; the payment webhook records a tax transaction and the
      refund webhook records reversals, each exactly once. Switching a
      restaurant to Stripe Tax, and activating one, is refused until its
      address is complete and its Stripe tax settings are active.
      `app/services/stripe_tax.py`, `tests/test_stripe_tax.py`; a real
      calculation request was accepted by Stripe's test API.
      **On your side:** §3.5.
- [x] **[LAUNCH] Refunds and cancellations.** *Decided:* refunds stay in each
      restaurant's own Stripe Dashboard, where disputes also live. The
      `charge.refunded` webhook reconciles the payment and, for Stripe Tax
      restaurants, reverses the tax. **On your side:** tell restaurants (§9).
- [x] **[SOON] Receipts from Zenoeats.** *(code)* *Fixed — Resend:* the worker
      emails an order confirmation once the payment webhook marks the order
      paid — exactly once per order, retried on rate limits and outages. It
      never contains the pickup PIN; it links to the order page where the
      signed-in customer sees it. `app/services/notifications.py`,
      `tests/test_notifications.py`. **On your side:** §3.6.

### 2.4 Customer sign-in (Clerk)

- [x] **[LAUNCH] Apple and Facebook buttons.** *(code)* *Fixed:* the sign-in and
      sign-up pages render a button for each provider enabled in Clerk
      (Google, Apple, Facebook), in each brand's style. Enabling a provider in
      the Clerk dashboard is all it takes.
- [x] **[LAUNCH] "We still need your email" step.** *(code)* *Fixed:* after a
      social sign-up Clerk cannot finish, the sign-up page collects exactly
      what is missing (email, name, terms consent) and verifies an unverified
      email by code.
- [x] **[LAUNCH] Two-step verification.** *(code)* *Fixed:* sign-in handles
      authenticator-app, text, email and backup codes, with a switch between
      them, including after a social sign-in.
      **Still to do:** click through each on staging; these were typechecked
      and built, not browser-tested.
- [ ] **[SOON] Apple "Hide My Email".** Customers may sign in with
      `@privaterelay.appleid.com` addresses. Mail only reaches them if the
      sending domain is registered with Apple (see §3.3).

### 2.5 Operations gaps

- [x] **[LAUNCH] Error tracking.** *(code)* *Fixed:* Sentry for the API and
      Celery, off until `SENTRY_DSN` is set. Request bodies, local variables
      and PII are never sent; PINs, client secrets, emails and notes are
      scrubbed. Errors carry the same reference the customer is shown.
      `app/core/observability.py`, `tests/test_observability.py`.
- [x] **[SOON] Table growth.** *(code)* *Fixed:* an hourly `sweep_retention`
      task removes expired idempotency keys, and processed/ignored webhook
      deliveries older than `WEBHOOK_EVENT_RETENTION_DAYS` (365). Unprocessed
      and failed deliveries are never removed. `app/services/retention.py`.
- [x] **[SOON] Dead setting.** *(code)* *Fixed:* `CORS_ORIGINS` removed.
- [x] **[SOON] Staff onboarding emails.** *(code)* *Fixed:* inviting someone
      emails them the restaurant, their role and the sign-in link. The
      temporary password is never emailed; the admin still passes it on, so
      a forwarded invitation alone does not open the account.

### 2.6 Admin portal (found by an end-to-end pass over the live portal)

A full pass over the platform portal against a running stack: 61 checks
passed, and everything below was found and has since been fixed.

- [x] **[BLOCKER] Creating a restaurant answered 500.** *(code)* The starter
      item types were written with the system role, which is not granted the
      menu tables at all, so "Create as draft" failed after the restaurant
      row had already been written. *Fixed:* creation is one tenant
      transaction -- restaurant, order counter and item types together -- so
      it either all lands or none of it does, and a taken subdomain is
      answered as a conflict rather than a crash.
      `tests/test_admin_restaurants.py`.
- [x] **[BLOCKER] An owner could not be given a second restaurant.** *(code)*
      Issuing an owner reset that person's password, so an operator who
      already ran one restaurant had their working login replaced. *Fixed:*
      an account already in use is invited instead: the membership waits at
      INVITED, the password is untouched, and they accept from inside the
      portal (rule 27). The portal shows "Owner invited" with no password to
      pass on.
- [x] **[LAUNCH] Storefront links pointed at a dev address.** *(code)* The
      "Open storefront" link was built from a build-time domain and port
      3000, so in production every link was dead. *Fixed:* the address is
      derived from the page the portal is open on. `web/src/utils/storefront.ts`.
- [x] **[BLOCKER] Signing out did not end the session.** *(code)* Sign-out
      deleted the cookie; a token copied beforehand kept working for up to
      eight hours. *Fixed:* `users.sessions_valid_after` (migration 0015) is
      stamped on admin sign-out, on a staff password change and on a
      super-admin reset, and every request refuses a token issued before it.
      Staff sign-out stays per-device, so one person signing out does not
      sign out the tablet on the pass; "Sign out all devices" in the portal
      header ends every session the account holds, for a lost phone.
      `tests/test_session_revocation.py`.
- [x] **[BLOCKER] The platform API answered on every restaurant subdomain.**
      *(code)* Restaurants and the portal share one root domain, so browsers
      treat them as one site: a page on any storefront could call the
      super-admin API with a signed-in operator's cookie attached, and CORS
      allowed exactly that. *Fixed:* the platform API exists on
      `admin.<root>` and nowhere else; both operator APIs refuse a request
      whose Origin is another host; production allows no cross-origin API
      access at all (every page that calls the API is served from the same
      hostname); and nginx no longer serves the portal's pages off the admin
      hostname, so there is no super-admin sign-in form to phish with on a
      thousand addresses. `tests/test_origin_pinning.py`.
- [x] **[BLOCKER] Stripe onboarding was an open redirect.** *(code)* The
      return and refresh URLs arrived as query parameters, so the onboarding
      link could hand the operator to any address with Stripe's credibility
      behind it. *Fixed:* the server builds both from the portal's own
      hostname, https in production. `tests/test_stripe_onboarding.py`.
- [x] **[LAUNCH] Connected accounts were contactable at the platform.**
      *(code)* A new connected account used the platform admin's address, so
      Stripe's verification requests, failed payouts and dispute deadlines
      came to us instead of the restaurant. *Fixed:* the owner's address is
      used, and onboarding a restaurant with no owner yet is refused with a
      message saying to create the owner first.
- [x] **[LAUNCH] "Gross volume" added different currencies.** *(code)* The
      tile summed minor units across restaurants and printed dollars, so one
      restaurant pricing in another currency made the headline figure
      meaningless. *Fixed:* one figure per currency.

---

## 3. Third-party accounts (new production accounts)

### 3.1 Clerk (production instance)

- [ ] **[BLOCKER]** Create a **production** instance in a new Clerk account (or
      promote a new application to production).
- [ ] **[BLOCKER]** Set the **primary domain** to the parent domain
      (e.g. `zenoeats.com`), so one sign-in covers every restaurant subdomain.
- [ ] **[BLOCKER]** Add the **DNS records** Clerk lists (typically CNAMEs for
      `clerk.`, `accounts.`, `clkmail.` and the two DKIM records) and wait for
      verification. Clerk's emails and its Frontend API depend on them.
- [ ] **[BLOCKER]** Enable **Email address** + **Password**, with email
      verification by **code** (the pages expect 6-digit codes, not links).
- [ ] **[BLOCKER]** Copy keys into production config: `pk_live_…` →
      `CLERK_PUBLISHABLE_KEY` on the web container (`VITE_CLERK_PUBLISHABLE_KEY`
      in `.env` when using compose); `sk_live_…` → `CLERK_SECRET_KEY`; JWKS URL
      → `CLERK_JWKS_URL`; Frontend API URL → `CLERK_ISSUER`.
- [ ] **[LAUNCH]** **Webhook**: endpoint `https://<yourdomain>/api/v1/webhooks/clerk`,
      events `user.created`, `user.updated`, `user.deleted`; signing secret →
      `CLERK_WEBHOOK_SECRET`. Requires the Celery worker to be running.
- [ ] **[LAUNCH]** Keep **bot protection** on (the sign-up page includes the
      `clerk-captcha` element it needs).
- [ ] **[LAUNCH]** Brand Clerk's **email templates** (verification and reset
      codes) with the Zenoeats name and sender.
- [ ] **[LAUNCH]** Decide **session lifetime** and inactivity timeout in Clerk.

### 3.2 Google, Facebook and Apple sign-in (production credentials)

Production Clerk instances need your own credentials for each provider. Every
provider page in Clerk shows the **redirect URI** to paste into the provider.

- [ ] **[LAUNCH] Google**: Google Cloud console → OAuth consent screen
      (publish it, add privacy policy and terms URLs) → Credentials → OAuth
      client *Web application* → Clerk's redirect URI → client ID and secret into
      Clerk.
- [ ] **[LAUNCH] Facebook**: developers.facebook.com → create app (Facebook
      Login) → *Valid OAuth Redirect URIs* = Clerk's redirect URI → add
      **Privacy Policy URL** and **Data deletion instructions URL** → App ID and
      Secret into Clerk → switch the app to **Live**.
- [ ] **[LAUNCH] Apple** (Apple Developer Program, $99/year): App ID with
      *Sign in with Apple* → **Services ID** (web domain + return URL = Clerk's
      redirect URI) → **Key** with Sign in with Apple, download the `.p8` once →
      enter Services ID, Team ID, Key ID and the key contents in Clerk.

### 3.3 Apple private email relay

- [ ] **[SOON]** Apple Developer → *Sign in with Apple for Email Communication*
      → register the domains that send mail to customers, so messages to
      `privaterelay.appleid.com` addresses are delivered.

### 3.4 Stripe (live, new account)

- [ ] **[BLOCKER]** Activate the **platform** account (business details, bank,
      identity) and complete the **Connect platform profile**.
- [ ] **[BLOCKER]** Live keys → `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`.
- [ ] **[BLOCKER]** Create the webhook **on the Connect tab** (not the account
      tab): `https://<yourdomain>/api/v1/webhooks/stripe/connect`, events
      `payment_intent.succeeded`, `payment_intent.payment_failed`,
      `payment_intent.canceled`, `charge.refunded`, `account.updated`; its
      signing secret → `STRIPE_CONNECT_WEBHOOK_SECRET`.
- [ ] **[BLOCKER]** Onboard each restaurant through the admin portal's Stripe
      onboarding so it gets a **real** connected account with
      `charges_enabled`. Never carry over `acct_REPLACE_WITH_TEST_ACCOUNT`
      from the seed.
- [ ] **[LAUNCH] Apple Pay / Google Pay.** Checkout uses
      `automatic_payment_methods`. Wallet buttons only appear on domains
      registered as **payment method domains**; with direct charges that
      registration is per connected account, per restaurant subdomain.
      Register each storefront domain when a restaurant is activated.
- [ ] **[LAUNCH]** Decide **statement descriptors** (what shows on the
      customer's card statement) and confirm **email receipts** are enabled for
      connected accounts.
- [ ] **[LAUNCH]** Confirm restaurants understand they handle **disputes** and
      receive **payouts** directly (merchant of record).

### 3.5 Stripe Tax (for each restaurant using it)

- [ ] **[BLOCKER]** The restaurant, in its own Stripe Dashboard (Tax), sets its
      **head office address** and **preset tax code**, so its tax settings
      become `active`. Zenoeats refuses to switch it to Stripe Tax until then.
- [ ] **[BLOCKER]** The restaurant adds a **tax registration** for its state.
      Without one Stripe calculates **zero tax** (`not_collecting`) — it does
      not error — so this is the step most likely to be silently missed.
- [ ] **[BLOCKER]** In the super admin portal: fill in the restaurant's
      **pickup address**, set tax to **Stripe Tax**, save (the save checks
      Stripe), then activate.
- [ ] **[LAUNCH]** Confirm the tax code. `txcd_40060003` fits prepared food;
      a restaurant mostly selling packaged goods may need another.
- [ ] **[LAUNCH]** Understand the cost: Stripe Tax is billed per calculation
      and per transaction on the restaurant's account. Test mode allows 1,000
      calculations a day.

### 3.6 Resend (email)

- [ ] **[LAUNCH]** Create a Resend account, add your sending domain under
      **Domains**, and add the DNS records it lists (SPF, DKIM) until verified.
- [ ] **[LAUNCH]** Set `RESEND_API_KEY`, `EMAIL_FROM` (on the verified domain,
      e.g. `Zenoeats <orders@zenoeats.com>`) and optionally `EMAIL_REPLY_TO`.
- [ ] **[LAUNCH]** Set `STOREFRONT_URL_TEMPLATE` (`https://{slug}.{root_domain}`)
      so links in emails point at the right storefront.
- [ ] **[SOON]** Register the sending domain with Apple's private email relay
      (§3.3) so confirmations reach "Hide My Email" customers.

---

## 4. Infrastructure

- [ ] **[BLOCKER] Domain and DNS**: the root domain, `admin.<domain>`, and a
      wildcard `*.<domain>` for restaurant subdomains. `admin.<domain>` is
      required, not a convention: the platform portal and its API answer on
      that hostname only, and nowhere else (see 2.6).
- [x] **[BLOCKER] Reserve Clerk's subdomains.** *(code)* *Fixed:* `clerk`,
      `accounts` and `clkmail` added to `RESERVED_SLUGS` in
      `app/core/tenant.py`, so no restaurant can take the DNS names Clerk
      production needs. Add any other hostname you plan to use there too.
- [ ] **[BLOCKER] TLS**: wildcard certificate via DNS-01 validation (Let's
      Encrypt) or a Cloudflare origin certificate, plus monitoring on expiry.
      A lapsed wildcard certificate takes down every storefront at once.
      Place `fullchain.pem` and `privkey.pem` in `infra/certs/` (git-ignored)
      or point `TLS_CERT_DIR` at them.
- [ ] **[LAUNCH] Narrow proxy trust.** Set `TRUSTED_PROXY_CIDRS` and
      `FORWARDED_ALLOW_IPS` to the network nginx actually runs on, instead of
      the default private ranges.
- [ ] **[LAUNCH] Cloudflare ranges.** Re-check
      `infra/nginx/production/cloudflare-realip.conf` against
      https://www.cloudflare.com/ips/ before launch.
- [ ] **[BLOCKER] Origin firewall**: if behind Cloudflare, allow inbound 80/443
      only from Cloudflare's ranges, as `nginx.conf` assumes. The rate limiter
      and the forwarded headers are only trustworthy if the origin cannot be
      reached directly.
- [ ] **[BLOCKER] PostgreSQL**:
  - [ ] Create `zenoeats_migrate`, `zenoeats_app` and `zenoeats_system` with
        **strong, unique passwords**. `infra/postgres/01-roles.sql` contains the
        dev passwords (`*_dev_pw`) and must not be used as-is.
  - [ ] All three roles `NOBYPASSRLS`; `zenoeats_app` must not own tables.
        Run `tests/test_rls_isolation.py` against staging to prove it.
  - [ ] Not reachable from the internet; TLS for the connection if the
        database is on another host.
  - [ ] On a managed database (RDS, Cloud SQL…), the init script will not run;
        create the roles and grants by hand before the first migration.
- [ ] **[BLOCKER] Redis ×2**: `redis-broker` with AOF and `noeviction` (a lost
      task is a lost payment webhook), `redis-runtime` with eviction. Neither
      exposed publicly; set passwords. If `redis-runtime` is down the rate
      limiter **fails open**, so alert on it.
- [ ] **[BLOCKER] Celery**: at least one `worker` (Stripe and Clerk webhooks do
      nothing without it) and **exactly one** `beat` (expires abandoned
      checkouts every 5 minutes).
- [ ] **[BLOCKER] Secrets**: keep the production `.env` / secret files outside
      images and outside git; restrict who can read them.
- [ ] **[LAUNCH] Menu images**: stored on the API host's disk (`IMAGES_DIR`).
      Put that directory on persistent storage that is backed up, or move to
      object storage (set `IMAGES_PUBLIC_BASE` to the bucket's public domain).
      Past one API host, local disk no longer works.

---

## 5. Backups and recovery

- [ ] **[BLOCKER]** Nightly encrypted `pg_dump`, copied off the server.
- [ ] **[BLOCKER]** Escrow `FIELD_ENCRYPTION_KEY` separately from the database
      backups. Pickup PINs are encrypted with it; losing the key makes them
      unreadable, and a backup stored together with the key protects nothing.
- [ ] **[BLOCKER]** One **timed restore drill** into a fresh environment before
      launch. A backup that has never been restored is not a backup.
- [ ] **[LAUNCH]** Back up the menu images directory (or its bucket).
- [ ] **[LAUNCH]** Write a short rollback plan: previous image tags, and
      whether the latest migration's downgrade is safe to run.

---

## 6. Monitoring and alerting

- [ ] **[BLOCKER]** Uptime check on `/health/ready` (checks the database as the
      app role), not just `/health`.
- [ ] **[LAUNCH]** Alert on **stale `PENDING_PAYMENT` orders** (beat stopped or
      webhooks not arriving).
- [ ] **[LAUNCH]** Alert on `stripe_events` and `clerk_events` rows with status
      `FAILED`.
- [ ] **[LAUNCH]** Alert on Redis being unreachable (limiter fails open), disk
      space on the database and images volumes, and certificate expiry.
- [ ] **[LAUNCH]** Centralised logs with a retention period.
- [ ] **[LAUNCH]** Create a Sentry project and set `SENTRY_DSN`,
      `SENTRY_ENVIRONMENT` and `RELEASE`.

---

## 7. Production configuration

Every setting the backend reads, with what it must be in production.

| Variable | Production value | Notes |
|---|---|---|
| `ENV` | `production` | **[BLOCKER]** Secure cookies, no `/docs`, no error details, and the startup safety checks (§2.1). |
| `ROOT_DOMAIN` | e.g. `zenoeats.com` | Tenant resolution, CORS, the Clerk token origin check, the nginx template. |
| `DATABASE_URL_APP` / `_SYSTEM` | strong per-role passwords | The only database URLs runtime containers get. |
| `DATABASE_URL_MIGRATE` | owner role | Migration job only. A production API refuses to start with it. |
| `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `REDIS_RUNTIME_URL` | production Redis, with passwords | |
| `TRUSTED_PROXY_CIDRS` | nginx's network | Where forwarding headers are believed from (rate limiter). |
| `FORWARDED_ALLOW_IPS` | nginx's network | Same, for uvicorn. Keep the two in step. |
| `API_WORKERS` / `WEB_CONCURRENCY` | 2+ | Size with database pools. |
| `CLERK_JWKS_URL`, `CLERK_ISSUER`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` | production Clerk instance | The first three are required at startup. |
| `CLERK_PUBLISHABLE_KEY` (web container) | `pk_live_…` | Read at container start. Compose maps it from `VITE_CLERK_PUBLISHABLE_KEY`. |
| `CSP_EXTRA_IMG_SRC`, `CSP_REPORT_ONLY` | bucket origin; `false` | Web container. `true` only for a first staging run. |
| `AUTH_DEV_BYPASS` | `false` | Startup refuses `true`. |
| `ADMIN_USERS` | generated with `scripts/hash_password.py` | Required at startup. |
| `SESSION_SECRET` | `openssl rand -base64 32` | Required at startup, 32+ characters. |
| `ADMIN_SESSION_TTL_MINUTES`, `STAFF_SESSION_TTL_MINUTES` | 480 / 720, or your policy | |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET` | live values | Secret and webhook secret required at startup. |
| `PLATFORM_FEE_BPS`, `PLATFORM_FEE_FIXED_MINOR` | your fee | 0 = no fee. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Resend key; sender on a verified domain | Empty key = no emails. |
| `STOREFRONT_URL_TEMPLATE` | `https://{slug}.{root_domain}` | Links in emails. |
| `FIELD_ENCRYPTION_KEY` | new Fernet key (`make key`) | Required at startup. Never reuse the dev key; escrow it (§5). |
| `IMAGES_DIR`, `IMAGES_PUBLIC_BASE` | persistent path or bucket URL | |
| `PENDING_PAYMENT_TTL_MINUTES`, `IDEMPOTENCY_TTL_HOURS`, `MAX_ITEMS_PER_ORDER` | defaults are reasonable | |
| `WEBHOOK_EVENT_RETENTION_DAYS` | 365, or your policy | 0 = keep forever. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `RELEASE` | your Sentry project | Empty DSN = off. |
| `TLS_CERT_DIR` | certificate directory | `docker-compose.prod.yml`. |
| `POSTGRES_PASSWORD` | strong | Only if running Postgres in compose. |

---

## 8. Data

- [ ] **[BLOCKER]** Start production from an **empty database** plus migrations.
      Never copy the development database: it holds test users, test
      restaurants and rows created by the test suite.
- [ ] **[BLOCKER]** Do **not** run `scripts/seed.py` in production. It prints a
      temporary owner password and creates a placeholder Stripe account.
- [ ] **[LAUNCH]** Create restaurants, owners and Stripe onboarding through
      the super admin portal.

---

## 9. Legal and business

The pages now exist and are wired up *(code)*: `/legal/privacy`,
`/legal/terms`, `/legal/refunds` and `/legal/data-deletion`, served as files
by nginx on every host including the root domain, with no JavaScript needed —
which is what an OAuth reviewer and a crawler both fetch. They are linked from
the sign-up consent checkbox, from above the checkout button, and from a
footer on every customer page. **Every one of them carries a visible “draft,
not reviewed” banner and a list of what a lawyer must confirm, and those stay
until the review below happens.**

- [ ] **[BLOCKER]** **Legal review** of all four pages. Each one ends with the
      specific questions for its own text; the common ones are the legal
      entity name, trading address and contact address (`PLACEHOLDER` in the
      files today), the governing law, and which privacy regime applies —
      no GDPR lawful-basis section and no CCPA notice are present.
      Then delete the banner and the “Before this page goes live” paragraph
      from each page.
- [ ] **[BLOCKER]** **Publish them on the root domain** and give Google,
      Facebook and Apple the `https://<root domain>/legal/...` URLs, not a
      restaurant subdomain. §3.2 needs these before any provider is approved.
- [ ] **[BLOCKER]** **A process behind data deletion.** The page commits to
      response windows and a monitored mailbox. Note there is **no
      self-service account deletion** in the software: the only route is a
      Clerk-side delete, whose `user.deleted` webhook soft-deletes the
      customer and keeps their paid orders. Everything else is manual.
- [ ] **[LAUNCH]** **Restaurant agreement**: fees, merchant-of-record duties,
      disputes, tax responsibility, data processing. It must agree with
      `/legal/refunds` about who bears a refund and a chargeback, and must
      tell restaurants refunds are issued from their own Stripe Dashboard —
      the software has no refund button.
- [ ] **[LAUNCH]** **Cookie notice** where required. The privacy policy lists
      the cookies and says all are necessary; whether a consent banner is
      needed where you operate is part of the review above.
- [x] **[LAUNCH]** **Allergen / food disclaimer.** *(code)* In the footer of
      every customer page, and in the terms: kitchens handle allergens,
      cross-contact cannot be ruled out, contact the restaurant.
- [x] **[SOON]** **Proof of agreement.** *(code)* The checkbox blocks sign-up,
      and migration 0033 records `terms_accepted_at` and `terms_version` on
      the customer when an order is placed — the moment the checkout page says
      continuing means agreeing. Guests included, since a guest never signs
      up. Bump `CURRENT_VERSION` in `app/services/terms.py` when the wording
      changes materially; everyone re-agrees on their next order.
      `tests/test_terms_acceptance.py`.
- [ ] **[LAUNCH]** **PCI**: Stripe Elements keeps card data off your servers
      (SAQ A), but the annual self-assessment still has to be completed in
      Stripe.

---

## 10. Go-live rehearsal on staging

Run the whole flow on a staging environment that uses the **production shape**
(same nginx, TLS, containers and migration process) with test-mode Stripe and
a separate Clerk instance.

- [ ] Customer **sign-up** with email code, **sign-in**, **forgot password**.
- [ ] **Google**, **Apple** and **Facebook** sign-in, including a first-time
      account, and a Facebook account without an email (the "continue" step).
- [ ] Two-step verification: authenticator app, then a backup code.
- [ ] With `CSP_REPORT_ONLY=true`, repeat sign-in, a card payment with
      3-D Secure, and Apple/Google Pay, and confirm the browser console shows
      no CSP violations. Then set it back to `false`.
- [ ] Sign in on one restaurant subdomain, open another: still signed in.
- [ ] Order with a card → webhook → order appears on the **kitchen board** →
      ready → **PIN** completes it.
- [ ] **Apple Pay** on a real iPhone (Safari) and **Google Pay** on Android.
- [ ] Abandon a checkout → it **expires** after the TTL with nothing charged.
- [ ] **Refund** from the restaurant's Stripe Dashboard → payment status
      updates in the portal, and for a Stripe Tax restaurant a reversal appears
      under Tax → Transactions.
- [ ] A **Stripe Tax** restaurant: the quote shows local tax for the pickup
      address, the paid order appears under the restaurant's Tax →
      Transactions, and the amounts match.
- [ ] Order **confirmation email** arrives once (without the PIN), and a
      **staff invitation email** arrives with the sign-in link.
- [ ] **Staff invite** → temporary password → change password → accept →
      board access by role.
- [ ] **Super admin**: create restaurant, create owner, Stripe onboarding,
      activate, suspend (storefront disappears within a few seconds).
- [ ] Try a forged `X-Forwarded-For` against `/restaurant/login` through the
      real edge and confirm the rate limit still applies.
- [ ] Menu photos load on a storefront (served by the API through the edge).
- [ ] Restore last night's backup into a scratch database (§5).
- [ ] Light load test on menu, quote and order creation.

When every **[BLOCKER]** and **[LAUNCH]** box is ticked, switch Stripe and
Clerk to live keys, deploy the tagged release, and place one real low-value
order end to end before announcing.
