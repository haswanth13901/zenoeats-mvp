import { useEffect, useState } from "react";
import { ErrorNote } from "@/components/common/Feedback";
import { SettingsCard } from "@/features/restaurant/components/SettingsCard";
import { ImagePicker } from "@/features/restaurant/components/ImagePicker";
import type { RestaurantProfile } from "@/features/restaurant/restaurantApi";
import { Wordmark } from "@/features/storefront/components/CustomerHeader";
import { BRAND_FONTS, loadBrandFont, type BrandFont } from "@/features/storefront/brand";

/*
 * The advice for the two brand pictures, from where the header draws them:
 * the logo at the monogram's 43px height, the lettering up to 38 x 260px.
 * Twice that for sharp high-density screens. The spaces inside each size are
 * non-breaking, as in IMAGE_GUIDE.
 */
const LOGO_GUIDE = {
  size: "Square PNG with a transparent background, 512 × 512 px",
  tip: "Replaces the initial beside your name. Shown whole, never cropped.",
};
const LETTERING_GUIDE = {
  size: "Wide PNG with a transparent background, about 540 × 80 px",
  tip: "Your name as you letter it. Crop it close — no empty margins.",
};

type NameMode = "text" | "image";

/**
 * The restaurant's logo and how its name is shown, on every customer page
 * and the sign-in pages.
 *
 * Part of the page's one save bar, like the name and tagline above it: a
 * picture chosen here uploads straight away but reaches customers only when
 * the page is saved, so Discard really does put everything back.
 */
export function BrandSettings({
  draft,
  edit,
  onBusyChange,
}: {
  draft: RestaurantProfile;
  edit: (changes: Partial<RestaurantProfile>) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // Lettering once there is some; otherwise the typed name. Following the
  // draft, so Discard and a fresh load land on the saved choice.
  const hasLettering = draft.brand_name_image_path !== null;
  const [mode, setMode] = useState<NameMode>(hasLettering ? "image" : "text");
  useEffect(() => {
    if (hasLettering) setMode("image");
  }, [hasLettering]);

  // Every font in the list, so each option can be judged before choosing.
  useEffect(() => {
    for (const font of Object.keys(BRAND_FONTS) as BrandFont[]) loadBrandFont(font);
  }, []);

  function chooseMode(next: NameMode) {
    setMode(next);
    // Going back to text takes the lettering off; the save bar still offers
    // Discard if that was a slip.
    if (next === "text" && hasLettering) {
      edit({ brand_name_image_path: null, brand_name_image_url: null });
    }
  }

  const preview = {
    logo_url: draft.logo_url,
    name_image_url: mode === "image" ? draft.brand_name_image_url : null,
    name_font: draft.brand_name_font,
  };

  return (
    <SettingsCard id="settings-brand" title="Logo & name" subtitle="How your restaurant appears to customers.">
      <div className="flex flex-col gap-[22px]">
        <div>
          <span className="label mb-[7px]">Preview</span>
          <div className="flex min-h-[78px] items-center overflow-hidden rounded-field border border-hairline bg-[#FBF7EC] px-5 py-4">
            <Wordmark name={draft.name.trim() || "Your restaurant"} brand={preview} linked={false} />
          </div>
          <span className="field-hint block">
            The header of your menu, checkout and order pages, and the customer sign-in pages.
          </span>
        </div>

        <div>
          <span className="label mb-[7px]">Logo</span>
          <ImagePicker
            kind="branding"
            label="restaurant logo"
            image={{ path: draft.logo_path, url: draft.logo_url }}
            guide={LOGO_GUIDE}
            fit="contain"
            onChange={(next) => edit({ logo_path: next.path, logo_url: next.url })}
            onError={setError}
            onBusyChange={onBusyChange}
          />
          <span className="field-hint block">Without one, customers see the first letter of your name.</span>
        </div>

        <fieldset>
          <legend className="label mb-[9px]">Your name</legend>
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="radio"
                name="brand-name-mode"
                className="mt-0.5 h-5 w-5 shrink-0"
                checked={mode === "text"}
                onChange={() => chooseMode("text")}
              />
              <span>
                <span className="font-semibold">Typed, in a font you choose</span>
                <span className="field-hint block">Always matches the name above as you edit it.</span>
              </span>
            </label>
            {mode === "text" && (
              <div className="animate-disclose pl-[30px]">
                <label className="block">
                  <span className="sr-only">Font</span>
                  <select
                    className="field max-w-[22rem]"
                    value={draft.brand_name_font}
                    onChange={(e) => edit({ brand_name_font: e.target.value as BrandFont })}
                  >
                    {(Object.entries(BRAND_FONTS) as [BrandFont, (typeof BRAND_FONTS)[BrandFont]][]).map(
                      ([key, font]) => (
                        <option key={key} value={key}>
                          {font.label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
            )}

            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="radio"
                name="brand-name-mode"
                className="mt-0.5 h-5 w-5 shrink-0"
                checked={mode === "image"}
                onChange={() => chooseMode("image")}
              />
              <span>
                <span className="font-semibold">Your own lettering, as an image</span>
                <span className="field-hint block">
                  For a name set in your brand's typeface. Customers' screen readers still hear the
                  name above.
                </span>
              </span>
            </label>
            {mode === "image" && (
              <div className="animate-disclose pl-[30px]">
                <ImagePicker
                  kind="branding"
                  label="restaurant name lettering"
                  image={{ path: draft.brand_name_image_path, url: draft.brand_name_image_url }}
                  guide={LETTERING_GUIDE}
                  fit="contain"
                  onChange={(next) =>
                    edit({ brand_name_image_path: next.path, brand_name_image_url: next.url })
                  }
                  onError={setError}
                  onBusyChange={onBusyChange}
                />
                {!hasLettering && (
                  <p className="field-hint">Until you add one, customers see your name typed.</p>
                )}
              </div>
            )}
          </div>
        </fieldset>

        <ErrorNote message={error} />
      </div>
    </SettingsCard>
  );
}
