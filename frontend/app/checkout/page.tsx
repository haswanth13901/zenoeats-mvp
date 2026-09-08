"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { api, ApiError, errorMessage, isAbort, newIdempotencyKey } from "@/lib/api";
import { CartProvider, useCart } from "@/lib/cart";
import { money } from "@/lib/format";
import type { Amounts, Order, Portal } from "@/lib/types";

export default function CheckoutPage() {
  const [portal, setPortal] = useState<Portal | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api<Portal>("/portal", { signal: ac.signal })
      .then(setPortal)
      .catch((e) => {
        if (!isAbort(e)) setBootError(errorMessage(e));
      });
    return () => ac.abort();
  }, []);

  if (bootError) {
    return (
      <main className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="font-display text-3xl">Checkout is unavailable</h1>
        <p className="mt-3 text-sm text-muted">{bootError}</p>
        <button className="btn-quiet mt-6" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  if (!portal) return <main className="px-5 py-24 text-center text-muted">Loading…</main>;
  return (
    <CartProvider slug={portal.slug}>
      <Checkout portal={portal} />
    </CartProvider>
  );
}

type Stage = "review" | "paying";

function Checkout({ portal }: { portal: Portal }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { lines, setQuantity, previewSubtotal, clear } = useCart();

  const [stage, setStage] = useState<Stage>("review");
  const [amounts, setAmounts] = useState<Amounts | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);

  // One key per checkout attempt, reused across retries. Regenerated only
  // when the cart changes, so a network hiccup can never create a second
  // order for the same intent.
  // Lazily: useRef(f()) would call f on every render and discard the result.
  const idempotencyKey = useRef<string | null>(null);
  const attemptKey = () => (idempotencyKey.current ??= newIdempotencyKey());
  const cartSignature = useMemo(
    () => lines.map((l) => `${l.key}x${l.quantity}`).join("|"),
    [lines]
  );
  useEffect(() => {
    idempotencyKey.current = newIdempotencyKey();
  }, [cartSignature]);

  const payload = useMemo(
    () =>
      lines.map((l) => ({
        menu_item_id: l.menu_item_id,
        quantity: l.quantity,
        note: l.note,
        modifiers: l.modifiers.map((m) => ({ option_id: m.option_id, quantity: m.quantity })),
      })),
    [lines]
  );

  // Authoritative pricing. Whatever the cart displayed locally is a guess
  // until the server answers.
  useEffect(() => {
    if (!lines.length) {
      setAmounts(null);
      return;
    }
    const ac = new AbortController();
    api<{ currency: string; amounts: Amounts }>("/orders/quote", {
      method: "POST",
      body: { items: payload },
      signal: ac.signal,
    })
      .then((q) => {
        setAmounts(q.amounts);
        setError(null);
      })
      .catch((e) => {
        if (!isAbort(e)) setError(errorMessage(e));
      });
    return () => ac.abort();
  }, [payload, lines.length]);

  async function startPayment() {
    if (!amounts) return;
    setBusy(true);
    setError(null);

    try {
      const token = await getToken();

      // Step 1: the order row exists before any charge is attempted. If the
      // customer walks away now, the TTL sweep expires it and nothing was
      // ever charged.
      const order = await api<Order>("/orders", {
        method: "POST",
        token,
        idempotencyKey: attemptKey(),
        body: {
          items: payload,
          customer_note: note.trim() || null,
          expected_total_minor: amounts.total_minor,
        },
      });

      // Step 2: PaymentIntent on the restaurant's connected account.
      const intent = await api<{
        client_secret: string;
        stripe_account_id: string;
        publishable_key: string;
      }>(`/orders/${order.order_id}/payment-intent`, {
        method: "POST",
        token,
        idempotencyKey: `${attemptKey()}-pi`,
        body: {},
      });

      // Direct charges live on the connected account, so Stripe.js must be
      // initialized with stripeAccount or the client secret will not resolve.
      setStripePromise(
        loadStripe(intent.publishable_key, { stripeAccount: intent.stripe_account_id })
      );
      setClientSecret(intent.client_secret);
      setOrderId(order.order_id);
      setStage("paying");
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "PRICE_CHANGED") {
        setError("Prices changed while you were ordering. Check the total and try again.");
      } else if (err.code === "ITEM_UNAVAILABLE") {
        setError("Something in your cart just sold out. Remove it and try again.");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!lines.length && stage === "review") {
    return (
      <main className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="font-display text-3xl">Your cart is empty</h1>
        <button className="btn-quiet mt-6" onClick={() => router.push("/")}>
          Back to the menu
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-10">
      <h1 className="font-display text-3xl">Pick up from {portal.name}</h1>

      <ul className="mt-8 divide-y divide-hairline border-y border-hairline">
        {lines.map((line) => (
          <li key={line.key} className="flex items-start gap-4 py-4">
            <div className="flex-1">
              <p className="text-[15px]">{line.name}</p>
              {line.modifiers.length > 0 && (
                <p className="mt-0.5 text-sm text-muted">
                  {line.modifiers.map((m) => m.label).join(" · ")}
                </p>
              )}
              {line.note && <p className="mt-0.5 text-sm italic text-muted">{line.note}</p>}
              {stage === "review" && (
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <button
                    className="rounded border border-hairline px-2"
                    onClick={() => setQuantity(line.key, line.quantity - 1)}
                    aria-label={`Fewer ${line.name}`}
                  >
                    −
                  </button>
                  <span className="tnum w-6 text-center">{line.quantity}</span>
                  <button
                    className="rounded border border-hairline px-2"
                    onClick={() => setQuantity(line.key, line.quantity + 1)}
                    aria-label={`More ${line.name}`}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
            <span className="tnum text-[15px]">
              {money(line.unitPreviewMinor * line.quantity, portal.currency)}
            </span>
          </li>
        ))}
      </ul>

      {amounts && (
        <dl className="mt-6 space-y-1.5 text-sm">
          <Row label="Subtotal" value={money(amounts.subtotal_minor, portal.currency)} />
          {amounts.discount_minor > 0 && (
            <Row label="Discount" value={`−${money(amounts.discount_minor, portal.currency)}`} />
          )}
          <Row label="Tax" value={money(amounts.tax_minor, portal.currency)} />
          <div className="flex justify-between border-t border-hairline pt-2 text-base font-medium">
            <dt>Total</dt>
            <dd className="tnum">{money(amounts.total_minor, portal.currency)}</dd>
          </div>
        </dl>
      )}

      {stage === "review" && (
        <>
          <label className="mt-6 block">
            <span className="text-sm font-medium">Anything else?</span>
            <input
              className="field mt-2"
              value={note}
              maxLength={500}
              placeholder="Name for the counter, pickup time"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {error && <p className="mt-4 text-sm text-brick">{error}</p>}

          <button
            className="btn-primary mt-6 w-full"
            disabled={busy || !amounts || !portal.is_orderable}
            onClick={startPayment}
          >
            {busy ? "Setting up payment…" : "Continue to payment"}
          </button>
        </>
      )}

      {stage === "paying" && clientSecret && stripePromise && orderId && (
        <div className="mt-8">
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: "flat",
                variables: { colorPrimary: "#B3341F", fontFamily: "system-ui, sans-serif" },
              },
            }}
          >
            <PayForm
              orderId={orderId}
              total={amounts?.total_minor ?? 0}
              currency={portal.currency}
              onPaid={() => {
                clear();
                router.push(`/orders/${orderId}`);
              }}
            />
          </Elements>
        </div>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <dt>{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}

function PayForm({
  orderId,
  total,
  currency,
  onPaid,
}: {
  orderId: string;
  total: number;
  currency: string;
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/orders/${orderId}` },
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message ?? "That payment didn't go through.");
      setBusy(false);
      return;
    }

    // Stripe says the confirmation succeeded. That is NOT the same as the
    // order being paid. Only the webhook can say that, so we hand off to the
    // order page, which polls the server for the authoritative state.
    onPaid();
  }

  return (
    <div>
      <PaymentElement options={{ layout: "tabs" }} />
      {error && <p className="mt-4 text-sm text-brick">{error}</p>}
      <button className="btn-primary mt-6 w-full" disabled={busy || !stripe} onClick={submit}>
        {busy ? "Processing…" : `Pay ${money(total, currency)}`}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        Your card is charged by the restaurant through Stripe.
      </p>
    </div>
  );
}
