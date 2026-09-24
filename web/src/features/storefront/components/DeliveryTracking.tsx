import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/common/icons";
import {
  loadGoogleMaps,
  type AdvancedMarker,
  type GoogleMap,
  type LatLngLiteral,
  type MapsLibraries,
} from "@/services/googleMaps";
import { contrast, DEFAULT_PINS, type MapPins } from "@/features/storefront/theme";
import type { MapPoint, Tracking, TrackingStep } from "@/types";

/** A driver position older than this is shown as delayed: kept on the map as
 *  the last known place, but no longer good enough for an arrival time. */
const STALE_AFTER_MS = 2 * 60_000;

/**
 * A delivery from payment to the door, as one card: what is happening, when
 * it should arrive, who is bringing it, where they are and where it is going.
 *
 * Everything here is read from the order poll. Nothing is guessed on this
 * side -- no dot is moved along a route the server did not report, and no
 * arrival time is invented when Google has not given one. The status and the
 * steps read the same with or without a map, so a map that is loading,
 * failing or switched off never hides where the order is.
 */
export function DeliveryTracking({
  tracking,
  status,
  destination,
  mapsKey,
  mapId,
  restaurantName,
  pins = DEFAULT_PINS,
}: {
  tracking: Tracking;
  status: string;
  /** The address as the customer typed it, from the order. */
  destination: string | null;
  mapsKey: string | null;
  mapId: string | null;
  restaurantName: string;
  /** The colours of the three pins, from the restaurant's palette. */
  pins?: MapPins;
}) {
  const finished = ["COMPLETED", "CANCELLED", "EXPIRED"].includes(status);
  const onTheRoad = status === "OUT_FOR_DELIVERY";
  const now = useNow(onTheRoad ? 15_000 : null);
  const online = useOnline();

  const location = tracking.driver_location;
  const age = location ? now - new Date(location.recorded_at).getTime() : null;
  const stale = age !== null && age > STALE_AFTER_MS;
  const name = tracking.driver_name;

  return (
    <section
      className="overflow-hidden rounded-banner border border-hairline bg-surface"
      aria-label="Delivery progress"
    >
      <div className="p-5 sm:p-6" aria-live="polite">
        <p className="eyebrow text-muted">Delivery progress</p>
        <Headline tracking={tracking} status={status} stale={stale} online={online} />
      </div>

      {!finished && (!mapsKey || !mapId || !(tracking.restaurant || tracking.destination)) && (
        <div className="flex min-h-[260px] items-center justify-center border-t border-hairline bg-brickSoft px-6 text-center text-sm text-muted" role="status">
          Live map is unavailable. Your order status and delivery details will keep updating here.
        </div>
      )}
      {!finished && mapsKey && mapId && (tracking.restaurant || tracking.destination) && (
        <TrackingMap
          tracking={tracking}
          mapsKey={mapsKey}
          mapId={mapId}
          restaurantName={restaurantName}
          pins={pins}
        />
      )}

      {/* Who is bringing it: only once the restaurant has assigned someone. */}
      {name && !finished && (
        <div className="flex items-center gap-3.5 border-t border-hairline px-5 py-4 sm:px-6">
          <span
            aria-hidden="true"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F4E7C4] text-sm font-bold text-[#5C4A1C]"
          >
            {name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{name}</p>
            <p className="text-caption text-muted">Your delivery driver</p>
          </div>
          <span className={onTheRoad ? "pill-green" : "pill"}>{onTheRoad ? "On the way" : "Assigned"}</span>
        </div>
      )}

      {/* How fresh the dot is. Said in words, because a marker that stopped
          moving looks exactly like one that is waiting at a light. */}
      {onTheRoad && (
        <div className="px-5 pb-4 sm:px-6">
          <Freshness age={age} stale={stale} online={online} />
        </div>
      )}

      {destination && (
        <div className="flex items-start gap-3 border-t border-hairline px-5 py-4 sm:px-6">
          <Icon name="store" className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="text-caption text-muted">{status === "COMPLETED" ? "Delivered to" : "Delivering to"}</p>
            <p className="mt-0.5 [overflow-wrap:anywhere]">{destination}</p>
          </div>
        </div>
      )}

      <div className="border-t border-hairline px-5 py-5 sm:px-6">
        <Timeline tracking={tracking} status={status} />
      </div>
    </section>
  );
}

/** The time, refreshed every `ms` while it matters, so "2 min ago" ages. */
function useNow(ms: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ms === null) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

// ---------------------------------------------------------------- headline

function Headline({
  tracking,
  status,
  stale,
  online,
}: {
  tracking: Tracking;
  status: string;
  stale: boolean;
  online: boolean;
}) {
  const name = tracking.driver_name ?? "Your driver";
  const location = tracking.driver_location;
  const heading = "mt-1.5 font-display text-[25px] leading-[1.2] tracking-[-.5px] sm:text-[27px]";

  if (status === "COMPLETED") return <h2 className={heading}>Delivered. Enjoy your meal.</h2>;
  if (status === "CANCELLED") return <h2 className={heading}>This delivery was cancelled</h2>;

  if (status !== "OUT_FOR_DELIVERY") {
    return (
      <>
        <h2 className={heading}>
          {status === "READY_FOR_DELIVERY" ? "Ready for your driver" : "Your order is being prepared"}
        </h2>
        <p className="mt-1 text-caption text-muted">
          {tracking.driver_name
            ? `${tracking.driver_name} takes it the moment it's ready.`
            : "The restaurant assigns a driver before it leaves."}
        </p>
      </>
    );
  }

  // An arrival time only from a live position and a server estimate. A
  // delayed or offline position still shows where the driver was, but not a
  // time that position can no longer support.
  if (location && tracking.eta_seconds !== null && tracking.eta_computed_at &&
    Date.now() - Date.parse(tracking.eta_computed_at) <= STALE_AFTER_MS && !stale && online) {
    const minutes = Math.max(1, Math.round(tracking.eta_seconds / 60));
    const base = tracking.eta_computed_at ? new Date(tracking.eta_computed_at).getTime() : Date.now();
    const at = new Date(base + tracking.eta_seconds * 1000);
    return (
      <>
        <h2 className={heading}>{minutes <= 4 ? "Your driver is nearby" : "Your order is on its way"}</h2>
        <div className="mt-4 flex items-end gap-3">
          <p className="tnum text-[36px] font-bold leading-none tracking-[-1px] text-brick">
            {minutes}
            <span className="ml-1 text-lg font-semibold">min</span>
          </p>
          <p className="pb-0.5 text-caption leading-tight">
            Estimated arrival
            <span className="block text-muted">
              Around {at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}, with current traffic
            </span>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h2 className={heading}>{name} is on the way</h2>
      <p className="mt-1 text-caption text-muted">
        {location ? "The arrival time will return with a fresh location." : "Their live location will appear here once their phone shares it."}
      </p>
    </>
  );
}

function Freshness({ age, stale, online }: { age: number | null; stale: boolean; online: boolean }) {
  if (!online) {
    return (
      <p className="note-warning flex items-start gap-2.5" role="status">
        <Icon name="warning" className="mt-0.5 h-4 w-4 shrink-0" />
        You're offline. This shows the last location we received; it updates again when you reconnect.
      </p>
    );
  }
  if (age === null) {
    return (
      <p className="note flex items-center gap-2.5">
        <span aria-hidden className="h-[7px] w-[7px] shrink-0 animate-pending rounded-full bg-muted" />
        Waiting for your driver's location.
      </p>
    );
  }
  const minutes = Math.max(1, Math.round(age / 60_000));
  if (stale) {
    return (
      <p className="note-warning flex items-start gap-2.5">
        <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0" />
        Location delayed. Last updated {minutes} min ago.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2.5 rounded-field bg-successSoft px-4 py-3 text-sm text-success">
      <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-success" />
      Live location · updated {age < 60_000 ? "just now" : `${minutes} min ago`}
    </p>
  );
}

// --------------------------------------------------------------------- map

/**
 * One pin, built detached and handed to Google.
 *
 * Its colours are passed in rather than read from a class, because this
 * element is never inside the page: a Tailwind colour or a CSS variable
 * would resolve against nothing once Google mounts it on the map.
 */
export function markerElement(
  kind: "restaurant" | "home" | "driver",
  pins: MapPins = DEFAULT_PINS,
): HTMLElement {
  const el = document.createElement("div");
  if (kind === "driver") {
    // A disc with an arrow that turns with the driver's heading.
    el.className =
      "flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-white shadow-[0_4px_14px_#12160B40] transition-transform duration-500";
    el.style.background = pins.driver;
    el.style.color = pins.onDriver;
    el.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 3l7 18-7-4-7 4 7-18z"/></svg>';
  } else {
    el.className =
      "flex h-8 w-8 items-center justify-center rounded-full border-2 border-white shadow-[0_3px_10px_#1F1B1640]";
    el.style.background = kind === "home" ? pins.home : pins.restaurant;
    // The line art inside: dark enough to read on whichever colour it sits.
    el.style.color = readableOn(kind === "home" ? pins.home : pins.restaurant);
    el.innerHTML =
      kind === "home"
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 11l8-7 8 7v9H4z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9h18L19 3H5L3 9Zm1 0v12h16V9"/></svg>';
  }
  return el;
}

/** Ink that reads on the given background: the darker of the two candidates
 *  wins on a pale pin, the paler on a dark one. */
function readableOn(background: string): string {
  return contrast(background, "#1D1B16") >= contrast(background, "#FFFFFF") ? "#1D1B16" : "#FFFFFF";
}

const toLatLng = (p: MapPoint): LatLngLiteral => ({ lat: p.latitude, lng: p.longitude });

function TrackingMap({
  tracking,
  mapsKey,
  mapId,
  restaurantName,
  pins,
}: {
  tracking: Tracking;
  mapsKey: string;
  mapId: string | null;
  restaurantName: string;
  pins: MapPins;
}) {
  const container = useRef<HTMLDivElement>(null);
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [libs, setLibs] = useState<MapsLibraries | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped by "Retry map". The loader forgets a failed attempt, so asking
  // again really does try again.
  const [attempt, setAttempt] = useState(0);
  const map = useRef<GoogleMap | null>(null);
  const markers = useRef<{ restaurant?: AdvancedMarker; home?: AdvancedMarker; driver?: AdvancedMarker }>({});
  // Framed once when the map opens and once when the driver first appears.
  // After that the customer's own panning and zooming is left alone.
  const framedWithDriver = useRef(false);
  const glide = useRef<number>();

  useEffect(() => {
    let alive = true;
    setFailed(false);
    loadGoogleMaps(mapsKey)
      .then((loaded) => alive && setLibs(loaded))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [mapsKey, attempt]);

  // The map and the two fixed points.
  useEffect(() => {
    if (!libs || !container.current || map.current) return;
    const previousAuthFailure = window.gm_authFailure;
    const authFailed = () => setFailed(true);
    window.gm_authFailure = authFailed;
    try {
    const center = tracking.destination ?? tracking.restaurant!;
    map.current = new libs.Map(container.current, {
      center: toLatLng(center),
      zoom: 14,
      mapId: mapId ?? undefined,
      disableDefaultUI: true,
      zoomControl: false,
      gestureHandling: "cooperative",
      clickableIcons: false,
    });
    if (tracking.restaurant) {
      markers.current.restaurant = new libs.AdvancedMarkerElement({
        map: map.current,
        position: toLatLng(tracking.restaurant),
        content: markerElement("restaurant", pins),
        title: restaurantName,
      });
    }
    if (tracking.destination) {
      markers.current.home = new libs.AdvancedMarkerElement({
        map: map.current,
        position: toLatLng(tracking.destination),
        content: markerElement("home", pins),
        title: "Your address",
      });
    }
    const bounds = new libs.LatLngBounds();
    if (tracking.restaurant) bounds.extend(toLatLng(tracking.restaurant));
    if (tracking.destination) bounds.extend(toLatLng(tracking.destination));
    if (tracking.restaurant && tracking.destination && !reduceMotion()) map.current.fitBounds(bounds, 48);
    } catch { setFailed(true); }
    return () => {
      if (window.gm_authFailure === authFailed) window.gm_authFailure = previousAuthFailure;
      Object.values(markers.current).forEach(marker => { if (marker) marker.map = null; });
      markers.current = {};
      map.current = null;
      framedWithDriver.current = false;
    };
    // Coordinates are immutable for an order; a poll must not reset the
    // viewport. The pins are rebuilt when the palette changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libs, mapId, restaurantName, attempt, pins]);

  // The driver: placed on first sight, then glided to each new position so
  // the dot travels rather than jumping every five seconds.
  const location = tracking.driver_location;
  useEffect(() => {
    if (!libs || !map.current) return;
    const existing = markers.current.driver;

    if (!location) {
      if (existing) existing.map = null;
      markers.current.driver = undefined;
      return;
    }

    const target = toLatLng(location);
    if (!existing) {
      markers.current.driver = new libs.AdvancedMarkerElement({
        map: map.current,
        position: target,
        content: markerElement("driver", pins),
        title: "Your driver",
        zIndex: 10,
      });
    } else if (reduceMotion()) {
      if (glide.current) cancelAnimationFrame(glide.current);
      existing.position = target;
    } else {
      const from = existing.position ?? target;
      const started = performance.now();
      const duration = 250;
      if (glide.current) cancelAnimationFrame(glide.current);
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        const eased = t * (2 - t);
        existing.position = {
          lat: from.lat + (target.lat - from.lat) * eased,
          lng: from.lng + (target.lng - from.lng) * eased,
        };
        if (t < 1) glide.current = requestAnimationFrame(step);
      };
      glide.current = requestAnimationFrame(step);
    }

    const content = markers.current.driver!.content;
    content.style.transform = location.heading !== null ? `rotate(${location.heading}deg)` : "";

    if (!framedWithDriver.current) {
      framedWithDriver.current = true;
      const bounds = new libs.LatLngBounds();
      bounds.extend(target);
      if (tracking.destination) bounds.extend(toLatLng(tracking.destination));
      if (reduceMotion()) map.current.setCenter(target);
      else map.current.fitBounds(bounds, 64);
    }
    // Do not override the customer's panning; Recenter is an explicit action.
    return () => { if (glide.current) cancelAnimationFrame(glide.current); };
  }, [libs, location, tracking.destination, pins]);

  useEffect(() => () => {
    if (glide.current) cancelAnimationFrame(glide.current);
  }, []);

  if (failed) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 border-t border-hairline bg-[#F0F1E6] px-5 py-4 text-center sm:min-h-[320px] sm:px-6" role="status">
        <p className="text-sm">The map could not be loaded. Your order&apos;s progress is below.</p>
        <button type="button" className="btn-quiet btn-compact rounded-full" onClick={() => { setLibs(null); setFailed(false); setAttempt((n) => n + 1); }}>
          <Icon name="refresh" className="h-4 w-4" />
          Retry map
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-[260px] w-full border-t border-hairline bg-[#E8EBD9] sm:h-[320px]">
      <div
        ref={container}
        className="absolute inset-0"
        role="region"
        aria-label="Map showing the restaurant, your address and your driver"
      />
      {libs && (
        <div className="absolute right-3 top-3 flex flex-col gap-2" role="group" aria-label="Map controls">
          <button type="button" className="btn-quiet min-h-[44px] min-w-[44px] bg-surface" aria-label="Zoom in"
            onClick={() => map.current?.setZoom(Math.min(20, (map.current.getZoom() ?? 14) + 1))}>+</button>
          <button type="button" className="btn-quiet min-h-[44px] min-w-[44px] bg-surface" aria-label="Zoom out"
            onClick={() => map.current?.setZoom(Math.max(2, (map.current.getZoom() ?? 14) - 1))}>−</button>
          <button type="button" className="btn-quiet min-h-[44px] bg-surface" onClick={() => {
            const point = tracking.driver_location ?? tracking.destination ?? tracking.restaurant;
            if (!map.current || !point) return;
            if (reduceMotion()) map.current.setCenter(toLatLng(point));
            else map.current.panTo(toLatLng(point));
          }}>Recenter</button>
        </div>
      )}
      {!libs && (
        <p className="absolute inset-0 flex items-center justify-center gap-2.5 text-sm text-muted" role="status">
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />
          Loading map…
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- timeline

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function Timeline({ tracking, status }: { tracking: Tracking; status: string }) {
  const done = new Map<TrackingStep, string>(tracking.steps.map((s) => [s.step, s.at]));
  const driver = tracking.driver_name;
  const cancelled = status === "CANCELLED";

  const rows: { key: TrackingStep; done: string; pending: string }[] = [
    { key: "PAID", done: "Payment confirmed", pending: "Confirming payment" },
    {
      key: "DRIVER_ASSIGNED",
      done: driver ? `${driver} is your driver` : "Driver assigned",
      pending: "Assigning a driver",
    },
    { key: "READY", done: "Food is ready", pending: "Being prepared" },
    {
      key: "PICKED_UP",
      done: driver ? `${driver} picked up your order` : "Picked up",
      pending: "Driver collects your order",
    },
    { key: "DELIVERED", done: "Delivered", pending: "Delivered to your door" },
  ];
  // The first step not yet done is the one happening now.
  const current = rows.find((r) => !done.has(r.key))?.key;

  return (
    <ol className="flex flex-col" aria-label="Delivery steps">
      {rows.map((row, i) => {
        const at = done.get(row.key);
        const now = !cancelled && row.key === current;
        const last = i === rows.length - 1;
        return (
          <li key={row.key} className="relative flex gap-3.5 pb-4 last:pb-0">
            {!last && (
              <span
                aria-hidden
                className={`absolute left-[9px] top-[22px] h-[calc(100%-18px)] w-0.5 ${at ? "bg-brick" : "bg-hairline"}`}
              />
            )}
            <span
              aria-hidden
              className={`relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                at ? "bg-brick text-white" : now ? "border-2 border-brick bg-surface" : "border-2 border-hairline bg-surface"
              }`}
            >
              {at && <Icon name="check" className="h-3 w-3" />}
              {now && <span className="h-2 w-2 animate-pending rounded-full bg-brick" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[15px] ${at ? "text-ink" : now ? "font-semibold text-ink" : "text-muted"}`}>
                {at ? row.done : row.pending}
                <span className="sr-only">{at ? ", done" : now ? ", in progress" : ""}</span>
              </p>
              {at && <p className="text-caption text-muted">{time(at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
