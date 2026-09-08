const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api/v1";

/** Nothing should hang the UI forever. A request that has not answered by
 *  now is not going to. */
const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  code: string;
  /** HTTP status, or 0 when the request never reached the server. */
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Opts = {
  method?: string;
  body?: unknown;
  token?: string | null;
  idempotencyKey?: string;
  /** Caller-owned cancellation, e.g. an unmounting component. */
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** Every failure reaching a caller is an ApiError with a usable `code`, so
 *  `catch (e) { (e as ApiError).code }` is never a lie. The one exception is
 *  a caller-initiated abort, which is rethrown untouched so callers can tell
 *  "I cancelled this" apart from "it failed". */
export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const unlink = link(opts.signal, timeout);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
      signal: timeout.signal,
    });
  } catch (cause) {
    // The caller cancelled: their business, not an error condition.
    if (opts.signal?.aborted) throw cause;
    if (timeout.signal.aborted) {
      throw new ApiError(0, "TIMEOUT", "The server took too long to respond.");
    }
    // fetch() rejects with a bare TypeError for DNS, refused connections,
    // offline, and CORS alike. None of those carry a code of their own.
    throw new ApiError(0, "NETWORK_ERROR", "Couldn't reach the server. Check your connection.");
  } finally {
    clearTimeout(timer);
    unlink();
  }

  if (!res.ok) {
    let code = "UNKNOWN";
    let message = "Something went wrong.";
    try {
      const data = await res.json();
      // FastAPI wraps HTTPException detail; the 500 handler does not.
      const detail = data?.detail ?? data;
      if (detail && typeof detail === "object") {
        code = detail.code ?? code;
        message = detail.message ?? message;
      } else if (typeof detail === "string") {
        message = detail;
      }
    } catch {
      /* non-JSON error body (a proxy 502, an HTML error page) */
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Abort `child` when `parent` aborts. Returns an unsubscribe function so a
 *  long-lived caller signal does not accumulate listeners per request. */
function link(parent: AbortSignal | undefined, child: AbortController): () => void {
  if (!parent) return () => {};
  if (parent.aborted) {
    child.abort();
    return () => {};
  }
  const onAbort = () => child.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  return () => parent.removeEventListener("abort", onAbort);
}

/** Message for display. Accepts anything a catch block can receive. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

/** True when the throw came from a cancelled request rather than a failure. */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** Idempotency keys are generated once per checkout attempt and reused on
 *  retry, so a flaky network cannot produce two orders or two charges.
 *
 *  crypto.randomUUID() is restricted to secure contexts. Development serves
 *  the app over plain HTTP on a .local subdomain, which is not one, so the
 *  method is undefined in exactly the place the app is normally used and
 *  checkout throws on render. getRandomValues carries no such restriction.
 */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();

  if (typeof c?.getRandomValues !== "function") {
    throw new Error("No secure random source available; cannot start checkout.");
  }
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
