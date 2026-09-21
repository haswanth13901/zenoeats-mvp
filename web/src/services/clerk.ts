import type { Clerk } from "@clerk/clerk-js";

/**
 * Clerk, for customers only, loaded once per page.
 *
 * The customer pages are our own markup; Clerk sits underneath them. It stores
 * passwords, runs Google sign-in, sends verification and reset codes, and
 * keeps the session. Nothing here renders a Clerk component.
 *
 * The SDK is not bundled. It is fetched from this Clerk instance's own
 * Frontend API, as Clerk's React SDK does: that is Clerk's browser build,
 * about 80 KB gzipped with the rest loaded as needed, where bundling the npm
 * build shipped a single 590 KB chunk to every phone at checkout. The npm
 * package is only here for its types.
 *
 * Only customer pages ever call this. The staff and platform portals share
 * the app bundle but authenticate with credentials the platform issues, and
 * neither Clerk's weight nor a Clerk outage should reach them.
 */

// The container's runtime value first (public/config.js, rewritten at start),
// so one image serves every environment. The build-time variable is the
// development fallback, where no container writes config.js.
const PUBLISHABLE_KEY =
  window.__ZENOEATS_CONFIG__?.clerkPublishableKey ||
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  "";
// Major version only, matching the types this code is checked against. Clerk
// serves the latest release within it.
const CLERK_JS_MAJOR = 6;

let loading: Promise<Clerk> | null = null;

declare global {
  interface Window {
    Clerk?: Clerk;
    __ZENOEATS_CONFIG__?: { clerkPublishableKey?: string };
  }
}

/** The instance's Frontend API host, which the publishable key encodes:
 *  pk_test_<base64 of "host$">. */
function frontendApiHost(key: string): string {
  const encoded = key.split("_").slice(2).join("_");
  return atob(encoded).replace(/\$$/, "");
}

function injectScript(): Promise<Clerk> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://${frontendApiHost(PUBLISHABLE_KEY)}/npm/@clerk/clerk-js@${CLERK_JS_MAJOR}/dist/clerk.browser.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    // The browser build reads this attribute and creates window.Clerk with it.
    script.setAttribute("data-clerk-publishable-key", PUBLISHABLE_KEY);
    script.addEventListener("load", () => {
      if (window.Clerk) resolve(window.Clerk);
      else reject(new Error("Clerk loaded but did not start."));
    });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("Couldn't load Clerk."));
    });
    document.head.appendChild(script);
  });
}

export function clerkConfigured(): boolean {
  return PUBLISHABLE_KEY.length > 0;
}

/** The loaded Clerk instance. Rejects when no publishable key was built in,
 *  so callers can say sign-in is unavailable rather than hang. */
export function getClerk(): Promise<Clerk> {
  if (!clerkConfigured()) {
    return Promise.reject(
      new Error(
        "Customer sign-in is not configured. Set CLERK_PUBLISHABLE_KEY on the web container (VITE_CLERK_PUBLISHABLE_KEY in development).",
      ),
    );
  }
  if (!loading) {
    loading = (async () => {
      const clerk = window.Clerk ?? (await injectScript());
      await clerk.load();
      return clerk;
    })();
    // A failed load (offline, blocked script) must not be cached forever: the
    // next attempt should try again.
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/**
 * A short-lived session token for the API, or null when signed out.
 *
 * Clerk's tokens live about a minute and Clerk refreshes them itself, so this
 * is called per request rather than held anywhere.
 */
export async function getCustomerToken(): Promise<string | null> {
  if (!clerkConfigured()) return null;
  const clerk = await getClerk();
  return (await clerk.session?.getToken()) ?? null;
}

/**
 * Whether Clerk probably has a session in this browser, without loading Clerk.
 *
 * Clerk writes __client_uat on the origin for precisely this question -- it is
 * what its server-side helpers read to decide whether a page is signed in. A
 * positive value is a signed-in session, 0 or absent is signed out. Some
 * instances suffix the name (__client_uat_a1b2c3), so both are matched.
 *
 * A hint, never an authorisation: it carries no identity and the API verifies
 * the real token regardless. What it buys is the storefront, which is the page
 * a QR code opens, not pulling down the Clerk SDK for a customer who is only
 * reading a menu.
 */
export function maybeSignedIn(): boolean {
  if (!clerkConfigured()) return false;
  if (window.Clerk?.session) return true;
  const match = document.cookie.match(/(?:^|;\s*)__client_uat(?:_[^=]*)?=([^;]*)/);
  if (!match?.[1]) return false;
  const seenAt = Number(decodeURIComponent(match[1]));
  return Number.isFinite(seenAt) && seenAt > 0;
}

/**
 * A session token, but only if this browser looks signed in already.
 *
 * For callers that ask "who is ordering?" on a page where the answer is
 * usually "nobody, they are browsing": a guest is identified by a cookie the
 * browser sends itself, so loading Clerk to be told there is no token would
 * be the whole cost of Clerk for no answer.
 */
export async function getCustomerTokenIfSignedIn(): Promise<string | null> {
  if (!maybeSignedIn()) return null;
  try {
    return await getCustomerToken();
  } catch {
    // Clerk unreachable. The request still carries any guest cookie, and the
    // API answers 401 if that is nothing -- which is the right answer here.
    return null;
  }
}

/** Clerk's own wording for a failed call, which names the field at fault. */
export function clerkErrorMessage(e: unknown): string {
  const errors = (e as { errors?: { longMessage?: string; message?: string }[] })?.errors;
  const first = Array.isArray(errors) ? errors[0] : undefined;
  if (first) return first.longMessage ?? first.message ?? "Something went wrong.";
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

/** The machine-readable code on a Clerk error, when there is one. */
export function clerkErrorCode(e: unknown): string | null {
  const errors = (e as { errors?: { code?: string }[] })?.errors;
  return Array.isArray(errors) ? (errors[0]?.code ?? null) : null;
}
