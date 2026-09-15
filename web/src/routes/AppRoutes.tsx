import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RequireAdmin, RequireCustomer, RequireStaff } from "@/components/layout/Guards";
import { AdminRestaurantsPage } from "@/pages/admin/AdminRestaurantsPage";
import { AdminOrdersPage } from "@/pages/admin/AdminOrdersPage";
import { KitchenBoardPage } from "@/pages/manage/KitchenBoardPage";
import { MenuPage } from "@/pages/manage/MenuPage";
import { StaffPage } from "@/pages/manage/StaffPage";
import { ReportsPage } from "@/pages/manage/ReportsPage";
import { StockPage } from "@/pages/manage/StockPage";
import { DeliveriesPage } from "@/pages/manage/DeliveriesPage";
import {
  ADMIN_ROLES,
  ALL_STAFF_ROLES,
  DELIVERY_ROLES,
  MANAGER_ROLES,
} from "@/features/restaurant/nav";
import { StorefrontPage } from "@/pages/storefront/StorefrontPage";
import { CheckoutPage } from "@/pages/storefront/CheckoutPage";
import { PaymentPage } from "@/pages/storefront/PaymentPage";
import { OrderPage } from "@/pages/storefront/OrderPage";

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
 */
export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Customer surface. The storefront is deliberately public; only the
            two routes that need an identity are guarded. */}
        <Route path="/" element={<StorefrontPage />} />
        <Route
          path="/checkout"
          element={
            <RequireCustomer>
              <CheckoutPage />
            </RequireCustomer>
          }
        />
        <Route
          path="/checkout/pay/:orderId"
          element={
            <RequireCustomer>
              <PaymentPage />
            </RequireCustomer>
          }
        />
        <Route
          path="/orders/:orderId"
          element={
            <RequireCustomer>
              <OrderPage />
            </RequireCustomer>
          }
        />

        {/* Restaurant portal. Credentials issued by the platform. */}
        <Route
          path="/manage"
          element={<RequireStaff roles={ALL_STAFF_ROLES}><KitchenBoardPage /></RequireStaff>}
        />
        <Route
          path="/manage/deliveries"
          element={<RequireStaff roles={DELIVERY_ROLES}><DeliveriesPage /></RequireStaff>}
        />
        <Route
          path="/manage/stock"
          element={<RequireStaff roles={ALL_STAFF_ROLES}><StockPage /></RequireStaff>}
        />
        <Route
          path="/manage/menu"
          element={<RequireStaff roles={MANAGER_ROLES}><MenuPage /></RequireStaff>}
        />
        <Route
          path="/manage/staff"
          element={<RequireStaff roles={ADMIN_ROLES}><StaffPage /></RequireStaff>}
        />
        <Route
          path="/manage/reports"
          element={<RequireStaff roles={MANAGER_ROLES}><ReportsPage /></RequireStaff>}
        />

        {/* Platform portal. Credentials from ADMIN_USERS. */}
        <Route path="/admin" element={<RequireAdmin><AdminRestaurantsPage /></RequireAdmin>} />
        <Route
          path="/admin/restaurants/:id/orders"
          element={<RequireAdmin><AdminOrdersPage /></RequireAdmin>}
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-5 py-24 text-center">
      <h1 className="font-display text-3xl">Page not found</h1>
    </main>
  );
}

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
