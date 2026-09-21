import { useCallback, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { Shell } from "@/components/layout/Shell";
import { selectSession } from "@/features/session/sessionSlice";
import { homeFor, navFor } from "../nav";
import { OwnAccount } from "./OwnAccount";
import { StaffIdentity, StaffSignOut } from "./StaffSignOut";

/**
 * The restaurant portal's header, which is the same on every page.
 *
 * It carries the restaurant name rather than the page's, and the highlighted
 * tab says which page this is. The name comes from the session rather than a
 * fetch of its own: the guard above every one of these pages has already
 * asked who the caller is, and the answer says which restaurant they are
 * scoped to. Before it answers the guard is still showing its own loading
 * state, so the fallback below is only ever seen if a page mounts outside one.
 *
 * "Your account" opens above the page from the account menu, for every role.
 * The endpoints behind it are open to every member; restaurant Settings is
 * not, and opening your own name and password does not open that. On the
 * Settings page the same panel is already the first section, so the menu
 * scrolls to it instead of drawing a second copy.
 */
export function ManageShell({ children }: { children: ReactNode }) {
  const { restaurantName, roleCode, storefrontEnabled } = useAppSelector(selectSession);
  const { pathname } = useLocation();
  const [accountOpen, setAccountOpen] = useState(false);
  const onSettings = pathname === "/manage/settings";

  const openAccount = useCallback(() => {
    const panel = document.getElementById("own-account");
    if (onSettings && panel) {
      panel.scrollIntoView({ block: "start" });
      document.getElementById("own-account-heading")?.focus({ preventScroll: true });
      return;
    }
    setAccountOpen(true);
  }, [onSettings]);
  const closeAccount = useCallback(() => setAccountOpen(false), []);

  return (
    <Shell
      title={restaurantName ?? "Restaurant"}
      titleHref={homeFor(roleCode)}
      nav={navFor(roleCode, storefrontEnabled)}
      identity={<StaffIdentity />}
      action={<StaffSignOut onOpenAccount={openAccount} />}
    >
      {accountOpen && !onSettings && <OwnAccount onClose={closeAccount} />}
      {children}
    </Shell>
  );
}
