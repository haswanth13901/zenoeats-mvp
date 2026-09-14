import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { MenuImage } from "@/components/common/MenuImage";
import { ModifierSheet } from "@/features/cart/components/ModifierSheet";
import { ComboSheet, savingLabel } from "@/features/cart/components/ComboSheet";
import {
  cartOpened,
  comboAdded,
  itemAdded,
  selectCartCount,
  selectCartPreviewSubtotal,
} from "@/features/cart/cartSlice";
import { usePortalQuery, usePublicMenuQuery } from "@/features/storefront/storefrontApi";
import { errorMessage } from "@/services/apiClient";
import { mealHours, money } from "@/utils/format";
import type { Combo, Item } from "@/types";

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

  const slug = portal.data?.slug;
  useEffect(() => {
    // Binds the cart to this restaurant and restores anything saved for it.
    // Subdomains share an origin and therefore share localStorage, so the cart
    // is keyed by slug rather than one global key.
    if (slug) dispatch(cartOpened(slug));
  }, [slug, dispatch]);

  const loadError =
    (portal.error ? errorMessage(portal.error) : null) ??
    (menu.error ? errorMessage(menu.error) : null);

  if (loadError) {
    return (
      <main className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="font-display text-3xl">This menu isn&apos;t available</h1>
        <p className="mt-3 text-sm text-muted">{loadError}</p>
      </main>
    );
  }

  if (!portal.data || !menu.data) {
    return <main className="px-5 py-24 text-center text-muted">Loading…</main>;
  }

  const meals = menu.data.meals;
  const open = portal.data.is_orderable && portal.data.accepting_orders;
  // Bound to a const, as checkout does: narrowing on portal.data does not
  // survive into the callbacks below, because it is a property of a mutable
  // object rather than a local.
  const currency = portal.data.currency;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto max-w-3xl px-5 py-10">
          <h1 className="font-display text-4xl leading-tight">{portal.data.name}</h1>
          {portal.data.tagline && <p className="mt-2 text-muted">{portal.data.tagline}</p>}
          {!open && (
            <p className="mt-4 border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick">
              Not taking orders right now. You can still look at the menu.
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        {meals.length === 0 && (
          <p className="border border-dashed border-hairline px-4 py-12 text-center text-sm text-muted">
            Nothing on the menu yet.
          </p>
        )}

        {meals.map((meal) => (
          <section key={meal.id} className="mb-10">
            {meals.length > 1 && <h2 className="font-display text-2xl">{meal.name}</h2>}
            {/* The hours, where the restaurant set them. Shown on their own
                when there is only one period, because its name is hidden and
                the hours would go with it otherwise. */}
            {mealHours(meal.starts_at, meal.ends_at) && (
              <p className="mt-0.5 text-sm text-muted">
                {mealHours(meal.starts_at, meal.ends_at)}
              </p>
            )}

            {/* Headings come from the server, derived from the kinds of the
                items served in this period. There is no empty one to guard
                against and no name to fall back on. */}
            {/* Combos lead the period. A meal deal is the thing a menu wants
                read first, and it is assembled from the lists below it. */}
            {meal.combos.length > 0 && (
              <section className="mt-6">
                <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
                  Combos
                </h3>
                <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
                  {meal.combos.map((combo) => (
                    <li key={combo.id}>
                      <button
                        className="flex w-full items-start gap-4 py-4 text-left disabled:opacity-40"
                        disabled={!open}
                        onClick={() => setBuilding(combo)}
                      >
                        <div className="flex-1">
                          <p className="text-[15px]">{combo.name}</p>
                          {combo.description && (
                            <p className="mt-0.5 max-w-prose text-sm text-muted">
                              {combo.description}
                            </p>
                          )}
                          <p className="mt-0.5 text-sm text-muted">
                            {combo.slots.map((s) => s.label).join(" · ")}
                          </p>
                        </div>
                        <span className="text-[15px] text-brick">
                          {savingLabel(combo, currency)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {meal.sections.map((section) => (
              <section key={section.item_type_id} className="mt-6">
                <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
                  {section.label}
                </h3>

                {/* What is filed on the heading itself, before any of its
                    subcategories. A menu that subdivided only half its food
                    still reads top to bottom. */}
                {section.items.length > 0 && (
                  <ItemList items={section.items} open={open} onPick={setCustomizing} />
                )}

                {section.groups.map((group) => (
                  <div key={group.item_type_id} className="mt-4">
                    {/* Quieter than the heading above it and indented under
                        it, so the two levels read as one list rather than
                        as two headings of equal weight. */}
                    <h4 className="pl-3 text-[13px] font-medium text-ink/70">
                      {group.label}
                    </h4>
                    <ItemList items={group.items} open={open} onPick={setCustomizing} />
                  </div>
                ))}
              </section>
            ))}
          </section>
        ))}
      </main>

      <CartBar currency={portal.data.currency} orderable={open} />

      {customizing && (
        <ModifierSheet
          item={customizing}
          currency={portal.data.currency}
          onClose={() => setCustomizing(null)}
          onAdd={(selected, quantity, note) =>
            dispatch(itemAdded(customizing, selected, quantity, note))
          }
        />
      )}

      {building && (
        <ComboSheet
          combo={building}
          currency={portal.data.currency}
          onClose={() => setBuilding(null)}
          onAdd={(chosen, quantity, note) =>
            dispatch(comboAdded(building, chosen, quantity, note))
          }
        />
      )}
    </div>
  );
}

function CartBar({ currency, orderable }: { currency: string; orderable: boolean }) {
  const count = useAppSelector(selectCartCount);
  const subtotal = useAppSelector(selectCartPreviewSubtotal);
  if (count === 0) return null;

  return (
    <div className="sticky bottom-0 border-t border-hairline bg-surface/95 px-5 py-3 backdrop-blur">
      <Link
        to="/checkout"
        aria-disabled={!orderable}
        className={`btn-primary w-full ${orderable ? "" : "pointer-events-none opacity-40"}`}
      >
        <span>
          Review order · {count} {count === 1 ? "item" : "items"}
        </span>
        <span className="tnum ml-auto">{money(subtotal, currency)}</span>
      </Link>
      <p className="mt-2 text-center text-xs text-muted">Tax is calculated at checkout.</p>
    </div>
  );
}

/**
 * The items of a section or of one of its subcategories.
 *
 * The same list either way, because a burger under a Burgers subheading is
 * the same row as a burger filed straight on Food. Only the heading above it
 * differs, so only the heading is written twice.
 */
function ItemList({
  items,
  open,
  onPick,
}: {
  items: Item[];
  /** Whether the restaurant is taking orders. Shut, the rows still read. */
  open: boolean;
  onPick: (item: Item) => void;
}) {
  return (
    <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
      {items.map((item) => (
        <li key={item.id}>
          <button
            className="flex w-full items-start gap-4 py-4 text-left disabled:opacity-40"
            disabled={!item.is_available || !open}
            onClick={() => onPick(item)}
          >
            {/* min-w-0 so the photo can fill the column without pushing the
                price off the edge of a narrow phone. */}
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">{item.name}</p>
              {/* Under the name, where the eye already is, and above the
                  description it illustrates. Capped in width so one photo
                  does not turn a desktop menu into a gallery. */}
              <MenuImage
                src={item.image_url}
                className="mt-2 aspect-[4/3] w-full max-w-xs rounded-md bg-paper object-cover"
              />
              {item.description && (
                <p className="mt-0.5 max-w-prose text-sm text-muted">
                  {item.description}
                </p>
              )}
              {!item.is_available && (
                <p className="mt-1 text-sm text-brick">Sold out</p>
              )}
            </div>
            <span className="tnum text-[15px]">
              {money(item.base_price_minor, item.currency)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
