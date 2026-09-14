import type { ItemTypeRow } from "./restaurantApi";

/**
 * Reading the two levels of the item-type list.
 *
 * A type may sit under another one: Food holding Burgers and Nuggets. The
 * nesting is a heading on the storefront and nothing else. Everything
 * structural -- which combo slot an item can fill, which modifier groups the
 * builder offers for it -- reads the top-level type, so a restaurant that
 * subdivides its menu does not split a meal deal or duplicate a group.
 *
 * The server sends one flat list in menu order, each heading followed by its
 * own subcategories, with `parent_id` telling them apart. These are the four
 * questions the builder asks of it, in one place so every screen answers
 * them the same way.
 *
 * Two levels is a rule the database holds, so nothing here walks a tree.
 */

/** The headings: the types a combo slot or a modifier group may name. */
export function topLevel(types: ItemTypeRow[]): ItemTypeRow[] {
  return types.filter((t) => !t.parent_id);
}

/** The subcategories filed under one heading, in the order it put them in. */
export function childrenOf(types: ItemTypeRow[], parentId: string): ItemTypeRow[] {
  return types.filter((t) => t.parent_id === parentId);
}

/**
 * The heading an item of this type belongs to.
 *
 * Itself unless it is a subcategory, in which case its parent. The one place
 * the two levels collapse back into one, and what lets a burger filed under
 * Food > Burgers be offered whatever Food is offered.
 *
 * An id that is not in the list comes back unchanged rather than empty, so a
 * list still loading filters nothing out instead of everything.
 */
export function rootIdOf(types: ItemTypeRow[], typeId: string): string {
  return types.find((t) => t.id === typeId)?.parent_id ?? typeId;
}

/**
 * What to call a type where it appears on its own, away from its heading.
 *
 * "Burgers" is ambiguous in a flat dropdown of every type a restaurant has;
 * "Food / Burgers" is not. Headings are returned as their own bare name,
 * which is every type on a menu that never subdivided anything.
 */
export function typeLabel(types: ItemTypeRow[], typeId: string): string {
  const type = types.find((t) => t.id === typeId);
  if (!type) return "no type";
  if (!type.parent_id) return type.name;
  const parent = types.find((t) => t.id === type.parent_id);
  return parent ? `${parent.name} / ${type.name}` : type.name;
}
