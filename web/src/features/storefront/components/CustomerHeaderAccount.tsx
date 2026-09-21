import { clearCheckoutDrafts } from "../checkoutDraft";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  useCustomerSessionQuery,
  useEndGuestSessionMutation,
} from "@/features/storefront/storefrontApi";
import { ErrorNote } from "@/components/common/Feedback";
import { errorMessage } from "@/services/apiClient";
import { getClerk } from "@/services/clerk";
import { GUEST_WARNING, GuestSessionConfirm } from "./GuestSession";

/**
 * Who is ordering, in the storefront header.
 *
 * The menu itself never needs an account, so this is an offer rather than a
 * gate: signing in here saves the interruption at checkout, and skipping it
 * costs nothing until then.
 *
 * A guest is named as one. Their session lives in this browser's cookie and
 * nowhere else, so "guest" is the honest label for what they have, and the
 * standing offer of an account is the fix for it.
 *
 * The row keeps a minimum height whatever the answer is, so the banner below
 * it does not jump when the session check lands. `leading` shares the row --
 * the storefront puts whether it is taking orders there.
 */
export function CustomerHeaderAccount({ leading }: { leading?: ReactNode }) {
  // 401 is the ordinary answer here -- most people reading a menu are nobody
  // yet -- so a failed query is a state, not an error worth showing.
  const { data: session, isLoading } = useCustomerSessionQuery({ soft: true });
  const [endGuest] = useEndGuestSessionMutation();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      if (session?.is_guest) await endGuest().unwrap();
      else await getClerk().then(c => c.signOut());
      clearCheckoutDrafts();
      window.location.assign("/");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const textLink = "link text-caption";

  let row;
  if (isLoading) {
    row = <span className="text-caption text-muted">Checking your session…</span>;
  } else if (!session) {
    row = (
      <a href={signInHref()} className={textLink}>
        Sign in
      </a>
    );
  } else if (session.is_guest) {
    row = (
      <>
        <span className="text-caption">Guest</span>
        <Link to="/profile" className={textLink}>
          Your orders
        </Link>
        <a href={signInHref()} className={textLink}>
          Sign in
        </a>
        <button
          type="button"
          className={textLink}
          disabled={busy}
          aria-expanded={confirming}
          onClick={() => setConfirming(true)}
        >
          End guest session
        </button>
      </>
    );
  } else {
    row = (
      <>
        <span className="max-w-[12rem] truncate text-caption text-muted" title={session.full_name ?? session.email}>
          {session.full_name ?? session.email}
        </span>
        <Link to="/profile" className={textLink}>
          Your profile
        </Link>
        <button type="button" className={textLink} disabled={busy} onClick={signOut}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </>
    );
  }

  return (
    <div aria-label="Your account" role="group">
      <div className="flex min-h-[46px] flex-wrap items-center justify-between gap-x-5 gap-y-1 sm:min-h-[51px]">
        {leading ?? <span />}
        <div className="flex flex-wrap items-center justify-end gap-x-[13px] sm:gap-x-[17px]">{row}</div>
      </div>
      {session?.is_guest && (
        <p className="-mt-1 mb-3.5 max-w-[520px] text-left text-[11px] text-muted sm:ml-auto sm:text-right">
          {GUEST_WARNING}
        </p>
      )}
      <ErrorNote message={error} className="mb-3" />
      {confirming && session?.is_guest && (
        <div className="mb-4">
          <GuestSessionConfirm busy={busy} onEnd={signOut} onKeep={() => setConfirming(false)} />
        </div>
      )}
    </div>
  );
}

/** Back to wherever they were when they chose to sign in. */
function signInHref(): string {
  const next = window.location.pathname + window.location.search;
  return `/account/sign-in?next=${encodeURIComponent(next)}`;
}
