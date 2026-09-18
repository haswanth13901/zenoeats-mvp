import { Empty } from "@/components/common/Feedback";
import { MenuImage } from "@/components/common/MenuImage";
import { savingLabel } from "@/features/cart/components/ComboSheet";
import type { Meal } from "@/types";
import { mealHours, money } from "@/utils/format";
import { buildMenuPreview, type PreviewItem } from "../menuPreview";
import type { ItemTypeRow } from "../restaurantApi";

/**
 * The menu, read rather than edited.
 *
 * The other four tabs are each one question about the menu. This is the
 * answer to all of them at once, and the only screen in the builder that
 * shows what was actually made. Checking that used to mean opening the
 * storefront in another tab.
 *
 * Category-first, so every item is printed once. The storefront groups by
 * meal period first, which prints an item served at both breakfast and lunch
 * twice -- correctly, from its own point of view, and confusingly from the
 * menu's. What the period grouping was carrying is kept as a note on the
 * rows that are not served all day, and as a block of its own underneath.
 *
 * Strictly read-only. Nothing here mutates, so being wrong about the
 * arrangement costs nothing: it is the safe place to find out whether
 * category-first reads better before the storefront is moved to it.
 */
export function MenuPreview({
  meals,
  types,
}: {
  meals: Meal[];
  types: ItemTypeRow[];
}) {
  const preview = buildMenuPreview(meals, types);
  // Every item on one menu is priced in one currency. Taking it from a row
  // rather than threading the portal query through this screen.
  const currency =
    preview.sections[0]?.items[0]?.item.currency ??
    preview.sections[0]?.groups[0]?.items[0]?.item.currency ??
    "USD";

  if (preview.itemCount === 0 && preview.periods.length === 0) {
    return (
      <Empty>
        Nothing on the menu yet. Add items on the Items tab, then serve them in a meal period.
      </Empty>
    );
  }

  return (
    <div>
      <p className="mb-6 text-caption text-muted">
        {preview.itemCount} {preview.itemCount === 1 ? "item" : "items"} across{" "}
        {preview.sections.length}{" "}
        {preview.sections.length === 1 ? "category" : "categories"}
        {preview.servingPeriods > 1 && (
          <>
            , {preview.servingPeriods} meal periods, {preview.specialCount} not
            served all day
          </>
        )}
        . Each item appears once here, however many periods serve it.
      </p>

      <div className="grid grid-cols-1 gap-x-9 md:grid-cols-2">
        {preview.sections.map((section) => (
          <section key={section.item_type_id} className="mb-8">
            <h2 className="font-display text-[30px] leading-[1.2] tracking-[-.7px]">{section.label}</h2>

            {section.items.length > 0 && <Rows rows={section.items} currency={currency} />}

            {section.groups.map((group) => (
              <div key={group.item_type_id} className="mt-[18px] border-l-2 border-[#E4DED3] pl-4">
                <h3 className="mb-1 mt-3 text-caption font-[650] uppercase tracking-[1.7px] text-muted">
                  {group.label}
                </h3>
                <Rows rows={group.items} currency={currency} />
              </div>
            ))}
          </section>
        ))}
      </div>

      {/* Only worth a block once there is more than one period to tell apart,
          or a combo, which has no home in the listing above: a combo belongs
          to one period and spans categories, so no heading can hold it. */}
      {preview.periods.some((p) => p.only.length > 0 || p.combos.length > 0) && (
        <section className="mt-6">
          <h2 className="font-display text-[30px] leading-[1.2] tracking-[-.7px]">By meal period</h2>
          <p className="field-hint max-w-prose">
            Combos, and what each period serves that no other one does.
            Everything else on the menu is served all day.
          </p>

          {preview.periods.map((period) => {
            if (!period.only.length && !period.combos.length) return null;
            return (
              <div key={period.id} className="card mt-6">
                <h3 className="text-lg font-semibold">
                  {period.name}
                  {mealHours(period.starts_at, period.ends_at) && (
                    <span className="ml-2 text-caption font-normal text-muted">
                      {mealHours(period.starts_at, period.ends_at)}
                    </span>
                  )}
                </h3>

                {period.combos.length > 0 && (
                  <ul className="mt-2">
                    {period.combos.map((combo) => (
                      <li key={combo.id} className="flex items-start gap-4 border-b border-hairline py-[18px]">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{combo.name}</p>
                          <p className="mt-1 text-caption text-muted">
                            {combo.slots.map((s) => s.label).join(" · ")}
                          </p>
                        </div>
                        <span className="text-[13px] font-[650] text-brick">
                          {savingLabel(combo, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {period.only.length > 0 && (
                  <Rows rows={period.only} currency={currency} hidePeriods />
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

/** The item rows of one heading.
 *
 *  `hidePeriods` is for the period block below, where the heading above every
 *  row already says the one period it is served in. */
function Rows({
  rows,
  currency,
  hidePeriods = false,
}: {
  rows: PreviewItem[];
  currency: string;
  hidePeriods?: boolean;
}) {
  return (
    <ul>
      {rows.map(({ item, periods, allDay }) => (
        <li key={item.id} className="border-b border-hairline py-[18px]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-lg font-semibold leading-snug">
                {item.name}
                {!item.is_available && <span className="pill-red">sold out</span>}
              </p>
              {item.description && (
                <p className="mt-3 max-w-prose text-caption text-muted">{item.description}</p>
              )}
              {/* Said only where it is news. An all-day item would otherwise
                  list every period the restaurant has against every row. */}
              {!allDay && !hidePeriods && (
                <p className="mt-3 text-caption text-brick">{periods.join(", ")} only</p>
              )}
            </div>
            <span className="tnum whitespace-nowrap">
              {money(item.base_price_minor, item.currency || currency)}
            </span>
          </div>
          {/* Where the storefront puts it and at the size it shows it, so
              this preview answers "how will my photos look". */}
          <MenuImage
            src={item.image_url}
            className="mt-[15px] block aspect-[4/3] w-full max-w-[320px] rounded-button bg-paper object-cover"
          />
        </li>
      ))}
    </ul>
  );
}
