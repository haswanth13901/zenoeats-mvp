"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Empty, ErrorNote, Panel, Shell } from "@/components/Shell";
import { ApiError, errorMessage } from "@/lib/api";
import { money } from "@/lib/format";
import { useAdminResource } from "@/lib/useAdminApi";

type Restaurant = {
  id: string;
  slug: string;
  name: string;
  status: string;
  currency: string;
  tax_rate_bps: number;
  accepting_orders: boolean;
  stripe_account_id: string | null;
  charges_enabled: boolean;
  created_at: string;
  tagline: string | null;
  timezone: string | null;
  deleted_at: string | null;
};

type Report = {
  restaurant_id: string;
  slug: string;
  name: string;
  status: string;
  currency: string;
  orders_paid: number;
  gross_revenue_minor: number;
  tax_collected_minor: number;
  average_order_value_minor: number;
  orders_pending_payment: number;
  orders_expired: number;
  last_order_at: string | null;
};

const NAV = [{ href: "/admin", label: "Restaurants" }];

export default function AdminPage() {
  // Declared before the resource hooks: the query string is derived from it,
  // so the state has to exist first.
  const [showDeleted, setShowDeleted] = useState(false);
  const restaurants = useAdminResource<Restaurant[]>(
    `/admin/restaurants?include_deleted=${showDeleted}`
  );
  const reports = useAdminResource<Report[]>("/admin/reports", 30_000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [ownerFor, setOwnerFor] = useState<Restaurant | null>(null);
  // Shown once, then gone. The API returns the temporary password at creation
  // and never again, so losing it here means reissuing rather than looking up.
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const router = useRouter();

  async function signOut() {
    await restaurants.call("/admin/logout", { method: "POST" }).catch(() => {});
    router.replace("/admin/login");
  }

  async function act(id: string, action: string) {
    setBusy(id);
    setError(null);
    try {
      await restaurants.call(`/admin/restaurants/${id}/${action}`, { method: "POST" });
      await Promise.all([restaurants.refresh(), reports.refresh()]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: Restaurant) {
    // Reversible, but it still pulls a storefront offline, so it asks first
    // and names which one.
    if (!confirm(`Delete ${r.name}? It can be restored, and its subdomain stays reserved.`))
      return;
    setBusy(r.id);
    setError(null);
    try {
      await restaurants.call(`/admin/restaurants/${r.id}`, { method: "DELETE" });
      await restaurants.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function restore(id: string) {
    setBusy(id);
    setError(null);
    try {
      await restaurants.call(`/admin/restaurants/${id}/restore`, { method: "POST" });
      await restaurants.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function save(id: string, changes: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    try {
      await restaurants.call(`/admin/restaurants/${id}`, { method: "PATCH", body: changes });
      setEditing(null);
      await restaurants.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function createOwner(restaurant: Restaurant, email: string, fullName: string) {
    setBusy(restaurant.id);
    setError(null);
    try {
      const res = await restaurants.call<{ email: string; temporary_password: string }>(
        `/admin/restaurants/${restaurant.id}/owner`,
        { method: "POST", body: { email, full_name: fullName || null } }
      );
      setOwnerFor(null);
      setIssued({ email: res.email, password: res.temporary_password });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onboard(id: string) {
    setBusy(id);
    setError(null);
    try {
      const origin = window.location.origin;
      const res = await restaurants.call<{ onboarding_url: string }>(
        `/admin/restaurants/${id}/stripe-onboarding?return_url=${encodeURIComponent(
          `${origin}/admin`
        )}&refresh_url=${encodeURIComponent(`${origin}/admin`)}`,
        { method: "POST" }
      );
      window.location.href = res.onboarding_url;
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  const totals = (reports.data ?? []).reduce(
    (acc, r) => ({
      gross: acc.gross + r.gross_revenue_minor,
      orders: acc.orders + r.orders_paid,
      live: acc.live + (r.status === "ACTIVE" ? 1 : 0),
    }),
    { gross: 0, orders: 0, live: 0 }
  );

  return (
    <Shell
      title="Zenoeats platform"
      nav={NAV}
      action={
        <button className="btn-quiet px-3 py-1.5 text-sm" onClick={signOut}>
          Sign out
        </button>
      }
    >
      <ErrorNote message={error ?? restaurants.error} />

      <div className="mb-10 grid grid-cols-3 gap-px border border-hairline bg-hairline">
        <Stat label="Live restaurants" value={String(totals.live)} />
        <Stat label="Paid orders" value={String(totals.orders)} />
        <Stat label="Gross volume" value={money(totals.gross)} />
      </div>

      <Panel
        title="Restaurants"
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-brick"
                checked={showDeleted}
                onChange={(e) => setShowDeleted(e.target.checked)}
              />
              Show deleted
            </label>
            <button className="btn-quiet px-3 py-1.5" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Cancel" : "Add restaurant"}
            </button>
          </div>
        }
      >
        {showForm && (
          <CreateForm
            onDone={async () => {
              setShowForm(false);
              await restaurants.refresh();
            }}
            call={restaurants.call}
            onError={setError}
          />
        )}

        {issued && (
          <div className="mb-4 border border-hairline bg-surface p-4">
            <h3 className="text-sm font-medium">Owner login created</h3>
            <p className="mt-1 text-sm text-muted">
              Give these to the owner now. The password is not stored and cannot
              be shown again — only reissued.
            </p>
            <dl className="mt-3 grid gap-1 text-sm">
              <div className="flex gap-2">
                <dt className="w-20 text-muted">Email</dt>
                <dd>{issued.email}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 text-muted">Password</dt>
                <dd className="tnum font-medium tracking-wide">{issued.password}</dd>
              </div>
            </dl>
            <button className="btn-quiet mt-4 px-3 py-1.5 text-sm" onClick={() => setIssued(null)}>
              I have saved it
            </button>
          </div>
        )}

        {ownerFor && (
          <OwnerForm
            restaurant={ownerFor}
            busy={busy === ownerFor.id}
            onCancel={() => setOwnerFor(null)}
            onCreate={(email, fullName) => createOwner(ownerFor, email, fullName)}
          />
        )}

        {restaurants.loading ? (
          <Empty>Loading…</Empty>
        ) : !restaurants.data?.length ? (
          <Empty>No restaurants yet. Add one to get started.</Empty>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-hairline text-left text-xs text-muted">
                <th className="py-2 font-medium">Restaurant</th>
                <th className="font-medium">Status</th>
                <th className="font-medium">Stripe</th>
                <th className="text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {restaurants.data.map((r) => (
                <Fragment key={r.id}>
                <tr className={r.deleted_at ? "opacity-50" : undefined}>
                  <td className="py-3">
                    <div>
                      {r.name}
                      {r.deleted_at && <span className="ml-2 text-xs text-brick">deleted</span>}
                    </div>
                    <a
                      href={`http://${r.slug}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "zenoeats.local"}:8080`}
                      className="text-xs text-muted underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.slug}
                    </a>
                  </td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className="text-xs">
                    {!r.stripe_account_id ? (
                      <span className="text-muted">Not connected</span>
                    ) : r.charges_enabled ? (
                      <span>Charges enabled</span>
                    ) : (
                      <span className="text-brick">Onboarding incomplete</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <div className="inline-flex gap-2">
                      {!r.charges_enabled && (
                        <button
                          className="btn-quiet px-2 py-1 text-xs"
                          disabled={busy === r.id}
                          onClick={() => onboard(r.id)}
                        >
                          Connect Stripe
                        </button>
                      )}
                      {r.deleted_at ? (
                        <button
                          className="btn-primary px-2 py-1 text-xs"
                          disabled={busy === r.id}
                          onClick={() => restore(r.id)}
                        >
                          Restore
                        </button>
                      ) : (
                        <>
                          {r.status !== "ACTIVE" ? (
                            <button
                              className="btn-primary px-2 py-1 text-xs"
                              disabled={busy === r.id}
                              onClick={() => act(r.id, "activate")}
                            >
                              Activate
                            </button>
                          ) : (
                            <button
                              className="btn-quiet px-2 py-1 text-xs"
                              disabled={busy === r.id}
                              onClick={() => act(r.id, "suspend")}
                            >
                              Suspend
                            </button>
                          )}
                          <button
                            className="btn-quiet px-2 py-1 text-xs"
                            onClick={() => setEditing(editing === r.id ? null : r.id)}
                          >
                            {editing === r.id ? "Close" : "Edit"}
                          </button>
                          <button
                            className="btn-quiet px-2 py-1 text-xs"
                            onClick={() => setOwnerFor(r)}
                          >
                            Owner login
                          </button>
                          <Link
                            className="btn-quiet px-2 py-1 text-xs"
                            href={`/admin/restaurants/${r.id}/orders`}
                          >
                            Orders
                          </Link>
                          {/* The API refuses to delete an ACTIVE restaurant.
                              Hiding the button avoids offering a certain 409. */}
                          {r.status !== "ACTIVE" && (
                            <button
                              className="btn-quiet px-2 py-1 text-xs text-brick"
                              disabled={busy === r.id}
                              onClick={() => remove(r)}
                            >
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {editing === r.id && (
                  <tr>
                    <td colSpan={4} className="bg-paper px-3 py-4">
                      <EditForm
                        restaurant={r}
                        busy={busy === r.id}
                        onCancel={() => setEditing(null)}
                        onSave={(changes) => save(r.id, changes)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Reports"
        action={
          <a className="btn-quiet px-3 py-1.5 text-sm" href="/api/v1/admin/reports.csv">
            Download CSV
          </a>
        }
      >
        {!reports.data?.length ? (
          <Empty>No order data yet.</Empty>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-hairline text-left text-xs text-muted">
                <th className="py-2 font-medium">Restaurant</th>
                <th className="text-right font-medium">Paid</th>
                <th className="text-right font-medium">Gross</th>
                <th className="text-right font-medium">Tax</th>
                <th className="text-right font-medium">AOV</th>
                <th className="text-right font-medium">Unpaid</th>
                <th className="text-right font-medium">Expired</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {reports.data.map((r) => (
                <tr key={r.restaurant_id}>
                  <td className="py-2.5">{r.name}</td>
                  <td className="tnum text-right">{r.orders_paid}</td>
                  <td className="tnum text-right">
                    {money(r.gross_revenue_minor, r.currency)}
                  </td>
                  <td className="tnum text-right text-muted">
                    {money(r.tax_collected_minor, r.currency)}
                  </td>
                  <td className="tnum text-right">
                    {money(r.average_order_value_minor, r.currency)}
                  </td>
                  <td className="tnum text-right text-muted">{r.orders_pending_payment}</td>
                  <td className="tnum text-right text-muted">{r.orders_expired}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-muted">
          Every read on this page is written to the platform audit log with your
          user, the scope requested, and a correlation id.
        </p>
      </Panel>
    </Shell>
  );
}

/** Inline editor for one restaurant.
 *
 *  Sends only what actually changed. A PATCH that resends every field would
 *  clobber a concurrent edit by another admin, and would make "clear the
 *  tagline" indistinguishable from "leave it alone".
 *
 *  slug and status are shown read-only: slug is the tenant's public address
 *  and status belongs to activate/suspend, which enforce the readiness gate.
 */
/** Issue the owner login for one restaurant.
 *
 *  One account per restaurant, with the ADMIN role. The owner adds their own
 *  staff from the restaurant portal, so this is not a general user-creation
 *  screen and deliberately offers no role choice.
 */
function OwnerForm({
  restaurant,
  busy,
  onCancel,
  onCreate,
}: {
  restaurant: Restaurant;
  busy: boolean;
  onCancel: () => void;
  onCreate: (email: string, fullName: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");

  return (
    <form
      className="mb-4 border border-hairline bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(email.trim().toLowerCase(), fullName.trim());
      }}
    >
      <h3 className="text-sm font-medium">Owner login for {restaurant.name}</h3>
      <p className="mt-1 text-sm text-muted">
        Creates one ADMIN account with a temporary password. They choose their
        own at first sign-in, and add their staff themselves.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-muted">Owner email</span>
          <input
            className="field mt-1"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Full name (optional)</span>
          <input
            className="field mt-1"
            value={fullName}
            maxLength={160}
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button className="btn-primary px-3 py-1.5 text-sm" disabled={busy || !email}>
          {busy ? "Creating…" : "Create login"}
        </button>
        <button type="button" className="btn-quiet px-3 py-1.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditForm({
  restaurant,
  busy,
  onCancel,
  onSave,
}: {
  restaurant: Restaurant;
  busy: boolean;
  onCancel: () => void;
  onSave: (changes: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(restaurant.name);
  const [tagline, setTagline] = useState(restaurant.tagline ?? "");
  const [taxPct, setTaxPct] = useState((restaurant.tax_rate_bps / 100).toString());
  const [accepting, setAccepting] = useState(restaurant.accepting_orders);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    if (name !== restaurant.name) changes.name = name;
    // An empty box means "no tagline", which is null rather than "".
    const nextTagline = tagline.trim() === "" ? null : tagline.trim();
    if (nextTagline !== restaurant.tagline) changes.tagline = nextTagline;
    const bps = Math.round(parseFloat(taxPct || "0") * 100);
    if (Number.isFinite(bps) && bps !== restaurant.tax_rate_bps) changes.tax_rate_bps = bps;
    if (accepting !== restaurant.accepting_orders) changes.accepting_orders = accepting;
    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }
    onSave(changes);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs text-muted">Name</span>
          <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Tagline</span>
          <input
            className="field mt-1"
            value={tagline}
            maxLength={200}
            placeholder="none"
            onChange={(e) => setTagline(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Tax rate %</span>
          <input
            className="field mt-1 tnum"
            value={taxPct}
            inputMode="decimal"
            onChange={(e) => setTaxPct(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brick"
            checked={accepting}
            onChange={(e) => setAccepting(e.target.checked)}
          />
          Accepting orders
        </label>
        <span className="text-xs text-muted">
          Subdomain <code>{restaurant.slug}</code> and status{" "}
          <code>{restaurant.status}</code> are not editable here.
        </span>
      </div>

      <div className="flex gap-2">
        <button className="btn-primary px-3 py-1.5 text-sm" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="btn-quiet px-3 py-1.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="tnum mt-1 font-display text-2xl">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "ACTIVE"
      ? "bg-ink text-white"
      : status === "SUSPENDED"
      ? "bg-brick/10 text-brick"
      : "bg-paper text-muted";
  return <span className={`rounded px-2 py-0.5 text-xs ${tone}`}>{status.toLowerCase()}</span>;
}

function CreateForm({
  call,
  onDone,
  onError,
}: {
  call: <T,>(p: string, o?: { method?: string; body?: unknown }) => Promise<T>;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [taxPercent, setTaxPercent] = useState("8.25");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await call("/admin/restaurants", {
        method: "POST",
        body: {
          name,
          slug: slug.toLowerCase().trim(),
          // The API takes basis points so the rate stays an integer end to
          // end. 8.25% becomes 825.
          tax_rate_bps: Math.round(parseFloat(taxPercent || "0") * 100),
        },
      });
      setName("");
      setSlug("");
      onDone();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 grid gap-3 border border-hairline bg-surface p-4 sm:grid-cols-4">
      <label className="sm:col-span-2">
        <span className="text-xs text-muted">Restaurant name</span>
        <input
          className="field mt-1"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
          }}
        />
      </label>
      <label>
        <span className="text-xs text-muted">Subdomain</span>
        <input
          className="field mt-1"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="spicehouse"
        />
      </label>
      <label>
        <span className="text-xs text-muted">Tax rate %</span>
        <input
          className="field mt-1"
          value={taxPercent}
          inputMode="decimal"
          onChange={(e) => setTaxPercent(e.target.value)}
        />
      </label>
      <div className="sm:col-span-4">
        <button className="btn-primary" disabled={busy || !name || !slug} onClick={submit}>
          {busy ? "Creating…" : "Create as draft"}
        </button>
        <span className="ml-3 text-xs text-muted">
          Created restaurants stay in draft until Stripe is connected and a menu exists.
        </span>
      </div>
    </div>
  );
}
