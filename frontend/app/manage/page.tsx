"use client";

import { useState } from "react";
import { Empty, ErrorNote, Shell } from "@/components/Shell";
import { ApiError, errorMessage } from "@/lib/api";
import { money } from "@/lib/format";
import { useStaffResource } from "@/lib/useStaffApi";
import { MANAGE_NAV } from "./nav";

type BoardOrder = {
  order_id: string;
  order_number: number;
  status: string;
  total_minor: number;
  currency: string;
  created_at: string;
  customer_note: string | null;
  items: { name: string; quantity: number; note: string | null; modifiers: string[] }[];
};

export default function KitchenBoard() {
  // Polling stands in for WebSockets at MVP volume. Five seconds is well
  // inside the time it takes to read a new ticket.
  const board = useStaffResource<BoardOrder[]>("/restaurant/orders", 5000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState("");

  async function markReady(id: string) {
    setBusy(id);
    setError(null);
    try {
      await board.call(`/restaurant/orders/${id}/ready`, { method: "POST" });
      await board.refresh();
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
      await board.call(
        `/restaurant/orders/${id}/complete?pin=${encodeURIComponent(pin.trim())}`,
        { method: "POST" }
      );
      setPinFor(null);
      setPin("");
      await board.refresh();
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.code === "PIN_LOCKED"
          ? "Five failed attempts. A manager has to override this one."
          : err.message
      );
    } finally {
      setBusy(null);
    }
  }

  const preparing = (board.data ?? []).filter((o) => o.status !== "READY_FOR_PICKUP");
  const ready = (board.data ?? []).filter((o) => o.status === "READY_FOR_PICKUP");

  return (
    <Shell title="Kitchen" nav={MANAGE_NAV}>
      <ErrorNote message={error ?? board.error} />

      <div className="grid gap-8 lg:grid-cols-2">
        <Column title={`Making now (${preparing.length})`}>
          {!preparing.length && <Empty>Nothing in the queue.</Empty>}
          {preparing.map((o) => (
            <Ticket key={o.order_id} order={o}>
              <button
                className="btn-primary w-full"
                disabled={busy === o.order_id}
                onClick={() => markReady(o.order_id)}
              >
                Mark ready for pickup
              </button>
            </Ticket>
          ))}
        </Column>

        <Column title={`Waiting for collection (${ready.length})`}>
          {!ready.length && <Empty>Nothing waiting at the counter.</Empty>}
          {ready.map((o) => (
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
    </Shell>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Ticket({ order, children }: { order: BoardOrder; children: React.ReactNode }) {
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
        {order.items.map((item, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="tnum w-6 shrink-0 font-medium">{item.quantity}×</span>
            <div>
              <div>{item.name}</div>
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

      <div className="mt-4">{children}</div>
    </article>
  );
}
