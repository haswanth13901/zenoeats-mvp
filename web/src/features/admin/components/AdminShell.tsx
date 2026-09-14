import type { ReactNode } from "react";
import { Shell } from "@/components/layout/Shell";
import { AdminSignOut } from "./AdminSignOut";

export const ADMIN_NAV = [{ href: "/admin", label: "Restaurants" }];

/**
 * The platform portal's header, which is the same on every admin page.
 *
 * Pages used to pass their own title and action to Shell, so the orders page
 * carried a "Back" link where every other page carried "Sign out" -- an
 * operator two pages deep had no way out of the portal. The chrome is fixed
 * here instead: the wordmark and the nav both lead to /admin, and signing out
 * is always in the same place.
 *
 * Only the login pages are exempt, and they are outside React entirely --
 * separate HTML entry points served by nginx, so they never mount this.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <Shell title="ZenoEats" titleHref="/admin" nav={ADMIN_NAV} action={<AdminSignOut />}>
      {children}
    </Shell>
  );
}
