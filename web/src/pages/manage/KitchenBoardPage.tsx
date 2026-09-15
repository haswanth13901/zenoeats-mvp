import { useMemo, useState, type ReactNode } from "react";
import { useAppSelector } from "@/app/hooks";
import { Empty, ErrorNote } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import {
  useAssignDriverMutation,
  useCancelOrderMutation,
  useCompleteOrderMutation,
  useMarkReadyMutation,
  useOrderBoardQuery,
  useDriversQuery,
  useOrderHistoryQuery,
  useOverrideCompleteMutation,
  type BoardOrder,
  type HistoryOrder,
} from "@/features/restaurant/restaurantApi";
import { useNewOrderAlert } from "@/features/restaurant/newOrderAlert";
import { canManage as roleCanManage } from "@/features/restaurant/nav";
import { selectSession } from "@/features/session/sessionSlice";
import { ApiError, errorMessage } from "@/services/apiClient";

type Acting = { orderId: string; kind: "override" | "cancel" | "assign" };

export function KitchenBoardPage() {
  // Polling stands in for WebSockets at MVP volume. Five seconds is well inside
  // the time it takes to read a new ticket. RTK Query supersedes an in-flight
  // request rather than stacking them, so a slow API cannot pile up work.
  const board = useOrderBoardQuery(undefined, { pollingInterval: 5_000 });
  // RTK Query keeps the same array while nothing changed, so this only
  // recomputes when the board does.
  const orderIds = useMemo(() => board.data?.map((o) => o.order_id), [board.data]);
  const alert = useNewOrderAlert(orderIds);
  const [markReady] = useMarkReadyMutation();
  const [completeOrder] = useCompleteOrderMutation();
  const [overrideComplete] = useOverrideCompleteMutation();
  const [cancelOrder] = useCancelOrderMutation();
  const [assignDriver] = useAssignDriverMutation();
  const { roleCode } = useAppSelector(selectSession);
  // Override and cancel are managers only. The server decides regardless;
  // this only avoids offering a button that would 403.
  const canManage = roleCanManage(roleCode);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  // One manager action open at a time, on one ticket, with the reason being
  // typed for it.
  const [acting, setActing] = useState<Acting | null>(null);
  const [reason, setReason] = useState("");

  function clearMessages() {
    setError(null);
    setNotice(null);
  }

  function openAction(orderId: string, kind: Acting["kind"]) {
    clearMessages();
    setPinFor(null);
    setReason("");
    setActing({ orderId, kind });
  }

  async function ready(id: string) {
    setBusy(id);
    clearMessages();
    try {
      await markReady(id).unwrap();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function complete(id: string) {
    setBusy(id);
    clearMessages();
    try {
      await completeOrder({ orderId: id, pin: pin.trim() }).unwrap();
      setPinFor(null);
      setPin("");
    } catch (e) {
      if (e instanceof ApiError && e.code === "PIN_LOCKED") {
        // The ticket turns into its locked state on the next poll; the PIN
        // box would only answer "locked" again.
        setPinFor(null);
        setError(
          canManage
            ? "Five wrong PINs, so this order is locked. You can hand it over without the PIN."
            : "Five wrong PINs, so this order is locked. Ask a manager to hand it over.",
        );
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  }

  async function confirmAction(order: BoardOrder) {
    if (!acting) return;
    setBusy(order.order_id);
    clearMessages();
    try {
      if (acting.kind === "override") {
        await overrideComplete({ orderId: order.order_id, reason: reason.trim() }).unwrap();
        setNotice(`#${order.order_number} handed over without a PIN.`);
      } else {
        const out = await cancelOrder({ orderId: order.order_id, reason: reason.trim() }).unwrap();
        setNotice(
          out.refund_needed
            ? `#${order.order_number} cancelled. The customer has not been refunded: issue the refund from your Stripe Dashboard.`
            : `#${order.order_number} cancelled. Its payment was already refunded.`,
        );
      }
      setActing(null);
      setReason("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const orders = board.data ?? [];
  const cooking = ["AUTO_ACCEPTED", "PREPARING"];
  const preparing = orders.filter((o) => cooking.includes(o.status));
  // Ready: at the counter for a collection, with or waiting for a driver on a
  // delivery. One column, because to the kitchen they are all "done, gone soon".
  const waiting = orders.filter((o) => !cooking.includes(o.status));

  /** The form for whichever manager action is open on this ticket. */
  function actionFor(order: BoardOrder): ReactNode {
    if (acting?.orderId !== order.order_id) return null;
    if (acting.kind === "assign") {
      return (
        <AssignDriverForm
          order={order}
          busy={busy === order.order_id}
          onBack={() => setActing(null)}
          onAssign={async (membership_id, delivery_address) => {
            setBusy(order.order_id);
            clearMessages();
            try {
              const out = await assignDriver({
                orderId: order.order_id,
                membership_id,
                delivery_address,
              }).unwrap();
              setNotice(`#${order.order_number} is ${out.driver}'s delivery.`);
              setActing(null);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(null);
            }
          }}
        />
      );
    }
    return (
      <ReasonForm
        kind={acting.kind}
        order={order}
        reason={reason}
        busy={busy === order.order_id}
        onReason={setReason}
        onConfirm={() => void confirmAction(order)}
        onBack={() => setActing(null)}
      />
    );
  }

  const cancelLink = (order: BoardOrder) =>
    canManage && (
      <button
        className="text-xs text-muted underline"
        onClick={() => openAction(order.order_id, "cancel")}
      >
        cancel order
      </button>
    );

  /** Hand the order to a driver, or hand it to a different one. */
  const driverLink = (order: BoardOrder) =>
    canManage && (
      <button
        className="text-xs text-muted underline"
        onClick={() => openAction(order.order_id, "assign")}
      >
        {order.fulfillment_type === "DELIVERY" ? "change driver" : "assign driver"}
      </button>
    );

  return (
    <ManageShell>
      <ErrorNote message={error ?? (board.error ? errorMessage(board.error) : null)} />
      {notice && (
        <p className="mb-4 border-l-2 border-ink bg-paper px-3 py-2 text-sm">{notice}</p>
      )}

      <div className="mb-4 flex items-center justify-end gap-3 text-xs">
        {alert.soundReady ? (
          <>
            <span className="text-muted">Sound on for new orders</span>
            <button className="text-muted underline" onClick={alert.disableSound}>
              turn off
            </button>
          </>
        ) : (
          <button className="btn-quiet px-3 py-1.5 text-sm" onClick={() => void alert.enableSound()}>
            {alert.soundWanted ? "Tap to turn sound back on" : "Turn on sound for new orders"}
          </button>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Column title={`Making now (${preparing.length})`}>
          {!preparing.length && <Empty>Nothing in the queue.</Empty>}
          {preparing.map((o) => (
            <Ticket
              key={o.order_id}
              order={o}
              fresh={o.order_id in alert.fresh}
              onSeen={() => alert.acknowledge(o.order_id)}
            >
              {actionFor(o) ?? (
                <>
                  <button
                    className="btn-primary w-full"
                    disabled={busy === o.order_id}
                    onClick={() => ready(o.order_id)}
                  >
                    {o.fulfillment_type === "DELIVERY"
                      ? "Mark ready for the driver"
                      : "Mark ready for pickup"}
                  </button>
                  <div className="mt-2 flex justify-end gap-3">
                    {driverLink(o)}
                    {cancelLink(o)}
                  </div>
                </>
              )}
            </Ticket>
          ))}
        </Column>

        <Column title={`Ready (${waiting.length})`}>
          {!waiting.length && <Empty>Nothing ready for the counter or a driver.</Empty>}
          {waiting.map((o) => (
            <Ticket
              key={o.order_id}
              order={o}
              fresh={o.order_id in alert.fresh}
              onSeen={() => alert.acknowledge(o.order_id)}
            >
              {actionFor(o) ??
                (o.fulfillment_type === "DELIVERY" ? (
                  <div>
                    <p className="text-sm">
                      {o.status === "OUT_FOR_DELIVERY"
                        ? `On the road with ${o.driver ?? "a driver"}.`
                        : o.driver
                          ? `Waiting for ${o.driver} to pick it up.`
                          : "Ready, but no driver assigned yet."}
                    </p>
                    <div className="mt-2 flex justify-end gap-3">
                      {driverLink(o)}
                      {cancelLink(o)}
                    </div>
                  </div>
                ) : o.pin_locked ? (
                  <div>
                    <p className="text-sm text-brick">
                      Locked after five wrong PINs.
                      {!canManage && " Ask a manager to hand it over."}
                    </p>
                    {canManage && (
                      <button
                        className="btn-primary mt-3 w-full"
                        onClick={() => openAction(o.order_id, "override")}
                      >
                        Hand over without PIN
                      </button>
                    )}
                    <div className="mt-2 text-right">{cancelLink(o)}</div>
                  </div>
                ) : pinFor === o.order_id ? (
                  <div className="flex gap-2">
                    <input
                      className="field tnum tracking-[0.3em]"
                      value={pin}
                      inputMode="numeric"
                      maxLength={6}
                      autoFocus
                      placeholder="······"
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    />
                    <button
                      className="btn-primary"
                      disabled={pin.length !== 6 || busy === o.order_id}
                      onClick={() => complete(o.order_id)}
                    >
                      Hand over
                    </button>
                    <button className="btn-quiet" onClick={() => setPinFor(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      className="btn-quiet w-full"
                      onClick={() => {
                        setPinFor(o.order_id);
                        setPin("");
                        setActing(null);
                        clearMessages();
                      }}
                    >
                      Collect with PIN
                    </button>
                    {canManage && (
                      <div className="mt-2 flex flex-wrap justify-between gap-3">
                        <button
                          className="text-xs text-muted underline"
                          onClick={() => openAction(o.order_id, "override")}
                        >
                          no PIN? hand over without it
                        </button>
                        <span className="flex gap-3">
                          {driverLink(o)}
                          {cancelLink(o)}
                        </span>
                      </div>
                    )}
                  </>
                ))}
            </Ticket>
          ))}
        </Column>
      </div>

      <TodayHistory />

      <p className="mt-8 text-xs text-muted">
        Unpaid orders never reach this board. An order appears only after Stripe
        confirms the payment by webhook.
      </p>
    </ManageShell>
  );
}

/**
 * Give an order to one of the restaurant's drivers, with the address.
 *
 * The address is typed here because a customer cannot order a delivery in this
 * build: it is what the restaurant was told on the phone. Assigning is what
 * makes the order a delivery, so the same form serves "assign" and "change
 * driver", starting from whatever the order already says.
 */
function AssignDriverForm({
  order,
  busy,
  onAssign,
  onBack,
}: {
  order: BoardOrder;
  busy: boolean;
  onAssign: (membershipId: string, address: string) => void;
  onBack: () => void;
}) {
  const drivers = useDriversQuery();
  const [membershipId, setMembershipId] = useState("");
  const [address, setAddress] = useState(order.delivery_address ?? "");

  const options = drivers.data ?? [];

  return (
    <div className="border-t border-hairline pt-3">
      <p className="text-sm">
        Send <span className="font-medium">#{order.order_number}</span> out with a driver.
        They see this order and its address, and nothing else of the portal.
      </p>
      {drivers.isLoading ? (
        <p className="mt-3 text-sm text-muted">Loading drivers…</p>
      ) : !options.length ? (
        <p className="mt-3 text-sm text-brick">
          No drivers on the team yet. An admin can invite one from the Staff page.
        </p>
      ) : (
        <>
          <select
            className="field mt-3 text-sm"
            value={membershipId}
            aria-label="Driver"
            onChange={(e) => setMembershipId(e.target.value)}
          >
            <option value="">Choose a driver…</option>
            {options.map((driver) => (
              <option key={driver.membership_id} value={driver.membership_id}>
                {driver.name}
              </option>
            ))}
          </select>
          <input
            className="field mt-2 text-sm"
            value={address}
            maxLength={300}
            placeholder="Delivery address, as the customer gave it"
            onChange={(e) => setAddress(e.target.value)}
          />
        </>
      )}
      <div className="mt-3 flex items-center gap-4">
        <button
          className="btn-primary px-3 py-1.5 text-sm"
          disabled={busy || !membershipId || address.trim().length < 3}
          onClick={() => onAssign(membershipId, address.trim())}
        >
          {busy ? "Saving…" : "Assign"}
        </button>
        <button className="text-xs underline" disabled={busy} onClick={onBack}>
          back
        </button>
      </div>
    </div>
  );
}

/**
 * The two things only a manager can do to a ticket, each with the reason it is
 * kept under. Inline on the ticket rather than a dialog: the board is a
 * shared screen, and the ticket being acted on should stay in sight.
 */
function ReasonForm({
  kind,
  order,
  reason,
  busy,
  onReason,
  onConfirm,
  onBack,
}: {
  kind: Acting["kind"];
  order: BoardOrder;
  reason: string;
  busy: boolean;
  onReason: (value: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const refunded = order.payment_status === "REFUNDED";
  return (
    <div className="border-t border-hairline pt-3">
      {kind === "override" ? (
        <p className="text-sm">
          Hand <span className="font-medium">#{order.order_number}</span> over without the
          customer&apos;s PIN. Check it is theirs first, by name or their order confirmation.
          Your name and reason are kept with the order.
        </p>
      ) : (
        <p className="text-sm">
          Cancel <span className="font-medium">#{order.order_number}</span>.{" "}
          {refunded ? (
            "Its payment has already been refunded."
          ) : (
            <span className="text-brick">
              This does not refund the customer. Issue the refund from your Stripe Dashboard.
            </span>
          )}
        </p>
      )}
      <input
        className="field mt-3 text-sm"
        value={reason}
        autoFocus
        maxLength={200}
        placeholder={
          kind === "override" ? "Why? e.g. phone died, checked name" : "Why? e.g. never collected"
        }
        onChange={(e) => onReason(e.target.value)}
      />
      <div className="mt-3 flex items-center gap-4">
        <button
          className="btn-primary px-3 py-1.5 text-sm"
          disabled={busy || reason.trim().length < 3}
          onClick={onConfirm}
        >
          {kind === "override" ? "Hand over without PIN" : "Cancel order"}
        </button>
        <button className="text-xs underline" disabled={busy} onClick={onBack}>
          back
        </button>
      </div>
    </div>
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

function Ticket({
  order,
  fresh,
  onSeen,
  children,
}: {
  order: BoardOrder;
  fresh?: boolean;
  onSeen?: () => void;
  children: ReactNode;
}) {
  // From payment, which is when the order reached the kitchen. From checkout
  // start, a customer slow at the card step made the ticket look late on
  // arrival.
  const since = order.paid_at ?? order.created_at;
  const waited = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
  return (
    <article
      className={`bg-surface p-4 ${fresh ? "border-2 border-brick" : "border border-hairline"}`}
      onClick={onSeen}
    >
      <header className="flex items-baseline justify-between gap-3">
        <span className="font-display text-xl">#{order.order_number}</span>
        {fresh && (
          <span className="rounded bg-brick px-2 py-0.5 text-xs font-medium text-white">new</span>
        )}
        {order.fulfillment_type === "DELIVERY" && (
          <span className="rounded bg-ink px-2 py-0.5 text-xs text-white">delivery</span>
        )}
        {/* A refund in the Stripe Dashboard never moves the order, so this is
            the only sign on the board that nobody is paying for it now. */}
        {(order.payment_status === "REFUNDED" ||
          order.payment_status === "PARTIALLY_REFUNDED") && (
          <span className="rounded bg-brick/10 px-2 py-0.5 text-xs text-brick">
            {order.payment_status === "REFUNDED" ? "refunded" : "partly refunded"}
          </span>
        )}
        <span className="flex-1" />
        <span className={`text-xs ${waited > 15 ? "text-brick" : "text-muted"}`}>
          {waited < 1 ? "just now" : `${waited} min ago`}
        </span>
      </header>

      <ul className="mt-3 space-y-2 border-t border-hairline pt-3">
        {groupTicket(order.items).map((entry, i) =>
          entry.kind === "combo" ? (
            // One block, indented under the deal's name. Three items listed
            // loose would be plated as three separate orders, and the drink
            // would go out while the burger was still on the grill.
            <li key={i} className="flex gap-3 text-sm">
              <span className="tnum w-6 shrink-0 font-medium">{entry.quantity}×</span>
              <div>
                <div className="font-medium">{entry.name}</div>
                <ul className="mt-0.5 border-l-2 border-hairline pl-2">
                  {entry.items.map((item, j) => (
                    <li key={j}>
                      <div>{item.name}</div>
                      {item.modifiers.length > 0 && (
                        <div className="text-muted">{item.modifiers.join(" · ")}</div>
                      )}
                      {item.note && <div className="text-brick">{item.note}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ) : (
            <li key={i} className="flex gap-3 text-sm">
              <span className="tnum w-6 shrink-0 font-medium">{entry.item.quantity}×</span>
              <div>
                <div>{entry.item.name}</div>
                {entry.item.modifiers.length > 0 && (
                  <div className="text-muted">{entry.item.modifiers.join(" · ")}</div>
                )}
                {entry.item.note && <div className="text-brick">{entry.item.note}</div>}
              </div>
            </li>
          ),
        )}
      </ul>

      {order.fulfillment_type === "DELIVERY" && (
        <p className="mt-3 border-t border-hairline pt-3 text-sm">
          {order.delivery_address}
          <span className="text-muted"> · {order.driver ?? "no driver yet"}</span>
        </p>
      )}

      {order.customer_note && (
        <p className="mt-3 border-t border-hairline pt-3 text-sm text-brick">
          {order.customer_note}
        </p>
      )}

      <div className="mt-4">{children}</div>
    </article>
  );
}


type TicketLine = BoardOrder["items"][number];

type TicketEntry =
  | { kind: "item"; item: TicketLine }
  | { kind: "combo"; name: string; quantity: number; items: TicketLine[] };

/**
 * Fold a ticket's lines so a combo reads as one thing.
 *
 * A combo is stored as one line per slot, because the kitchen plates items
 * rather than abstractions and a receipt has to price them. On the board that
 * has to be put back together: lines sharing a combo group are one meal deal,
 * and the order of everything else is preserved exactly as it was sent.
 *
 * The quantity is the deal's, not the sum of its parts. Two burger meals is
 * two, whatever three items each contains.
 */
export function groupTicket(items: TicketLine[]): TicketEntry[] {
  const entries: TicketEntry[] = [];
  const combos = new Map<number, TicketEntry & { kind: "combo" }>();

  for (const item of items) {
    if (item.combo_group == null) {
      entries.push({ kind: "item", item });
      continue;
    }

    const existing = combos.get(item.combo_group);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    // The first line of a combo holds its place in the ticket, so a deal
    // ordered before a loose item still reads first.
    const entry: TicketEntry & { kind: "combo" } = {
      kind: "combo",
      name: item.combo_name ?? "Combo",
      quantity: item.quantity,
      items: [item],
    };
    combos.set(item.combo_group, entry);
    entries.push(entry);
  }

  return entries;
}


const FINISHED: Record<string, string> = {
  COMPLETED_WITH_PIN: "handed over",
  COMPLETED_BY_OVERRIDE: "handed over without PIN",
  CANCELLED: "cancelled",
};

/**
 * Today's orders that have left the board.
 *
 * Once handed over or cancelled, an order used to vanish from every screen the
 * counter has, so "I ordered twenty minutes ago -- where is it?" had no answer.
 * Searchable by order number, which is what a customer reads out.
 */
function TodayHistory() {
  const history = useOrderHistoryQuery(undefined, { pollingInterval: 30_000 });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const orders = history.data?.orders ?? [];
  const needle = search.replace(/\D/g, "");
  const shown = needle ? orders.filter((o) => String(o.order_number).includes(needle)) : orders;

  return (
    <section className="mt-10 border-t border-hairline pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button className="text-sm font-medium" onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} Done today ({orders.length})
        </button>
        {open && orders.length > 0 && (
          <input
            className="field w-40 py-1 text-sm"
            inputMode="numeric"
            placeholder="Order number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </div>

      {open && (
        <div className="mt-3">
          {history.error ? (
            <ErrorNote message={errorMessage(history.error)} />
          ) : !orders.length ? (
            <Empty>Nothing handed over or cancelled yet today.</Empty>
          ) : !shown.length ? (
            <Empty>No order today matches #{needle}.</Empty>
          ) : (
            <ul className="divide-y divide-hairline border border-hairline bg-surface">
              {shown.map((o) => (
                <HistoryRow key={o.order_id} order={o} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function HistoryRow({ order }: { order: HistoryOrder }) {
  const action = order.last_action;
  const what =
    (action && FINISHED[action.action]) ??
    (order.status === "CANCELLED" ? "cancelled" : "handed over");
  const time = new Date(order.finished_at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const summary = order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ");

  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
      <span className="font-display w-16">#{order.order_number}</span>
      <span className={order.status === "CANCELLED" ? "text-brick" : undefined}>
        {what} {time}
        {action?.by && <span className="text-muted"> · {action.by}</span>}
      </span>
      {(order.payment_status === "REFUNDED" || order.payment_status === "PARTIALLY_REFUNDED") && (
        <span className="rounded bg-brick/10 px-2 py-0.5 text-xs text-brick">
          {order.payment_status === "REFUNDED" ? "refunded" : "partly refunded"}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-muted">{summary}</span>
      {action?.reason && (
        <span className="w-full text-xs text-muted">Reason: {action.reason}</span>
      )}
    </li>
  );
}
