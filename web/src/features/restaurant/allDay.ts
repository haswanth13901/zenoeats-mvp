import type { Meal, Section } from "@/types";
import type { LibraryItem } from "./restaurantApi";

/**
 * Which items are served all day, and folding them out of one period.
 *
 * An item ticked for every meal period is not a fact about any one period --
 * it is the menu's baseline. Printing it under every heading of every period
 * buries the handful of rows that actually differ, which is the only thing
 * the meal periods screen exists to show.
 *
 * Kept out of the component so the rule can be checked on its own: what
 * counts as "every period" is the kind of thing that goes quietly wrong when
 * a period is empty or has just been deleted.
 */

/**
 * The items on every period there is.
 *
 * Tested against the periods actually on the screen rather than by counting
 * each item's `meal_ids`, so an id left behind by a deleted period cannot
 * make an item look all-day when it is not.
 *
 * With one period the answer is deliberately empty. Everything would qualify,
 * and a screen that folded its entire contents away would show nothing at
 * all. One period is a menu, not a schedule.
 */
export function allDayItemIds(meals: Meal[], items: LibraryItem[]): Set<string> {
  if (meals.length < 2) return new Set();
  return new Set(
    items
      .filter((item) => meals.every((meal) => item.meal_ids.includes(meal.id)))
      .map((item) => item.id),
  );
}

/**
 * One period's headings with the all-day rows taken out.
 *
 * A heading those rows were the whole of goes with them: an empty heading is
 * a word with nothing under it. Subcategories are emptied first so a parent
 * is judged on what is left of it, which is what keeps a Food heading whose
 * only remaining rows are under Food / Burgers.
 */
export function foldAllDay(sections: Section[], allDay: Set<string>): Section[] {
  if (allDay.size === 0) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !allDay.has(item.id)),
      groups: section.groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !allDay.has(item.id)),
        }))
        .filter((group) => group.items.length > 0),
    }))
    .filter((section) => section.items.length > 0 || section.groups.length > 0);
}

/** What a period serves, and how much of that is served all day. */
export function countServed(
  sections: Section[],
  allDay: Set<string>,
): { served: number; folded: number } {
  let served = 0;
  let folded = 0;
  for (const section of sections) {
    for (const item of [...section.items, ...section.groups.flatMap((g) => g.items)]) {
      served += 1;
      if (allDay.has(item.id)) folded += 1;
    }
  }
  return { served, folded };
}
