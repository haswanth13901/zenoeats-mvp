import { clearCheckoutDrafts } from "@/features/storefront/checkoutDraft";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppDispatch } from "@/app/hooks";
import { sessionEstablished, sessionEnded } from "@/features/session/sessionSlice";
import { useAdminMeQuery } from "@/features/admin/adminApi";
import {
  useAcceptInvitationMutation,
  useStaffLogoutMutation,
  useStaffMeQuery,
  type StaffMe,
} from "@/features/restaurant/restaurantApi";
import { ApiError, errorMessage } from "@/services/apiClient";
import { useCustomerSessionQuery } from "@/features/storefront/storefrontApi";
import { takeOrderToken } from "@/features/storefront/orderToken";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import { ErrorNote, StatePage } from "@/components/common/Feedback";
import { Icon } from "@/components/common/icons";
import { AuthLayout } from "./AuthLayout";

/**
 * Route guards for the two credentialed portals and the customer checkout.
 *
 * These are a convenience, not a security control. The session is an httpOnly
 * cookie the browser sends by itself, and the API authorises every request
 * independently -- a guard that was bypassed would reach endpoints that refuse
 * it anyway. What this buys is not showing an empty shell to someone who is
 * about to be redirected.
 *
 * The redirect is a full navigation rather than a router push, because the
 * login pages are separate HTML entry points outside React.
 */

/** Full navigation, carrying where we were headed so signing in returns there
 *  rather than dumping everyone on the portal root. */
function toLogin(loginPath: string): null {
  if (loginPath === "/account/sign-in") clearCheckoutDrafts();
  const next = window.location.pathname + window.location.search;
  window.location.replace(`${loginPath}?next=${encodeURIComponent(next)}`);
  return null;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const { data, error, isLoading, isFetching, refetch } = useAdminMeQuery();

  useEffect(() => {
    if (data) dispatch(sessionEstablished({ portal: "admin", email: data.email }));
    else if (error) dispatch(sessionEnded());
  }, [data, error, dispatch]);

  // "Not asked yet" is not "not signed in". Redirecting during the first
  // request would bounce an authenticated operator to the login page.
  if (isLoading) return <Booting />;
  if (error instanceof ApiError && error.status === 401) return toLogin("/admin/login");
  if (isRefusal(error)) return <Refused message={error.message} />;
  if (error) return <Unreachable retry={refetch} retrying={isFetching} />;
  return <>{children}</>;
}

export function RequireStaff({
  children,
  roles,
}: {
  children: ReactNode;
  /** Roles this page is for. Left out, every active member may open it. */
  roles?: string[];
}) {
  const dispatch = useAppDispatch();
  const { data, error, isLoading, isFetching, refetch } = useStaffMeQuery();

  useEffect(() => {
    if (data) {
      dispatch(
        sessionEstablished({
          portal: "staff",
          email: data.email,
          fullName: data.full_name,
          roleCode: data.role_code,
          restaurantName: data.restaurant_name,
          storefrontEnabled: data.storefront_customization_enabled,
          mustChangePassword: data.must_change_password,
        }),
      );
    } else if (error) dispatch(sessionEnded());
  }, [data, error, dispatch]);

  if (isLoading) return <Booting />;
  if (error instanceof ApiError && error.status === 401) return toLogin("/manage/login");
  if (isRefusal(error)) return <Refused message={error.message} signOut />;
  if (error) return <Unreachable retry={refetch} retrying={isFetching} />;

  // An account still holding a temporary password is refused everywhere but
  // change-password, so sending it anywhere else would only bounce. The API
  // enforces this regardless; this makes the refusal actionable instead of a
  // wall of 403s.
  if (data?.must_change_password) {
    window.location.replace("/manage/change-password");
    return null;
  }
  // Signed in, but not yet on the team. Every other staff endpoint refuses
  // this session, so the invitation is the only thing worth showing.
  if (data?.membership_status === "INVITED") return <AcceptInvitation me={data} />;
  // Reached by a bookmark or a typed address rather than the tabs, which
  // already leave this page out. Every call the page makes would be refused,
  // so say why once instead of showing a screen of errors.
  if (data && roles && !roles.includes(data.role_code)) return <NotForYourRole me={data} />;
  return <>{children}</>;
}

