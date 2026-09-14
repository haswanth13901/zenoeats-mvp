import { useEffect, useState, type ReactNode } from "react";
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
import { clerkConfigured, getClerk } from "@/services/clerk";
import { ManageShell } from "@/features/restaurant/components/ManageShell";

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
  const next = window.location.pathname + window.location.search;
  window.location.replace(`${loginPath}?next=${encodeURIComponent(next)}`);
  return null;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const { data, error, isLoading } = useAdminMeQuery();

  useEffect(() => {
    if (data) dispatch(sessionEstablished({ portal: "admin", email: data.email }));
    else if (error) dispatch(sessionEnded());
  }, [data, error, dispatch]);

  // "Not asked yet" is not "not signed in". Redirecting during the first
  // request would bounce an authenticated operator to the login page.
  if (isLoading) return <Booting />;
  if (error instanceof ApiError && error.status === 401) return toLogin("/admin/login");
  if (error) return <Unreachable />;
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
  const { data, error, isLoading } = useStaffMeQuery();

  useEffect(() => {
    if (data) {
      dispatch(
        sessionEstablished({
          portal: "staff",
          email: data.email,
          fullName: data.full_name,
          roleCode: data.role_code,
          restaurantName: data.restaurant_name,
          mustChangePassword: data.must_change_password,
        }),
      );
    } else if (error) dispatch(sessionEnded());
  }, [data, error, dispatch]);

  if (isLoading) return <Booting />;
  if (error instanceof ApiError && error.status === 401) return toLogin("/manage/login");
  if (error) return <Unreachable />;

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
 * Browsing the menu never needs an account; paying does. Whether the customer
 * is signed in is Clerk's answer, read from the Clerk session in this browser.
 * The redirect goes to our own sign-in page -- a separate entry outside React,
 * like the portal logins -- and carries the path back so the cart is waiting.
 *
 * The API still verifies every token itself; this only decides what to show.
 */
export function RequireCustomer({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const [state, setState] = useState<"loading" | "signed-in" | "signed-out" | "failed">(
    "loading",
  );

  useEffect(() => {
    if (!clerkConfigured()) return;
    let alive = true;
    getClerk()
      .then((clerk) => {
        if (!alive) return;
        const user = clerk.user;
        if (user) {
          dispatch(
            sessionEstablished({
              portal: "customer",
              email: user.primaryEmailAddress?.emailAddress ?? "",
              fullName: user.fullName,
            }),
          );
          setState("signed-in");
        } else {
          dispatch(sessionEnded());
          setState("signed-out");
        }
      })
      .catch(() => {
        if (alive) setState("failed");
      });
    return () => {
      alive = false;
    };
  }, [dispatch]);

  if (!clerkConfigured()) return <SignInUnavailable />;
  if (state === "loading") return <Booting />;
  if (state === "signed-out") return toLogin("/account/sign-in");
  if (state === "failed") return <SignInUnreachable />;
  return <>{children}</>;
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
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <h1 className="font-display text-3xl">Join {me.restaurant_name}</h1>
      <p className="mt-3 text-sm text-muted">
        You&apos;ve been invited to the team as{" "}
        <span className="font-medium text-ink">{me.role_code.toLowerCase()}</span>. Accept to
        start using the portal, signed in as {me.email}.
      </p>
      {error && (
        <p className="mt-4 border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick">
          {error}
        </p>
      )}
      <button
        className="btn-primary mt-8 w-full"
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
        className="btn-quiet mt-3 w-full"
        onClick={async () => {
          await logout().unwrap().catch(() => undefined);
          window.location.assign("/manage/login");
        }}
      >
        Not now — sign out
      </button>
    </main>
  );
}

function NotForYourRole({ me }: { me: StaffMe }) {
  return (
    <ManageShell>
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="font-display text-2xl">Not part of your role</h1>
        <p className="mt-3 text-sm text-muted">
          You&apos;re signed in to {me.restaurant_name} as{" "}
          <span className="font-medium text-ink">{me.role_code.toLowerCase()}</span>, which
          doesn&apos;t include this page. An admin at the restaurant can change your role.
        </p>
      </div>
    </ManageShell>
  );
}

/** Scoped to the routes that need an identity: browsing and both portals
 *  work without a Clerk key. */
function SignInUnavailable() {
  return (
    <main className="mx-auto max-w-lg px-5 py-24 text-center">
      <h1 className="font-display text-3xl">Sign-in is not configured</h1>
      <p className="mt-3 text-sm text-muted">
        Set CLERK_PUBLISHABLE_KEY on the web container, or VITE_CLERK_PUBLISHABLE_KEY in
        development. Ordering needs a customer identity; browsing the menu does not.
      </p>
    </main>
  );
}

function SignInUnreachable() {
  return (
    <main className="mx-auto max-w-lg px-5 py-24 text-center">
      <h1 className="font-display text-3xl">Can&apos;t reach sign-in</h1>
      <p className="mt-3 text-sm text-muted">
        Check your connection and reload. You can still browse the menu.
      </p>
    </main>
  );
}

function Booting() {
  return <main className="px-5 py-24 text-center text-muted">Loading…</main>;
}

function Unreachable() {
  return (
    <main className="mx-auto max-w-lg px-5 py-24 text-center">
      <h1 className="font-display text-3xl">Can&apos;t reach the server</h1>
      <p className="mt-3 text-sm text-muted">
        The application is running but the API did not answer. Check that it is
        up, then reload.
      </p>
    </main>
  );
}
