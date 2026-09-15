import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { sessionEnded, selectSession } from "@/features/session/sessionSlice";
import { useStaffLogoutMutation } from "../restaurantApi";

/**
 * Ends the restaurant staff session.
 *
 * Shows who is signed in and in what role, because a shared kitchen tablet
 * often is not obviously anyone's -- and the role decides which controls the
 * portal offers.
 *
 * The cookie is httpOnly, so only the server can clear it.
 */
export function StaffSignOut() {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectSession);
  const [logout, { isLoading }] = useStaffLogoutMutation();

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
        className="btn-quiet px-3 py-1.5 text-sm"
        disabled={isLoading}
        onClick={async () => {
          await logout().unwrap().catch(() => undefined);
          dispatch(sessionEnded());
          window.location.assign("/manage/login");
        }}
      >
        Sign out
      </button>
    </div>
  );
}
