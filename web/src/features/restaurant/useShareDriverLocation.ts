import { useEffect, useRef, useState } from "react";
import { useSendDriverLocationMutation } from "@/features/restaurant/restaurantApi";
import { ApiError } from "@/services/apiClient";

/** How often the latest fix is sent. The customer's page polls at the same
 *  pace, so sending faster would only be thrown away. */
const SEND_EVERY_MS = 5_000;

export type SharingState =
  | "idle" // nothing on the road
  | "starting" // asked the phone, no fix yet
  | "sharing"
  | "denied" // the driver or the browser said no
  | "unavailable" // no GPS, no fix, or not a secure page
  | "failed"; // fixes arrive but the server is not taking them

/**
 * Share this phone's position while the driver has an order on the road.
 *
 * Runs only while `active`: from the moment they press Picked up until the
 * last order is delivered, and never between deliveries. The browser's own
 * location prompt is the consent, and it names this site.
 *
 * Also asks the screen to stay on. A browser stops reporting position when
 * the phone locks, so a dimmed screen would quietly freeze the customer's map.
 * Where the Wake Lock API is missing, the page says to keep it open instead.
 */
export function useShareDriverLocation(active: boolean): SharingState {
  const [send] = useSendDriverLocationMutation();
  const [state, setState] = useState<SharingState>("idle");
  const latest = useRef<GeolocationPosition | null>(null);
  const sentAt = useRef<number>(0);

  useEffect(() => {
    if (!active) {
      setState("idle");
      return;
    }
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      setState("unavailable");
      return;
    }

    setState("starting");
    latest.current = null;
    let stopped = false;

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        latest.current = position;
      },
      (error) => {
        if (stopped) return;
        setState(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );

    const flush = async () => {
      const position = latest.current;
      if (!position || position.timestamp === sentAt.current) return;
      sentAt.current = position.timestamp;
      const heading = position.coords.heading;
      try {
        await send({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          heading: heading !== null && !Number.isNaN(heading) ? heading : null,
        }).unwrap();
        if (!stopped) setState("sharing");
      } catch (e) {
        // NOT_ON_A_DELIVERY is the last order being delivered a moment
        // before this page's own poll noticed. Not a failure worth showing.
        if (!stopped && !(e instanceof ApiError && e.code === "NOT_ON_A_DELIVERY")) {
          setState("failed");
        }
      }
    };
    const timer = window.setInterval(() => void flush(), SEND_EVERY_MS);

    // Keep the screen on while sharing, and take the lock back whenever the
    // page returns to the foreground -- the browser releases it on hide.
    type WakeLock = { release(): Promise<void> };
    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: { request(type: "screen"): Promise<WakeLock> };
    }).wakeLock;
    let lock: WakeLock | null = null;
    const holdScreen = () => {
      if (!wakeLockApi || document.visibilityState !== "visible") return;
      wakeLockApi.request("screen").then((l) => {
        if (stopped) void l.release();
        else lock = l;
      }).catch(() => undefined);
    };
    holdScreen();
    document.addEventListener("visibilitychange", holdScreen);

    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watch);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", holdScreen);
      void lock?.release().catch(() => undefined);
    };
  }, [active, send]);

  return state;
}
