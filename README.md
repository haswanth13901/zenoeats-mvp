# Zenoeats MVP — pickup ordering through successful payment

A working slice of the v3.0 architecture baseline: multi-tenant subdomain
portals, Clerk-backed customer sign-in on our own pages, an Item → Modifier menu served by meal periods, and Stripe
Connect checkout that ends with a webhook-confirmed paid order on the kitchen
board.

## What is in this build

| Area | Included |
|---|---|
| Tenancy | Wildcard subdomain resolution, PostgreSQL RLS, three-role DB model |
| Identity | Customers: Clerk (email/password, Google) behind our own `/account` pages. Staff: platform-issued passwords. Admins: `ADMIN_USERS` |
| Menu | Item types the restaurant names itself, items, meal periods that serve them, combos, reusable modifier groups |
| Checkout | Server-authoritative repricing, TaxService, idempotent order creation |
| Payments | Stripe Connect direct charges, durable webhook inbox, account-match guard |
| Ops | Kitchen board, pickup PIN, menu builder, staff invitations, reports, deliveries the restaurant runs itself |
| Admin | Super admin portal: onboarding, activation, platform reports, CSV |
| Infra | Docker Compose, Nginx, two Redis instances, Celery, Alembic, GitHub Actions |

## What is deliberately not here

Ordering a delivery, delivery fees, driver GPS and routing, WebSockets, cash
payments, reconciliation, promotions, reviews, SMS, push, PITR. All of it
stays in the v3.0 baseline for later releases. See "Adding delivery" at the
bottom.

A restaurant can send an order out with one of its own drivers -- a phone
order it agreed to run -- but a customer cannot choose delivery, is not
charged for one, and the address is typed by staff.

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

All three are the same React app, built by Vite. Which one you get depends
on the URL.

| URL | Who | What |
|---|---|---|
| `spicehouse.zenoeats.local:8080/` | Customers | Menu, cart, checkout, order tracking |
| `spicehouse.zenoeats.local:8080/manage` | Restaurant staff | Kitchen board, deliveries, menu builder, staff, reports |
| `admin.zenoeats.local:8080/admin` | Platform | Create and activate restaurants, platform reports |

The restaurant screens must be opened **on that restaurant's subdomain**. The
tenant is resolved from the `Host` header and nothing else, so
`localhost:3000/manage` will not work. Always browse through nginx on `:8080`,
or through the Vite dev server on a `*.zenoeats.local` subdomain.

`admin` is a reserved slug, so it never resolves as a tenant. The super admin
endpoints do not use tenant context at all; they run through the audited
system read surface.

### Restaurant screens

- **Kitchen** polls every five seconds. Unpaid orders never appear here.
  A new order chimes (once sound is switched on with a tap, which browsers
  require), is marked "new" and counts in the tab title. Tickets show
  quantity, modifiers and notes, and time from payment, turning red past
  fifteen minutes. "Done today" lists today's handed-over and cancelled
  orders, searchable by number, with who did it and any reason given. "Collect with PIN" needs the customer's six digits;
  five wrong attempts locks that order. A manager can hand an order over
  without the PIN or cancel a paid one, each with a reason; cancelling does
  not refund, which stays in the restaurant's Stripe Dashboard. A ticket
  refunded there is marked "refunded".
- **Deliveries** is for the orders a restaurant runs out itself. Customers
  cannot order a delivery: a manager assigns a paid order to one of the
  restaurant's drivers and types the address taken by phone, which is what
  makes it a delivery. The kitchen's "ready" then means ready for the driver,
  and the driver marks it picked up, then delivered -- no PIN at a doorstep,
  so the driver saying so is what completes it, recorded against them. A
  driver sees their own deliveries and nothing else; a manager sees them all
  and can press the same buttons for a driver whose hands are full.
- **Stock** is the sold-out toggle for everyone on the floor: sold-out items
  first, a search box, one button per item.
