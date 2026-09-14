import { useState, type ReactNode } from "react";
import { useAppSelector } from "@/app/hooks";
import { Empty, ErrorNote } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import {
  useCancelOrderMutation,
  useCompleteOrderMutation,
  useMarkReadyMutation,
  useOrderBoardQuery,
  useOverrideCompleteMutation,
  type BoardOrder,
} from "@/features/restaurant/restaurantApi";
import { selectSession } from "@/features/session/sessionSlice";
import { ApiError, errorMessage } from "@/services/apiClient";

/** The roles the API lets override a PIN or cancel a paid order. The server
 *  decides regardless; this only avoids offering a button that would 403. */
const MANAGER_ROLES = ["ADMIN", "MANAGER"];

type Acting = { orderId: string; kind: "override" | "cancel" };

export function KitchenBoardPage() {
  // Polling stands in for WebSockets at MVP volume. Five seconds is well inside
  // the time it takes to read a new ticket. RTK Query supersedes an in-flight
  // request rather than stacking them, so a slow API cannot pile up work.
  const board = useOrderBoardQuery(undefined, { pollingInterval: 5_000 });
  const [markReady] = useMarkReadyMutation();
  const [completeOrder] = useCompleteOrderMutation();
  const [overrideComplete] = useOverrideCompleteMutation();
  const [cancelOrder] = useCancelOrderMutation();
  const { roleCode } = useAppSelector(selectSession);
  const canManage = !!roleCode && MANAGER_ROLES.includes(roleCode);

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
  const preparing = orders.filter((o) => o.status !== "READY_FOR_PICKUP");
  const waiting = orders.filter((o) => o.status === "READY_FOR_PICKUP");

  /** The reason form, when a manager action is open on this ticket. */
  function actionFor(order: BoardOrder): ReactNode {
    if (acting?.orderId !== order.order_id) return null;
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

  return (
    <ManageShell>
      <ErrorNote message={error ?? (board.error ? errorMessage(board.error) : null)} />
      {notice && (
        <p className="mb-4 border-l-2 border-ink bg-paper px-3 py-2 text-sm">{notice}</p>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <Column title={`Making now (${preparing.length})`}>
          {!preparing.length && <Empty>Nothing in the queue.</Empty>}
          {preparing.map((o) => (
            <Ticket key={o.order_id} order={o}>
              {actionFor(o) ?? (
                <>
                  <button
                    className="btn-primary w-full"
                    disabled={busy === o.order_id}
                    onClick={() => ready(o.order_id)}
                  >
                    Mark ready for pickup
                  </button>
                  <div className="mt-2 text-right">{cancelLink(o)}</div>
                </>
              )}
            </Ticket>
          ))}
        </Column>

        <Column title={`Waiting for collection (${waiting.length})`}>
          {!waiting.length && <Empty>Nothing waiting at the counter.</Empty>}
          {waiting.map((o) => (
            <Ticket key={o.order_id} order={o}>
              {actionFor(o) ??
                (o.pin_locked ? (
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
                      <div className="mt-2 flex justify-between">
                        <button
                          className="text-xs text-muted underline"
                          onClick={() => openAction(o.order_id, "override")}
                        >
                          no PIN? hand over without it
                        </button>
                        {cancelLink(o)}
                      </div>
                    )}
                  </>
                ))}
            </Ticket>
          ))}
        </Column>
      </div>

      <p className="mt-8 text-xs text-muted">
        Unpaid orders never reach this board. An order appears only after Stripe
        confirms the payment by webhook.
      </p>
    </ManageShell>
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

function Ticket({ order, children }: { order: BoardOrder; children: ReactNode }) {
  const waited = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
  return (
    <article className="border border-hairline bg-surface p-4">
      <header className="flex items-baseline justify-between gap-3">
        <span className="font-display text-xl">#{order.order_number}</span>
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
