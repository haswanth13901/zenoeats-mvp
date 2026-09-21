import { useAppDispatch } from "@/app/hooks";
import { sessionEnded } from "@/features/session/sessionSlice";
import { useAdminLogoutMutation } from "../adminApi";

/**
 * Ends the platform-admin session.
 *
 * The cookie is httpOnly, so only the server can clear it -- this cannot be
 * done in the browser alone. The local session slice is cleared too, and the
 * redirect is a full navigation because the login page is a separate HTML
 * entry point outside React.
 */
export function AdminSignOut() {
  const dispatch = useAppDispatch();
  const [logout, { isLoading }] = useAdminLogoutMutation();

  return (
    <button
      className="btn-quiet btn-compact sm:min-h-[46px] sm:px-[19px] sm:text-sm"
      disabled={isLoading}
      onClick={async () => {
        // A failed logout still means the operator wants out; the cookie
        // expires on its own, so leaving them on an authenticated-looking
        // screen would be worse than redirecting anyway.
        await logout().unwrap().catch(() => undefined);
        dispatch(sessionEnded());
        window.location.assign("/admin/login");
      }}
    >
      {isLoading ? "Signing out…" : "Sign out"}
    </button>
  );
}