- **Menu** has four tabs. *Items* is everything the restaurant sells, each
  with a type and the meal periods that serve it, plus the sold-out toggle.
  *Meal periods* adds a period and chooses what it serves, pulling from that
  item list. Item types are managed above the item list, on the Items tab. *Combos* bundles a period's items into meal deals with a
  discount. *Modifier library* creates reusable groups, each shown on any
  number of item types. Options are entered a row at a time, name beside
  price change; a blank price means no change and a negative one is allowed,
  like `-0.50` for no cheese.
- **Staff** sends invitations. An invited person shows as "waiting to accept"
  and has no access until they sign in to this restaurant and accept. An admin
  can change a member's role, which applies on their next click, and reset a
  forgotten password: the person is signed out everywhere and gets a
  temporary password, shown once. You cannot remove yourself, change your own
  role, or leave the restaurant without an active admin. Resets are refused
  for another admin, and for a login that also works at another Zenoeats
  restaurant; Zenoeats support resets those.
- **Reports** covers today, yesterday, the last 7 days, this month or chosen
  dates -- the restaurant's own days, in its timezone, with each order counted
  on the day it was paid there. It shows net sales (gross less refunds made
  from the Stripe Dashboard), paid orders, average order, tax net of refunds,
  combo discounts, cancelled orders, a by-day breakdown, top items (leaving out
  cancelled and fully refunded orders), and checkouts that expired unpaid.

### Staff roles

Every member of a restaurant's team has one of five roles. The same person
can hold a different role at another restaurant.

| Role | Kitchen | Deliveries | Stock | Menu | Staff | Reports |
|---|---|---|---|---|---|---|
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Kitchen | ✓ | | ✓ | | | |
| Cashier | ✓ | | ✓ | | | |
| Driver | | ✓ | | | | |

A driver is not floor staff with an extra screen. Deliveries is the whole
portal to them, and it shows only the orders assigned to them.

The actions split further:

| Action | Admin | Manager | Kitchen | Cashier | Driver |
|---|---|---|---|---|---|
| See the board, mark ready, collect with PIN | ✓ | ✓ | ✓ | ✓ | |
| Mark items sold out or back in stock | ✓ | ✓ | ✓ | ✓ | |
| Hand over without the PIN | ✓ | ✓ | | | |
| Cancel a paid order | ✓ | ✓ | | | |
| Edit the menu, read reports | ✓ | ✓ | | | |
| Send an order out with a driver | ✓ | ✓ | | | |
| Pick up and deliver | ✓ | ✓ | | | ✓ |
| Invite and remove staff, change roles, reset passwords | ✓ | | | | |

### How roles are enforced

The API decides; the portal only follows. Every restaurant endpoint runs
these checks in order, and any one of them refuses the request:

1. **Who you are.** The staff session cookie is a signed token naming a
   person, never a restaurant. It is refused if expired, if it was issued
   before a password change or reset (`users.sessions_valid_after`), or if
   the account is inactive. An account still holding a temporary password can
   only ask who it is, sign out, and change that password. "Sign out" is
   this device only, because restaurants share logins across tablets; "Sign
   out all devices" ends every session the account holds.
2. **Which restaurant.** The tenant comes from the `Host` header and nothing
   else, so a request cannot name a restaurant it is not on.
3. **Your role there.** `require_staff(...)` in `app/api/deps.py` reads your
   `restaurant_users` row for that restaurant, under row-level security, and
   requires it to be `ACTIVE` with a role in the endpoint's list. It is read
   on every request, so removing someone or changing their role takes effect
   on their next click. The lists live at the top of the staff API in
   `app/api/v1/restaurant.py`: `MANAGE` (Admin, Manager), `ANY_STAFF` (all
   four) and `STAFF_ADMIN` (Admin alone).
4. **Row-level security.** The query itself runs with
   `app.current_tenant` set, so even a wrong role check could not read or
   write another restaurant's rows.
5. **Origin pinning.** A request whose `Origin` is another hostname is
   refused, so a page on a neighbouring subdomain cannot use a signed-in
   operator's cookie.

