import { useState, type ReactNode } from "react";
import { useAppSelector } from "@/app/hooks";
import { Empty, ErrorNote, Loading, Spinner } from "@/components/common/Feedback";
import { PageTitle } from "@/components/layout/Shell";
import { BoardColumn } from "@/features/restaurant/components/BoardColumn";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import { isDriver as roleIsDriver } from "@/features/restaurant/nav";
import {
  useDeliveredMutation,
  useDeliveriesQuery,
  usePickedUpMutation,
  type Delivery,
} from "@/features/restaurant/restaurantApi";
import { selectSession } from "@/features/session/sessionSlice";
import { useShareDriverLocation, type SharingState } from "@/features/restaurant/useShareDriverLocation";
import { errorMessage } from "@/services/apiClient";
import { money } from "@/utils/format";

/** A delivery is expected to take longer than a collection, so it is late
 *  later: thirty minutes rather than the board's fifteen. */
const OVERDUE_MINUTES = 30;

/**
 * The deliveries a restaurant is running itself.
 *
 * Orders customers chose delivery for at checkout, and orders a manager agreed
 * over the phone to send out, once a manager has handed them to one of the
 * restaurant's own drivers.
 *
 * For a driver this is the whole portal: the orders assigned to them, what is
 * in each, where it goes, who to call, and the two buttons that move it. They
 * see nothing of the board, the menu, stock, reports or the team -- the API
 * refuses all of it, and the tabs do not offer it. It is built for a phone
 * held in one hand outdoors: address first and large, 60px buttons.
 *
 * While a driver has an order on the road, this page shares the phone's
 * position so the customer can watch it arrive. It stops the moment nothing
 * is on the road.
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
  const { roleCode, restaurantName } = useAppSelector(selectSession);
  const driver = roleIsDriver(roleCode);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Said once the server has confirmed the move, never before.
  const [announcement, setAnnouncement] = useState("");

  async function move(order: Delivery, step: "pick-up" | "deliver") {
    setBusy(order.order_id);
    setError(null);
    try {
      if (step === "pick-up") await pickedUp(order.order_id).unwrap();
      else await delivered(order.order_id).unwrap();
      setAnnouncement(
        step === "pick-up"
          ? `#${order.order_number} picked up. It is on the road.`
          : `#${order.order_number} delivered.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const orders = deliveries.data ?? [];
  const waiting = orders.filter((o) => o.status !== "OUT_FOR_DELIVERY");
  const onTheRoad = orders.filter((o) => o.status === "OUT_FOR_DELIVERY");
  // Only the driver carrying it shares a position. A manager pressing the
  // buttons for them is not where the food is.
  const carrying = onTheRoad.some((o) => o.mine);
  const sharing = useShareDriverLocation(carrying);

  return (
    <ManageShell>
      <PageTitle
        title={driver ? "My deliveries" : "Delivery overview"}
        subtitle={
          driver
            ? `${restaurantName ? `${restaurantName} · ` : ""}your assigned orders`
            : "Every driver. Every delivery."
        }
        right={<span className="pill">{driver ? "Driver" : "Manager view"}</span>}
      />

      <ErrorNote message={error ?? (deliveries.error ? errorMessage(deliveries.error) : null)} />
      {carrying && <SharingNote state={sharing} />}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {deliveries.isLoading ? (
        <Loading />
      ) : !orders.length ? (
        <Empty>
          {driver
            ? "Nothing assigned to you right now."
            : "No deliveries running. Assign one from a ticket on the Kitchen board."}
        </Empty>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-7 lg:grid-cols-2">
          <BoardColumn title="To collect from the kitchen" count={waiting.length} dot="bg-brick">
            {!waiting.length && <Empty>Nothing waiting.</Empty>}
            {waiting.map((order) => (
              <Card key={order.order_id} order={order} showDriver={!driver}>
                {order.status === "READY_FOR_DELIVERY" ? (
                  <button
                    type="button"
                    className="btn-primary min-h-[60px] w-full text-[17px]"
                    disabled={busy === order.order_id}
                    onClick={() => void move(order, "pick-up")}
                  >
                    {busy === order.order_id && <Spinner />}
                    {busy === order.order_id ? "Saving…" : "Picked up"}
                  </button>
                ) : (
                  // No button before the kitchen marks it ready: there is
                  // nothing to pick up yet.
                  <p className="note">
                    Still being made. It can be picked up once the kitchen marks it ready.
                  </p>
                )}
              </Card>
            ))}
          </BoardColumn>

          <BoardColumn title="On the road" count={onTheRoad.length} dot="bg-success">
            {!onTheRoad.length && <Empty>Nothing out for delivery.</Empty>}
            {onTheRoad.map((order) => (
              <Card key={order.order_id} order={order} showDriver={!driver}>
                <button
                  type="button"
                  className="btn-primary min-h-[60px] w-full text-[17px]"
                  disabled={busy === order.order_id}
                  onClick={() => void move(order, "deliver")}
                >
                  {busy === order.order_id && <Spinner />}
                  {busy === order.order_id ? "Saving…" : "Delivered"}
                </button>
              </Card>
            ))}
          </BoardColumn>
        </div>
      )}

      <p className="mt-[22px] max-w-[780px] text-caption text-muted">
        {driver
          ? "Only the orders assigned to you appear here. There is no PIN at a doorstep: pressing Delivered is what completes the order, and it is recorded against you."
          : "Deliveries customers ordered at checkout, and phone orders a manager sent out. Assign drivers from the Kitchen board."}
      </p>
    </ManageShell>
  );
}

/** Whether the customer can see this driver on their map, and if not, the
 *  one thing that would fix it. */
