"use client";

import { useSessionApi, useSessionResource, type SessionRoutes } from "./sessionApi";

/** The restaurant portal.
 *
 *  Staff credentials are issued by the platform, so an expired session goes
 *  to the staff login rather than Clerk. An account still holding a temporary
 *  password is refused everywhere with PASSWORD_CHANGE_REQUIRED, and the only
 *  useful response is to send them to choose a real one -- the API enforces
 *  that regardless, this just makes the refusal actionable.
 */
const STAFF: SessionRoutes = {
  login: "/manage/login",
  changePassword: "/manage/change-password",
};

export function useStaffApi() {
  return useSessionApi(STAFF);
}

export function useStaffResource<T>(path: string, pollMs?: number) {
  return useSessionResource<T>(STAFF, path, pollMs);
}
