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
  middleware: (getDefault) =>
    getDefault({
      // Every failure this app raises is an ApiError, which is an Error
      // subclass and therefore not serialisable. That is deliberate -- pages
      // read `e instanceof ApiError` and branch on `e.code`, which a plain
      // object would not support -- so the development-only check is told
      // where those live rather than the errors being flattened to satisfy it.
      //
      // Left unconfigured it was merely latent, warning whenever a request
      // happened to fail. It became constant once the storefront started
      // asking who is ordering: "nobody" is a 401, and that is the ordinary
      // answer on the busiest page in the product. A console full of warnings
      // on every menu view is how a real error goes unnoticed.
      serializableCheck: {
        ignoredActions: [
          "api/executeQuery/rejected",
          "api/executeMutation/rejected",
          "api/executeQuery/fulfilled",
        ],
        ignoredPaths: [/^api\.queries\..*\.error$/, /^api\.mutations\..*\.error$/],
      },
    }).concat(api.middleware),
});

// Enables refetchOnFocus / refetchOnReconnect. The kitchen board runs all
// shift on a tablet that sleeps; coming back to a stale board is worse than a
// brief refetch.
setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