function SharingNote({ state }: { state: SharingState }) {
  if (state === "sharing") {
    return (
      <p className="note-success mb-4 flex items-center gap-2.5" role="status">
        <span className="h-2 w-2 shrink-0 animate-pending rounded-full bg-success" aria-hidden />
        Sharing your location with your customer. Keep this page open while you drive.
      </p>
    );
  }
  if (state === "starting" || state === "idle") {
    return (
      <p className="note mb-4" role="status">
        Finding your location… Allow location access if your phone asks.
      </p>
    );
  }
  const message =
    state === "denied"
      ? "Location is blocked for this site, so your customer can't see you on their map. Allow location in your browser's site settings."
      : state === "unavailable"
        ? "Your location isn't available. Check that location is on, and that this page is open over https."
        : "Your location isn't reaching the restaurant. Check your connection; it will retry by itself.";
  return (
    <p className="note-warning mb-4" role="alert">
      {message}
    </p>
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
  const late = waited > OVERDUE_MINUTES;

  return (
    <article
      aria-label={`Order ${order.order_number}`}
      className={`animate-arrive rounded-[13px] border border-hairline bg-surface p-5 shadow-card sm:p-6 ${
        late ? "border-t-[3px] border-t-danger" : ""
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <span className="font-display text-[31px] leading-none">#{order.order_number}</span>
        <span className={`whitespace-nowrap text-caption ${late ? "font-[650] text-danger" : "text-muted"}`}>
          {waited < 1 ? "just now" : `${waited} min ago`}
        </span>
      </header>

      {/* The address first: it is what the driver is here for. */}
      <p
        className="mb-2 mt-[23px] text-[22px] font-semibold leading-[1.4] tracking-[-.5px] sm:text-[23px]"
        style={{ overflowWrap: "anywhere" }}
      >
        {order.delivery_address ?? "No address"}
      </p>
      {/* Who is expecting it, and a number to ring from the doorstep. */}
      {order.contact_name && (
        <p className="text-sm" style={{ overflowWrap: "anywhere" }}>
          {order.contact_name}
          {order.contact_phone && (
            <>
              {" · "}
              <a className="link link-inline" href={`tel:${order.contact_phone.replace(/[^\d+]/g, "")}`}>
                {order.contact_phone}
              </a>
            </>
          )}
        </p>
      )}
      {/* A driver does not need to be told who they are. */}
      {showDriver && <p className="text-caption text-muted">{order.driver ?? "No driver assigned"}</p>}

      <ul className="my-6 flex flex-col gap-2.5 border-y border-hairline py-5 text-sm">
        {order.items.map((item, i) => (
          <li key={i}>
            <p className="font-semibold">
              <span className="tnum">{item.quantity}×</span>{" "}
              {item.combo_name ? `${item.combo_name}: ${item.name}` : item.name}
            </p>
            {item.modifiers.length > 0 && (
              <p className="text-caption text-muted">{item.modifiers.join(" · ")}</p>
            )}
            {item.note && <p className="text-caption text-danger">{item.note}</p>}
          </li>
        ))}
      </ul>

      {order.customer_note && (
        <p className="-mt-6 mb-5 border-b border-hairline pb-[18px] pt-3.5 text-sm text-danger">
          {order.customer_note}
        </p>
      )}

      {/* Paid online, so the driver collects nothing at the door. */}
      <p className="mb-5 text-[13px] text-muted">
        <strong className="tnum font-display text-[26px] font-normal text-ink">
          {money(order.total_minor, order.currency)}
        </strong>{" "}
        · paid online
      </p>

      {children}
    </article>
  );
}
