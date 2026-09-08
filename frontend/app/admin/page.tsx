"use client";

import { useState } from "react";
import { Empty, ErrorNote, Panel, Shell } from "@/components/Shell";
import { ApiError, errorMessage } from "@/lib/api";
import { money } from "@/lib/format";
import { useResource } from "@/lib/useApi";

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
  const restaurants = useResource<Restaurant[]>("/admin/restaurants");
  const reports = useResource<Report[]>("/admin/reports", 30_000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

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
    <Shell title="Zenoeats platform" nav={NAV}>
      <ErrorNote message={error ?? restaurants.error} />

      <div className="mb-10 grid grid-cols-3 gap-px border border-hairline bg-hairline">
        <Stat label="Live restaurants" value={String(totals.live)} />
        <Stat label="Paid orders" value={String(totals.orders)} />
        <Stat label="Gross volume" value={money(totals.gross)} />
      </div>

      <Panel
        title="Restaurants"
        action={
          <button className="btn-quiet px-3 py-1.5" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "Add restaurant"}
          </button>
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
                <tr key={r.id}>
                  <td className="py-3">
                    <div>{r.name}</div>
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
                    </div>
                  </td>
                </tr>
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
