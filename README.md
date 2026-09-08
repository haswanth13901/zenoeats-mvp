# Zenoeats MVP — pickup ordering through successful payment

A working slice of the v3.0 architecture baseline: multi-tenant subdomain
portals, Clerk identity, a Meal → Category → Item → Modifier menu, and Stripe
Connect checkout that ends with a webhook-confirmed paid order on the kitchen
board.

## What is in this build

| Area | Included |
|---|---|
| Tenancy | Wildcard subdomain resolution, PostgreSQL RLS, three-role DB model |
| Identity | Clerk for customers and staff, webhook mirror into `users` |
| Menu | Meals, categories (FOOD / BEVERAGE / SAUCE), items, reusable modifier groups |
| Checkout | Server-authoritative repricing, TaxService, idempotent order creation |
| Payments | Stripe Connect direct charges, durable webhook inbox, account-match guard |
| Ops | Kitchen board, pickup PIN, menu builder, staff invitations, reports |
| Admin | Super admin portal: onboarding, activation, platform reports, CSV |
| Infra | Docker Compose, Nginx, two Redis instances, Celery, Alembic, GitHub Actions |

## What is deliberately not here

Delivery, drivers, GPS, WebSockets, cash payments, reconciliation, promotions,
reviews, SMS, push, PITR. All of it stays in the v3.0 baseline for later
releases. See "Adding delivery" at the bottom.

## The payment sequence

This is the part worth reading before changing anything.

```
1. POST /api/v1/orders
   Server reprices the cart from the database. The browser's numbers are
   ignored. Order committed as PENDING_PAYMENT with immutable snapshots.
   No money has moved.

2. POST /api/v1/orders/{id}/payment-intent
   PaymentIntent created on the RESTAURANT's connected account. Stripe's
   idempotency key is derived from the order id, so retries return the same
   intent instead of creating a second one.

3. Customer confirms in the browser via Stripe Elements.
   Stripe returning "succeeded" here does NOT mark the order paid.

4. POST /api/v1/webhooks/stripe/connect
   Signature verified. Event persisted to stripe_events with a UNIQUE event
   id. Celery enqueued by row id. 200 returned immediately.

5. Celery worker
   Loads the event as zenoeats_system. Resolves order → restaurant and the
   restaurant's configured stripe_account_id. Proves the event's account
   matches. Opens a SEPARATE zenoeats_app transaction with SET LOCAL
   app.current_tenant. Marks payment PAID and moves the order
   PENDING_PAYMENT → AUTO_ACCEPTED → PREPARING.

6. The customer's page polls GET /orders/{id} and sees the real state.
```

Three rules hold this together. The order row exists before any charge. Only
a verified webhook can say PAID. A partial unique index on
`payments (order_id) WHERE succeeded_at IS NOT NULL` means a second
successful payment on one order is impossible at the database level, even
after a refund.

## The three portals

All three are the same Next.js app. Which one you get depends on the URL.

| URL | Who | What |
|---|---|---|
| `spicehouse.zenoeats.local:8080/` | Customers | Menu, cart, checkout, order tracking |
| `spicehouse.zenoeats.local:8080/manage` | Restaurant staff | Kitchen board, menu builder, staff, reports |
| `admin.zenoeats.local:8080/admin` | Platform | Create and activate restaurants, platform reports |

The restaurant screens must be opened **on that restaurant's subdomain**. The
tenant is resolved from the `Host` header and nothing else, so
`localhost:3000/manage` will not work. Always browse through nginx on `:8080`.

`admin` is a reserved slug, so it never resolves as a tenant. The super admin
endpoints do not use tenant context at all; they run through the audited
system read surface.

### Restaurant screens

- **Kitchen** polls every five seconds. Unpaid orders never appear here.
  Tickets show quantity, modifiers and notes, and turn the elapsed time red
  past fifteen minutes. "Collect with PIN" needs the customer's six digits;
  five wrong attempts locks that order until a manager overrides.
