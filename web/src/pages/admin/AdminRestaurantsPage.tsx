import { useState } from "react";
import { Empty, ErrorNote, Panel, Stat } from "@/components/common/Feedback";
import { AdminShell } from "@/features/admin/components/AdminShell";
import { RestaurantRow } from "@/features/admin/components/RestaurantRow";
import {
  CreateRestaurantForm,
  IssuedCredentialPanel,
  OwnerForm,
} from "@/features/admin/components/RestaurantForms";
import {
  useCreateOwnerMutation,
  useCreateRestaurantMutation,
  useDeleteRestaurantMutation,
  useListRestaurantsQuery,
  usePlatformReportsQuery,
  useRefreshStripeStatusMutation,
  useResetOwnerPasswordMutation,
  usePurgeRestaurantMutation,
  useRestoreRestaurantMutation,
  useSetRestaurantStatusMutation,
  useStartStripeOnboardingMutation,
  useUpdateRestaurantMutation,
  type Restaurant,
  type StripeSync,
} from "@/features/admin/adminApi";
import { errorMessage } from "@/services/apiClient";
import { money } from "@/utils/format";

/**
 * Platform overview and restaurant administration.
 *
 * The page holds only what it alone needs -- which dialog is open, which row is
 * being edited, and the last answer Stripe gave. Everything server-side comes
 * from RTK Query, so a mutation refreshes the list through its tags rather than
 * this component remembering to refetch.
 */
