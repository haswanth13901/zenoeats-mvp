import type { CSSProperties } from "react";

export type FontPair = "default" | "lora_inter" | "playfair_source" | "fraunces_dm" | "merriweather_sans";
export type StorefrontTheme = { brand: string; hero: string; accent: string; paper: string; font_pair: FontPair };
export type Banner = { id: string; image_url: string; headline: string; subline: string; cta_label: string; cta_target_kind: "menu" | "item_type" | "item" | "collection"; cta_target_id: string | null;
  /** How the photo sits in the banner's crop: the point of it, as percentages
   *  of the image, and how far in. Chosen per banner in the portal. */
  focal_x: number; focal_y: number; zoom: number };
export type CategoryStyle = { image_url: string | null; show_in_shortcuts: boolean; sort_order: number };
export type Collection = { id: string; title: string; item_ids: string[] };
/** An entry in the shortcut row, built by the restaurant: its own label, and
 *  the items from one category that its section shows. */
export type Shortcut = { id: string; item_type_id: string; label: string; image_url: string | null; item_ids: string[] };
export type Storefront = { theme: StorefrontTheme | null; logo_url: string | null; banner_interval_ms: number; banners: Banner[]; categories: Record<string, CategoryStyle>; collections: Collection[]; shortcuts?: Shortcut[] };

export const FONT_PAIRS: Record<FontPair, { label: string; display?: string; body?: string; query?: string }> = {
  default: { label: "Classic — system fonts" },
  lora_inter: { label: "Lora / Inter", display: "Lora", body: "Inter", query: "family=Lora:wght@400;600;700&family=Inter:wght@400;500;600;700" },
  playfair_source: { label: "Playfair Display / Source Sans 3", display: "Playfair Display", body: "Source Sans 3", query: "family=Playfair+Display:wght@400;600;700&family=Source+Sans+3:wght@400;600;700" },
  fraunces_dm: { label: "Fraunces / DM Sans", display: "Fraunces", body: "DM Sans", query: "family=Fraunces:wght@400;600;700&family=DM+Sans:wght@400;500;600;700" },
  merriweather_sans: { label: "Merriweather / Open Sans", display: "Merriweather", body: "Open Sans", query: "family=Merriweather:wght@400;700&family=Open+Sans:wght@400;600;700" },
};

export const PALETTES: { name: string; theme: StorefrontTheme }[] = ([
  ["Forest & gold", "#174D39", "#102A1D", "#F1C958", "#FAF8F2"],
  ["Burgundy & cream", "#722F37", "#35151B", "#F2D3AB", "#FFF9F0"],
  ["Navy & citrus", "#183B60", "#101F35", "#FFD36E", "#F7FAFC"],
  ["Terracotta", "#8B3826", "#3D211A", "#F2C08C", "#FFF8F0"],
  ["Plum & rose", "#59305C", "#291A31", "#F1C4D3", "#FCF7FB"],
  ["Charcoal & lime", "#303C30", "#18221B", "#D5E889", "#FAFBF4"],
] as [string, string, string, string, string][]).map(([name, brand, hero, accent, paper]) => ({ name, theme: { brand, hero, accent, paper, font_pair: "default" } }));

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgb = (hex: string) => channels(hex).join(" ");
const mix = (a: string, b: string, amount: number) => channels(a).map((v, i) => Math.round(v * (1 - amount) + channels(b)[i]! * amount)).join(" ");

/** One derivation for the customer page and the unsaved preview. Null is
 * deliberately empty: the default palette keeps every original shade. */
export function themeVariables(theme: StorefrontTheme | null): CSSProperties {
  if (!theme) return {};
  const vars: Record<string, string> = {
    "--ze-brand": rgb(theme.brand), "--ze-brand-hover": mix(theme.brand, "#000000", .2),
    "--ze-brand-soft": mix(theme.brand, theme.paper, .92), "--ze-hero": rgb(theme.hero),
    "--ze-paper": rgb(theme.paper), "--ze-gold": rgb(theme.accent),
    "--ze-accent": rgb(theme.accent), "--ze-cta-hover": mix(theme.accent, "#FFFFFF", .15),
    "--ze-hero-glow": mix(theme.hero, theme.brand, .6),
    "--ze-sage": mix(theme.brand, theme.paper, .94),
  };
  for (const name of ["header-link", "shortcut-text", "meal-title", "category-title", "card-text", "item-title", "combo-text"])
    vars[`--ze-${name}`] = rgb(theme.brand);
  for (const name of ["shortcut-hover", "shortcut-clock", "card-gradient", "combo-ground", "combo-hover"])
    vars[`--ze-${name}`] = mix(theme.brand, theme.paper, .94);
  const font = FONT_PAIRS[theme.font_pair];
  if (font.display) vars["--font-display"] = `"${font.display}", Georgia, serif`;
  if (font.body) vars["--font-body"] = `"${font.body}", system-ui, sans-serif`;
  return vars as CSSProperties;
}

export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => channels(hex).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1]! + .05) / (values[0]! + .05);
}

export function contrastResults(theme: StorefrontTheme) {
  return [["Cream text on hero", "#FFF8E4", theme.hero], ["CTA text on accent", "#1D3326", theme.accent], ["Brand on paper", theme.brand, theme.paper], ["White text on brand", "#FFFFFF", theme.brand], ["Body text on paper", "#252620", theme.paper]].map(([name, a, b]) => ({ name, ratio: contrast(a!, b!) }));
}

/**
 * The colours of the three pins on the delivery map.
 *
 * The map's own tiles are Google's, recoloured only by a style the platform
 * set up (services/maps.py says why). What sits on top of them is ours: the
 * restaurant, the customer's address and the driver. They take the palette
 * the rest of the page uses, so a forest-green storefront does not open a
 * map pinned in someone else's colours.
 *
 * Resolved values rather than CSS variables, because a pin is built as a
 * detached element and handed to Google: it never inherits this page.
 */
export type MapPins = { restaurant: string; home: string; driver: string; onDriver: string };

export const DEFAULT_PINS: MapPins = {
  restaurant: "#FFFDF7", home: "#E8B54B", driver: "#174D39", onDriver: "#FFFFFF",
};

export function mapPins(theme: StorefrontTheme | null, themed: boolean): MapPins {
  if (!themed || !theme) return DEFAULT_PINS;
  return {
    // The restaurant's own mark stays pale, as a pin on a road has to be:
    // its paper, not its brand, or two dark pins compete on a dark map.
    restaurant: theme.paper,
    home: theme.accent,
    driver: theme.brand,
    // The arrow inside the driver's disc, against the brand behind it.
    onDriver: contrast(theme.brand, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#1D1B16",
  };
}

/** Only curated identifiers can create a link. Never interpolate a URL from
 * restaurant data; the CSP and this allowlist protect different boundaries. */
export function attachFont(pair: FontPair) {
  const query = FONT_PAIRS[pair].query;
  if (!query) return () => {};
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
  document.head.appendChild(link);
  return () => link.remove();
}
