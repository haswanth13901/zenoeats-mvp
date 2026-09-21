import { useLayoutEffect } from "react";
import { usePortalQuery } from "@/features/storefront/storefrontApi";
import { CustomerFooter } from "@/features/storefront/components/CustomerFooter";
import { attachFont, themeVariables } from "@/features/storefront/theme";
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
  const { data } = usePortalQuery();
  const theme = data?.storefront?.theme ?? null;
  useLayoutEffect(() => {
    const root = document.documentElement;
    const vars = themeVariables(theme);
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, String(value));
    const removeFont = attachFont(theme?.font_pair ?? "default");
    return () => {
      for (const key of Object.keys(vars)) root.style.removeProperty(key);
      removeFont();
    };
  }, [theme]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.surface = "customer";
    return () => {
      delete root.dataset.surface;
    };
  }, []);

  return (
    <>
      <Outlet />
      <CustomerFooter />
    </>
  );
}
