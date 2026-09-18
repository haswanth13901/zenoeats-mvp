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

export interface PlaceResult {
  formatted_address?: string;
}

export interface PlacesAutocomplete {
  addListener(event: "place_changed", handler: () => void): { remove(): void };
  getPlace(): PlaceResult;
}

export type PlacesLibrary = {
  Autocomplete: new (
    input: HTMLInputElement,
    options: { fields: string[]; types: string[] },
  ) => PlacesAutocomplete;
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

let scriptLoading: Promise<GoogleNamespace["maps"]> | null = null;
let mapsLoading: Promise<MapsLibraries> | null = null;
let placesLoading: Promise<PlacesLibrary> | null = null;

/** Load Google's bootstrap once. Pages then request only their own library. */
function loadGoogleBootstrap(key: string): Promise<GoogleNamespace["maps"]> {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise<GoogleNamespace["maps"]>((resolve, reject) => {
    let settled = false;
    let script: HTMLScriptElement | null = null;
    const previousAuthFailure = window.gm_authFailure;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      delete window.__zenoeatsMapsReady;
      window.gm_authFailure = previousAuthFailure;
      if (error) {
        script?.remove();
        reject(error);
      } else {
        resolve(window.google!.maps);
      }
    };
    const timer = setTimeout(() => finish(new Error("Google took too long to load.")), 15_000);
    window.gm_authFailure = () => finish(new Error("Google could not be opened."));
    window.__zenoeatsMapsReady = () => finish();
    script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) +
      "&v=weekly&loading=async&callback=__zenoeatsMapsReady";
    script.async = true;
    script.onerror = () => finish(new Error("Google could not be loaded."));
    document.head.appendChild(script);
  }).catch((error) => {
    scriptLoading = null;
    throw error;
  });
  return scriptLoading;
}

/** A failed or blocked script must settle, and a retry gets a new request. */
export function loadGoogleMaps(key: string): Promise<MapsLibraries> {
  if (mapsLoading) return mapsLoading;
  mapsLoading = loadGoogleBootstrap(key).then(async (maps) => {
    const [map, marker, core] = await Promise.all([
      maps.importLibrary("maps"), maps.importLibrary("marker"), maps.importLibrary("core"),
    ]);
    return {
      Map: map.Map,
      AdvancedMarkerElement: marker.AdvancedMarkerElement,
      LatLngBounds: core.LatLngBounds,
    } as MapsLibraries;
  }).catch((error) => {
    mapsLoading = null;
    throw error;
  });
  return mapsLoading;
}

/** Failure is non-fatal: checkout keeps accepting a manually typed address. */
export function loadGooglePlaces(key: string): Promise<PlacesLibrary> {
  if (placesLoading) return placesLoading;
  placesLoading = loadGoogleBootstrap(key).then(async (maps) => {
    const places = await maps.importLibrary("places");
    return { Autocomplete: places.Autocomplete } as PlacesLibrary;
  }).catch((error) => {
    placesLoading = null;
    throw error;
  });
  return placesLoading;
}
