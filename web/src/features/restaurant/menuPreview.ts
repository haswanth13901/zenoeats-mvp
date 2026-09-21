import type { Combo, Item, Meal } from "@/types";
import type { ItemTypeRow } from "./restaurantApi";

/**
 * The menu the way a customer reads it, reorganised category-first.
 *
 * The storefront groups by meal period first and by category inside it, so an
 * item served at both breakfast and lunch is printed twice. That is not a bug
 * in the data -- it is two link rows, and both are real -- but it is not how a
 * menu reads. This builds the other arrangement: every item once, under its
 * own heading, with the periods it is served in carried alongside it.
 *
 * Nothing here talks to the server. It is a pure rearrangement of the menu the
 * builder already loaded, which is what makes it safe to look at: the preview
 * cannot disagree with the storefront about what exists, only about the order
 * it is read in.
 *
 * A meal period carries no clock anywhere in this system -- no start, no end,
 * nothing gates ordering by time of day, and an order records the item and
 * never the period it came from. So a period is a heading with a hand-picked
 * list under it, and "all day" below means "on every period's list" rather
 * than anything about hours.
 */

/** One item, and when it is served.
 *
 *  `periods` is in menu order and is only worth printing when `allDay` is
 *  false: on an all-day item it would repeat every period the restaurant has
 *  against every row. */
export type PreviewItem = {
  item: Item;
  periods: string[];
  allDay: boolean;
};

export type PreviewSubsection = {
  item_type_id: string;
  label: string;
  items: PreviewItem[];
};

/** A heading and its subcategories, the same two levels the storefront reads.
 *  Built from the restaurant's type list rather than from the items, so the
 *  headings come out in the order it put them in. */
export type PreviewSection = {
  item_type_id: string;
  label: string;
  items: PreviewItem[];
  groups: PreviewSubsection[];
};

/** What one period has that no other period does.
 *
 *  Combos live here and nowhere else: a combo belongs to exactly one period by
 *  its foreign key, and it spans categories by definition, so there is no
 *  heading in the listing above that could hold it. */
export type PreviewPeriod = {
  id: string;
  name: string;
  /** HH:MM, or both null where the restaurant has not said. */
  starts_at: string | null;
  ends_at: string | null;
  combos: Combo[];
  only: PreviewItem[];
};

export type MenuPreview = {
  sections: PreviewSection[];
  periods: PreviewPeriod[];
  /** How many periods a customer would actually see. */
  servingPeriods: number;
  /** Distinct items, which is the number the listing prints. */
  itemCount: number;
  /** Items served in some periods but not all. */
  specialCount: number;
};

/** Every item a period serves, headings and subcategories alike. */
function itemsOf(meal: Meal): Item[] {
  const out: Item[] = [];
  for (const section of meal.sections) {
    out.push(...section.items);
    for (const group of section.groups) out.push(...group.items);
  }
  return out;
}

export function buildMenuPreview(
  meals: Meal[],
  types: ItemTypeRow[],
): MenuPreview {
  // Only the periods a customer would see. The builder is sent periods that
  // serve nothing, because that is the screen where they get filled, and
  // counting one of those here would mean no item was ever on every list --
  // so a menu would read as all specials the moment a period was created.
  const serving = meals.filter(
    (meal) => meal.sections.length > 0 || meal.combos.length > 0,
  );

  const byId = new Map<string, Item>();
  // Keyed by period id rather than name, because two periods may share a name
  // and counting them as one would call an item all-day that is not.
  const servedIn = new Map<string, string[]>();
  const nameOf = new Map<string, string>();

  for (const meal of serving) {
    nameOf.set(meal.id, meal.name);
    for (const item of itemsOf(meal)) {
      if (!byId.has(item.id)) byId.set(item.id, item);
      const seen = servedIn.get(item.id);
      if (!seen) servedIn.set(item.id, [meal.id]);
      else if (!seen.includes(meal.id)) seen.push(meal.id);
    }
  }

  // One period is not a schedule. A restaurant that never split its menu
  // serves everything all day, and badging every row with the one period it
  // has would be noise on every line of the menu.
  const total = serving.length;
  const single = total <= 1;

  function decorate(item: Item): PreviewItem {
    const ids = servedIn.get(item.id) ?? [];
    return {
      item,
      periods: ids.map((id) => nameOf.get(id) ?? ""),
      allDay: single || ids.length === total,
    };
  }

  const buckets = new Map<string, PreviewItem[]>();
  for (const item of byId.values()) {
    const list = buckets.get(item.item_type_id);
    if (list) list.push(decorate(item));
    else buckets.set(item.item_type_id, [decorate(item)]);
  }

  // The same single pass the server makes over the type list: it is already in
  // reading order, each heading followed by its own subcategories, so a
  // subcategory never has to look backwards for its parent. A heading is held
  // back until something lands in it or in one of its children, and an item
  // whose type is gone falls out here rather than appearing under no heading.
  const sections: PreviewSection[] = [];
  const started = new Map<string, PreviewSection>();
  const placed = new Set<string>();

  for (const type of types) {
    const items = buckets.get(type.id) ?? [];

    if (!type.parent_id) {
      const section: PreviewSection = {
        item_type_id: type.id,
        label: type.name,
        items,
        groups: [],
      };
      started.set(type.id, section);
      if (items.length) {
        sections.push(section);
        placed.add(type.id);
      }
      continue;
    }

    if (!items.length) continue;
    const parent = started.get(type.parent_id);
    if (!parent) continue;
    if (!placed.has(type.parent_id)) {
      sections.push(parent);
      placed.add(type.parent_id);
    }
    parent.groups.push({ item_type_id: type.id, label: type.name, items });
  }

  const periods: PreviewPeriod[] = serving.map((meal) => ({
    id: meal.id,
    name: meal.name,
    starts_at: meal.starts_at,
    ends_at: meal.ends_at,
    combos: meal.combos,
    // Nothing is exclusive when there is only one list to be on.
    only: single
      ? []
      : itemsOf(meal)
          .filter((item) => (servedIn.get(item.id) ?? []).length === 1)
          .map(decorate),
  }));

  let specialCount = 0;
  for (const ids of servedIn.values()) {
    if (!single && ids.length < total) specialCount += 1;
  }

  return {
    sections,
    periods,
    servingPeriods: total,
    itemCount: byId.size,
    specialCount,
  };
}
