import { useState } from "react";
import { useParams } from "react-router-dom";
import { Empty, ErrorNote } from "@/components/common/Feedback";
import { AdminShell } from "@/features/admin/components/AdminShell";
import { useRestaurantOrdersQuery } from "@/features/admin/adminApi";
import { errorMessage } from "@/services/apiClient";
import { money } from "@/utils/format";

const PAGE_SIZE = 50;

const STATUSES = [
  "",
  "PENDING_PAYMENT",
  "AUTO_ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
];

/**
 * One restaurant's orders, as the platform is permitted to see them.
 *
 * Narrower than the restaurant's own board on purpose. zenoeats_system holds
 * column-level SELECT on orders, and customer_note, pickup_pin_encrypted and
 * customer_user_id are not in the grant -- Postgres refuses the read, so there
 * is nothing to render for them. A platform operator can answer "was this
 * charged, and when" without reading what a customer wrote.
 */
export function AdminOrdersPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const page = useRestaurantOrdersQuery({
    id,
    status: status || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const orders = page.data?.orders ?? [];
  const total = page.data?.total ?? 0;

  return (
    <AdminShell>
      <ErrorNote message={page.error ? errorMessage(page.error) : null} />

      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl">{page.data?.slug ?? "…"}</h2>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Status</span>
          <select
            className="field w-auto py-1.5"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0); // a new filter means a new result set, not page 3 of it
            }}
          >
            {STATUSES.map((s) => (
              <option key={s || "all"} value={s}>
                {s || "All"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {page.isLoading ? (
        <Empty>Loading…</Empty>
      ) : !orders.length ? (
        <Empty>No orders{status ? ` with status ${status}` : ""} yet.</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-hairline text-left text-xs text-muted">
                  <th className="py-2 font-medium">Order</th>
                  <th className="font-medium">Status</th>
                  <th className="font-medium">Payment</th>
                  <th className="text-right font-medium">Tax</th>
                  <th className="text-right font-medium">Total</th>
                  <th className="font-medium">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {orders.map((o) => (
                  <tr key={o.order_id}>
                    <td className="tnum py-3">#{o.order_number}</td>
                    <td className="text-xs">{o.status}</td>
                    <td className="text-xs">
                      {o.payment_status ?? <span className="text-muted">none</span>}
                      {o.stripe_payment_intent_id && (
                        <div className="text-muted">{o.stripe_payment_intent_id}</div>
                      )}
                    </td>
                    <td className="tnum text-right">{money(o.tax_minor, o.currency)}</td>
                    <td className="tnum text-right">{money(o.total_minor, o.currency)}</td>
                    <td className="text-xs text-muted">
                      {new Date(o.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted">
              {offset + 1}–{offset + orders.length} of {total}
            </span>
            <div className="flex gap-2">
              <button
                className="btn-quiet px-3 py-1.5"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <button
                className="btn-quiet px-3 py-1.5"
                disabled={offset + orders.length >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <p className="mt-8 text-xs text-muted">
        Customer notes and pickup PINs are not shown here. The platform database role
        has no permission to read them.
      </p>
    </AdminShell>
  );
}
