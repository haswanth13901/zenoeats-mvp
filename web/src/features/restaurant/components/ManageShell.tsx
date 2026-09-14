import type { ReactNode } from "react";
import { useAppSelector } from "@/app/hooks";
import { Shell } from "@/components/layout/Shell";
import { selectSession } from "@/features/session/sessionSlice";
import { navFor } from "../nav";
import { StaffSignOut } from "./StaffSignOut";

/**
 * The restaurant portal's header, which is the same on every page.
 *
 * Pages used to pass their own title, so the header read "Kitchen" beside a
 * nav whose Kitchen tab was already highlighted -- the same word twice, and
 * the one thing an operator actually wants at a glance was nowhere on screen.
 * It carries the restaurant name instead, and the highlighted tab says which
 * page this is, which is what a highlighted tab is for.
 *
 * The name comes from the session rather than a fetch of its own: the guard
 * above every one of these pages has already asked who the caller is, and the
 * answer says which restaurant they are scoped to. Before it answers the guard
 * is still showing its own loading state, so the fallback below is only ever
 * seen if a page mounts outside one.
 */
export function ManageShell({ children }: { children: ReactNode }) {
  const { restaurantName, roleCode } = useAppSelector(selectSession);

  return (
    <Shell
      title={restaurantName ?? "Restaurant"}
      titleHref="/manage"
      nav={navFor(roleCode)}
      action={<StaffSignOut />}
    >
      {children}
    </Shell>
  );
}
