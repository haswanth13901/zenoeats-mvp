"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, errorMessage, isAbort } from "./api";

type CallOpts = { method?: string; body?: unknown; signal?: AbortSignal };

/** Where a session-backed portal sends someone whose session is no longer
 *  usable. The two portals differ only in these destinations, so everything
 *  else lives here once rather than being copied per portal. */
export type SessionRoutes = {
  /** 401: no session, expired, or revoked. */
  login: string;
  /** 403 PASSWORD_CHANGE_REQUIRED. Absent for portals that cannot hit it. */
  changePassword?: string;
};

/** Fetch bound to an httpOnly session cookie.
 *
 *  There is no token to attach: the browser sends the cookie and JavaScript
 *  cannot read it. The only interesting behaviour is what to do when the
 *  server says the session will not do.
 */
export function useSessionApi(routes: SessionRoutes) {
  const router = useRouter();

  return useCallback(
    async <T,>(path: string, opts: CallOpts = {}): Promise<T> => {
      try {
        return await api<T>(path, opts);
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 401) router.replace(routes.login);
          else if (e.code === "PASSWORD_CHANGE_REQUIRED" && routes.changePassword) {
            router.replace(routes.changePassword);
          }
        }
        throw e;
      }
    },
    [router, routes.login, routes.changePassword]
  );
}

/** Load once, with a refresh handle and optional polling.
 *
 *  Three things this has to get right, all of which bite on the kitchen board
 *  because it polls every five seconds:
 *
 *    - Only the newest response may write state. Without that, a slow request
 *      landing after a fast one silently reverts the board.
 *    - Nothing may write state after unmount.
 *    - Polls must not overlap. A chained timeout, not setInterval: if the
 *      server is slow, setInterval keeps firing and requests stack up.
 */
export function useSessionResource<T>(
  routes: SessionRoutes,
  path: string,
  pollMs?: number
) {
  const call = useSessionApi(routes);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const alive = useRef(false);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inFlight.current?.abort(); // supersede anything still running
    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const next = await call<T>(path, { signal: controller.signal });
      if (controller.signal.aborted || !alive.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted || !alive.current) return;
      setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted && alive.current) setLoading(false);
    }
  }, [call, path]);

  useEffect(() => {
    // Set here rather than at init: React StrictMode mounts, unmounts and
    // remounts in development, and a ref initialised to true would stay false
    // after that first teardown.
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await refresh();
      if (!stopped && pollMs) timer = setTimeout(tick, pollMs);
    };
    void tick();

    return () => {
      stopped = true;
      alive.current = false;
      clearTimeout(timer);
      inFlight.current?.abort();
    };
  }, [refresh, pollMs]);

  return { data, error, loading, refresh, call };
}
