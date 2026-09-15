import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { sessionEnded, selectSession } from "@/features/session/sessionSlice";
import { useStaffLogoutEverywhereMutation, useStaffLogoutMutation } from "../restaurantApi";

/**
 * Ends the restaurant staff session.
 *
 * Shows who is signed in and in what role, because a shared kitchen tablet
 * often is not obviously anyone's -- and the role decides which controls the
 * portal offers.
 *
 * Two ways out. "Sign out" is this device only, on purpose: a restaurant often
 * shares one login across its tablets, and one person leaving must not sign
 * the tablet on the pass out mid-service. "Sign out all devices" ends every
 * session the account holds -- the answer to a lost phone -- and asks first,
 * because it takes those shared tablets with it.
 *
 * The cookie is httpOnly, so only the server can clear it.
 */
export function StaffSignOut() {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectSession);
  const [logout, { isLoading }] = useStaffLogoutMutation();
  const [logoutEverywhere, everywhere] = useStaffLogoutEverywhereMutation();
  const [confirming, setConfirming] = useState(false);

  async function leave(run: () => Promise<unknown>) {
    await run().catch(() => undefined);
    dispatch(sessionEnded());
    window.location.assign("/manage/login");
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
        <span className="text-xs text-brick">
          Sign out every device using this login, shared tablets included?
        </span>
        <button
          className="btn-primary px-3 py-1.5 text-sm"
          disabled={everywhere.isLoading}
          onClick={() => void leave(() => logoutEverywhere().unwrap())}
        >
          {everywhere.isLoading ? "Signing out…" : "Sign out everywhere"}
        </button>
        <button className="text-xs underline" onClick={() => setConfirming(false)}>
          cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {session.email && (
        <span className="hidden text-xs text-muted sm:inline">
          {session.fullName ?? session.email}
          {session.roleCode && ` · ${session.roleCode.toLowerCase()}`}
        </span>
      )}
      {/* A full navigation: the page is its own entry outside React, like the
          sign-in pages. */}
      <a className="hidden text-xs text-muted underline sm:inline" href="/manage/change-password">
        Change password
      </a>
      <button
        className="hidden text-xs text-muted underline sm:inline"
        onClick={() => setConfirming(true)}
      >
        Sign out all devices
      </button>
      <button
        className="btn-quiet px-3 py-1.5 text-sm"
        disabled={isLoading}
        onClick={() => void leave(() => logout().unwrap())}
      >
        Sign out
      </button>
    </div>
  );
}
