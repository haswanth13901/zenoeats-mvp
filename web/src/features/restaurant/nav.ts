import type { NavItem } from "@/components/layout/Shell";

/**
 * Who may open what in the restaurant portal.
 *
 * These mirror the API's role checks (MANAGE, KITCHEN and staff admin in
 * restaurant.py), which are what actually decide. They exist so the portal
 * offers each person the screens their role can use: a kitchen login used to
 * see every tab and meet "Not authorized" on three of the four.
 */
export const ALL_STAFF_ROLES = ["ADMIN", "MANAGER", "KITCHEN", "CASHIER"];
export const MANAGER_ROLES = ["ADMIN", "MANAGER"];
export const ADMIN_ROLES = ["ADMIN"];

export type ManageNavItem = NavItem & { roles: string[] };

export const MANAGE_NAV: ManageNavItem[] = [
  { href: "/manage", label: "Kitchen", roles: ALL_STAFF_ROLES },
  { href: "/manage/stock", label: "Stock", roles: ALL_STAFF_ROLES },
  { href: "/manage/menu", label: "Menu", roles: MANAGER_ROLES },
  { href: "/manage/staff", label: "Staff", roles: ADMIN_ROLES },
  { href: "/manage/reports", label: "Reports", roles: MANAGER_ROLES },
];

/** The tabs this role can use. No role yet -- the guard has not answered --
 *  shows only what every role has, so nothing flashes and disappears. */
export function navFor(roleCode: string | null): NavItem[] {
  const role = roleCode ?? "";
  return MANAGE_NAV.filter(
    (item) => item.roles.includes(role) || item.roles === ALL_STAFF_ROLES,
  );
}

export function canManage(roleCode: string | null): boolean {
  return !!roleCode && MANAGER_ROLES.includes(roleCode);
}
