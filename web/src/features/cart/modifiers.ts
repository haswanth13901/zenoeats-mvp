import type { Item, ModifierGroup, Option } from "@/types";

/**
 * The rules for choosing modifiers on one item, as plain functions.
 *
 * Extracted from the modifier sheet because a combo needs exactly the same
 * rules, once per slot, and a sheet cannot be called in a loop. Functions
 * rather than a hook for the same reason: a combo holds a selection per slot
 * in one state object, and the number of slots differs per combo.
 *
 * All of it is a courtesy to the customer. The server enforces every one of
 * these rules again at checkout, and its answer is the one that counts.
 */

/** Selections for one item, keyed by group name.
 *
 *  By name rather than id because the cart line builds its labels from the
 *  key, and a label is what the kitchen ticket and the receipt show. Two
 *  groups on one item sharing a name would collide; the menu builder has no
 *  reason to make that, and the server would still price it correctly. */
export type Selection = Map<string, Option[]>;

/** What the item comes with, already chosen.
 *
 *  Driven by the item rather than by a flag on the option, because a burger
 *  and a salad built from the same Veggies group come with different things.
 *  A sold-out inclusion is left off: it cannot be served, and starting the
 *  customer with something unavailable only earns a refusal at checkout. */
export function defaultSelection(item: Item): Selection {
  const included = new Set(item.included_option_ids);
  const initial: Selection = new Map();
  for (const group of item.modifier_groups) {
    const comesWith = group.options.filter((o) => included.has(o.id) && o.is_available);
    if (comesWith.length) initial.set(group.name, comesWith);
  }
  return initial;
}

/** True when this item comes with the option, so it costs nothing here. */
export function isIncluded(item: Item, optionId: string): boolean {
  return item.included_option_ids.includes(optionId);
}

/** Turn one option on or off, honouring the group's own rules.
 *
 *  A single-choice group replaces rather than accumulates. A multi-choice one
 *  refuses to go past its maximum, which is why a full group simply stops
 *  responding rather than silently dropping an earlier choice. */
export function toggleOption(
  selected: Selection,
  group: ModifierGroup,
  option: Option,
): Selection {
  const next: Selection = new Map(selected);
  const current = next.get(group.name) ?? [];

  if (group.selection_type === "SINGLE") {
    next.set(group.name, [option]);
    return next;
  }

  const already = current.some((o) => o.id === option.id);
  if (already) next.set(group.name, current.filter((o) => o.id !== option.id));
  else if (current.length < group.max_select) next.set(group.name, [...current, option]);
  return next;
}

/** The required groups still waiting on a choice, by name, for the message
 *  that says what is missing. */
export function unmetGroups(item: Item, selected: Selection): string[] {
  return item.modifier_groups
    .filter(
      (g) => g.is_required && (selected.get(g.name)?.length ?? 0) < Math.max(g.min_select, 1),
    )
    .map((g) => g.name);
}

/** What the chosen options add to the price of one unit.
 *
 *  Nothing for what the item comes with: that is part of the item, not a
 *  topping that happens to be free. May be negative otherwise, because
 *  "no cheese -0.50" is the documented exception to the non-negative rule.
 *
 *  The same arithmetic the server runs. A preview that disagreed would look
 *  like a price change at checkout, which is the one thing this app refuses
 *  to do quietly. */
export function modifierDelta(item: Item, selected: Selection): number {
  const included = new Set(item.included_option_ids);
  return [...selected.values()]
    .flat()
    .reduce((sum, o) => sum + (included.has(o.id) ? 0 : o.price_delta_minor), 0);
}

/** One unit of this item as configured, floored at zero for the same reason
 *  the server floors it: deltas may be negative, a price may not. */
export function unitPrice(item: Item, selected: Selection): number {
  return Math.max(0, item.base_price_minor + modifierDelta(item, selected));
}

/** The shape the API takes, flattened out of the selection map.
 *
 *  The delta is what this item charges for the option, so an inclusion
 *  carries zero. The cart shows it and the server agrees; neither is the
 *  authority on the final price, which is quoted fresh at checkout. */
export function toCartModifiers(
  item: Item,
  selected: Selection,
): { option_id: string; quantity: number; label: string; delta: number }[] {
  const included = new Set(item.included_option_ids);
  return [...selected.entries()].flatMap(([groupName, options]) =>
    options.map((o) => ({
      option_id: o.id,
      quantity: 1,
      label: `${groupName}: ${o.name}`,
      delta: included.has(o.id) ? 0 : o.price_delta_minor,
    })),
  );
}
