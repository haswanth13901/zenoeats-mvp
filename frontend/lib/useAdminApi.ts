"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, errorMessage, isAbort } from "./api";

/** Platform-admin fetch.
 *
 *  The counterpart to useAuthedApi, which binds to a Clerk session. There is
 *  no token to attach here: the session is an httpOnly cookie the browser
 *  sends automatically and JavaScript cannot read. A 401 means the session
 *  expired or was revoked in ADMIN_USERS, and the only useful response is to
 *  send the operator back to the login form.
 */
export function useAdminApi() {
  const router = useRouter();

  return useCallback(
    async <T,>(
      path: string,
      opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}
    ): Promise<T> => {
      try {
        return await api<T>(path, opts);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace("/admin/login");
        throw e;
      }
    },
    [router]
  );
}

/** Load once, with a refresh handle and optional polling. Mirrors useResource
 *  but on the admin session. Same discipline: newest response wins, no writes
 *  after unmount, chained timeout so slow polls cannot stack. */
export function useAdminResource<T>(path: string, pollMs?: number) {
  const call = useAdminApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const alive = useRef(false);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
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