- **Menu** has two tabs. *Meals and items* builds the
  Meal → Category → Item tree and toggles sold-out. *Modifier library* creates
  reusable groups. Options are entered one per line, with an optional price
  change at the end: `Jalapenos +0.50`, `No cheese -0.50`.
- **Staff** sends invitations. An invited person shows as "waiting to accept"
  and has no access until they sign in to this restaurant and accept.
- **Reports** shows paid orders, gross, average order value, tax, top items,
  and how many checkouts expired unpaid.

### Super admin screen

Create a restaurant (starts in draft), connect its Stripe account through
hosted onboarding, then activate. Activation is gated: it refuses unless the
connected account has charges enabled and at least one menu item is
available. Every read on this page writes to `platform_audit_logs` with your
user, the scope requested, and a correlation id.

## Running it

### 1. Local DNS

Wildcard subdomains need to resolve. Add to `/etc/hosts`:

```
127.0.0.1  zenoeats.local
127.0.0.1  spicehouse.zenoeats.local
127.0.0.1  admin.zenoeats.local
```

On macOS and Linux you can also use `dnsmasq` to wildcard `*.zenoeats.local`
instead of listing each slug.

### 2. Configure

```bash
make setup          # copies .env.example to .env
make key            # prints a Fernet key -> FIELD_ENCRYPTION_KEY
```

Then fill in `.env`:

**Clerk.** Create one application. Under Domains, set the primary domain to
the parent (`zenoeats.local` in dev, `zenoeats.com` in production) so the
session cookie is scoped to `.zenoeats.com` and one login works across every
restaurant subdomain. Copy the publishable key, secret key, JWKS URL and
issuer. Add a webhook endpoint pointing at
`https://api.yourdomain/api/v1/webhooks/clerk` subscribed to `user.created`,
`user.updated` and `user.deleted`, and copy its signing secret.

**Stripe.** Enable Connect in test mode. Copy the secret and publishable
keys. Create a webhook endpoint **on the Connect tab** (not the account tab)
pointing at `/api/v1/webhooks/stripe/connect`, subscribed to
`payment_intent.succeeded`, `payment_intent.payment_failed`,
`payment_intent.canceled`, `charge.refunded` and `account.updated`. Copy that
endpoint's signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET`. It is a
different secret from the platform endpoint's.

### 3. Start

```bash
make up
make seed
```

Open `http://spicehouse.zenoeats.local:8080`.

### 4. Connect a real test-mode restaurant account

The seed inserts a placeholder account id. Replace it before paying:

```bash
# Create a test connected account through the API, or in the Stripe dashboard
docker compose exec postgres psql -U postgres -d zenoeats -c \
  "UPDATE restaurant_payment_accounts SET stripe_account_id = 'acct_YOUR_TEST_ID';"
```

### 5. Forward webhooks to localhost

```bash
stripe listen --forward-connect-to localhost:8000/api/v1/webhooks/stripe/connect
```

Copy the `whsec_` it prints into `STRIPE_CONNECT_WEBHOOK_SECRET` and restart
the api container.

### 6. Pay

Card `4242 4242 4242 4242`, any future expiry, any CVC. The order page will
sit on "Confirming your payment" for a second or two and then flip to
"Being made now" when the webhook lands. That pause is the system working
correctly, not a bug.

## Verifying tenant isolation

```bash
make rls
```

Six gates run. The important one creates two restaurants, writes a menu into
tenant B, then queries for it from a tenant A session with no application
filter at all. It must return zero rows. The others assert that no runtime
role has `BYPASSRLS`, that no runtime role owns a table, and that
`zenoeats_system` cannot UPDATE orders or INSERT menu items.

If you change the migration, run these before merging. They are the only
thing standing between you and a cross-tenant data leak.

## Development without Clerk

For backend work you can skip Clerk entirely:

```
AUTH_DEV_BYPASS=true
```

The `Authorization: Bearer` header is then read as a bare user id. The seed
prints three: `user_dev_customer`, `user_dev_owner`, `user_dev_superadmin`.