/**
 * Checkout, payment and order tracking.
 *
 * Browsing the menu never needs an identity; paying does -- but an identity is
 * not the same as an account. The server answers this now, because a guest is
 * an httpOnly cookie no script can read, and a signed-in customer is a Clerk
 * token: one question to one endpoint covers both, where asking Clerk could
 * only ever see one of them.
 *
 * The redirect goes to our own sign-in page -- a separate entry outside React,
 * like the portal logins -- and carries the path back, so the cart is waiting
 * whichever way they choose to come back.
 *
 * The API still authorises every request itself; this only decides what to
 * show instead of an empty shell.
 */
export function RequireCustomer({
  children,
  allowOrderToken = false,
}: {
  children: ReactNode;
  /** Let a ?t= order-view token through unasked.
   *
   *  Order tracking sets it, because the link in a guest's confirmation email
   *  is meant to be opened on whatever device the email is read on -- a phone
   *  that holds no cookie and will never hold a Clerk session. Bouncing it to
   *  sign-in would make that link useless to exactly the people it is for.
   *
   *  It grants nothing: the token names one order, is signed by the API and
   *  is checked there. A wrong one gets the same 404 as a wrong order id. */
  allowOrderToken?: boolean;
}) {
  const dispatch = useAppDispatch();
  // Read once, on the first render that can see it: takeOrderToken moves the
  // token out of the address bar, so a later reader would find no ?t= and
  // must get the same answer from where this put it.
  const [hasOrderToken] = useState(() => (allowOrderToken ? takeOrderToken() !== null : false));
  const { data, error, isLoading, isFetching, refetch } = useCustomerSessionQuery(undefined, {
    skip: hasOrderToken,
  });

  useEffect(() => {
    if (data) {
      dispatch(
        sessionEstablished({
          portal: "customer",
          email: data.email,
          fullName: data.full_name,
        }),
      );
    } else if (error) dispatch(sessionEnded());
  }, [data, error, dispatch]);

  if (hasOrderToken) return <>{children}</>;
  // "Not asked yet" is not "nobody", exactly as in the portals above.
  if (isLoading) return <Booting />;
  if (data) return <>{children}</>;
  // Nobody yet. The sign-in page offers both an account and continuing as a
  // guest, so this is the right destination even where Clerk is unconfigured
  // and an account is not on offer at all.
  if (error instanceof ApiError && error.status === 401) return toLogin("/account/sign-in");
  if (error) return <SignInUnreachable retry={refetch} retrying={isFetching} />;
  return <Booting />;
}

/**
 * Rule 27, in the portal: an invitation grants nothing until the person it
 * names accepts it, signed in as themselves.
 */
