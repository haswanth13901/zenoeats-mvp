"use client";

import { useSessionApi, useSessionResource, type SessionRoutes } from "./sessionApi";

/** The super admin portal. Authenticates against ADMIN_USERS, so an expired
 *  or revoked session goes back to the platform login, not a customer one. */
const ADMIN: SessionRoutes = { login: "/admin/login" };

export function useAdminApi() {
  return useSessionApi(ADMIN);
}

export function useAdminResource<T>(path: string, pollMs?: number) {
  return useSessionResource<T>(ADMIN, path, pollMs);
}
