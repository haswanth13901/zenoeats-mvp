/**
 * The order-view token from a guest's confirmation email.
 *
 * It arrives as #t= on the tracking URL -- in the fragment, which a browser
 * never sends to a server, so it is in no access log -- and is moved out of
 * the address bar the first time it is read. Links from before that change
 * carried it as ?t=, which is still read, then removed the same way. A token in the address bar is a token that gets
 * copied into a chat, mailed on, pasted into a support ticket and kept in
 * browser history -- and it opens that order's pickup PIN for seven days to
 * whoever holds it.
 *
 * Deleting it outright was the wrong fix: this link exists so a guest can
 * reach their order from a device holding no cookie, and there it is the only
 * credential they have. Stripping it would make a reload -- or the browser
 * restoring the tab -- a dead end.
 *
 * So it moves to sessionStorage instead, which survives reloads, is scoped to
 * the one tab, dies with it, and never leaves in a copied URL. Keyed by path,
 * so a token for one order is never offered for another.
 */
const PREFIX = "zenoeats:order-token:";

function key(path: string): string {
  return PREFIX + path;
}

/** "t" from the fragment (#t=...), then from the query string (?t=...). */
function tokenInUrl(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  return new URLSearchParams(hash).get("t") || new URLSearchParams(window.location.search).get("t");
}

/** The current URL without "t" in either place, for history.replaceState. */
function urlWithoutToken(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("t");
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  hash.delete("t");
  const rest = hash.toString();
  return url.pathname + url.search + (rest ? `#${rest}` : "");
}

/**
 * The token for the current URL, from the address bar or from where an
 * earlier call on this tab put it. Safe to call repeatedly and from more than
 * one place -- the guard asks before the page does.
 */
export function takeOrderToken(): string | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;

  const fromUrl = tokenInUrl();
  if (fromUrl) {
    try {
      window.sessionStorage.setItem(key(path), fromUrl);
    } catch {
      // Private window, or storage refused. The token still works for this
      // render; only surviving a reload is lost, so the URL keeps it.
      return fromUrl;
    }
    // Out of the address bar, without adding a history entry.
    window.history.replaceState(window.history.state, "", urlWithoutToken());
    return fromUrl;
  }

  try {
    return window.sessionStorage.getItem(key(path));
  } catch {
    return null;
  }
}