export function AdminRestaurantsPage() {
  const [showDeleted, setShowDeleted] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [ownerFor, setOwnerFor] = useState<Restaurant | null>(null);
  const [issued, setIssued] = useState<{
    email: string;
    password: string | null;
    status: "ACTIVE" | "INVITED";
    restaurant: Restaurant;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // A point-in-time answer, not stored state, so it lives here rather than in
  // the restaurant row the list returns.
  const [stripeStatus, setStripeStatus] = useState<Record<string, StripeSync>>({});

  const restaurants = useListRestaurantsQuery({ includeDeleted: showDeleted });
  const reports = usePlatformReportsQuery(undefined, { pollingInterval: 30_000 });

  const [createRestaurant] = useCreateRestaurantMutation();
  const [updateRestaurant] = useUpdateRestaurantMutation();
  const [deleteRestaurant] = useDeleteRestaurantMutation();
  const [restoreRestaurant] = useRestoreRestaurantMutation();
  const [purgeRestaurant] = usePurgeRestaurantMutation();
  const [setStatus] = useSetRestaurantStatusMutation();
  const [startOnboarding] = useStartStripeOnboardingMutation();
  const [refreshStripe] = useRefreshStripeStatusMutation();
  const [createOwner] = useCreateOwnerMutation();
  const [resetOwner] = useResetOwnerPasswordMutation();

  /** One place that runs a mutation, tracks which row is busy and surfaces the
   *  failure. Without it every handler repeats the same six lines. */
  async function run<T>(id: string, work: () => Promise<T>): Promise<T | undefined> {
    setBusyId(id);
    setError(null);
    try {
      return await work();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusyId(null);
    }
  }

  const rows = restaurants.data ?? [];
  const reportRows = reports.data ?? [];
  const totals = reportRows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders_paid,
      live: acc.live + (r.status === "ACTIVE" ? 1 : 0),
    }),
    { orders: 0, live: 0 },
  );

  // Gross volume is summed per currency. Each restaurant settles in its own,
  // and this tile used to add the minor units together and print the result
  // as dollars -- so a single restaurant pricing in rupees or euros made the
  // platform's headline revenue figure a number that meant nothing.
  const grossByCurrency = new Map<string, number>();
  for (const r of reportRows) {
    grossByCurrency.set(r.currency, (grossByCurrency.get(r.currency) ?? 0) + r.gross_revenue_minor);
  }
  const grossVolume =
    grossByCurrency.size === 0
      ? money(0)
      : [...grossByCurrency]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([currency, minor]) => money(minor, currency))
          .join(" · ");

  return (
    <AdminShell>
      <ErrorNote message={error ?? (restaurants.error ? errorMessage(restaurants.error) : null)} />

      <div className="mb-10 grid grid-cols-3 gap-px border border-hairline bg-hairline">
        <Stat label="Live restaurants" value={String(totals.live)} />
        <Stat label="Paid orders" value={String(totals.orders)} />
        <Stat label="Gross volume" value={grossVolume} />
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
            <button className="btn-quiet px-3 py-1.5" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? "Cancel" : "Add restaurant"}
            </button>
          </div>
        }
      >
        {issued && (
          <IssuedCredentialPanel
            email={issued.email}
            password={issued.password}
            status={issued.status}
            restaurant={issued.restaurant}
            onDismiss={() => setIssued(null)}
          />
        )}

        {showCreate && (
          <CreateRestaurantForm
            busy={busyId === "new"}
            onCancel={() => setShowCreate(false)}
            onCreate={async (input) => {
              const created = await run("new", () => createRestaurant(input).unwrap());
              if (created) setShowCreate(false);
            }}
          />
        )}

        {ownerFor && (
          <OwnerForm
            restaurant={ownerFor}
            busy={busyId === ownerFor.id}
            onCancel={() => setOwnerFor(null)}
            onCreate={async (email, fullName) => {
              const res = await run(ownerFor.id, () =>
                createOwner({ id: ownerFor.id, email, full_name: fullName || null }).unwrap(),
              );
              if (res) {
                setIssued({
                  email: res.email,
                  password: res.temporary_password,
                  status: res.status,
                  restaurant: ownerFor,
                });
                setOwnerFor(null);
              }
            }}
            onReset={async (email) => {
              const res = await run(ownerFor.id, () =>
                resetOwner({ id: ownerFor.id, email }).unwrap(),
              );
              if (res) {
                setIssued({
                  email: res.email,
                  password: res.temporary_password,
                  status: res.status,
                  restaurant: ownerFor,
                });
                setOwnerFor(null);
              }
            }}
          />
        )}

        {restaurants.isLoading ? (
          <Empty>Loading…</Empty>
        ) : !rows.length ? (
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
              {rows.map((r) => (
                <RestaurantRow
                  key={r.id}
                  restaurant={r}
                  busy={busyId === r.id}
                  editing={editing === r.id}
                  stripeStatus={stripeStatus[r.id]}
                  actions={{
                    onEdit: () => setEditing(r.id),
                    onCancelEdit: () => setEditing(null),
                    onSave: async (changes) => {
                      const ok = await run(r.id, () =>
                        updateRestaurant({ id: r.id, changes }).unwrap(),
                      );
                      if (ok) setEditing(null);
                    },
                    onDelete: async () => {
                      // Reversible, but it still pulls a storefront offline.
                      if (
                        !confirm(
                          `Delete ${r.name}? It can be restored, and its subdomain stays reserved.`,
                        )
                      )
                        return;
                      await run(r.id, () => deleteRestaurant(r.id).unwrap());
                    },
                    onRestore: () => void run(r.id, () => restoreRestaurant(r.id).unwrap()),
                    onPurge: () => void run(r.id, () => purgeRestaurant(r.id).unwrap()),
                    onActivate: () =>
                      void run(r.id, () => setStatus({ id: r.id, action: "activate" }).unwrap()),
                    onSuspend: () =>
                      void run(r.id, () => setStatus({ id: r.id, action: "suspend" }).unwrap()),
                    onOnboard: async () => {
                      const res = await run(r.id, () => startOnboarding(r.id).unwrap());
                      // Stripe hosts the onboarding form, so this leaves the app.
                      if (res) window.location.href = res.onboarding_url;
                    },
                    onRefreshStripe: async () => {
                      const res = await run(r.id, () => refreshStripe(r.id).unwrap());
                      if (res) setStripeStatus((prev) => ({ ...prev, [r.id]: res }));
                    },
                    onOwner: () => setOwnerFor(r),
                  }}
                />
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
          <div className="overflow-x-auto">
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
                    <td className="py-3">{r.name}</td>
                    <td className="tnum text-right">{r.orders_paid}</td>
                    <td className="tnum text-right">
                      {money(r.gross_revenue_minor, r.currency)}
                    </td>
                    <td className="tnum text-right">
                      {money(r.tax_collected_minor, r.currency)}
                    </td>
                    <td className="tnum text-right">
                      {money(r.average_order_value_minor, r.currency)}
                    </td>
                    <td className="tnum text-right">{r.orders_pending_payment}</td>
                    <td className="tnum text-right">{r.orders_expired}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="mt-8 text-xs text-muted">
        Every read on this page is written to the platform audit log with your user,
        the scope requested, and a correlation id.
      </p>
    </AdminShell>
  );
}
