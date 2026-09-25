/**
 * How the map itself is coloured.
 *
 * Google applies a style one of two ways: from a Map ID set up in its Cloud
 * console, or from a style array sent with the map. It ignores the array
 * whenever a Map ID is in use, and a Map ID is what Advanced Markers need --
 * so the tracking map uses neither. It sends these arrays and draws its pins
 * with ordinary markers, which is what lets a restaurant recolour its map
 * without anyone opening a console.
 *
 * Four styles, and the last of them is the point: a storefront in forest
 * green opens a map in forest green, derived from the same palette rather
 * than chosen separately and left to drift from it.
 */

import { mixHex, type StorefrontTheme } from "./theme";

export type MapStyleKey = "standard" | "light" | "dark" | "palette";

/** Google's style array. Loosely typed on purpose: it is data handed
 *  straight to the Maps API, and typing every feature and element here would
 *  be a copy of their documentation that could only go stale. */
export type MapStyle = Record<string, unknown>[];

export const MAP_STYLES: { key: MapStyleKey; label: string; hint: string }[] = [
  { key: "standard", label: "Google standard", hint: "The map as Google draws it." },
  { key: "light", label: "Light and quiet", hint: "Pale, with the labels turned down." },
  { key: "dark", label: "Dark", hint: "For a dark storefront, and easier at night." },
  { key: "palette", label: "Match my palette", hint: "Built from your storefront colours." },
];

export function isMapStyleKey(value: unknown): value is MapStyleKey {
  return MAP_STYLES.some((style) => style.key === value);
}

/** One rule, shortened: the shape Google's style array takes. */
const rule = (
  featureType: string,
  elementType: string,
  stylers: Record<string, unknown>[],
): Record<string, unknown> => ({ featureType, elementType, stylers });

const LIGHT: MapStyle = [
  rule("all", "geometry", [{ color: "#F5F3EC" }]),
  rule("all", "labels.text.fill", [{ color: "#6B6A62" }]),
  rule("all", "labels.text.stroke", [{ color: "#FFFFFF" }, { weight: 2 }]),
  rule("poi", "labels", [{ visibility: "off" }]),
  rule("poi.park", "geometry", [{ color: "#E4EADF" }]),
  rule("road", "geometry", [{ color: "#FFFFFF" }]),
  rule("road.arterial", "geometry.stroke", [{ color: "#E8E5DC" }]),
  rule("road.highway", "geometry", [{ color: "#F7EFD9" }]),
  rule("transit", "labels.icon", [{ visibility: "off" }]),
  rule("water", "geometry", [{ color: "#D8E4E6" }]),
];

const DARK: MapStyle = [
  rule("all", "geometry", [{ color: "#232A26" }]),
  rule("all", "labels.text.fill", [{ color: "#9AA69D" }]),
  rule("all", "labels.text.stroke", [{ color: "#161A17" }, { weight: 2 }]),
  rule("poi", "labels", [{ visibility: "off" }]),
  rule("poi.park", "geometry", [{ color: "#2A362C" }]),
  rule("road", "geometry", [{ color: "#2E3833" }]),
  rule("road.arterial", "geometry.stroke", [{ color: "#39443E" }]),
  rule("road.highway", "geometry", [{ color: "#3B4A3F" }]),
  rule("transit", "labels.icon", [{ visibility: "off" }]),
  rule("water", "geometry", [{ color: "#1A2426" }]),
];

/**
 * The restaurant's own palette as a map.
 *
 * Its paper is the ground and its brand tints the water and the parks, which
 * are the two large areas a map can take a colour in without the roads
 * becoming hard to follow. Roads stay pale and labels stay dark on a light
 * paper, because a customer reading a street name at night is the whole
 * point of the map.
 */
export function paletteStyle(theme: StorefrontTheme): MapStyle {
  const paper = theme.paper;
  const dark = isDark(paper);
  const ink = dark ? "#C8CFC6" : "#5C5B54";
  return [
    rule("all", "geometry", [{ color: paper }]),
    rule("all", "labels.text.fill", [{ color: ink }]),
    rule("all", "labels.text.stroke", [{ color: mixHex(paper, dark ? "#000000" : "#FFFFFF", 0.6) }, { weight: 2 }]),
    rule("poi", "labels", [{ visibility: "off" }]),
    rule("poi.park", "geometry", [{ color: mixHex(paper, theme.brand, 0.18) }]),
    rule("road", "geometry", [{ color: mixHex(paper, dark ? "#FFFFFF" : "#FFFFFF", dark ? 0.12 : 0.55) }]),
    rule("road.arterial", "geometry.stroke", [{ color: mixHex(paper, theme.brand, 0.12) }]),
    rule("road.highway", "geometry", [{ color: mixHex(paper, theme.accent, 0.35) }]),
    rule("transit", "labels.icon", [{ visibility: "off" }]),
    rule("water", "geometry", [{ color: mixHex(paper, theme.brand, 0.45) }]),
  ];
}

/** What to hand the map, or null for Google's own colours. */
export function mapStyle(key: MapStyleKey | null, theme: StorefrontTheme | null): MapStyle | null {
  if (key === "light") return LIGHT;
  if (key === "dark") return DARK;
  // A palette map with no palette is the standard map: there is nothing to
  // derive it from, and a half-derived one would be neither.
  if (key === "palette" && theme) return paletteStyle(theme);
  return null;
}

/** Whether ink has to be pale on this ground. */
function isDark(hex: string): boolean {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  return luminance < 0.4;
}
