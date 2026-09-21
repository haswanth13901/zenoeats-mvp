import { useEffect } from "react";
import { useAppDispatch } from "@/app/hooks";
import { cartOpened } from "@/features/cart/cartSlice";
import { usePortalQuery } from "@/features/storefront/storefrontApi";

/**
 * Bind the cart to this restaurant and restore anything saved for it.
 *
 * Every page that reads the cart has to call this, not just the one that
 * fills it. The store starts empty on each full page load, and the cart only
 * comes back from localStorage when this runs -- so a page that skipped it
 * showed an empty cart to someone whose cart was sitting in storage the whole
 * time. That is exactly what happened at checkout: signing in is a full
 * navigation out of the app and back, which throws the store away, and the
 * customer returned to "Your cart is empty".
 *
 * Keyed by slug because subdomains share an origin, and therefore share
 * localStorage: one global key would show a cart from one restaurant on
 * another's menu.
 *
 * The portal query is already cached by the time this runs on any page that
 * renders the restaurant, so calling it here costs no extra request.
 */
export function useOpenCart(): void {
  const dispatch = useAppDispatch();
  const slug = usePortalQuery().data?.slug;

  useEffect(() => {
    if (slug) dispatch(cartOpened(slug));
  }, [slug, dispatch]);
}
