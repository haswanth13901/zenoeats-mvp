import { useState, type ReactNode } from "react";
import { useAppSelector } from "@/app/hooks";
import { Empty, ErrorNote } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import { isDriver as roleIsDriver } from "@/features/restaurant/nav";
import {
  useDeliveredMutation,
  useDeliveriesQuery,
  usePickedUpMutation,
  type Delivery,
} from "@/features/restaurant/restaurantApi";
import { selectSession } from "@/features/session/sessionSlice";
import { errorMessage } from "@/services/apiClient";
import { money } from "@/utils/format";

/**
 * The deliveries a restaurant is running itself.
 *
 * A customer cannot order a delivery in this build, so these are the orders a
 * manager agreed over the phone to send out and handed to one of the
 * restaurant's own drivers.
 *
 * For a driver this is the whole portal: the orders assigned to them, what is
 * in each, where it goes, and the two buttons that move it. They see nothing
 * of the board, the menu, stock, reports or the team -- the API refuses all of
 * it, and the tabs do not offer it.
 *
 * A manager sees every delivery in play, with who is running it, and can press
 * the same two buttons for a driver whose hands are full.
 */
export function DeliveriesPage() {
  // The same five seconds as the board: a driver waits on the kitchen, and a
  // manager wants to see a delivery leave without reloading.
  const deliveries = useDeliveriesQuery(undefined, { pollingInterval: 5_000 });
  const [pickedUp] = usePickedUpMutation();
  const [delivered] = useDeliveredMutation();
  const { roleCode } = useAppSelector(selectSession);
  const driver = roleIsDriver(roleCode);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(order: Delivery, step: "pick-up" | "deliver") {
    setBusy(order.order_id);
    setError(null);
    try {
      if (step === "pick-up") await pickedUp(order.order_id).unwrap();
      else await delivered(order.order_id).unwrap();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const orders = deliveries.data ?? [];
  const waiting = orders.filter((o) => o.status !== "OUT_FOR_DELIVERY");
  const onTheRoad = orders.filter((o) => o.status === "OUT_FOR_DELIVERY");

  return (
    <ManageShell>
      <ErrorNote
        message={error ?? (deliveries.error ? errorMessage(deliveries.error) : null)}
      />

      {deliveries.isLoading ? (
        <Empty>Loading…</Empty>
      ) : !orders.length ? (
        <Empty>
          {driver
            ? "Nothing assigned to you right now."
            : "No deliveries running. Assign one from a ticket on the Kitchen board."}
        </Empty>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <Column title={`To collect from the kitchen (${waiting.length})`}>
            {!waiting.length && <Empty>Nothing waiting.</Empty>}
            {waiting.map((order) => (
              <Card key={order.order_id} order={order} showDriver={!driver}>
                {order.status === "READY_FOR_DELIVERY" ? (
                  <button
                    className="btn-primary w-full"
                    disabled={busy === order.order_id}
                    onClick={() => void move(order, "pick-up")}
                  >
                    {busy === order.order_id ? "Saving…" : "Picked up"}
                  </button>
                ) : (
                  <p className="text-sm text-muted">
                    Still being made. It can be picked up once the kitchen marks it ready.
                  </p>
                )}
              </Card>
            ))}
          </Column>

          <Column title={`On the road (${onTheRoad.length})`}>
            {!onTheRoad.length && <Empty>Nothing out for delivery.</Empty>}
            {onTheRoad.map((order) => (
              <Card key={order.order_id} order={order} showDriver={!driver}>
                <button
                  className="btn-primary w-full"
                  disabled={busy === order.order_id}
                  onClick={() => void move(order, "deliver")}
                >
                  {busy === order.order_id ? "Saving…" : "Delivered"}
                </button>
              </Card>
            ))}
          </Column>
        </div>
      )}

      <p className="mt-8 text-xs text-muted">
        {driver
          ? "Only the orders assigned to you appear here. There is no PIN at a doorstep: pressing Delivered is what completes the order, and it is recorded against you."
          : "Customers cannot order a delivery. These are orders a manager assigned to a driver, with the address taken by phone."}
      </p>
    </ManageShell>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Card({
  order,
  showDriver,
  children,
}: {
  order: Delivery;
  showDriver: boolean;
  children: ReactNode;
}) {
  const since = order.paid_at ?? order.created_at;
  const waited = Math.floor((Date.now() - new Date(since).getTime()) / 60000);

  return (
    <article className="border border-hairline bg-surface p-4">
      <header className="flex items-baseline justify-between gap-3">
        <span className="font-display text-xl">#{order.order_number}</span>
        <span className={`text-xs ${waited > 30 ? "text-brick" : "text-muted"}`}>
          {waited < 1 ? "just now" : `${waited} min ago`}
        </span>
      </header>

      {/* The address first: it is what the driver is here for. */}
      <p className="mt-2 text-sm font-medium">{order.delivery_address ?? "No address"}</p>
      {showDriver && (
        <p className="text-xs text-muted">{order.driver ?? "No driver assigned"}</p>
      )}

      <ul className="mt-3 space-y-2 border-t border-hairline pt-3 text-sm">
        {order.items.map((item, i) => (
          <li key={i} className="flex gap-3">
            <span className="tnum w-6 shrink-0 font-medium">{item.quantity}×</span>
            <div>
              <div>{item.combo_name ? `${item.combo_name}: ${item.name}` : item.name}</div>
              {item.modifiers.length > 0 && (
                <div className="text-muted">{item.modifiers.join(" · ")}</div>
              )}
              {item.note && <div className="text-brick">{item.note}</div>}
            </div>
          </li>
        ))}
      </ul>

      {order.customer_note && (
        <p className="mt-3 border-t border-hairline pt-3 text-sm text-brick">
          {order.customer_note}
        </p>
      )}

      <p className="mt-3 text-xs text-muted">
        {money(order.total_minor, order.currency)} · paid online
      </p>

      <div className="mt-4">{children}</div>
    </article>
  );
}
