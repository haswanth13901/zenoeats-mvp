import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { selectSession, sessionEnded } from "@/features/session/sessionSlice";
import { getClerk } from "@/services/clerk";

/**
 * Who is ordering, and a way to stop being them.
 *
 * Checkout is where it matters: a shared phone or a family tablet is often
 * signed in as someone else, and the order, its receipt and its pickup PIN all
 * go to whoever that is. Saying so before payment is cheaper than a refund.
 *
 * The session is Clerk's, so Clerk ends it.
 */
export function CustomerAccountBar() {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectSession);
  const [busy, setBusy] = useState(false);

  if (session.portal !== "customer" || !session.email) return null;

  return (
    <div className="mb-6 flex items-center justify-between gap-3 text-xs text-muted">
      <span className="truncate">Ordering as {session.fullName ?? session.email}</span>
      <button
        className="shrink-0 underline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await getClerk()
            .then((clerk) => clerk.signOut())
            .catch(() => undefined);
          dispatch(sessionEnded());
          window.location.assign("/");
        }}
      >
        Not you? Sign out
      </button>
    </div>
  );
}
