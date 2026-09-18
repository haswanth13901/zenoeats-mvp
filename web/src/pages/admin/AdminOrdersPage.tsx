import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Empty, ErrorNote, Loading } from "@/components/common/Feedback";
import { Icon } from "@/components/common/icons";
import { PageTitle } from "@/components/layout/Shell";
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
      <Link
        to="/admin"
        className="mb-4 inline-flex min-h-[40px] items-center gap-2 text-caption text-muted hover:text-ink"
      >
        <Icon name="back" className="h-4 w-4" />
        Restaurants
      </Link>
      <PageTitle
        title={page.data?.slug ?? "…"}
        subtitle="Restaurant orders"
        right={
          <label className="block w-full sm:w-56">
            <span className="label">Status</span>
            <select
              className="field mt-[7px]"
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
        }
      />

      <ErrorNote message={page.error ? errorMessage(page.error) : null} />

      {page.isLoading ? (
        <Loading />
      ) : !orders.length ? (
        <Empty>No orders{status ? ` with status ${status}` : ""} yet.</Empty>
      ) : (
        <>
          <div className={`card overflow-x-auto py-2 ${page.isFetching ? "opacity-[.48]" : ""}`}>
            <table className="data-table min-w-[750px]">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th className="text-right">Tax</th>
                  <th className="text-right">Total</th>
                  <th>Placed</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.order_id}>
                    <td className="tnum font-semibold">#{o.order_number}</td>
                    <td>
                      <span className="pill">{o.status}</span>
                    </td>
                    <td className="text-caption">
                      {o.payment_status ?? <span className="text-muted">none</span>}
                      {o.stripe_payment_intent_id && (
                        <div className="font-mono text-[11px] text-muted">{o.stripe_payment_intent_id}</div>
                      )}
                    </td>
                    <td className="tnum text-right">{money(o.tax_minor, o.currency)}</td>
                    <td className="tnum text-right">{money(o.total_minor, o.currency)}</td>
                    <td className="whitespace-nowrap text-caption text-muted">
                      {new Date(o.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav
            aria-label="Pages"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
          >
            <span className="tnum text-muted">
              {offset + 1}–{offset + orders.length} of {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-quiet"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <Icon name="back" className="h-4 w-4" />
                Previous
              </button>
              <button
                type="button"
                className="btn-quiet"
                disabled={offset + orders.length >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
                <Icon name="arrow" className="h-4 w-4" />
              </button>
            </div>
          </nav>
        </>
      )}

      <p className="mt-[30px] text-[11px] leading-relaxed text-muted">
        Customer notes and pickup PINs are not shown here. The platform database role
        has no permission to read them.
      </p>
    </AdminShell>
  );
}
