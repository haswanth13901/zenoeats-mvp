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
| Customer profile | `/profile`: name, phone and address; order history at this restaurant; favourite items (accounts only), saved from a heart on the menu |
| Menu | Item types the restaurant names itself, items, meal periods that serve them, combos, reusable modifier groups |
| Checkout | Server-authoritative repricing, TaxService, idempotent order creation |
| Payments | Stripe Connect direct charges, durable webhook inbox, account-match guard |
| Ops | Kitchen board, pickup PIN, menu builder, staff invitations, reports, deliveries the restaurant runs itself, self-service settings |
| Admin | Super admin portal: onboarding, activation, platform reports, CSV |
| Infra | Docker Compose, Nginx, two Redis instances, Celery, Alembic, GitHub Actions |

## What is deliberately not here

Route planning, a native driver app, WebSockets, cash payments, reconciliation, promotions,
reviews, SMS, push, PITR. All of it stays in the v3.0 baseline for later
releases. See "Adding delivery" at the bottom.

Checkout requires a name, phone number and address on every order, plus the
email the customer signed in or started their guest session with. A customer
of a restaurant that delivers chooses Pickup or Delivery there: the address is
priced against the restaurant's rings on the quote and again when the order is
created, and the fee is charged with the food. A manager still assigns the
driver. Name and phone are kept on the order as a snapshot and shown on the
kitchen ticket and the driver's card; the customer's row keeps the latest copy
to fill in next time.

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
   If the payment has sat in PROCESSING for 10 seconds with no webhook, the
   poll also reads the PaymentIntent back from Stripe (after responding, at
   most every 10 seconds per payment) and applies it through the same
   handlers as step 5. The 5-minute expiry sweep does the same before it
   expires anything, so a lost webhook cannot expire a charged order.
```

Three rules hold this together. The order row exists before any charge. Only
Stripe can say PAID: a verified webhook, or the intent read back from Stripe
with the platform key, never the browser. A partial unique index on
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
  and can press the same buttons for a driver whose hands are full. A manager
  can also hand the order to a different driver, or take it back to being a
  collection -- until the driver has it, at which point the choices are let
  them deliver it or cancel.
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
- **Settings** is the admin's own screen, in six parts. *Your account* is
  your display name and the address you sign in with -- the name saves on its
  own, the address asks for your password, since it is a credential and a name
  is not. *The restaurant* is the trading name, tagline and whether you are
  taking orders. *Where you are* is the pickup address, which is also the
  address your sales tax is worked out for, and your timezone, which decides
  which day an order counts on in reports. *Delivery* is below. *Tax* is a flat
  rate or Stripe Tax, which needs a connected account that has finished its own
  tax setup -- until it has, the option says so rather than offering a switch
  that would be refused. Your subdomain, status and currency are shown but not
  editable, under *Set by Zenoeats*: the first is printed on your tables, the
  second has its own readiness checks, and the third is what your existing
  orders are counted in.
- **Delivery**, inside Settings, is three things in the only order that works.
  Place the restaurant on the map, which geocodes the pickup address and is
  what every distance is then measured from. Draw the rings: each is how far it
  reaches and what it costs, typed as "3 miles, $4" -- the inner edge is the
  previous ring's outer one, so a gap is impossible, and past the last ring is
  no delivery rather than free delivery. Then switch delivery on, which is
  refused until the first two exist. Editing the address afterwards drops the
  coordinates and pauses delivery until the restaurant is placed again, because
  measuring from where a restaurant used to be would charge every customer the
  wrong fee and nothing about editing a street says so. Under a flat rate you
  also say whether your state taxes the fee; under Stripe Tax you do not,
  because Stripe is handed the amount and decides for the jurisdiction.
- **Reports** covers today, yesterday, the last 7 days, this month or chosen
  dates -- the restaurant's own days, in its timezone, with each order counted
  on the day it was paid there. It shows net sales (gross less refunds made
  from the Stripe Dashboard), paid orders, average order, tax net of refunds,
  combo discounts, cancelled orders, a by-day breakdown, top items (leaving out
  cancelled and fully refunded orders), and checkouts that expired unpaid.
  Deliveries are counted apart from collections and per driver -- the same
  sales, split, not added -- since they cost the restaurant someone's time in
  a car.

### Staff roles

Every member of a restaurant's team has one of five roles. The same person
can hold a different role at another restaurant.

| Role | Kitchen | Deliveries | Stock | Menu | Staff | Reports | Settings |
|---|---|---|---|---|---|---|---|
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ | ✓ | | ✓ | |
| Kitchen | ✓ | | ✓ | | | | |
| Cashier | ✓ | | ✓ | | | | |
| Driver | | ✓ | | | | | |

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
| Edit the restaurant's name, address, timezone and tax | ✓ | | | | |
| Set the delivery area, its fees and whether they are taxed | ✓ | | | | |
| Change your own display name and sign-in address | ✓ | ✓ | ✓ | ✓ | ✓ |

The last row is not an oversight. Your own name and your own login belong to
you whatever you do at the restaurant, so a driver may change theirs exactly as
an owner may. Only the Settings screen offers it today, which is admin-only, so
a screen for the rest of the team is a route away rather than a rewrite.

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
   `app/api/v1/restaurant.py`: `MANAGE` (Admin, Manager), `ANY_STAFF` (the
   four who work the floor, deliberately not Driver), `STAFF_ADMIN` (Admin
   alone), `DELIVERY` (Admin, Manager, Driver) and `OWN_ACCOUNT` (everyone,
   for the two endpoints that are about you rather than about the
   restaurant).
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

**Google Maps (delivery only).** Attach a billing account to the Google Cloud
project and enable **Maps JavaScript API**, **Places API (Legacy)**,
**Geocoding API**, and **Routes API**. API activation itself is not billed;
Google charges for usage after the applicable free allowances.

Create two separate credentials and put them in the root `.env`:

```dotenv
# Private backend credential. Never expose this value to browser code.
GOOGLE_MAPS_API_KEY=replace_with_server_key

