import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";

/**
 * Who is signed in -- to a portal, or to the storefront -- and in what capacity.
 *
 * The second of the two things that genuinely belongs in Redux. The layout
 * chrome needs the identity to render sign-out, route guards need it to decide
 * whether to admit anyone, and the restaurant portal needs role_code to hide
 * controls a KITCHEN account may not use. Passing that down from every page
 * would be prop drilling through the whole tree.
 *
 * It holds no credential. The session itself is an httpOnly cookie the browser
 * sends on its own and JavaScript cannot read; this is only what the server
 * said about it. The server re-authorises every request regardless, so nothing
 * here grants access -- clearing it signs nobody out, and forging it admits
 * nobody.
 */

export type Portal = "admin" | "staff" | "customer";

export type SessionState = {
  portal: Portal | null;
  email: string | null;
  fullName: string | null;
  /** Restaurant portal only: ADMIN, MANAGER, KITCHEN or CASHIER. */
  roleCode: string | null;
  /** Restaurant portal only: the name shown in the header, so an operator can
   *  see which restaurant they are working in without reading the address. */
  restaurantName: string | null;
  /** True while a platform-issued temporary password is still in place. The
   *  API refuses everything but the change-password endpoint until it is
   *  replaced, so the UI should not offer anything else either. */
  mustChangePassword: boolean;
  /** Distinguishes "not signed in" from "not asked yet", so a guard does not
   *  redirect before the first /me has answered. */
  status: "unknown" | "authenticated" | "anonymous";
};

const initialState: SessionState = {
  portal: null,
  email: null,
  fullName: null,
  roleCode: null,
  restaurantName: null,
  mustChangePassword: false,
  status: "unknown",
};

const sessionSlice = createSlice({
  name: "session",
  initialState,
  reducers: {
    sessionEstablished(
      state,
      action: PayloadAction<{
        portal: Portal;
        email: string;
        fullName?: string | null;
        roleCode?: string | null;
        restaurantName?: string | null;
        mustChangePassword?: boolean;
      }>,
    ) {
      const p = action.payload;
      state.portal = p.portal;
      state.email = p.email;
      state.fullName = p.fullName ?? null;
      state.roleCode = p.roleCode ?? null;
      state.restaurantName = p.restaurantName ?? null;
      state.mustChangePassword = p.mustChangePassword ?? false;
      state.status = "authenticated";
    },

    sessionEnded(state) {
      state.portal = null;
      state.email = null;
      state.fullName = null;
      state.roleCode = null;
      state.restaurantName = null;
      state.mustChangePassword = false;
      state.status = "anonymous";
    },
  },
});

export const { sessionEstablished, sessionEnded } = sessionSlice.actions;
export default sessionSlice.reducer;

export const selectSession = (s: RootState) => s.session;
export const selectIsAuthenticated = (s: RootState) => s.session.status === "authenticated";
export const selectRoleCode = (s: RootState) => s.session.roleCode;
