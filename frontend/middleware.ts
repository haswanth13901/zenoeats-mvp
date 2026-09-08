import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// The menu is public. Everything else needs a session. Authorization itself
// is decided server-side against restaurant_users and RLS; this only keeps
// signed-out visitors off the operator screens.
const isProtected = createRouteMatcher([
  "/checkout(.*)",
  "/orders(.*)",
  "/manage(.*)",
  "/admin(.*)",
]);

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "zenoeats.local";

/** The leading label of the Host, mirroring the API's extract_slug. */
function slugFromHost(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(":")[0].trim().toLowerCase().replace(/\.$/, "");
  const suffix = `.${ROOT_DOMAIN.toLowerCase()}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  return label && !label.includes(".") ? label : null;
}

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();

  // nginx forwards Host untouched, so the API resolves the tenant from it.
  // Next's rewrite proxy does not: it replaces Host with the destination's,
  // and the subdomain the browser asked for is lost. When the browser talks
  // to Next directly there is no nginx, so pass the slug explicitly in the
  // header the API already accepts as a development fallback. Setting it here
  // unconditionally also means a client cannot smuggle its own value in.
  const headers = new Headers(req.headers);
  headers.delete("x-zenoeats-restaurant");
  const slug = slugFromHost(req.headers.get("host"));
  if (slug) headers.set("x-zenoeats-restaurant", slug);

  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: ["/((?!_next|.*\..*).*)", "/(api|trpc)(.*)"],
};
