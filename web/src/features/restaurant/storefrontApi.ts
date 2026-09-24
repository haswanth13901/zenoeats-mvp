import { api } from "@/services/api";
import type { Meal } from "@/types";
import type { Banner, Collection, StorefrontTheme } from "@/features/storefront/theme";

export type BannerDraft = Banner & { image_path: string; is_active: boolean; starts_at: string | null; ends_at: string | null };
export type CategoryDraft = { id: string; name: string; parent_id: string | null; sort_order: number; image_path: string | null; image_url: string | null; show_in_shortcuts: boolean; items: { id: string; name: string; is_available: boolean }[] };
export type CollectionDraft = Collection & { is_active: boolean };
/** A map style the platform has set up in Google Cloud, offered by key. */
export type MapStyleChoice = { key: string; label: string };
export type MapSettings = { map_style_key: string | null; map_pins_themed: boolean };
export type ShortcutDraft = { id: string; item_type_id: string; label: string; image_path: string | null; image_url: string | null; is_active: boolean; item_ids: string[] };
export type StorefrontSettings = { storefront_customization_enabled: boolean; name: string; tagline: string | null; currency: string; theme: StorefrontTheme | null; logo_path: string | null; logo_url: string | null; banner_interval_ms: number; banners: BannerDraft[]; categories: CategoryDraft[]; collections: CollectionDraft[]; shortcuts: ShortcutDraft[]; map_style_key: string | null; map_pins_themed: boolean; map_styles: MapStyleChoice[]; menu: { meals: Meal[] } };
export type ThemeUpdate = { theme?: StorefrontTheme | null; logo_path?: string | null; banner_interval_ms?: number };

const storefrontApi = api.injectEndpoints({
  endpoints: (build) => ({
    storefrontSettings: build.query<StorefrontSettings, void>({ query: () => ({ url: "/restaurant/storefront" }), providesTags: ["Storefront"] }),
    saveStorefrontTheme: build.mutation<StorefrontSettings, ThemeUpdate>({ query: (body) => ({ url: "/restaurant/storefront/theme", method: "PATCH", body }), invalidatesTags: ["Storefront", "Portal"] }),
    saveStorefrontBanners: build.mutation<StorefrontSettings, BannerDraft[]>({ query: (banners) => ({ url: "/restaurant/storefront/banners", method: "PUT", body: { banners: banners.map(({ id, image_url: _url, ...b }) => ({ ...b, ...(id.startsWith("new-") ? {} : { id }) })) } }), invalidatesTags: ["Storefront", "Portal"] }),
    saveStorefrontCategory: build.mutation<StorefrontSettings, CategoryDraft>({ query: (c) => ({ url: `/restaurant/item-types/${c.id}/storefront`, method: "PATCH", body: { image_path: c.image_path, show_in_shortcuts: c.show_in_shortcuts } }), invalidatesTags: ["Storefront", "Portal"] }),
    saveStorefrontCollections: build.mutation<StorefrontSettings, CollectionDraft[]>({ query: (collections) => ({ url: "/restaurant/storefront/collections", method: "PUT", body: { collections: collections.map(({ id, ...c }) => ({ ...c, ...(id.startsWith("new-") ? {} : { id }) })) } }), invalidatesTags: ["Storefront", "Portal"] }),
    saveStorefrontMap: build.mutation<StorefrontSettings, Partial<MapSettings>>({
      query: (body) => ({ url: "/restaurant/storefront/map", method: "PATCH", body }),
      invalidatesTags: ["Storefront", "Portal"],
    }),
    saveStorefrontShortcuts: build.mutation<StorefrontSettings, ShortcutDraft[]>({ query: (shortcuts) => ({ url: "/restaurant/storefront/shortcuts", method: "PUT", body: { shortcuts: shortcuts.map(({ id, image_url: _url, ...s }) => ({ ...s, ...(id.startsWith("new-") ? {} : { id }) })) } }), invalidatesTags: ["Storefront", "Portal"] }),
  }),
});
export const { useStorefrontSettingsQuery, useSaveStorefrontThemeMutation, useSaveStorefrontBannersMutation, useSaveStorefrontCategoryMutation, useSaveStorefrontCollectionsMutation, useSaveStorefrontShortcutsMutation, useSaveStorefrontMapMutation } = storefrontApi;
