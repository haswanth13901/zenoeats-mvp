import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  comboQuantitySet,
  lineQuantitySet,
  selectCartCombos,
  selectCartLines,
} from "@/features/cart/cartSlice";
import {
  useCreateOrderMutation,
  useCreatePaymentIntentMutation,
  usePortalQuery,
  useQuoteMutation,
} from "@/features/storefront/storefrontApi";
import { ApiError, errorMessage, newIdempotencyKey } from "@/services/apiClient";
import { money } from "@/utils/format";
import { CustomerAccountBar } from "@/features/storefront/components/CustomerAccountBar";
import type { PaymentHandoff } from "./PaymentPage";
import type { Amounts } from "@/types";

/**
 * One idempotency key per distinct checkout attempt, reused across retries, so
 * a network hiccup can never create a second order for the same intent.
 *
 * It lives in sessionStorage rather than a ref because payment is now its own
 * URL: pressing Back unmounts this page, and a ref would come back empty and
 * open a second order for a cart the customer never changed. Keyed by the
 * exact request body, because that is what the server hashes -- so an edited
 * note or a re-quoted total correctly earns a new key instead of colliding
 * with the old one.
 */
const ATTEMPT_STORAGE_KEY = "zenoeats:checkout-attempt";

function attemptKeyFor(signature: string): string {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { signature?: string; key?: string };
      if (saved.signature === signature && saved.key) return saved.key;
    }
  } catch {
    // A private window, or storage the browser refuses. A fresh key is still
    // correct; it only costs the customer a duplicate pending order if they
    // navigate back, and the TTL sweep expires that without charging anything.
  }
  const key = newIdempotencyKey();
  try {
    sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify({ signature, key }));
  } catch {
    // Same as above: unstored is survivable, unkeyed is not.
  }
  return key;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const portal = usePortalQuery();
  const lines = useAppSelector(selectCartLines);
  const combos = useAppSelector(selectCartCombos);

  const [amounts, setAmounts] = useState<Amounts | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [quote] = useQuoteMutation();
  const [createOrder] = useCreateOrderMutation();
  const [createPaymentIntent] = useCreatePaymentIntentMutation();

  const payload = useMemo(
    () =>
      lines.map((l) => ({
        menu_item_id: l.menu_item_id,
        quantity: l.quantity,
        note: l.note,
        modifiers: l.modifiers.map((m) => ({ option_id: m.option_id, quantity: m.quantity })),
      })),
    [lines],
  );

  // Which deal and which choices. No price, here or anywhere else: the
  // server reads what a combo costs from the menu, on the quote and again on
  // the order.
  const comboPayload = useMemo(
    () =>
      combos.map((c) => ({
        combo_id: c.combo_id,
        quantity: c.quantity,
        note: c.note,
        selections: c.selections.map((s) => ({
          slot_id: s.slot_id,
          menu_item_id: s.menu_item_id,
          modifiers: s.modifiers.map((m) => ({
            option_id: m.option_id,
            quantity: m.quantity,
          })),
        })),
      })),
    [combos],
  );

  const empty = lines.length === 0 && combos.length === 0;

  // Authoritative pricing. Whatever the cart displayed locally is a guess until
  // the server answers.
  useEffect(() => {
    if (empty) {
      setAmounts(null);
      return;
    }
    let alive = true;
    quote({ items: payload, combos: comboPayload })
      .unwrap()
      .then((q) => {
        if (!alive) return;
        setAmounts(q.amounts);
        setError(null);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [payload, comboPayload, empty, quote]);

  async function startPayment() {
    if (!amounts) return;
    setBusy(true);
    setError(null);

    try {
      const body = {
        items: payload,
        combos: comboPayload,
        customer_note: note.trim() || null,
        expected_total_minor: amounts.total_minor,
      };
      const key = attemptKeyFor(JSON.stringify(body));

      // Step 1: the order row exists before any charge is attempted. If the
      // customer walks away now, the TTL sweep expires it and nothing was
      // ever charged.
      const order = await createOrder({ ...body, idempotencyKey: key }).unwrap();

      // Step 2: PaymentIntent on the restaurant's connected account.
      const intent = await createPaymentIntent({
        orderId: order.order_id,
        idempotencyKey: `${key}-pi`,
      }).unwrap();

      // Step 3: payment is its own URL, so it gets a real navigation with its
      // own history entry. Everything the payment page needs travels in router
      // state, which keeps the client secret out of the address bar; it
      // re-requests the intent by order id if that state is lost to a reload.
      const handoff: PaymentHandoff = {
        clientSecret: intent.client_secret,
        stripeAccountId: intent.stripe_account_id,
        publishableKey: intent.publishable_key,
        totalMinor: amounts.total_minor,
      };
      navigate(`/checkout/pay/${order.order_id}`, { state: handoff });
    } catch (e) {
      if (e instanceof ApiError && e.code === "PRICE_CHANGED") {
        setError("Prices changed while you were ordering. Check the total and try again.");
      } else if (e instanceof ApiError && e.code === "ITEM_UNAVAILABLE") {
        setError("Something in your cart just sold out. Remove it and try again.");
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!portal.data) {
    if (portal.error) {
      return (
        <main className="mx-auto max-w-lg px-5 py-24 text-center">
          <h1 className="font-display text-3xl">Checkout is unavailable</h1>
          <p className="mt-3 text-sm text-muted">{errorMessage(portal.error)}</p>
        </main>
      );
    }
    return <main className="px-5 py-24 text-center text-muted">Loading…</main>;
  }

  // Bound to a const after the guard above: narrowing on portal.data does not
  // survive into the callbacks below, because it is a property of a mutable
  // object rather than a local.
  const restaurant = portal.data;

  if (empty) {
    return (
      <main className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="font-display text-3xl">Your cart is empty</h1>
        <button className="btn-quiet mt-6" onClick={() => navigate("/")}>
          Back to the menu
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-10">
      <CustomerAccountBar />
      <h1 className="font-display text-3xl">Pick up from {restaurant.name}</h1>

      <ul className="mt-8 divide-y divide-hairline border-y border-hairline">
        {/* Combos first, and each as one row. A meal deal that listed its
            three items separately would read as three orders and would let a
            customer remove the drink from a deal that requires one. */}
        {combos.map((line) => (
          <li key={line.key} className="flex items-start gap-4 py-4">
            <div className="flex-1">
              <p className="text-[15px]">{line.name}</p>
              <ul className="mt-0.5 text-sm text-muted">
                {line.selections.map((s) => (
                  <li key={s.slot_id}>
                    {s.slotLabel}: {s.itemName}
                    {s.modifiers.length > 0 && (
                      <span> · {s.modifiers.map((m) => m.label).join(" · ")}</span>
                    )}
                  </li>
                ))}
              </ul>
              {line.note && <p className="mt-0.5 text-sm italic text-muted">{line.note}</p>}
              <div className="mt-2 flex items-center gap-2 text-sm">
                <button
                  className="rounded border border-hairline px-2"
                  onClick={() =>
                    dispatch(comboQuantitySet({ key: line.key, quantity: line.quantity - 1 }))
                  }
                  aria-label={`Fewer ${line.name}`}
                >
                  −
                </button>
                <span className="tnum w-6 text-center">{line.quantity}</span>
                <button
                  className="rounded border border-hairline px-2"
                  onClick={() =>
                    dispatch(comboQuantitySet({ key: line.key, quantity: line.quantity + 1 }))
                  }
                  aria-label={`More ${line.name}`}
                >
                  +
                </button>
              </div>
            </div>
            <span className="tnum text-[15px]">
              {money(line.unitPreviewMinor * line.quantity, restaurant.currency)}
            </span>
          </li>
        ))}

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
              <div className="mt-2 flex items-center gap-2 text-sm">
                <button
                  className="rounded border border-hairline px-2"
                  onClick={() =>
                    dispatch(lineQuantitySet({ key: line.key, quantity: line.quantity - 1 }))
                  }
                  aria-label={`Fewer ${line.name}`}
                >
                  −
                </button>
                <span className="tnum w-6 text-center">{line.quantity}</span>
                <button
                  className="rounded border border-hairline px-2"
                  onClick={() =>
                    dispatch(lineQuantitySet({ key: line.key, quantity: line.quantity + 1 }))
                  }
                  aria-label={`More ${line.name}`}
                >
                  +
                </button>
              </div>
            </div>
            <span className="tnum text-[15px]">
              {money(line.unitPreviewMinor * line.quantity, restaurant.currency)}
            </span>
          </li>
        ))}
      </ul>

      {amounts && (
        <dl className="mt-6 space-y-1.5 text-sm">
          <Row label="Subtotal" value={money(amounts.subtotal_minor, restaurant.currency)} />
          {amounts.discount_minor > 0 && (
            <Row
              label="Discount"
              value={`−${money(amounts.discount_minor, restaurant.currency)}`}
            />
          )}
          <Row label="Tax" value={money(amounts.tax_minor, restaurant.currency)} />
          <div className="flex justify-between border-t border-hairline pt-2 text-base font-medium">
            <dt>Total</dt>
            <dd className="tnum">{money(amounts.total_minor, restaurant.currency)}</dd>
          </div>
        </dl>
      )}

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
        disabled={busy || !amounts || !restaurant.is_orderable}
        onClick={startPayment}
      >
        {busy ? "Setting up payment…" : "Continue to payment"}
      </button>
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
