import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Loading, StatePage } from "@/components/common/Feedback";
import { Cloche, Icon } from "@/components/common/icons";
import { MenuImage } from "@/components/common/MenuImage";
import { ModifierSheet } from "@/features/cart/components/ModifierSheet";
import { ComboSheet, savingLabel } from "@/features/cart/components/ComboSheet";
import { CustomerHeader } from "@/features/storefront/components/CustomerHeader";
import { CustomerHeaderAccount } from "@/features/storefront/components/CustomerHeaderAccount";
import { FavouriteButton, useFavourites } from "@/features/storefront/components/FavouriteButton";
import {
  comboAdded,
  itemAdded,
  selectCartCount,
  selectCartPreviewSubtotal,
} from "@/features/cart/cartSlice";
import { useOpenCart } from "@/features/cart/useOpenCart";
import { usePortalQuery, usePublicMenuQuery } from "@/features/storefront/storefrontApi";
import { errorMessage } from "@/services/apiClient";
import { mealHours, money } from "@/utils/format";
import type { Combo, Item, Meal, Portal } from "@/types";

/** Every meal period, rather than one of them. */
const FULL_MENU = "all";

/**
 * One labelled group of cards: the items filed on a top-level type, or one of
 * its subcategories. `path` keeps the parent in view -- "Food / Burgers" --
 * so flattening the two levels into cards loses nothing the menu said.
 */
type Category = {
  key: string;
  itemTypeId: string;
  label: string;
  path: string;
  items: Item[];
};

function categoriesOf(meal: Meal): Category[] {
  return meal.sections.flatMap((section) => [
    ...(section.items.length > 0
      ? [
          {
            key: `${meal.id}-${section.item_type_id}`,
            itemTypeId: section.item_type_id,
            label: section.label,
            path: section.label,
            items: section.items,
          },
        ]
      : []),
    ...section.groups.map((group) => ({
      key: `${meal.id}-${group.item_type_id}`,
      itemTypeId: group.item_type_id,
      label: group.label,
      path: `${section.label} / ${group.label}`,
      items: group.items,
    })),
  ]);
}

/** Scroll a section into view and put focus on its heading, so a keyboard or
 *  screen-reader user lands where the jump went. Instant under reduced
 *  motion. */
function jumpTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  target.focus({ preventScroll: true });
}

/**
 * The storefront. Public: no session is required to read a menu, and the
 * tenant comes from the Host header, so this page never names a restaurant
 * itself. Signing in happens at checkout.
 */
