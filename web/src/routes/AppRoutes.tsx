import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, createRoutesFromElements, RouterProvider, Route } from "react-router-dom";
import { RequireCustomer } from "@/components/layout/Guards";
import { StorefrontPage } from "@/pages/storefront/StorefrontPage";
import { CustomerSurface } from "@/components/layout/CustomerSurface";
import { Booting } from "@/components/layout/guardParts";
import { NotFound } from "@/routes/NotFound";

/**
 * Route table.
 *
 * URLs carry over from the Next app -- /, /checkout, /orders/:orderId,
 * /manage/*, /admin/* -- so existing links, bookmarks and the QR codes printed
 * on tables keep working. /checkout/pay/:orderId is the one addition: paying
 * used to be a second stage rendered inside /checkout, and is now a page of
 * its own so the customer navigates to it.
 *
 * /admin/login, /manage/login, /manage/change-password and the /account/*
 * customer sign-in pages are absent on purpose. They are separate HTML entry
 * points outside React, served directly by the dev server and by nginx, so
 * they never reach this router.
 *
 * WHAT IS LOADED WHEN, and why it is worth the machinery.
 *
 * One bundle used to carry all three portals, so the page a QR code opens --
 * a menu, on a phone, on restaurant wifi -- spent a third of its download on
 * the kitchen board, the menu builder and the platform admin screens, none of
 * which that person can open. Both operator portals are now fetched only when
 * someone navigates into them, and the customer pages past the menu are
 * fetched when the customer moves towards paying.
 *
 * The storefront itself stays eager. It is the first thing rendered on the
 * busiest route in the product, and splitting it would buy a spinner.
 *
 * The boundary is the import graph, not this file: an area's chunk is
 * whatever it imports. That is why each portal owns its own sub-routes and
 * its own guard, rather than listing them here -- listing them here is what
 * would pull them back into the shell.
 */

/**
 * A route fetched on first visit, behind the loading state the guards use.
 *
 * Called at module scope so React.lazy is created once, not per render: a
 * lazy component rebuilt on every render remounts its subtree and refetches
 * every query under it.
 */
function lazyRoute(load: () => Promise<{ default: ComponentType }>) {
  const Loaded = lazy(load);
  return (
    <Suspense fallback={<Booting />}>
      <Loaded />
    </Suspense>
  );
}

const CheckoutRoute = lazyRoute(() =>
  import("@/pages/storefront/CheckoutPage").then((m) => ({ default: m.CheckoutPage })),
);
const PaymentRoute = lazyRoute(() =>
  import("@/pages/storefront/PaymentPage").then((m) => ({ default: m.PaymentPage })),
);
const OrderRoute = lazyRoute(() =>
  import("@/pages/storefront/OrderPage").then((m) => ({ default: m.OrderPage })),
);
const ProfileRoute = lazyRoute(() =>
  import("@/pages/storefront/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const ManageRoute = lazyRoute(() => import("@/routes/ManageArea"));
const AdminRoute = lazyRoute(() => import("@/routes/AdminArea"));

const router = createBrowserRouter(createRoutesFromElements(
      <>
        {/* Customer surface. The storefront is deliberately public; only the
            routes that need an identity are guarded. */}
        <Route element={<CustomerSurface />}>
          <Route path="/" element={<StorefrontPage />} />
          <Route
            path="/checkout"
            element={
              <RequireCustomer>
                {CheckoutRoute}
              </RequireCustomer>
            }
          />
          <Route
            path="/checkout/pay/:orderId"
            element={
              <RequireCustomer>
                {PaymentRoute}
              </RequireCustomer>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <RequireCustomer allowOrderToken>
                {OrderRoute}
              </RequireCustomer>
            }
          />

          <Route
            path="/account/profile"
            element={
              <RequireCustomer>
                {ProfileRoute}
              </RequireCustomer>
            }
          />
          {/* Keep the existing profile URL for bookmarks and current links. */}
          <Route
            path="/profile"
            element={
              <RequireCustomer>
                {ProfileRoute}
              </RequireCustomer>
            }
          />
        </Route>

        {/* Restaurant portal. Credentials issued by the platform. */}
        <Route path="/manage/*" element={ManageRoute} />

        {/* Platform portal. Credentials from ADMIN_USERS. */}
        <Route path="/admin/*" element={AdminRoute} />

        <Route path="*" element={<NotFound />} />
      </>
));

export function AppRoutes() { return <RouterProvider router={router} />; }

/**
 * Root.
 *
 * No provider wraps the tree any more. Every session -- customer, staff and
 * admin -- is an httpOnly cookie the API sets and reads, so there is nothing
 * for the client to initialise and no build-time key whose absence could take
 * a portal down.
 */
export function Root() {
  return <AppRoutes />;
}
