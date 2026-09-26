/**
 * Where a sign-in page may send someone afterwards: a path on this site, and
 * nothing that only looks like one.
 *
 * "Starts with / but not //" is not enough, and was the rule here. A browser
 * strips tabs and newlines out of a URL before reading it, so "/%09/evil.com"
 * passed as a path and navigated to evil.com: an open redirect, which is how
 * a phishing page gets a link on our own domain that ends on theirs. So the
 * browser's own parser decides where a value leads, and only a result on
 * this origin is accepted -- as a path that cannot itself read as another
 * host ("//evil.com" is protocol-relative once it reaches location).
 */
export function safeNextPath(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  // Control characters and backslashes have no business in a path we built,
  // and both are what URL parsers quietly rewrite.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return fallback;
  }
  if (url.origin !== window.location.origin || url.pathname.startsWith("//")) return fallback;
  return url.pathname + url.search + url.hash;
}
