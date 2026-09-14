import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { api } from "@/services/api";
import cartReducer from "@/features/cart/cartSlice";
import sessionReducer from "@/features/session/sessionSlice";

/**
 * Two slices and one RTK Query cache, deliberately.
 *
 * Server data -- restaurants, orders, menus, reports -- lives in the RTK Query
 * cache rather than in slices of its own. Hand-written slices for it would
 * mean hand-written loading flags, error flags and invalidation, which is the
 * boilerplate RTK Query exists to remove.
 *
 * Everything a single component owns (form inputs, open modals, pagination
 * offsets, hover) stays in that component. Putting it here would make the
 * store a dumping ground and every unrelated render a subscription.
 */
export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    cart: cartReducer,
    session: sessionReducer,
  },
  middleware: (getDefault) => getDefault().concat(api.middleware),
});

// Enables refetchOnFocus / refetchOnReconnect. The kitchen board runs all
// shift on a tablet that sleeps; coming back to a stale board is worse than a
// brief refetch.
setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
