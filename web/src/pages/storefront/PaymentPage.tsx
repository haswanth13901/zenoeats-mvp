import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useAppDispatch } from "@/app/hooks";
import { cartCleared } from "@/features/cart/cartSlice";
import {
  useCreatePaymentIntentMutation,
  useOrderQuery,
  usePortalQuery,
} from "@/features/storefront/storefrontApi";
import { ApiError, errorMessage, newIdempotencyKey } from "@/services/apiClient";
import { money } from "@/utils/format";

/**
 * What /checkout hands over, so the ordinary path costs no extra request.
 *
 * Router state survives Back and Forward but not a reload, and it is arbitrary
 * data -- a stale history entry from an older build, or one typed by hand --
 * so it is validated here and treated as a fast path, never as the only path.
 */
type IntentBundle = {
  clientSecret: string;
  /** The restaurant's own connected account. Stripe.js is initialised with it,
   *  or the client secret for a direct charge will not resolve. */
  stripeAccountId: string;
  publishableKey: string;
};

export type PaymentHandoff = IntentBundle & { totalMinor: number };

function readHandoff(state: unknown): PaymentHandoff | null {
  if (typeof state !== "object" || state === null) return null;
  const s = state as Record<string, unknown>;
  if (
    typeof s.clientSecret !== "string" ||
    typeof s.stripeAccountId !== "string" ||
    typeof s.publishableKey !== "string" ||
    typeof s.totalMinor !== "number"
  ) {
    return null;
  }
  return {
    clientSecret: s.clientSecret,
    stripeAccountId: s.stripeAccountId,
    publishableKey: s.publishableKey,
    totalMinor: s.totalMinor,
  };
}

/**
 * Payment, on its own URL.
 *
 * The order and its PaymentIntent both exist before anything renders here:
 * /checkout creates them, then navigates. This page only confirms the intent.
 * It still does not decide that the order is paid -- only the webhook does
 * that -- so it hands off to the order page, which polls the server.
 */
export function PaymentPage() {
  const { orderId = "" } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { state } = useLocation();

  const handed = useMemo(() => readHandoff(state), [state]);

  const portal = usePortalQuery();
  const [createPaymentIntent] = useCreatePaymentIntentMutation();
  const [recovered, setRecovered] = useState<IntentBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetched only when the handoff is gone. It supplies the amount and, just as
  // importantly, says whether this order is still awaiting payment at all.
  const { data: order } = useOrderQuery(orderId, { skip: handed !== null || !orderId });

  // Reload with no handoff. The endpoint is "create or return": its Stripe
  // idempotency key is derived from the order id, so this hands back the
  // intent that already exists instead of opening a second one.
  useEffect(() => {
    if (handed || recovered || !orderId) return;
    let alive = true;
    createPaymentIntent({ orderId, idempotencyKey: newIdempotencyKey() })
      .unwrap()
      .then((intent) => {
        if (!alive) return;
        // No amount here on purpose: the order query is the authority for it
        // on this path, and the page waits for that before it renders.
        setRecovered({
          clientSecret: intent.client_secret,
          stripeAccountId: intent.stripe_account_id,
          publishableKey: intent.publishable_key,
        });
      })
      .catch((e) => {
        if (!alive) return;
        // The order left PENDING_PAYMENT while this page was closed: paid,
        // cancelled or swept by the TTL. The order page says which.
        if (e instanceof ApiError && e.code === "ORDER_STATE_CONFLICT") {
          navigate(`/orders/${orderId}`, { replace: true });
          return;
        }
        setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [handed, recovered, orderId, createPaymentIntent, navigate]);

  // The same redirect from the other direction, for an order already settled.
  useEffect(() => {
    if (order && order.status !== "PENDING_PAYMENT") {
      navigate(`/orders/${orderId}`, { replace: true });
    }
  }, [order, orderId, navigate]);

  const payment = handed ?? recovered;
  const total = handed?.totalMinor ?? order?.amounts.total_minor ?? null;

  // loadStripe opens a connection, so it must not run again on every render.
  // Direct charges live on the connected account, which is why Stripe.js needs
  // stripeAccount here or the client secret will not resolve.
  const stripePromise = useMemo(
    () =>
      payment
        ? loadStripe(payment.publishableKey, { stripeAccount: payment.stripeAccountId })
        : null,
    [payment],
  );

  if (!orderId) {
    return (
      <main className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="font-display text-3xl">Nothing to pay for</h1>
        <Link to="/checkout" className="btn-quiet mt-6">
          Back to your order
        </Link>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="font-display text-3xl">We couldn&apos;t open payment</h1>
        <p className="mt-3 text-sm text-muted">{error}</p>
        <Link to="/checkout" className="btn-quiet mt-6">
          Back to your order
        </Link>
      </main>
    );
  }

  if (!payment || !stripePromise || total === null || !portal.data) {
    return <main className="px-5 py-24 text-center text-muted">Opening payment…</main>;
  }

  // Bound to a const after the guard: narrowing on portal.data does not survive
  // into the callbacks below, because it is a property of a mutable object.
  const restaurant = portal.data;

  return (
    <main className="mx-auto max-w-lg px-5 py-10">
      <h1 className="font-display text-3xl">Pay {restaurant.name}</h1>
      <p className="mt-2 text-sm text-muted">
        Your order is held while you pay. Nothing is charged until you confirm.
      </p>

      <div className="mt-6 flex justify-between border-y border-hairline py-3 text-base font-medium">
        <span>Total</span>
        <span className="tnum">{money(total, restaurant.currency)}</span>
      </div>

      <div className="mt-8">
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret: payment.clientSecret,
            appearance: {
              theme: "flat",
              variables: { colorPrimary: "#B3341F", fontFamily: "system-ui, sans-serif" },
            },
          }}
        >
          <PayForm
            orderId={orderId}
            total={total}
            currency={restaurant.currency}
            onPaid={() => {
              dispatch(cartCleared());
              navigate(`/orders/${orderId}`, { replace: true });
            }}
          />
        </Elements>
      </div>

      <Link to="/checkout" className="mt-6 block text-center text-sm text-muted underline">
        Back to your order
      </Link>
    </main>
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

    // Stripe says the confirmation succeeded. That is NOT the same as the order
    // being paid. Only the webhook can say that, so we hand off to the order
    // page, which polls the server for the authoritative state.
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