# Public browser credential. Its website and API restrictions protect it.
GOOGLE_MAPS_BROWSER_KEY=replace_with_browser_key

# Fine for local development; use a Cloud Map ID for production styling.
GOOGLE_MAPS_MAP_ID=DEMO_MAP_ID
```

Configure the **server key** with API restrictions for **Geocoding API** and
**Routes API**. In production, add an IP-address application restriction for
the API server's fixed outbound IP. An HTTP-referrer restriction will break
this key because calls originate from the backend.

Configure the **browser key** with the **Websites** application restriction,
allow `http://spicehouse.zenoeats.local:8080/*` for local development, and add
each deployed storefront origin before release. Restrict this key to **Maps
JavaScript API** and **Places API (Legacy)**. Do not reuse the server key as
the browser key.

The server key geocodes delivery addresses and calculates arrival estimates.
The browser key provides the checkout suggestion list and customer tracking
map. Delivery cannot be quoted when server geocoding is unavailable; checkout
continues to accept manual addresses if browser suggestions fail. Coordinates
are cached in Redis for 30 days to reduce requests.

After changing these settings, restart the API so the public portal response
contains the browser configuration. For the normal native development setup,
stop the terminal running `make api` and start it again:

```bash
make api
```

When rehearsing the containerized application instead, run:

```bash
docker compose --profile app restart api
```

Open the checkout page, choose **Delivery**, and type part of an address. A
Google suggestion list should appear. Select a suggestion and confirm that a
delivery quote replaces the address-checking message. If Google reports
`REQUEST_DENIED`, verify billing, key restrictions, enabled APIs, and allowed
website referrers; Google configuration changes can take several minutes to
propagate.

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

The CLI listens on whichever Stripe account it is logged in to, which is not
necessarily the one `STRIPE_SECRET_KEY` belongs to. If they differ, nothing is
forwarded and every order sits on "Confirming your payment" even though Stripe
took the money. Either `stripe login` to the same account, or pass the key:
`stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-connect-to ...`. The
secret it prints depends on the account, so copy it again after switching.

Keep `make worker` running too. The webhook only stores the event; the worker
is what marks the order paid. Without either, the order page still gets there
by asking Stripe after about 10 seconds, but that is the fallback, so a slow
confirmation locally usually means one of the two is not running.

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

Customers can choose delivery at checkout. What is missing is everything after
the driver sets off.