The portal mirrors the role lists in `web/src/features/restaurant/nav.ts` to
decide which tabs and buttons to show, and a page opened outside your role
says so instead of loading. That is a convenience: removing it would change
what people see, not what they can do.

`tests/test_role_coverage.py` holds the whole map of endpoint to roles. It
fails if an endpoint is added without a role check, or if an endpoint's roles
change without the map changing with it. So adding an endpoint, or widening
one, means editing that table on purpose. When you do, update the tables above
and `nav.ts` to match.

### Super admin screen

Create a restaurant (starts in draft), connect its Stripe account through
hosted onboarding, then activate. Activation is gated on payments only: it
refuses unless the connected account has charges enabled. The menu is not
part of the gate, so a restaurant can go live and fill its menu afterwards.
Every read on this page writes to `platform_audit_logs` with your user, the
scope requested, and a correlation id.

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

**Sessions.** Set `SESSION_SECRET` (`openssl rand -base64 32`). It signs the
admin and staff session cookies.

**Clerk (customers).** Create one application. Enable *Email address* +
*Password*, and *Google* under social connections if you want the button
(development instances use Clerk's shared Google credentials, so there is
nothing to set up at Google). Copy the publishable key into
`VITE_CLERK_PUBLISHABLE_KEY`, and the secret key, JWKS URL and issuer into the
`CLERK_*` settings. For production, set the primary domain to the parent
(`zenoeats.com`) so one sign-in covers every restaurant subdomain, and add a
webhook endpoint at `https://yourdomain/api/v1/webhooks/clerk` for
`user.created`, `user.updated` and `user.deleted`.

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

## Customer sign-in

The pages are ours; the identity is Clerk's. `/account/sign-in`,
`/account/sign-up` and `/account/forgot-password` are plain HTML entries
styled like the rest of the storefront, and they call Clerk's JavaScript SDK
directly -- no Clerk component is rendered.

* **Sign-up** sends a 6-digit code, entered on the same page.
* **Forgot password** sends a 6-digit code, entered with the new password.
* **Google** goes through Clerk and returns to `/account/sso-callback`, which
  finishes the sign-in (or sign-up) and continues to checkout.
* **The API** verifies Clerk's session token on every order request, checks it
  was minted for one of our own hosts, and keeps one `users` row per Clerk
  user. A new customer's email and name are read from Clerk's Backend API the
  first time they appear, so receipts do not wait for the webhook.

The SDK is loaded from the Clerk instance at runtime (about 80 KB), not
bundled, and only on customer pages.

## Development without Clerk

For backend work you can skip Clerk entirely:

```
AUTH_DEV_BYPASS=true
```

The `Authorization: Bearer` header is then read as a bare Clerk user id. The
seed creates `user_dev_customer`.

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
ItemType                "Food"  "Drinks"  "Sides"  "Sauces"   <- the restaurant's own
  ItemType                "Burgers"  parent=Food                <- optional, one level

Item  type=Burgers      "Smash Burger"
  ModifierGroup           "Veggies"      MULTI,  0-5, optional
    ModifierOption          "Lettuce"    +$0.00
    ModifierOption          "Jalapenos"  +$0.50
Item  type=Drinks       "Iced Tea"
  ModifierGroup           "Ice level"    SINGLE, 1-1, required
    ModifierOption          "Light" / "Regular" / "Heavy"
Item  type=Sides        "Fries"
Item  type=Sauces       "Garlic Aioli"

Meal                    "Lunch"     serves all four
Meal                    "Dinner"    serves the burger, the tea and the fries

Combo "Burger Meal"     sold during Lunch, 10% off
  slot Food               Smash Burger
  slot Drinks             Iced Tea
  slot Sides              Fries
