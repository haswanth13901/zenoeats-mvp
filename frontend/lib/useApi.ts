"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { api, errorMessage, isAbort } from "./api";

type CallOpts = {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

/** Authenticated fetch bound to the Clerk session. */
export function useAuthedApi() {
  const { getToken } = useAuth();

  return useCallback(
    async <T,>(path: string, opts: CallOpts = {}): Promise<T> => {
      const token = await getToken();
      return api<T>(path, { ...opts, token });
    },
    [getToken]
  );
}

/** Load once, with a refresh handle and optional polling.
 *
 *  Three things this has to get right, all of which bite on the kitchen
 *  board because it polls every five seconds:
 *
 *    - Only the newest response may write state. Without that, a slow
 *      request landing after a fast one silently reverts the board.
 *    - Nothing may write state after unmount.
 *    - Polls must not overlap. A chained timeout, not setInterval: if the
 *      server is slow, setInterval keeps firing and the requests stack up.
 */
export function useResource<T>(path: string, pollMs?: number) {
  const call = useAuthedApi();
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
    // Set here rather than at init: React 18 StrictMode mounts, unmounts and
    // remounts in development, and a ref initialised to true would stay false
    // after the first teardown.
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
