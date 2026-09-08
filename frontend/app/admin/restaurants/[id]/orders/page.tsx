"use client";

import { useState } from "react";
import Link from "next/link";
import { Empty, ErrorNote, Shell } from "@/components/Shell";
import { money } from "@/lib/format";
import { useAdminResource } from "@/lib/useAdminApi";

type AdminOrder = {
  order_id: string;
  order_number: number;
  status: string;
  total_minor: number;
  tax_minor: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
};

type OrderPage = {
  restaurant_id: string;
  slug: string;
  total: number;
  orders: AdminOrder[];
};

const NAV = [{ href: "/admin", label: "Restaurants" }];
const PAGE_SIZE = 50;

const STATUSES = [
  "",
  "PENDING_PAYMENT",
  "AUTO_ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
];

/** One restaurant's orders, as the platform is permitted to see them.
 *
 *  Narrower than the restaurant's own board on purpose. zenoeats_system holds
 *  column-level SELECT on orders and customer_note, pickup_pin_encrypted and
 *  customer_user_id are not in the grant, so there is nothing to render for
 *  them -- Postgres refuses the read. A platform operator can answer "was this
 *  charged, and when" without reading what a customer wrote.
 */
export default function AdminRestaurantOrdersPage({
  params,
}: {
  params: { id: string };
}) {
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const query = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (status) query.set("status", status);

  const page = useAdminResource<OrderPage>(
    `/admin/restaurants/${params.id}/orders?${query.toString()}`
  );

  const orders = page.data?.orders ?? [];
  const total = page.data?.total ?? 0;

  return (
    <Shell
      title="Orders"
      nav={NAV}
      action={
        <Link className="btn-quiet px-3 py-1.5 text-sm" href="/admin">
          Back
        </Link>
      }
    >
      <ErrorNote message={page.error} />

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
            {STATUSES.map((sv) => (
              <option key={sv || "all"} value={sv}>
                {sv || "All"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {page.loading ? (
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
        Customer notes and pickup PINs are not shown here. The platform database
        role has no permission to read them.
      </p>
    </Shell>
  );
}
