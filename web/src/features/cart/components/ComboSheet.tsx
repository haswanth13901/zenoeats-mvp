import { useState } from "react";
import { MenuImage } from "@/components/common/MenuImage";
import { money, signedMoney } from "@/utils/format";
import type { Combo, Item, Option } from "@/types";
import {
  defaultSelection,
  toggleOption,
  unitPrice,
  unmetGroups,
  type Selection,
} from "../modifiers";
import { ModifierGroups } from "./ModifierGroups";

/** What one slot has been filled with, if anything yet. */
type SlotChoice = { item: Item; selected: Selection };

/**
 * Build one combo: choose an item for every slot, then change it if you like.
 *
 * Every slot is required and takes exactly one item, which is what makes a
 * meal deal a meal deal rather than a discount on whatever you fancy. The
 * button stays disabled until each slot is filled and each chosen item's own
 * required modifiers are answered, and the footer says which is missing --
 * a combo has several ways to be incomplete and "not yet" is no use.
 *
 * The running total is a preview. Every price, rule and discount here is
 * enforced again by the server at checkout, and its answer is what is
 * charged.
 */
export function ComboSheet({
  combo,
  currency,
  onClose,
  onAdd,
}: {
  combo: Combo;
  currency: string;
  onClose: () => void;
  onAdd: (
    chosen: { slotId: string; slotLabel: string; item: Item; selected: Selection }[],
    quantity: number,
    note?: string,
  ) => void;
}) {
  // Keyed by slot id, not by index: two slots can offer the same item, and a
  // combo can be edited to have fewer slots than a stale render expects.
  const [choices, setChoices] = useState<Record<string, SlotChoice>>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  function chooseItem(slotId: string, item: Item) {
    setChoices((prev) => {
      // Re-picking the same item leaves its modifiers alone. Choosing a
      // different one starts that item's own defaults, because the previous
      // item's options mean nothing on it.
      if (prev[slotId]?.item.id === item.id) return prev;
      return { ...prev, [slotId]: { item, selected: defaultSelection(item) } };
    });
  }

  function toggle(slotId: string, group: Item["modifier_groups"][number], option: Option) {
    setChoices((prev) => {
      const current = prev[slotId];
      if (!current) return prev;
      return {
        ...prev,
        [slotId]: { ...current, selected: toggleOption(current.selected, group, option) },
      };
    });
  }

  const filled = combo.slots
    .map((slot) => {
      const choice = choices[slot.id];
      return choice ? { slot, choice } : null;
    })
    .filter((x): x is { slot: Combo["slots"][number]; choice: SlotChoice } => x !== null);

  const emptySlots = combo.slots
    .filter((slot) => !choices[slot.id])
    .map((slot) => slot.label);

  const unanswered = filled.flatMap(({ choice }) =>
    unmetGroups(choice.item, choice.selected),
  );

  const itemsSubtotal = filled.reduce(
    (sum, { choice }) => sum + unitPrice(choice.item, choice.selected),
    0,
  );

  // The same arithmetic the server runs, so the preview and the receipt
  // agree: round the percentage once, never take off more than the food.
  const rawDiscount =
    combo.discount_kind === "PERCENT"
      ? Math.round((itemsSubtotal * combo.discount_value) / 10000)
      : combo.discount_kind === "AMOUNT"
        ? Math.max(0, combo.discount_value)
        : 0;
  const discount = Math.min(rawDiscount, itemsSubtotal);
  const unit = Math.max(0, itemsSubtotal - discount);

  const ready = emptySlots.length === 0 && unanswered.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Build ${combo.name}`}
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-surface sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 border-b border-hairline bg-surface px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl leading-tight">{combo.name}</h2>
              {combo.description && (
                <p className="mt-1 max-w-prose text-sm text-muted">{combo.description}</p>
              )}
              <p className="mt-1 text-sm text-brick">{savingLabel(combo, currency)}</p>
            </div>
            <button onClick={onClose} className="btn-quiet px-2 py-1" aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        <div className="space-y-8 px-5 py-5">
          {combo.slots.map((slot) => {
            const choice = choices[slot.id];
            return (
              <section key={slot.id}>
                {/* The type name as a heading, with no article in front:
                    it is the restaurant's own word and may be plural, so
                    "Choose a Tiffins" is a sentence this cannot write. */}
                <div className="flex items-baseline justify-between pb-2">
                  <h3 className="text-sm font-medium">{slot.label}</h3>
                  <span className="text-xs text-muted">Choose one</span>
                </div>

                <div className="divide-y divide-hairline border-y border-hairline">
                  {slot.items.map((item) => (
                    <label
                      key={item.id}
                      className={`flex cursor-pointer items-center gap-3 py-2.5 ${
                        item.is_available ? "" : "opacity-40"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`slot:${slot.id}`}
                        checked={choice?.item.id === item.id}
                        disabled={!item.is_available}
                        onChange={() => chooseItem(slot.id, item)}
                        className="h-4 w-4 accent-brick"
                      />
                      <MenuImage
                        src={item.image_url}
                        className="h-10 w-10 shrink-0 rounded bg-paper object-cover"
                      />
                      <span className="flex-1 text-sm">
                        {item.name}
                        {!item.is_available && (
                          <span className="ml-2 text-xs text-brick">sold out</span>
                        )}
                      </span>
                      <span className="tnum text-sm text-muted">
                        {money(item.base_price_minor, currency)}
                      </span>
                    </label>
                  ))}
                </div>

                {/* The chosen item's own modifiers, in place. A combo does not
                    relax them: a required choice is still required inside one. */}
                {choice && choice.item.modifier_groups.length > 0 && (
                  <div className="mt-4 space-y-5 border-l-2 border-hairline pl-4">
                    <ModifierGroups
                      item={choice.item}
                      currency={currency}
                      selected={choice.selected}
                      scope={slot.id}
                      onToggle={(group, option) => toggle(slot.id, group, option)}
                    />
                  </div>
                )}
              </section>
            );
          })}

          <label className="block">
            <span className="text-sm font-medium">Note for the kitchen</span>
            <input
              className="field mt-2"
              value={note}
              maxLength={280}
              placeholder="Allergies, how you'd like it cooked"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>

        <footer className="sticky bottom-0 border-t border-hairline bg-surface px-5 py-4">
          {discount > 0 && (
            <div className="mb-3 flex items-baseline justify-between text-sm">
              <span className="text-muted">
                {money(itemsSubtotal, currency)} separately
              </span>
              <span className="tnum text-brick">
                {signedMoney(-discount, currency)}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-md border border-hairline">
              <button
                className="px-3 py-2 text-lg leading-none"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="tnum w-8 text-center text-sm">{quantity}</span>
              <button
                className="px-3 py-2 text-lg leading-none"
                onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            <button
              className="btn-primary flex-1"
              disabled={!ready}
              onClick={() => {
                onAdd(
                  filled.map(({ slot, choice }) => ({
                    slotId: slot.id,
                    slotLabel: slot.label,
                    item: choice.item,
                    selected: choice.selected,
                  })),
                  quantity,
                  note.trim() || undefined,
                );
                onClose();
              }}
            >
              Add {quantity > 1 ? `${quantity} ` : ""}·{" "}
              <span className="tnum ml-1">{money(unit * quantity, currency)}</span>
            </button>
          </div>

          {/* Named, not merely counted. A combo has several ways to be
              unfinished and the customer should not have to hunt for which. */}
          {emptySlots.length > 0 && (
            <p className="mt-2 text-xs text-brick">
              Still to choose: {emptySlots.join(", ")}.
            </p>
          )}
          {emptySlots.length === 0 && unanswered.length > 0 && (
            <p className="mt-2 text-xs text-brick">
              Choose an option for {unanswered.join(", ")}.
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}

/** What the deal saves, in the words the customer reads on the menu too. */
export function savingLabel(combo: Combo, currency: string): string {
  if (combo.discount_kind === "PERCENT" && combo.discount_value > 0) {
    // Basis points, so 1250 is 12.5%. Trailing zeros are dropped: "10% off"
    // rather than "10.0% off".
    const percent = combo.discount_value / 100;
    return `${Number(percent.toFixed(2))}% off`;
  }
  if (combo.discount_kind === "AMOUNT" && combo.discount_value > 0) {
    return `${money(combo.discount_value, currency)} off`;
  }
  return "Pick one of each";
}
