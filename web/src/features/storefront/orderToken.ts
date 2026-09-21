/**
 * The order-view token from a guest's confirmation email.
 *
 * It arrives as ?t= on the tracking URL and is moved out of the address bar
 * the first time it is read. A token in the address bar is a token that gets
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

/**
 * The token for the current URL, from the query string or from where an
 * earlier call on this tab put it. Safe to call repeatedly and from more than
 * one place -- the guard asks before the page does.
 */
export function takeOrderToken(): string | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;

  const fromUrl = new URLSearchParams(window.location.search).get("t");
  if (fromUrl) {
    try {
      window.sessionStorage.setItem(key(path), fromUrl);
    } catch {
      // Private window, or storage refused. The token still works for this
      // render; only surviving a reload is lost, so the URL keeps it.
      return fromUrl;
    }
    // Out of the address bar, without adding a history entry.
    const url = new URL(window.location.href);
    url.searchParams.delete("t");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    return fromUrl;
  }

  try {
    return window.sessionStorage.getItem(key(path));
  } catch {
    return null;
  }
}
