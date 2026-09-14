import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useOrderQuery } from "@/features/storefront/storefrontApi";
import { errorMessage } from "@/services/apiClient";
import { money } from "@/utils/format";

const STATUS_COPY: Record<string, { title: string; detail: string }> = {
  PENDING_PAYMENT: {
    title: "Confirming your payment",
    detail: "This usually takes a few seconds. Keep this page open.",
  },
  AUTO_ACCEPTED: { title: "Order confirmed", detail: "The kitchen has your order." },
  PREPARING: { title: "Being made now", detail: "We'll tell you when it's ready to collect." },
  READY_FOR_PICKUP: {
    title: "Ready to collect",
    detail: "Give your PIN to the counter to pick it up.",
  },
  COMPLETED: { title: "Collected", detail: "Thanks for ordering." },
  CANCELLED: { title: "Cancelled", detail: "This order was cancelled." },
  EXPIRED: {
    title: "Expired",
    detail: "Payment wasn't completed in time. Nothing was charged.",
  },
};

const TERMINAL = ["COMPLETED", "CANCELLED", "EXPIRED"];

export function OrderPage() {
  const { orderId = "" } = useParams<{ orderId: string }>();
  // Poll fast while payment is unconfirmed, slower once the kitchen has it, and
  // stop entirely once nothing further can change. Held in state rather than
  // derived inline, because deriving it from the query's own result would make
  // the query's options depend on its output.
  const [pollMs, setPollMs] = useState(2_000);

  const { data: order, error } = useOrderQuery(orderId, {
    skip: !orderId,
    pollingInterval: pollMs,
  });

  useEffect(() => {
    if (!order) return;
    if (TERMINAL.includes(order.status)) setPollMs(0);
    else setPollMs(order.status === "PENDING_PAYMENT" ? 2_000 : 8_000);
  }, [order]);

  if (error) {
    return (
      <main className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="font-display text-3xl">We can&apos;t find that order</h1>
        <p className="mt-3 text-muted">{errorMessage(error)}</p>
        <Link to="/" className="btn-quiet mt-6">
          Back to the menu
        </Link>
      </main>
    );
  }

  if (!order) {
    return <main className="px-5 py-24 text-center text-muted">Loading your order…</main>;
  }

  const copy = STATUS_COPY[order.status] ?? { title: order.status, detail: "" };
  const awaitingPayment =
    order.status === "PENDING_PAYMENT" && order.payment_status !== "PAID";

  return (
    <main className="mx-auto max-w-lg px-5 py-10">
      <p className="text-sm text-muted">Order #{order.order_number}</p>
      <h1 className="mt-1 font-display text-3xl">{copy.title}</h1>
      <p className="mt-2 text-muted">{copy.detail}</p>

      {awaitingPayment && (
        <div className="mt-6 flex items-center gap-3 rounded-md border border-hairline bg-surface px-4 py-3 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brick" aria-hidden />
          Waiting for the payment confirmation from Stripe.
        </div>
      )}

      {order.pickup_pin && (
        <div className="mt-6 rounded-md border border-brick/30 bg-brick/5 px-5 py-4">
          <p className="text-sm text-muted">Pickup PIN</p>
          <p className="tnum mt-1 font-display text-4xl tracking-[0.2em]">{order.pickup_pin}</p>
          <p className="mt-2 text-xs text-muted">
            Show this at the counter. Don&apos;t share it with anyone else.
          </p>
        </div>
      )}

      <ul className="mt-8 divide-y divide-hairline border-y border-hairline">
        {order.items.map((item, i) => (
          <li key={i} className="flex items-start gap-4 py-4">
            <span className="tnum w-6 text-sm text-muted">{item.quantity}×</span>
            <div className="flex-1">
              <p className="text-[15px]">{item.name}</p>
              {item.modifiers.length > 0 && (
                <p className="mt-0.5 text-sm text-muted">
                  {item.modifiers.map((m) => `${m.group_name}: ${m.option_name}`).join(" · ")}
                </p>
              )}
              {item.item_note && (
                <p className="mt-0.5 text-sm italic text-muted">{item.item_note}</p>
              )}
            </div>
            <span className="tnum text-[15px]">
              {money(item.line_total_minor, order.currency)}
            </span>
          </li>
        ))}
      </ul>

      <dl className="mt-6 space-y-1.5 text-sm">
        <div className="flex justify-between text-muted">
          <dt>Subtotal</dt>
          <dd className="tnum">{money(order.amounts.subtotal_minor, order.currency)}</dd>
        </div>
        <div className="flex justify-between text-muted">
          <dt>Tax</dt>
          <dd className="tnum">{money(order.amounts.tax_minor, order.currency)}</dd>
        </div>
        <div className="flex justify-between border-t border-hairline pt-2 text-base font-medium">
          <dt>Total</dt>
          <dd className="tnum">{money(order.amounts.total_minor, order.currency)}</dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-muted">Payment: {order.payment_status.toLowerCase()}</p>

      <Link to="/" className="btn-quiet mt-8 w-full">
        Order something else
      </Link>
    </main>
  );
}
