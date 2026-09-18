import { useLayoutEffect } from "react";
import { Outlet } from "react-router-dom";

/**
 * The customer surface: cream page and forest primary (globals.css).
 *
 * Set on <html> rather than on a wrapper element, because the item and combo
 * sheets render outside the page's own tree and would otherwise keep the
 * staff colours. A layout effect, so the first paint is already the right
 * palette. Removed on the way out, so a restaurant portal reached by client
 * navigation is never left forest green.
 */
export function CustomerSurface() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.surface = "customer";
    return () => {
      delete root.dataset.surface;
    };
  }, []);

  return <Outlet />;
}
