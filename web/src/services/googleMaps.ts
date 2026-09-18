/**
 * Google Maps, loaded only on the page that shows one.
 *
 * The script is fetched the first time a map is asked for, never on the menu
 * or at checkout, so a customer who only ever collects never downloads it.
 * The key is a browser key the API hands out with the portal, restricted in
 * Google's console to this site -- public by design.
 *
 * Typed by hand for the few calls the tracking map makes, rather than pulling
 * in @types/google.maps for a single component.
 */

export type LatLngLiteral = { lat: number; lng: number };

export interface GoogleMap {
  fitBounds(bounds: LatLngBounds, padding?: number): void;
  panTo(position: LatLngLiteral): void;
  setCenter(position: LatLngLiteral): void;
  getZoom(): number | undefined;
  setZoom(zoom: number): void;
  getBounds(): LatLngBounds | undefined;
}

export interface LatLngBounds {
  extend(point: LatLngLiteral): LatLngBounds;
  contains(point: LatLngLiteral): boolean;
}

export interface AdvancedMarker {
  position: LatLngLiteral | null;
  map: GoogleMap | null;
  content: HTMLElement;
}

export type MapsLibraries = {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  LatLngBounds: new () => LatLngBounds;
  AdvancedMarkerElement: new (options: {
    map: GoogleMap;
    position: LatLngLiteral;
    content: HTMLElement;
    title?: string;
    zIndex?: number;
  }) => AdvancedMarker;
};

type GoogleNamespace = {
  maps: { importLibrary(name: string): Promise<Record<string, unknown>> };
};

declare global {
  interface Window {
    google?: GoogleNamespace;
    __zenoeatsMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

let loading: Promise<MapsLibraries> | null = null;

/** A failed or blocked script must settle, and a retry gets a new request. */
export function loadGoogleMaps(key: string): Promise<MapsLibraries> {
  if (loading) return loading;
  loading = new Promise<MapsLibraries>((resolve, reject) => {
    let settled = false;
    let script: HTMLScriptElement | null = null;
    const previousAuthFailure = window.gm_authFailure;
    const finish = (error?: Error, libraries?: MapsLibraries) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      delete window.__zenoeatsMapsReady;
      window.gm_authFailure = previousAuthFailure;
      if (error) { script?.remove(); reject(error); }
      else resolve(libraries!);
    };
    const timer = setTimeout(() => finish(new Error("The map took too long to load.")), 15_000);
    window.gm_authFailure = () => finish(new Error("The map could not be opened."));
    const ready = async () => {
      try {
        const maps = window.google!.maps;
        const [map, marker, core] = await Promise.all([
          maps.importLibrary("maps"), maps.importLibrary("marker"), maps.importLibrary("core"),
        ]);
        finish(undefined, {
          Map: map.Map, AdvancedMarkerElement: marker.AdvancedMarkerElement,
          LatLngBounds: core.LatLngBounds,
        } as MapsLibraries);
      } catch { finish(new Error("The map could not be opened.")); }
    };
    if (window.google?.maps?.importLibrary) { void ready(); return; }
    window.__zenoeatsMapsReady = () => { void ready(); };
    script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) +
      "&v=weekly&loading=async&callback=__zenoeatsMapsReady";
    script.async = true;
    script.onerror = () => finish(new Error("The map could not be loaded."));
    document.head.appendChild(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}