export function StorefrontPage() {
  const dispatch = useAppDispatch();
  const portal = usePortalQuery();
  const menu = usePublicMenuQuery();
  const [customizing, setCustomizing] = useState<Item | null>(null);
  const [building, setBuilding] = useState<Combo | null>(null);
  // Which meal period is on screen. A way to read the menu, not a rule about
  // it: nothing becomes orderable or unorderable by choosing one, and the
  // cart is untouched.
  const [period, setPeriod] = useState<string>(FULL_MENU);
  const favourites = useFavourites();

  useOpenCart();

  const meals = useMemo(() => menu.data?.meals ?? [], [menu.data]);
  // A period that has gone from the menu since it was chosen falls back to
  // the whole menu rather than to an empty page.
  const chosen = period !== FULL_MENU && meals.some((m) => m.id === period) ? period : FULL_MENU;
  const shown = chosen === FULL_MENU ? meals : meals.filter((m) => m.id === chosen);

  const loadError =
    (portal.error ? errorMessage(portal.error) : null) ??
    (menu.error ? errorMessage(menu.error) : null);

  if (loadError) {
    const retrying = portal.isFetching || menu.isFetching;
    return (
      <StatePage
        title="This menu isn't available"
        action={
          <button
            type="button"
            className="btn-primary"
            disabled={retrying}
            onClick={() => { void portal.refetch(); void menu.refetch(); }}
          >
            {retrying ? "Trying again…" : "Try again"}
          </button>
        }
      >{loadError}</StatePage>
    );
  }

  if (!portal.data || !menu.data) {
    return (
      <main className="mx-auto flex min-h-[75vh] max-w-[570px] items-center px-6">
        <div className="w-full">
          <Loading />
        </div>
      </main>
    );
  }

  const restaurant = portal.data;
  const open = restaurant.is_orderable && restaurant.accepting_orders;
  // Bound to a const, as checkout does: narrowing on portal.data does not
  // survive into the callbacks below, because it is a property of a mutable
  // object rather than a local.
  const currency = restaurant.currency;
  const severalPeriods = meals.length > 1;

  return (
    <div className="flex min-h-dvh flex-col">
      <CustomerHeader
        restaurant={restaurant}
        showOrder
        links={
          <>
            <HeaderLink onClick={() => jumpTo("menu-heading")}>Our menu</HeaderLink>
            {severalPeriods && (
              <HeaderLink onClick={() => jumpTo("meal-times")}>Meal times</HeaderLink>
            )}
          </>
        }
      />

      <div className="mx-auto w-full max-w-[1336px] px-[19px] pb-[132px] sm:px-7 xl:px-10">
        {/* Signing in is offered here and required nowhere on this page: the
            menu is public, and the account only matters once there is an
            order to attach to someone. */}
        <CustomerHeaderAccount
          leading={
            <span className="flex items-center gap-2 text-caption text-muted">
              <span
                aria-hidden="true"
                className={`h-[7px] w-[7px] rounded-full ${open ? "bg-brick" : "bg-warning"}`}
              />
              {open ? "Taking orders" : "Not taking orders"}
            </span>
          }
        />

        <HomeBanner restaurant={restaurant} photo={heroPhoto(meals)} />

        {!open && (
          <p className="note-warning mt-5" role="status">
            Not taking orders right now. You can still look at the menu.
          </p>
        )}

        {meals.length === 0 ? (
          <div className="empty mt-10">
            <Cloche className="mx-auto mb-4" />
            <h2 className="font-display text-2xl text-ink">Nothing on the menu yet.</h2>
          </div>
        ) : (
          <>
            <CategoryShortcuts meals={shown} severalPeriods={severalPeriods} />

            <div className="mt-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 sm:mt-10">
              <div>
                <p className="eyebrow text-[#64725B]">Our menu</p>
                <h2
                  id="menu-heading"
                  tabIndex={-1}
                  className="mt-2 scroll-mt-6 font-display text-[34px] font-bold leading-[1.1] tracking-[-1px] text-brick sm:text-[40px]"
                >
                  What sounds good?
                </h2>
              </div>
              <p className="text-caption text-muted sm:text-right">
                Choose anything to make it your own.
              </p>
            </div>

            {/* The period selector only when there is more than one period
                to choose between. Hours stay beside each period either way. */}
            {severalPeriods && (
              <div
                id="meal-times"
                tabIndex={-1}
                className="mt-6 flex scroll-mt-6 flex-wrap items-center justify-start gap-2.5 rounded-[12px] bg-sage p-[11px] sm:justify-between sm:gap-4 sm:px-4 sm:py-[13px]"
              >
                <div
                  className="no-scrollbar flex w-full items-center gap-1 overflow-x-auto sm:w-auto"
                  role="group"
                  aria-label="Meal times"
                >
                  {[{ id: FULL_MENU, name: "Full menu" }, ...meals].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={chosen === m.id}
                      onClick={() => setPeriod(m.id)}
                      className="min-h-[44px] flex-1 whitespace-nowrap rounded-chip px-[17px] text-caption font-[650] text-[#66735B] transition-colors duration-color ease-standard hover:text-brick aria-pressed:bg-cream aria-pressed:text-brick aria-pressed:shadow-[0_2px_7px_#253F2312] sm:flex-none"
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
                <p className="flex items-start gap-[7px] px-1 text-caption text-[#6C775F] sm:items-center">
                  <Icon name="clock" className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:mt-0" />
                  Meal times are a guide. Order while the restaurant is taking orders.
                </p>
              </div>
            )}

            {/* Keyed by the choice, so swapping periods fades the new content
                in once rather than animating what stayed. */}
            <div key={chosen} className="animate-fade">
              {shown.map((meal, index) => (
                <MealBlock
                  key={meal.id}
                  meal={meal}
                  first={index === 0}
                  showName={severalPeriods}
                  open={open}
                  currency={currency}
                  onPickItem={setCustomizing}
                  onPickCombo={setBuilding}
                  favourites={favourites}
                />
              ))}
            </div>
          </>
        )}

        <footer className="mt-[39px] flex flex-col items-start justify-between gap-5 border-t border-[#DDE2D4] pt-[30px] text-caption text-[#707C64] sm:mt-[62px] sm:flex-row sm:flex-wrap sm:gap-[25px] sm:pt-[38px] lg:flex-nowrap">
          <div>
            <p className="font-display text-2xl font-bold tracking-[-.8px] text-brick">
              {restaurant.name}
              <span className="text-accent">.</span>
            </p>
            {restaurant.tagline && <p className="mt-2">{restaurant.tagline}</p>}
          </div>
          <p className="sm:pt-[5px]">
            {restaurant.delivery_offered ? "Order online for pick-up or delivery." : "Order online for pick-up."}
          </p>
          <p className="text-[11px] sm:pt-1">Ordering powered by Zenoeats</p>
        </footer>
      </div>

      {/* Last in the tab order: the menu is read before the order is reviewed. */}
      <CartBar currency={currency} orderable={open} />

      {customizing && (
        <ModifierSheet
          item={customizing}
          currency={currency}
          onClose={() => setCustomizing(null)}
          onAdd={(selected, quantity, note) =>
            dispatch(itemAdded(customizing, selected, quantity, note))
          }
        />
      )}

      {building && (
        <ComboSheet
          combo={building}
          currency={currency}
          onClose={() => setBuilding(null)}
          onAdd={(chosenItems, quantity, note) =>
            dispatch(comboAdded(building, chosenItems, quantity, note))
          }
        />
      )}
    </div>
  );
}

function HeaderLink({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] whitespace-nowrap text-[13px] font-semibold text-[#344D3B] transition-colors duration-color hover:text-accent"
    >
      {children}
    </button>
  );
}

/** The first photo on the menu, preferring one of something on sale. The
 *  banner uses the restaurant's own photography or none at all. */
function heroPhoto(meals: Meal[]): string | null {
  const items = meals.flatMap((m) =>
    m.sections.flatMap((s) => [...s.items, ...s.groups.flatMap((g) => g.items)]),
  );
  const pick = items.find((i) => i.image_url && i.is_available) ?? items.find((i) => i.image_url);
  return pick?.image_url ?? null;
}

// ------------------------------------------------------------------ banner

/**
 * The food banner: the restaurant's name and a way into the menu, over one of
 * its own photos. Without a photo, or when it fails to load, it is the plain
 * green version -- never an empty frame, and never a stock image standing in
 * for food this restaurant does not serve.
 *
 * Depth follows a fine pointer only, capped at ±2.5°, one animation frame at a
 * time, and settles back when the pointer leaves. On touch, and under reduced
 * motion, it never moves.
 */
function HomeBanner({
  restaurant,
  photo,
}: {
  restaurant: Pick<Portal, "name" | "tagline" | "delivery_offered">;
  photo: string | null;
}) {
  const banner = useRef<HTMLElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const hasPhoto = !!photo && failed !== photo;

  useEffect(() => {
    const surface = banner.current;
    const node = media.current;
    if (!surface || !node) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    function onMove(e: PointerEvent) {
      if (!fine.matches || reduced.matches || e.pointerType !== "mouse" || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = surface!.getBoundingClientRect();
        const x = (e.clientX - box.left) / box.width - 0.5;
        const y = (e.clientY - box.top) / box.height - 0.5;
        node!.style.setProperty("--tilt-y", `${(x * 5).toFixed(2)}deg`);
        node!.style.setProperty("--tilt-x", `${(-y * 5).toFixed(2)}deg`);
      });
    }
    function onLeave() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      node!.style.removeProperty("--tilt-x");
      node!.style.removeProperty("--tilt-y");
    }

    surface.addEventListener("pointermove", onMove);
    surface.addEventListener("pointerleave", onLeave);
    return () => {
      surface.removeEventListener("pointermove", onMove);
      surface.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [hasPhoto]);

  return (
    <section
      ref={banner}
      aria-labelledby="restaurant-name"
      className={`home-banner ${hasPhoto ? "" : "home-banner-plain"}`}
    >
      {hasPhoto && (
        <div ref={media} className="home-banner-media" aria-hidden="true">
          <img src={photo!} alt="" decoding="async" draggable={false} onError={() => setFailed(photo)} />
        </div>
      )}
      <div
        className={`relative z-section w-full px-[26px] py-7 sm:px-9 sm:py-[38px] lg:px-[52px] lg:py-[50px] ${
          hasPhoto ? "sm:w-[62%] lg:w-[55%] xl:w-[52%] xl:max-w-[600px]" : "sm:w-[70%] sm:max-w-[700px]"
        }`}
      >
        <p className="eyebrow mb-[13px] text-[#DCC985] sm:mb-[19px]">Order from {restaurant.name}</p>
        <h1
          id="restaurant-name"
          className="mb-2.5 font-display text-[45px] font-bold leading-[1.1] tracking-[-2px] text-[#FFF8E4] [overflow-wrap:anywhere] sm:mb-[13px] sm:text-[49px] lg:text-[56px] lg:tracking-[-3px] xl:text-[64px] xl:leading-[1.03]"
        >
          {restaurant.name}
          <span className="text-gold">.</span>
        </h1>
        {restaurant.tagline && (
          <p className="mb-[17px] max-w-[34ch] text-[15px] text-[#E0E4D2] sm:mb-7 sm:text-[17px]">
            {restaurant.tagline}
          </p>
        )}
        <button
          type="button"
          onClick={() => jumpTo("menu-heading")}
          className={`btn min-h-[44px] gap-[15px] rounded-full border-gold bg-gold px-4 text-caption font-bold text-[#1D3326] hover:border-[#F7D774] hover:bg-[#F7D774] sm:min-h-[49px] sm:gap-5 sm:px-[23px] sm:text-[13px] ${
            restaurant.tagline ? "" : "mt-[7px] sm:mt-3"
          }`}
        >
          Explore the menu
          <Icon name="arrow" className="h-[18px] w-[18px]" />
        </button>
        <p className="mt-[11px] text-caption text-[#D4D9C9] sm:mt-4">
          {restaurant.delivery_offered ? "Order online for pick-up or delivery." : "Order online for pick-up."}
        </p>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- shortcuts

/**
 * A shortcut to every kind of food on screen, and to the meal times. Each
 * jumps to the first place that kind appears and focuses its heading. It
 * scrolls sideways on a phone rather than widening the page.
 */
function CategoryShortcuts({ meals, severalPeriods }: { meals: Meal[]; severalPeriods: boolean }) {
  const seen = new Map<string, { target: string; label: string; photo: string | null }>();
  let combos: { target: string; photo: string | null } | null = null;

  for (const meal of meals) {
    if (meal.combos.length > 0 && !combos) {
      combos = { target: `combos-${meal.id}`, photo: comboPhoto(meal.combos) };
    }
    for (const category of categoriesOf(meal)) {
      const photo = category.items.find((i) => i.image_url)?.image_url ?? null;
      const known = seen.get(category.itemTypeId);
      if (!known) seen.set(category.itemTypeId, { target: category.key, label: category.label, photo });
      else if (!known.photo && photo) known.photo = photo;
    }
  }

  const entries = [
    ...[...seen.values()],
    ...(combos ? [{ ...combos, label: "Combos" }] : []),
  ];
  if (entries.length === 0) return null;

  return (
    <nav
      aria-label="Menu categories"
      className="no-scrollbar mt-4 flex items-stretch justify-start gap-[3px] overflow-x-auto border-b border-[#DDE3D7] pb-4 pt-[9px] sm:mt-5 sm:gap-1 lg:mt-7 lg:justify-around lg:gap-[9px] lg:px-2.5 lg:pb-5 lg:pt-[15px]"
    >
      {entries.map((entry) => (
        <Shortcut key={entry.target} label={entry.label} onClick={() => jumpTo(`heading-${entry.target}`)}>
          <ShortcutThumb photo={entry.photo} label={entry.label} />
        </Shortcut>
      ))}
      {severalPeriods && (
        <Shortcut label="Meal times" onClick={() => jumpTo("meal-times")}>
          <span className="grid h-full w-full place-items-center bg-[#E8EBD9] text-brick">
            <Icon name="clock" className="h-7 w-7" />
          </span>
        </Shortcut>
      )}
    </nav>
  );
}

function Shortcut({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-[89px] flex-col items-center gap-2 rounded-[13px] px-2 pb-[11px] pt-[7px] text-[11px] font-[650] text-[#3C4F3F] transition-colors duration-color hover:bg-[#E9EFDF] hover:text-brick sm:min-w-[95px] lg:min-w-[104px] lg:flex-1 lg:gap-[11px] lg:px-3 lg:text-caption"
    >
      <span className="grid h-[54px] w-[54px] place-items-center overflow-hidden rounded-full border border-[#E3DECF] bg-[#EEE7D9] sm:h-[58px] sm:w-[58px] lg:h-[65px] lg:w-[65px]">
        {children}
      </span>
      <span className="max-w-[120px] truncate">{label}</span>
    </button>
  );
}

function ShortcutThumb({ photo, label }: { photo: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  if (photo && !failed) {
    return (
      <MenuImage
        src={photo}
        onFail={() => setFailed(true)}
        className="h-full w-full object-cover transition-transform duration-[160ms] group-hover:scale-[1.06] motion-reduce:group-hover:scale-100"
      />
    );
  }
  // No photo of this kind of food: its initial, rather than an empty circle.
  return (
    <span aria-hidden="true" className="font-display text-2xl font-bold text-brick">
      {label.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** A photo for a meal deal, borrowed from one of the items it is built from:
 *  a combo has no photo of its own. */
function comboPhoto(combos: Combo[]): string | null {
  for (const combo of combos) {
    for (const slot of combo.slots) {
      const photo = slot.items.find((i) => i.image_url)?.image_url;
      if (photo) return photo;
    }
  }
  return null;
}

// ------------------------------------------------------------------- menu

function MealBlock({
  meal,
  first,
  showName,
  open,
  currency,
  onPickItem,
  onPickCombo,
  favourites,
}: {
  meal: Meal;
  first: boolean;
  /** Only when there is more than one period to tell apart. */
  showName: boolean;
  open: boolean;
  currency: string;
  onPickItem: (item: Item) => void;
  onPickCombo: (combo: Combo) => void;
  favourites: ReturnType<typeof useFavourites>;
}) {
  const hours = mealHours(meal.starts_at, meal.ends_at);
  const categories = categoriesOf(meal);

  return (
    <section
      aria-label={showName ? meal.name : undefined}
      className={first ? "mt-8 sm:mt-10" : "mt-12 border-t border-[#DDE2D4] pt-8 sm:mt-14 sm:pt-10"}
    >
      {/* The hours stay even when the name is hidden, because they would
          otherwise disappear with it. */}
      {(showName || hours) && (
        <div className="mb-[17px] flex flex-wrap items-center justify-between gap-x-5 gap-y-2 sm:mb-[21px]">
          {showName ? (
            <h2 className="font-display text-[27px] font-bold leading-[1.2] tracking-[-.8px] text-[#254830] sm:text-[30px]">
              {meal.name}
              <span className="text-accent">.</span>
            </h2>
          ) : (
            <span />
          )}
          {hours && (
            <p className="flex items-center gap-2 text-caption text-muted">
              <Icon name="clock" className="h-4 w-4" />
              {hours}
            </p>
          )}
        </div>
      )}

      {/* Combos lead the period. A meal deal is the thing a menu wants read
          first, and it is assembled from the lists below it. */}
      {meal.combos.length > 0 && (
        <section className="mb-8">
          <CategoryHeading id={`heading-combos-${meal.id}`} label="Combos" />
          <ul className="flex flex-col gap-[13px] sm:gap-[19px]">
            {meal.combos.map((combo) => (
              <li key={combo.id}>
                <ComboCard combo={combo} currency={currency} open={open} onPick={() => onPickCombo(combo)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Headings come from the server, derived from the kinds of the items
          served in this period. There is no empty one to guard against and
          no name to fall back on. A kind with one dish shares a row with its
          neighbour on a wide screen; a kind with several takes the row. */}
      <div className="grid grid-cols-1 gap-x-[19px] gap-y-8 lg:grid-cols-2">
        {categories.map((category) => {
          const wide = category.items.length > 1;
          return (
            <section key={category.key} className={wide ? "lg:col-span-2" : ""}>
              <CategoryHeading
                id={`heading-${category.key}`}
                label={category.label}
                count={category.items.length}
              />
              <ul className={`grid grid-cols-1 gap-[13px] sm:gap-[19px] ${wide ? "lg:grid-cols-2" : ""}`}>
                {category.items.map((item) => (
                  <li key={item.id} className="relative min-w-0">
                    <MenuCard
                      item={item}
                      path={category.path}
                      open={open}
                      onPick={() => onPickItem(item)}
                    />
                    {/* Beside the card rather than inside it: a button cannot
                        hold another button, and saving an item must not open
                        its sheet. Still works on a sold-out item -- that is
                        exactly one worth remembering for next time. */}
                    <FavouriteButton
                      itemId={item.id}
                      name={item.name}
                      saved={favourites.savedIds.has(item.id)}
                      canSave={favourites.canSave}
                      className="absolute right-1 top-1 sm:right-2 sm:top-2"
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function CategoryHeading({ id, label, count }: { id: string; label: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-[15px]">
      <h3
        id={id}
        tabIndex={-1}
        className="scroll-mt-6 text-lg font-bold leading-[1.3] tracking-[-.5px] text-[#253D2A] sm:text-[19px]"
      >
        {label}
      </h3>
      {count !== undefined && (
        <span className="text-caption text-[#64725B]">
          {count} {count === 1 ? "item" : "items"}
        </span>
      )}
    </div>
  );
}

/**
 * One dish. The whole card opens its sheet; a sold-out dish, or any dish while
 * the restaurant is closed, still reads but cannot be chosen. The photo is
 * optional, and one that fails to load gives its column back to the text.
 */
function MenuCard({
  item,
  path,
  open,
  onPick,
}: {
  item: Item;
  path: string;
  open: boolean;
  onPick: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const photo = item.image_url && failed !== item.image_url ? item.image_url : null;
  const orderable = item.is_available && open;

  return (
    <button
      type="button"
      disabled={!orderable}
      onClick={onPick}
      className={`group flex w-full overflow-hidden rounded-[12px] border border-[#E2E5D9] text-left text-[#243D2D] transition-[box-shadow,border-color] duration-[180ms] ease-standard enabled:hover:border-[#AFC0A3] enabled:hover:shadow-[0_8px_25px_#2549240D] disabled:cursor-not-allowed sm:rounded-product ${
        photo
          ? "min-h-[177px] bg-cream lg:min-h-[224px]"
          : "min-h-[150px] bg-[linear-gradient(115deg,#F5F5EA,#FFFDF8)] lg:min-h-[180px]"
      } ${orderable ? "" : "[&>*]:opacity-[.72]"}`}
    >
      {photo && (
        <span className="flex w-[36%] shrink-0 overflow-hidden bg-[#F2E9D9] lg:w-[41%]">
          <MenuImage
            src={photo}
            onFail={setFailed}
            className="photo-zoom h-full min-h-[177px] w-full object-cover lg:min-h-[224px]"
          />
        </span>
      )}
      <span
        className={`flex min-w-0 flex-1 flex-col px-[15px] py-[17px] sm:px-5 lg:px-[21px] lg:py-[22px] ${
          photo ? "" : "sm:px-6 lg:px-[31px] lg:py-[27px]"
        }`}
      >
        <span className="mb-2 block pr-10 text-[9px] uppercase tracking-[1.2px] text-[#64725B] sm:text-[10px] lg:mb-2.5">
          {path}
        </span>
        <span className="mb-[7px] block pr-8 text-base font-bold leading-[1.25] tracking-[-.3px] text-[#274630] [overflow-wrap:anywhere] sm:text-[17px] lg:mb-2.5 lg:text-lg">
          {item.name}
        </span>
        {item.description && (
          <span className="block max-w-[45ch] text-caption text-[#6D7664]">{item.description}</span>
        )}
        <span className="mt-auto flex items-center justify-between gap-2 pt-[13px] lg:pt-5">
          <span className="tnum whitespace-nowrap text-sm text-[#274630] sm:text-[15px]">
            {money(item.base_price_minor, item.currency)}
          </span>
          {!item.is_available ? (
            <span className="rounded-[5px] border border-[#E7CFC5] bg-[#FBEEE7] px-[7px] py-1 text-[11px] font-[650] text-danger">
              Sold out
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-1 text-[11px] font-[650] text-brick"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brickSoft transition-colors duration-color group-enabled:group-hover:bg-brick group-enabled:group-hover:text-white">
                <Icon name="plus" className="h-4 w-4" />
              </span>
              <span className="hidden sm:inline">Customize</span>
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * A meal deal, as a feature: what it is, what it is made of, what it saves.
 * The picture is one of its own items' photos when any has one.
 */
function ComboCard({
  combo,
  currency,
  open,
  onPick,
}: {
  combo: Combo;
  currency: string;
  open: boolean;
  onPick: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const found = comboPhoto([combo]);
  const photo = found && failed !== found ? found : null;

  return (
    <button
      type="button"
      disabled={!open}
      onClick={onPick}
      className={`group grid w-full grid-cols-1 overflow-hidden rounded-[12px] border border-[#E5DEC2] bg-[#EFEBD8] text-left transition-colors duration-[180ms] ease-standard enabled:hover:border-[#B9C2A0] enabled:hover:bg-[#E8E7CC] disabled:cursor-not-allowed disabled:opacity-[.68] sm:rounded-product ${
        photo ? "sm:min-h-[225px] sm:grid-cols-[1.15fr_1fr]" : ""
      }`}
    >
      <span className="order-1 flex flex-col items-start p-[25px] text-[#28462E] sm:order-none lg:px-[34px] lg:py-[27px]">
        <span className="eyebrow mb-[9px] text-[#64725B]">Meal deal</span>
        <span className="mb-[9px] font-display text-[31px] font-bold leading-[1.1] tracking-[-1px] [overflow-wrap:anywhere] lg:text-[34px]">
          {combo.name}
        </span>
        {combo.description && <span className="text-caption text-[#6A755C]">{combo.description}</span>}
        <span className="mt-3 text-caption text-[#6A755C]">{combo.slots.map((s) => s.label).join(" · ")}</span>
        <span className="mt-5 flex w-full flex-wrap items-center justify-between gap-2.5 sm:mt-6 sm:justify-start sm:gap-[30px]">
          <span className="rounded-[5px] border border-[#D6C8A5] bg-[#F8F2D7] px-[9px] py-[5px] text-[11px] font-bold text-[#70442A]">
            {savingLabel(combo, currency)}
          </span>
          <span className="inline-flex items-center gap-2.5 text-caption font-bold">
            Build your combo
            <Icon name="arrow" className="h-4 w-4" />
          </span>
        </span>
      </span>
      {photo && (
        <span className="flex max-h-[240px] overflow-hidden bg-hero sm:max-h-none">
          <MenuImage src={photo} onFail={setFailed} className="photo-zoom h-full w-full object-cover" />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- cart bar

function CartBar({ currency, orderable }: { currency: string; orderable: boolean }) {
  const count = useAppSelector(selectCartCount);
  const subtotal = useAppSelector(selectCartPreviewSubtotal);
  // Only the bar's first appearance moves: later adds change the count in
  // place, and money never animates.
  const [animate] = useState(() => count === 0);

  const items = `${count} ${count === 1 ? "item" : "items"}`;

  return (
    <>
      {/* Announced politely, in words, whenever the count changes. */}
      <p className="sr-only" aria-live="polite">
        {count > 0 ? `${items} in your order` : ""}
      </p>
      {count > 0 && (
        <div
          className={`fixed inset-x-0 bottom-0 z-cart border-t border-hairline bg-paper/[.96] px-5 pb-3.5 pt-[15px] backdrop-blur-md ${
            animate ? "animate-cart" : ""
          }`}
        >
          <div className="mx-auto max-w-[720px]">
            <Link
              to="/checkout"
              aria-disabled={!orderable}
              tabIndex={orderable ? undefined : -1}
              className={`btn-primary min-h-[56px] w-full justify-between rounded-full px-6 ${
                orderable ? "" : "pointer-events-none opacity-[.44]"
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon name="bag" />
                Review order
                <span className="tnum min-w-[25px] rounded-full bg-white/15 px-[7px] py-0.5 text-center">
                  {count}
                  <span className="sr-only"> {count === 1 ? "item" : "items"}</span>
                </span>
              </span>
              <span className="tnum">{money(subtotal, currency)}</span>
            </Link>
            <p className="mt-[7px] text-center text-[11px] text-muted">Tax is calculated at checkout.</p>
          </div>
        </div>
      )}
    </>
  );
}
