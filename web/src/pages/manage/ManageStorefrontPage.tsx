import { useEffect, useState, type ReactNode } from "react";
import { Link, useBlocker } from "react-router-dom";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import { ImagePicker, useUploadsInFlight } from "@/features/restaurant/components/ImagePicker";
import { BannerFraming, DEFAULT_FRAMING } from "@/features/restaurant/components/BannerFraming";
import { Loading, StatePage } from "@/components/common/Feedback";
import { SettingsCard } from "@/features/restaurant/components/SettingsCard";
import { HomeBanner, CategoryShortcuts, heroPhoto } from "@/features/storefront/components/HomePresentation";
import { attachFont, contrastResults, FONT_PAIRS, PALETTES, themeVariables, type FontPair, type Storefront } from "@/features/storefront/theme";
import { useStorefrontSettingsQuery, useSaveStorefrontThemeMutation, useSaveStorefrontBannersMutation, useSaveStorefrontCategoryMutation, useSaveStorefrontCollectionsMutation, type StorefrontSettings, type BannerDraft, type CollectionDraft } from "@/features/restaurant/storefrontApi";
import { errorMessage } from "@/services/apiClient";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let draftSequence = 0;
const newId = () => `new-${Date.now()}-${draftSequence++}`;
function move<T>(list: T[], index: number, step: number): T[] {
  const next = [...list];
  const source = next[index], target = next[index + step];
  if (source === undefined || target === undefined) return list;
  next[index] = target; next[index + step] = source;
  return next;
}
function localDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function ManageStorefrontPage() {
  const query = useStorefrontSettingsQuery();
  return <ManageShell>{query.error ? <StatePage title="Storefront unavailable">{errorMessage(query.error)}</StatePage> : query.data ? <StorefrontEditor initial={query.data} /> : <Loading />}</ManageShell>;
}

/** Drafts are separate from the query cache: saving a category must not
 * erase the banner the manager is still writing. Each successful save
 * adopts only that section's returned values and leaves the others alone. */