**What works.** `Order.fulfillment_type` is `DELIVERY` when the customer chose
it at checkout, or when a manager sends a paid collection out, and the transition matrix in `app/models/commerce.py` carries
READY_FOR_DELIVERY and OUT_FOR_DELIVERY. Who is delivering is a column,
`orders.driver_user_id`, rather than the baseline's DRIVER_ASSIGNED and
DRIVER_ACCEPTED states: a manager may assign or reassign at any point, which as
states would mean an edge from everywhere to everywhere. A restaurant draws
rings in Settings (`delivery_zones`), is geocoded to a point of its own, and
`app/services/delivery.py` will price an address against those rings.
`price_cart` takes the fee, keeps it out of the subtotal and puts it in the
total, and `TaxService` taxes it per the restaurant's answer under a flat rate
or hands it to Stripe as `shipping_cost` under Stripe Tax. An order keeps the
fee and the distance it was charged for.

**Live tracking.** From payment, a delivery's order page shows its steps --
paid, driver assigned, ready, picked up, delivered -- read from
`order_events`. Once the driver presses Picked up, the Deliveries page on
their phone shares GPS every five seconds (`POST
/restaurant/driver/location`, refused unless they have an order of their own
on the road) and keeps the screen awake. The position lives in Redis for
minutes, never in Postgres, and the customer's map (Google Maps JavaScript
API, `GOOGLE_MAPS_BROWSER_KEY`) shows it while fresh. The arrival time comes
from the Routes API with the server key, asked after the poll's response and
at most once per `DELIVERY_ETA_REFRESH_SECONDS` per order. The browser only
reports position while the page is open, so a native driver app is the next
step if drivers need to lock their phones.

The map also requires a non-empty `GOOGLE_MAPS_MAP_ID`: use `DEMO_MAP_ID`
locally and a Google Cloud Map ID in production. After editing `.env` in
Docker, recreate the API with `docker compose --profile app up -d --no-deps
--no-build --force-recreate api`; restarting an existing container does not
load changed environment values. Pickup and unpaid orders have no delivery
tracking map. Driver GPS requires HTTPS and browser location permission;
the HTTP `spicehouse.zenoeats.local:8080` development origin cannot share
GPS. Use a trusted HTTPS deployment for testing actual driver movement,
and keep the driver's Deliveries page open after marking the order picked up.

Uploaded menu images under `/images/` are served by the API. Both development
and production nginx configurations route that prefix to the API, including
when the frontend runs as a static Docker container.

The local edge prefers the `api` and `web` containers directly when the app
profile is running. Docker DNS refreshes their addresses after recreation;
native development uses the host gateway backup. This avoids intermittent
timeouts caused by routing container traffic through Windows port forwarding.
The configuration requires nginx 1.27.3 or newer (the Compose image supplies
1.27.5). After editing it, run `docker compose exec nginx nginx -t` and
`docker compose exec nginx nginx -s reload`. A temporary menu failure also
offers **Try again**, which only refetches the public menu and restaurant details.
Check the real edge after startup or upgrades with
`python scripts/check_storefront.py --slug spicehouse`. It makes 20 read-only
requests, reports latency, and exits unsuccessfully for errors or responses
taking 10 seconds or longer. Use your restaurant's slug if different.

Run one local application mode at a time. With `--profile app`, stop native
Uvicorn, Vite and Celery terminals first. To switch back to native development,
run `docker compose --profile app stop api web worker beat` before starting
those terminals; leave PostgreSQL, Redis and nginx running. Duplicate app
stacks waste memory, can compete for published ports, and run extra task
consumers. On an 8 GB laptop, avoid concurrent frontend builds while serving
the app: memory pressure can cause API worker restarts and request timeouts.
Local Compose defaults to one API worker to reduce memory usage and avoid
multiprocess watchdog restarts on a busy laptop. Set `API_WORKERS` explicitly
for a production host after sizing its resources and database pools.

**What a customer-facing release still needs.** Stripe Tax
sources tax at the restaurant's address, which is right for collection and
wrong for a delivery in a destination-sourced state, so the customer's
structured address has to reach `stripe_tax.calculate`. Then DELIVERY_FAILED
with the retry and refund handling around it, a minimum order value if that is
wanted. Polling in the order page is the thing to replace with WebSockets if
five-second updates stop being enough, and section 12 of the baseline already
specifies how.

**What was decided along the way**, so it is not relitigated. Distance is
straight-line rather than driving distance: routing costs more per lookup and
rings on a map are what a restaurant means by "we deliver within three miles".
Coordinates are cached for thirty days and never stored on an order, because
Google's terms allow caching rather than keeping; what an order keeps is the
distance and the fee, which are ours. A ring's id is not stored either, since
rings are replaced as a set on every edit and the pointer would dangle, while
"3.2 miles, $4" stays true.
