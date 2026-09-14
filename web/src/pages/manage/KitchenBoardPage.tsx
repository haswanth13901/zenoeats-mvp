import { useState, type ReactNode } from "react";
import { Empty, ErrorNote } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import {
  useCompleteOrderMutation,
  useMarkReadyMutation,
  useOrderBoardQuery,
  type BoardOrder,
} from "@/features/restaurant/restaurantApi";
import { ApiError, errorMessage } from "@/services/apiClient";

export function KitchenBoardPage() {
  // Polling stands in for WebSockets at MVP volume. Five seconds is well inside
  // the time it takes to read a new ticket. RTK Query supersedes an in-flight
  // request rather than stacking them, so a slow API cannot pile up work.
  const board = useOrderBoardQuery(undefined, { pollingInterval: 5_000 });
  const [markReady] = useMarkReadyMutation();
  const [completeOrder] = useCompleteOrderMutation();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState("");

  async function ready(id: string) {
    setBusy(id);
    setError(null);
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
    setError(null);
    try {
      await completeOrder({ orderId: id, pin: pin.trim() }).unwrap();
      setPinFor(null);
      setPin("");
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "PIN_LOCKED"
          ? "Five failed attempts. A manager has to override this one."
          : errorMessage(e),
      );
    } finally {
      setBusy(null);
    }
  }

  const orders = board.data ?? [];
  const preparing = orders.filter((o) => o.status !== "READY_FOR_PICKUP");
  const waiting = orders.filter((o) => o.status === "READY_FOR_PICKUP");

  return (
    <ManageShell>
      <ErrorNote message={error ?? (board.error ? errorMessage(board.error) : null)} />

      <div className="grid gap-8 lg:grid-cols-2">
        <Column title={`Making now (${preparing.length})`}>
          {!preparing.length && <Empty>Nothing in the queue.</Empty>}
          {preparing.map((o) => (
            <Ticket key={o.order_id} order={o}>
              <button
                className="btn-primary w-full"
                disabled={busy === o.order_id}
                onClick={() => ready(o.order_id)}
              >
                Mark ready for pickup
              </button>
            </Ticket>
          ))}
        </Column>

        <Column title={`Waiting for collection (${waiting.length})`}>
          {!waiting.length && <Empty>Nothing waiting at the counter.</Empty>}
          {waiting.map((o) => (
            <Ticket key={o.order_id} order={o}>
              {pinFor === o.order_id ? (
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
                <button
                  className="btn-quiet w-full"
                  onClick={() => {
                    setPinFor(o.order_id);
                    setPin("");
                    setError(null);
                  }}
                >
                  Collect with PIN
                </button>
              )}
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
      <header className="flex items-baseline justify-between">
        <span className="font-display text-xl">#{order.order_number}</span>
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