```

Item types are rows, not an enum. Four hard-coded words meant a tiffin house
filed tiffins, thalis and chaat under "Food" and read a stranger's vocabulary
back on its own menu. A restaurant is created with Food, Drinks, Sides and
Sauces as a starting point and renames, reorders, adds to or deletes them from
the portal. `item_types.sort_order` is the order headings read down a
storefront. Deleting a type still on items is refused rather than cascading,
because the alternative is taking real menu items with it.

A type may name a parent, which makes it a subcategory: Food holding Burgers
and Nuggets, Drinks holding Hot Beverages. Two levels and no more, capped by a
composite foreign key rather than by a rule the code has to remember, so
nothing walks a tree. Leaving the parent blank is the ordinary case and the
one most menus stay in.

The nesting is a heading on the storefront and nothing else. Combos and the
modifier-group filter read the top-level type, so a slot asking for a food
offers burgers and nuggets together and a group offered for Food reaches every
burger. Making Burgers and Nuggets top-level types instead would have split
that one slot into two, each offering half the choice, and forced the group to
be named against both. `sort_order` on a subcategory orders it among its
siblings, not across the menu. A heading with subcategories under it cannot be
deleted or filed under a third type while they are there.

An item belongs to the restaurant, not to a meal period, and a period serves
it through `meal_items`. So one item can be on breakfast and lunch alike, with
one price and one sold-out toggle. The headings a customer reads inside a
period are derived from the types of the items served, not stored. A
subcategory becomes a block inside its parent's heading rather than a heading
of its own, and what is filed on the heading itself reads before it.

A combo is one item from each of several item types, sold together for less. It
belongs to one meal period and may only offer items that period serves. Each
slot takes exactly one item of one type and is always required. The discount is a
percentage in basis points or a flat amount in minor units, and it is capped
at what the chosen items cost.

A combo is not an order line. It becomes one line per slot at each item's own
price, tagged with `combo_id`, `combo_name_snapshot` and `combo_group`, and
the saving lands in `orders.discount_minor`. So the subtotal is still what the
food costs, the saving is a figure a receipt can show, and the kitchen sees
the items it has to plate.

Modifier groups belong to the restaurant, not to a single item, and attach
through `item_modifier_groups`. Define "Ice level" once and reuse it on every
drink. The item types a group names filter the library in the menu builder, so
adding a drink surfaces Ice level rather than Veggies. It is a list, so a
"Size" group can be offered on drinks and sides at once; naming none means
every type.

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
web/
  src/pages/storefront/   customer: menu, checkout, order tracking
  src/pages/manage/       restaurant: kitchen, menu builder, staff, reports
  src/pages/admin/        platform: restaurants, onboarding, reports
  src/features/           cart and session state, one RTK Query API per portal
  src/services/           HTTP client and the RTK Query base query
  src/components/         modifier sheet, cart bar, operator shell, guards
  login/                  the three sign-in pages, deliberately outside React
  nginx.conf              static serving: SPA fallback, real files for /login
infra/
  postgres/         role creation, runs on first boot
  nginx/            origin edge with subdomain routing
```

## Before real money

`STEPS_BEFORE_PRODUCTION.md` is the checklist: every code change, account,
infrastructure, legal and rehearsal step before launch, with what has been done
and what is still open. Keep it current rather than a list here.

The production edge and deployment shape are in `docker-compose.prod.yml` and
`infra/nginx/production/`.

## Adding delivery later

Half of it is here. `Order.fulfillment_type` is `PICKUP` until a manager
sends an order out, and the transition matrix in `app/models/commerce.py`
carries READY_FOR_DELIVERY and OUT_FOR_DELIVERY. Who is delivering is a
column, `orders.driver_user_id`, rather than the baseline's DRIVER_ASSIGNED
and DRIVER_ACCEPTED states: a manager may assign or reassign at any point,
which as states would mean an edge from everywhere to everywhere.

What a customer-facing delivery release still needs: delivery as a choice at
checkout, with the address collected and validated there; a delivery fee and
its tax; a delivery radius; DELIVERY_FAILED with the retry and refund
handling around it; and driver location if that is wanted. Polling in the
order page is the thing to replace with WebSockets, and section 12 of the
baseline already specifies how.