function AcceptInvitation({ me }: { me: StaffMe }) {
  const [accept, { isLoading }] = useAcceptInvitationMutation();
  const [logout] = useStaffLogoutMutation();
  const [error, setError] = useState<string | null>(null);

  return (
    <AuthLayout
      operator
      title={`Join ${me.restaurant_name}`}
      intro={
        <>
          You&apos;ve been invited to the team as{" "}
          <strong className="font-semibold text-ink">{me.role_code.toLowerCase()}</strong>. Accept
          to start using the portal, signed in as {me.email}.
        </>
      }
    >
      <ErrorNote message={error} className="mb-5" />
      <div className="auth-stack">
        <button
          type="button"
          className="btn-primary w-full"
          disabled={isLoading}
          onClick={async () => {
            setError(null);
            try {
              await accept().unwrap();
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          {isLoading ? "Accepting…" : "Accept invitation"}
        </button>
        <button
          type="button"
          className="btn-quiet w-full"
          onClick={async () => {
            await logout().unwrap().catch(() => undefined);
            window.location.assign("/manage/login");
          }}
        >
          Not now — sign out
        </button>
      </div>
    </AuthLayout>
  );
}

function NotForYourRole({ me }: { me: StaffMe }) {
  return (
    <ManageShell>
      <div className="mx-auto max-w-md py-12 text-center sm:py-16">
        <Icon name="lock" className="mx-auto mb-4 h-7 w-7 text-muted" />
        <h1 className="font-display text-[34px] leading-[1.12] tracking-[-1px] sm:text-4xl">
          Not part of your role
        </h1>
        <p className="mt-4 text-muted">
          You&apos;re signed in to {me.restaurant_name} as{" "}
          <strong className="font-semibold text-ink">{me.role_code.toLowerCase()}</strong>, which
          doesn&apos;t include this page. An admin at the restaurant can change your role.
        </p>
      </div>
    </ManageShell>
  );
}

/** Scoped to the routes that need an identity: browsing and both portals
 *  work without a Clerk key. */
function SignInUnreachable({ retry, retrying }: Reconnect) {
  useReconnect(retry, retrying);
  return (
    <StatePage
      title="Can't reach sign-in"
      busy={retrying}
      action={
        <a href="/" className="btn-quiet">
          Back to the menu
        </a>
      }
    >
      This page will retry by itself. You can still browse the menu.
    </StatePage>
  );
}

function Booting() {
  return <StatePage busy>Loading…</StatePage>;
}

/** How long after a failed attempt the next one starts. Counted from when
 *  that attempt finished, so a slow server is never asked twice at once. */
const RECONNECT_AFTER_MS = 5_000;

type Reconnect = { retry: () => unknown; retrying: boolean };

/**
 * Keep asking until the API answers, then get out of the way.
 *
 * This page used to be a dead end: one request that happened to land while
 * the API was restarting, or stalled, left a Reload button in front of
 * someone who had done nothing wrong -- and on a kitchen tablet, nobody
 * standing there to press it. The guard above renders the real page the
 * moment its query succeeds, so recovering needs nothing but a retry.
 */
function useReconnect(retry: () => unknown, retrying: boolean) {
  // refetch is a new function on most renders; the latest one is what counts.
  const latest = useRef(retry);
  latest.current = retry;

  useEffect(() => {
    if (retrying) return;
    const timer = window.setTimeout(() => latest.current(), RECONNECT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [retrying]);

  useEffect(() => {
    // Straight away, rather than on the next tick, when there is reason to
    // think it will now work: the network came back, or someone looked.
    const now = () => latest.current();
    window.addEventListener("online", now);
    window.addEventListener("focus", now);
    return () => {
      window.removeEventListener("online", now);
      window.removeEventListener("focus", now);
    };
  }, []);
}

/** A 403 or 404 is an answer, not an outage. Saying "can't reach the server"
 *  for it sent people hunting for a fault that was never there. */
function isRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

function Refused({ message, signOut = false }: { message: string; signOut?: boolean }) {
  const [logout] = useStaffLogoutMutation();
  return (
    <StatePage
      title="No access here"
      action={
        signOut && (
          <button
            type="button"
            className="btn-quiet"
            onClick={async () => {
              await logout().unwrap().catch(() => undefined);
              window.location.assign("/manage/login");
            }}
          >
            Sign in with another account
          </button>
        )
      }
    >
      {message}
    </StatePage>
  );
}

function Unreachable({ retry, retrying }: Reconnect) {
  useReconnect(retry, retrying);
  return (
    <StatePage
      title="Can't reach the server"
      busy={retrying}
      action={
        <button type="button" className="btn-quiet" onClick={() => window.location.reload()}>
          <Icon name="refresh" />
          Reload
        </button>
      }
    >
      {retrying
        ? "Trying again…"
        : "The API did not answer. This page will reconnect by itself as soon as it does."}
    </StatePage>
  );
}