```bash
curl -H "Authorization: Bearer user_dev_customer" \
     -H "X-Zenoeats-Restaurant: spicehouse" \
     -H "Idempotency-Key: $(uuidgen)" \
     -H "Content-Type: application/json" \
     -d '{"items":[{"menu_item_id":"...","quantity":1,"modifiers":[]}]}' \
     http://localhost:8000/api/v1/orders
```

The app refuses to boot with `AUTH_DEV_BYPASS=true` and `ENV=production`.

## Menu model

```
Meal                    "Lunch"
  Category  kind=FOOD       "Burgers"
    Item                      "Smash Burger"
      ModifierGroup             "Veggies"      MULTI,  0-5, optional
        ModifierOption            "Lettuce"    +$0.00
        ModifierOption            "Jalapenos"  +$0.50
  Category  kind=BEVERAGE   "Cold Drinks"
    Item                      "Iced Tea"
      ModifierGroup             "Ice level"    SINGLE, 1-1, required
        ModifierOption            "Light" / "Regular" / "Heavy"
  Category  kind=SAUCE      "Sides & Sauces"
    Item                      "Garlic Aioli"
```

Modifier groups belong to the restaurant, not to a single item, and attach
through `item_modifier_groups`. Define "Ice level" once and reuse it on every
drink. `applies_to_kind` filters the library in the menu builder so adding a
beverage surfaces Ice level rather than Veggies.

`modifier_options.price_delta_minor` is the one money column without a
non-negative constraint, because "no cheese −$0.50" is legitimate. Everything
else is `BIGINT` minor units with `CHECK >= 0`.

## Project layout

```
backend/
  app/core/         auth, tenant resolution, money, crypto, idempotency
  app/db/           engines and the SET LOCAL tenant session
  app/models/       SQLAlchemy models, frozen enums, transition matrix
  app/services/     pricing, orders, tax, Stripe
  app/api/v1/       portal, orders, restaurant, admin, webhooks
  app/workers/      Celery app and tasks
  alembic/          schema, RLS policies, role grants
  tests/            unit tests plus the RLS gates
frontend/
  app/              customer: menu, checkout, order tracking
  app/manage/       restaurant: kitchen, menu builder, staff, reports
  app/admin/        platform: restaurants, onboarding, reports
  components/       modifier sheet, cart bar, operator shell
  lib/              API client, cart context, auth hooks, formatting
infra/
  postgres/         role creation, runs on first boot
  nginx/            origin edge with subdomain routing
```

## Before real money

Six things this build does not do that a production launch needs:

1. **Tax.** `TaxService` uses one flat rate per restaurant. Texas prepared
   food is state plus local jurisdiction and varies by address. Wire Stripe
   Tax behind the same interface before launch.
2. **Backups.** Nightly encrypted `pg_dump` copied off the VM, and one
   timed restore drill. A backup you have never restored is not a backup.
3. **TLS.** Let's Encrypt wildcard certificate via DNS validation, plus
   monitoring on expiry. A lapsed wildcard cert takes down every portal.
4. **Error tracking.** Wire Sentry or equivalent into the FastAPI handler and
   the Celery tasks. Scrub tokens, card data and PINs.
5. **Rate limiting.** `redis-runtime` is running and unused. Add limits on
   auth, order creation and PaymentIntent creation.
6. **Receipts.** No email is sent yet. Add a Celery task on the
   `payment_intent.succeeded` path.

Two smaller gaps worth knowing about. Staff invitations create the membership
row but send no email; wire that to the same notification task as receipts, or
use Clerk Organizations invitations if you would rather Clerk own the flow.
And the invited person currently has to be told the URL to visit, since there
is no invitation landing page yet.

## Adding delivery later

The seams are already in place. `Order.fulfillment_type` exists and is always
`PICKUP`. The transition matrix in `app/models/commerce.py` is missing exactly
the five delivery states from Appendix A.5; add them there and the guard
rejects everything you have not explicitly allowed. Polling in the order page
is the thing to replace with WebSockets, and section 12 of the baseline
already specifies how.
