import type { NavItem } from "@/components/layout/Shell";

/**
 * Who may open what in the restaurant portal.
 *
 * These mirror the API's role checks (MANAGE, KITCHEN and staff admin in
 * restaurant.py), which are what actually decide. They exist so the portal
 * offers each person the screens their role can use: a kitchen login used to
 * see every tab and meet "Not authorized" on three of the four.
 */
// The floor: everyone who works in the restaurant. A driver is not one of
// them -- they see the orders assigned to them and nothing else of the portal.
export const ALL_STAFF_ROLES = ["ADMIN", "MANAGER", "KITCHEN", "CASHIER"];
export const MANAGER_ROLES = ["ADMIN", "MANAGER"];
export const ADMIN_ROLES = ["ADMIN"];
export const DELIVERY_ROLES = ["ADMIN", "MANAGER", "DRIVER"];

export type ManageNavItem = NavItem & { roles: string[] };

export const MANAGE_NAV: ManageNavItem[] = [
  { href: "/manage", label: "Kitchen", icon: "kitchen", roles: ALL_STAFF_ROLES },
  { href: "/manage/deliveries", label: "Deliveries", icon: "bag", roles: DELIVERY_ROLES },
  { href: "/manage/stock", label: "Stock", icon: "stock", roles: ALL_STAFF_ROLES },
  { href: "/manage/menu", label: "Menu", icon: "menu", roles: MANAGER_ROLES },
  { href: "/manage/staff", label: "Staff", icon: "team", roles: ADMIN_ROLES },
  { href: "/manage/reports", label: "Reports", icon: "report", roles: MANAGER_ROLES },
  { href: "/manage/settings", label: "Settings", icon: "edit", roles: ADMIN_ROLES },
];

/** The tabs this role can use. No role yet -- the guard has not answered --
 *  shows only what the floor has, so nothing flashes and disappears. */
export function navFor(roleCode: string | null): NavItem[] {
  if (!roleCode) return MANAGE_NAV.filter((item) => item.roles === ALL_STAFF_ROLES);
  return MANAGE_NAV.filter((item) => item.roles.includes(roleCode));
}

/** Where this role starts, which for a driver is not the kitchen board. */
export function homeFor(roleCode: string | null): string {
  return navFor(roleCode)[0]?.href ?? "/manage";
}

export function isDriver(roleCode: string | null): boolean {
  return roleCode === "DRIVER";
}

export function canManage(roleCode: string | null): boolean {
  return !!roleCode && MANAGER_ROLES.includes(roleCode);
}