function StorefrontEditor({ initial }: { initial: StorefrontSettings }) {
  const [saved, setSaved] = useState(initial);
  const [banners, setBanners] = useState(initial.banners);
  const [interval, setInterval] = useState(initial.banner_interval_ms);
  const [categories, setCategories] = useState(initial.categories);
  const [collections, setCollections] = useState(initial.collections);
  const [theme, setTheme] = useState(initial.theme);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploads, trackUpload] = useUploadsInFlight();
  const [saveTheme] = useSaveStorefrontThemeMutation();
  const [saveBanners] = useSaveStorefrontBannersMutation();
  const [saveCategory] = useSaveStorefrontCategoryMutation();
  const [saveCollections] = useSaveStorefrontCollectionsMutation();
  const dirty = !same(banners, saved.banners) || interval !== saved.banner_interval_ms || !same(categories, saved.categories) || !same(collections, saved.collections) || !same(theme, saved.theme);
  const blocker = useBlocker(dirty || uploads > 0);
  useEffect(() => {
    if (!dirty && !uploads) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, uploads]);
  useEffect(() => attachFont(theme?.font_pair ?? "default"), [theme?.font_pair]);
  const off = !!busy || uploads > 0;
  async function save(section: string, action: () => Promise<void>) {
    setBusy(section); setError(null); setMessage(null);
    try { await action(); setMessage(`${section} saved.`); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  }
  function banner(index: number, changes: Partial<BannerDraft>) { setBanners((rows) => rows.map((row, n) => n === index ? { ...row, ...changes } : row)); }
  function collection(index: number, changes: Partial<CollectionDraft>) { setCollections((rows) => rows.map((row, n) => n === index ? { ...row, ...changes } : row)); }
  // What a customer can actually order. The storefront drops a collection's
  // items that are on no meal period, so the picker and preview say so too.
  const served = new Set(initial.menu.meals.flatMap((m) => m.sections.flatMap((s) => [...s.items, ...s.groups.flatMap((g) => g.items)])).map((i) => i.id));
  const itemNames = new Map(categories.flatMap((c) => c.items).map((i) => [i.id, i.name] as const));
  const emptyShown = collections.filter((c) => c.is_active && c.item_ids.length === 0);
  const chosenTheme = theme ?? PALETTES[0]!.theme;
  const checks = contrastResults(chosenTheme);
  const preview: Storefront = { theme, logo_url: initial.logo_url, banner_interval_ms: interval,
    banners: banners.filter((b) => b.is_active && b.image_url && (!b.starts_at || Date.parse(b.starts_at) <= Date.now()) && (!b.ends_at || Date.parse(b.ends_at) > Date.now())),
    categories: Object.fromEntries(categories.map((c, order) => [c.id, { image_url: c.image_url, show_in_shortcuts: c.show_in_shortcuts, sort_order: order }])), collections };
  return <div className="min-w-0">
    <h1 className="mb-2 font-display text-3xl">Storefront</h1>
    <p className="mb-6 text-sm text-muted">Make your restaurant feel like yours. Each section saves separately.</p>
    {error && <p className="note-danger mb-4" role="alert">{error}</p>}
    {message && <p className="note-success mb-4" role="status">{message}</p>}
    {blocker.state === "blocked" && <div className="note-warning mb-4" role="alert"><p>You have unsaved changes. Leave this page and discard them?</p><button className="btn-quiet mt-3" onClick={() => blocker.reset()}>Keep editing</button><button className="link-danger ml-4" onClick={() => blocker.proceed()}>Discard and leave</button></div>}
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <SettingsCard id="storefront-banners" title="Banners" subtitle="Up to eight slides. Move them up or down to choose their order.">
          <fieldset disabled={!!busy} className="min-w-0 space-y-5">
          {banners.map((row, index) => <div className="min-w-0 rounded-field border border-hairline p-4" key={row.id}>
            <RowActions index={index} count={banners.length} label={`Banner ${index + 1}`} onMove={(step) => setBanners(move(banners, index, step))} onRemove={() => setBanners(banners.filter((_, n) => n !== index))} disabled={off} />
            <ImagePicker kind="banners" label={`banner ${index + 1}`} image={{ path: row.image_path, url: row.image_url }} onBusyChange={trackUpload} onError={setError} onChange={(image) => banner(index, { image_path: image.path ?? "", image_url: image.url ?? "" })} />
            {row.image_url && <BannerFraming label={`banner ${index + 1}`} image={row.image_url} disabled={off}
              value={{ focal_x: row.focal_x, focal_y: row.focal_y, zoom: row.zoom }} onChange={(f) => banner(index, f)} />}
            {(["headline", "subline", "cta_label"] as const).map((key) => <Field key={key} label={{headline:"Headline",subline:"Subline",cta_label:"Button label"}[key]}><input className="field" maxLength={{headline:80,subline:160,cta_label:30}[key]} value={row[key]} onChange={(e) => banner(index, { [key]: e.target.value })} /></Field>)}
            <Field label="Button destination"><select className="field" value={`${row.cta_target_kind}:${row.cta_target_id ?? ""}`} onChange={(e) => { const [kind, id] = e.target.value.split(":"); banner(index, { cta_target_kind: kind as BannerDraft["cta_target_kind"], cta_target_id: id || null }); }}>
              <option value="menu:">Whole menu</option>
              <optgroup label="Categories">{categories.map((c) => <option key={c.id} value={`item_type:${c.id}`}>{c.name}</option>)}</optgroup>
              {categories.map((c) => <optgroup label={c.name} key={c.id}>{c.items.map((i) => <option key={i.id} value={`item:${i.id}`}>{i.name}{i.is_available ? "" : " - sold out"}</option>)}</optgroup>)}
              <optgroup label="Saved collections">{saved.collections.map((c) => <option key={c.id} value={`collection:${c.id}`}>{c.title}</option>)}</optgroup>
            </select></Field>
            <Toggle label="Active slide" checked={row.is_active} onChange={(value) => banner(index, { is_active: value })} />
            <div className="grid gap-3 sm:grid-cols-2">{(["starts_at", "ends_at"] as const).map((key) => <Field key={key} label={key === "starts_at" ? "Starts (optional)" : "Ends (optional)"}><input className="field min-w-0" type="datetime-local" value={localDate(row[key])} onChange={(e) => banner(index, { [key]: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>)}</div>
            <p className="field-hint">Dates use this device's timezone.</p>
          </div>)}
          <button type="button" className="btn-quiet" disabled={banners.length >= 8 || off} onClick={() => setBanners([...banners, { id: newId(), image_path: "", image_url: "", headline: "", subline: "", cta_label: "Explore the menu", cta_target_kind: "menu", cta_target_id: null, is_active: true, starts_at: null, ends_at: null, ...DEFAULT_FRAMING }])}>Add banner</button>
          <Field label={`Time per slide: ${interval / 1000} seconds`}><input className="w-full" type="range" min={2000} max={10000} step={500} value={interval} onChange={(e) => setInterval(Number(e.target.value))} /></Field>
          <Save disabled={off || banners.some((b) => !b.image_path)} busy={busy === "Banners"} onClick={() => void save("Banners", async () => {
            const result = await saveBanners(banners).unwrap(); setBanners(result.banners); setSaved((s) => ({ ...s, banners: result.banners }));
            const settings = await saveTheme({ banner_interval_ms: interval }).unwrap(); setSaved((s) => ({ ...s, banner_interval_ms: settings.banner_interval_ms }));
          })} />
          </fieldset>
        </SettingsCard>
        <SettingsCard id="storefront-categories" title="Categories" subtitle="Photos and visibility affect the shortcut row only.">
          <p className="mb-5 text-caption"><Link className="link" to="/manage/menu">Change category order on the Menu tab</Link></p>
          <fieldset disabled={!!busy} className="space-y-5 min-w-0">{categories.map((c, index) => <div key={c.id} className="border-b border-hairline pb-4"><h3 className="mb-3 font-semibold">{c.name}</h3><ImagePicker kind="categories" label={c.name} image={{ path: c.image_path, url: c.image_url }} onBusyChange={trackUpload} onError={setError} onChange={(image) => setCategories(categories.map((row, n) => n === index ? { ...row, image_path: image.path, image_url: image.url } : row))} /><Toggle label="Show in shortcut row" checked={c.show_in_shortcuts} onChange={(value) => setCategories(categories.map((row, n) => n === index ? { ...row, show_in_shortcuts: value } : row))} /></div>)}
          <Save disabled={off} busy={busy === "Categories"} onClick={() => void save("Categories", async () => {
            for (const c of categories) {
              if (same(c, saved.categories.find((row) => row.id === c.id))) continue;
              const result = await saveCategory(c).unwrap();
              const updated = result.categories.find((row) => row.id === c.id)!;
              setSaved((s) => ({ ...s, categories: s.categories.map((row) => row.id === c.id ? updated : row) }));
            }
          })} /></fieldset>
        </SettingsCard>
        <SettingsCard id="storefront-collections" title="Featured collections" subtitle="Choose existing items, up to twelve per collection and six collections.">
          <fieldset disabled={!!busy} className="min-w-0 space-y-5">
          <Field label="Search items"><input className="field" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          {collections.map((row, index) => <div className="rounded-field border border-hairline p-4" key={row.id}>
            <RowActions index={index} count={collections.length} label={row.title || `Collection ${index + 1}`} onMove={(step) => setCollections(move(collections, index, step))} onRemove={() => setCollections(collections.filter((_, n) => n !== index))} disabled={off} />
            <Field label="Collection title"><input className="field" maxLength={60} value={row.title} onChange={(e) => collection(index, { title: e.target.value })} /></Field>
            <Toggle label="Show collection" checked={row.is_active} onChange={(value) => collection(index, { is_active: value })} />
            <p className="my-2 text-caption">{row.item_ids.length} of 12 selected{" - "}
              {!row.is_active ? <span className="text-muted">Hidden from customers</span>
                : row.item_ids.some((id) => served.has(id)) ? <span className="text-success">Shows on your storefront</span>
                : <span className="text-danger">Choose at least one item on your menu, or it will not show</span>}
            </p>
            <ol className="mb-4">{row.item_ids.map((id, itemIndex) => <li key={id}><RowActions label={categories.flatMap((c) => c.items).find((i) => i.id === id)?.name ?? "Removed item"} index={itemIndex} count={row.item_ids.length} onMove={(step) => collection(index, { item_ids: move(row.item_ids, itemIndex, step) })} onRemove={() => collection(index, { item_ids: row.item_ids.filter((i) => i !== id) })} disabled={off} /></li>)}</ol>
            {/* Every category in full, no inner scroll box: a clipped list read
                as "these are all the items" and hid the rest of the menu. */}
            <div>{categories.map((c) => { const items = c.items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())); return items.length ? <fieldset key={c.id} className="mb-3 grid gap-x-4 sm:grid-cols-2"><legend className="mb-1 text-caption font-semibold">{c.name}</legend>{items.map((i) => <Toggle key={i.id} label={`${i.name}${i.is_available ? "" : " - sold out"}${served.has(i.id) ? "" : " - not on any meal period"}`} checked={row.item_ids.includes(i.id)} disabled={!row.item_ids.includes(i.id) && row.item_ids.length >= 12} onChange={(checked) => collection(index, { item_ids: checked ? [...row.item_ids, i.id] : row.item_ids.filter((id) => id !== i.id) })} />)}</fieldset> : null; })}</div>
          </div>)}
          <button className="btn-quiet" type="button" disabled={off || collections.length >= 6} onClick={() => setCollections([...collections, { id: newId(), title: "", is_active: true, item_ids: [] }])}>Add collection</button>
          {emptyShown.length > 0 && <p className="field-hint" role="status">Choose items for {emptyShown.map((c) => `“${c.title.trim() || "Untitled"}”`).join(", ")}, or turn off Show collection, before saving.</p>}
          <Save disabled={off || collections.some((c) => !c.title.trim()) || emptyShown.length > 0} busy={busy === "Collections"} onClick={() => void save("Collections", async () => { const result = await saveCollections(collections).unwrap(); setCollections(result.collections); setSaved((s) => ({ ...s, collections: result.collections })); })} />
          </fieldset>
        </SettingsCard>
        <SettingsCard id="storefront-brand" title="Brand" subtitle="Choose a palette and font pairing, or keep the Zenoeats default.">
          <fieldset disabled={!!busy} className="min-w-0 space-y-4">
          <Field label="Palette"><select className="field" value={theme === null ? "default" : PALETTES.find((p) => same({ ...p.theme, font_pair: theme.font_pair }, theme))?.name ?? "custom"} onChange={(e) => setTheme(e.target.value === "default" ? null : { ...(PALETTES.find((p) => p.name === e.target.value)?.theme ?? chosenTheme), font_pair: chosenTheme.font_pair })}><option value="default">Zenoeats default</option>{PALETTES.map((p) => <option key={p.name}>{p.name}</option>)}<option value="custom">Custom</option></select></Field>
          <div className="grid grid-cols-2 gap-4">{(["brand", "hero", "accent", "paper"] as const).map((key) => <Field key={key} label={key.charAt(0).toUpperCase() + key.slice(1)}><input aria-label={`${key} colour`} className="h-11 w-full" type="color" value={chosenTheme[key]} onChange={(e) => setTheme({ ...chosenTheme, [key]: e.target.value })} /><span className="text-caption">{chosenTheme[key]}</span></Field>)}</div>
          <ul className="text-caption" aria-live="polite">{checks.map((check) => <li key={check.name} className={check.ratio < 4.5 ? "text-danger" : "text-muted"}>{check.name}: {check.ratio.toFixed(2)}:1 - {check.ratio >= 4.5 ? "Pass" : "Needs 4.5:1"}</li>)}</ul>
          <Field label="Font pairing"><select className="field" value={chosenTheme.font_pair} onChange={(e) => setTheme({ ...chosenTheme, font_pair: e.target.value as FontPair })}>{Object.entries(FONT_PAIRS).map(([value, font]) => <option key={value} value={value}>{font.label}</option>)}</select></Field>
          {/* The logo and the name's lettering moved to Settings, where they
              apply whether or not the storefront is customized. Saving the
              theme here no longer sends a logo, so it cannot undo that. */}
          <p className="note">The logo and how your name is shown are set by an admin in <Link className="link" to="/manage/settings#settings-brand">Settings → Logo &amp; name</Link>.</p>
          <Save disabled={off || (theme !== null && checks.some((c) => c.ratio < 4.5))} busy={busy === "Brand"} onClick={() => void save("Brand", async () => { const result = await saveTheme({ theme }).unwrap(); setSaved((s) => ({ ...s, theme: result.theme })); })} />
          </fieldset>
        </SettingsCard>
      </div>
      <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start" aria-label="Live storefront preview">
        <h2 className="mb-3 text-lg font-semibold">Live preview <span className="text-caption font-normal text-muted">Unsaved changes</span></h2>
        <div data-surface="customer" style={themeVariables(theme)} className="storefront-preview min-w-0 overflow-hidden rounded-card bg-paper p-3 font-sans text-ink">
          <HomeBanner restaurant={{ name: initial.name, tagline: initial.tagline, delivery_offered: false }} photo={heroPhoto(initial.menu.meals)} storefront={preview} onTarget={() => {}} />
          <CategoryShortcuts meals={initial.menu.meals} severalPeriods={initial.menu.meals.length > 1} categories={preview.categories} />
          {collections.map((c) => {
            const shown = c.item_ids.filter((id) => served.has(id));
            if (!c.is_active || !shown.length) return null;
            return <section key={c.id} className="mt-5 min-w-0">
              <h3 className="mb-2 font-display text-xl font-bold text-brick">{c.title.trim() || "Untitled collection"}</h3>
              <ul className="flex flex-wrap gap-2">{shown.map((id) => <li key={id} className="rounded-chip border border-hairline bg-cream px-3 py-1.5 text-caption text-ink">{itemNames.get(id) ?? "Item"}</li>)}</ul>
            </section>;
          })}
        </div>
      </aside>
    </div>
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="my-3 block min-w-0"><span className="label mb-2 block">{label}</span>{children}</label>; }
function Toggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) { return <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>; }
function Save({ disabled, busy, onClick }: { disabled: boolean; busy: boolean; onClick: () => void }) { return <div className="mt-5"><button type="button" className="btn-primary" disabled={disabled} onClick={onClick}>{busy ? "Saving..." : "Save changes"}</button></div>; }
function RowActions({ index, count, label, onMove, onRemove, disabled }: { index: number; count: number; label: string; onMove: (step: number) => void; onRemove: () => void; disabled: boolean }) { return <div className="mb-3 flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-words text-sm font-semibold">{label}</span><button type="button" className="btn-quiet btn-compact" aria-label={`Move ${label} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)}>Up</button><button type="button" className="btn-quiet btn-compact" aria-label={`Move ${label} down`} disabled={disabled || index === count - 1} onClick={() => onMove(1)}>Down</button><button type="button" className="link-danger min-h-11" disabled={disabled} onClick={onRemove}>Remove</button></div>; }
