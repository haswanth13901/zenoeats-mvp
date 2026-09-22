/**
 * The restaurant's brand as customers see it: a logo in place of the initial,
 * and the name as the restaurant's own lettering or in a chosen font.
 *
 * Set in Settings, shown whether or not storefront customization is on. Used
 * by the React header and by the plain-HTML sign-in pages alike, so it stays
 * free of React.
 */

export type BrandFont = "default" | "lora" | "playfair" | "fraunces" | "merriweather" | "dm_sans";

export type Brand = {
  logo_url: string | null;
  name_image_url: string | null;
  name_font: BrandFont;
};

export const NO_BRAND: Brand = { logo_url: null, name_image_url: null, name_font: "default" };

/**
 * The same keys as services/restaurant_profile.BRAND_NAME_FONTS. `default` is
 * the storefront's display font -- the platform's, or the theme's when there
 * is one -- so it loads nothing.
 */
export const BRAND_FONTS: Record<BrandFont, { label: string; family?: string; query?: string }> = {
  default: { label: "The storefront's own font" },
  lora: { label: "Lora — classic serif", family: "Lora", query: "family=Lora:ital,wght@0,700;1,700" },
  playfair: { label: "Playfair Display — elegant serif", family: "Playfair Display", query: "family=Playfair+Display:wght@700" },
  fraunces: { label: "Fraunces — soft, friendly serif", family: "Fraunces", query: "family=Fraunces:wght@700" },
  merriweather: { label: "Merriweather — sturdy serif", family: "Merriweather", query: "family=Merriweather:wght@700" },
  dm_sans: { label: "DM Sans — clean, modern", family: "DM Sans", query: "family=DM+Sans:wght@700" },
};

export function isBrandFont(value: unknown): value is BrandFont {
  return typeof value === "string" && value in BRAND_FONTS;
}

/** The CSS font-family for the name, or undefined to inherit font-display. */
export function brandFontFamily(font: BrandFont): string | undefined {
  const family = BRAND_FONTS[font]?.family;
  return family ? `"${family}", Georgia, serif` : undefined;
}

/**
 * Load the name's font once per page. Only curated identifiers build the
 * link -- never a string from the API -- and the CSP already allows Google
 * Fonts for the theme's pairs.
 */
export function loadBrandFont(font: BrandFont): void {
  const query = BRAND_FONTS[font]?.query;
  if (!query) return;
  const id = `ze-brand-font-${font}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
  document.head.appendChild(link);
}

/** A brand read from anywhere untrusted -- localStorage, an old API -- with
 *  anything malformed dropped rather than rendered. */
export function brandFrom(value: unknown): Brand {
  if (!value || typeof value !== "object") return NO_BRAND;
  const raw = value as Record<string, unknown>;
  // Same-origin paths, or https when IMAGES_PUBLIC_BASE points at a bucket.
  const url = (v: unknown) =>
    typeof v === "string" && (/^\/(?!\/)/.test(v) || v.startsWith("https://")) ? v : null;
  return {
    logo_url: url(raw.logo_url),
    name_image_url: url(raw.name_image_url),
    name_font: isBrandFont(raw.name_font) ? raw.name_font : "default",
  };
}
