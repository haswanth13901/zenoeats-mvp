"use client";

import { useMemo, useState } from "react";
import { money, signedMoney } from "@/lib/format";
import type { Item, Option } from "@/lib/types";

/** Choose modifiers for one item.
 *
 *  The rules enforced here (required groups, single vs multi, min/max) are a
 *  courtesy to the customer. The server enforces the same rules again at
 *  checkout and its answer is the one that counts.
 */
export function ModifierSheet({
  item,
  currency,
  onClose,
  onAdd,
}: {
  item: Item;
  currency: string;
  onClose: () => void;
  onAdd: (selected: Map<string, Option[]>, quantity: number, note?: string) => void;
}) {
  const [selected, setSelected] = useState<Map<string, Option[]>>(() => {
    const initial = new Map<string, Option[]>();
    for (const group of item.modifier_groups) {
      const defaults = group.options.filter((o) => o.is_default && o.is_available);
      if (defaults.length) initial.set(group.name, defaults);
    }
    return initial;
  });
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  const toggle = (groupName: string, group: Item["modifier_groups"][number], option: Option) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const current = next.get(groupName) ?? [];

      if (group.selection_type === "SINGLE") {
        next.set(groupName, [option]);
        return next;
      }
      const exists = current.some((o) => o.id === option.id);
      if (exists) {
        next.set(groupName, current.filter((o) => o.id !== option.id));
      } else if (current.length < group.max_select) {
        next.set(groupName, [...current, option]);
      }
      return next;
    });
  };

  const unmet = useMemo(
    () =>
      item.modifier_groups
        .filter((g) => g.is_required && (selected.get(g.name)?.length ?? 0) < Math.max(g.min_select, 1))
        .map((g) => g.name),
    [item.modifier_groups, selected]
  );

  const unitPrice =
    item.base_price_minor +
    [...selected.values()].flat().reduce((sum, o) => sum + o.price_delta_minor, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Customize ${item.name}`}
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-surface sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 border-b border-hairline bg-surface px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl leading-tight">{item.name}</h2>
              {item.description && (
                <p className="mt-1 max-w-prose text-sm text-muted">{item.description}</p>
              )}
            </div>
            <button onClick={onClose} className="btn-quiet px-2 py-1" aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        <div className="space-y-6 px-5 py-5">
          {item.modifier_groups.map((group) => {
            const chosen = selected.get(group.name) ?? [];
            return (
              <fieldset key={group.id}>
                <legend className="flex w-full items-baseline justify-between pb-2">
                  <span className="text-sm font-medium">{group.name}</span>
                  <span className="text-xs text-muted">
                    {group.is_required
                      ? "Required"
                      : group.selection_type === "MULTI"
                      ? `Pick up to ${group.max_select}`
                      : "Optional"}
                  </span>
                </legend>

                <div className="divide-y divide-hairline border-y border-hairline">
                  {group.options.map((option) => {
                    const isChosen = chosen.some((o) => o.id === option.id);
                    return (
                      <label
                        key={option.id}
                        className={`flex cursor-pointer items-center gap-3 py-2.5 ${
                          option.is_available ? "" : "opacity-40"
                        }`}
                      >
                        <input
                          type={group.selection_type === "SINGLE" ? "radio" : "checkbox"}
                          name={group.id}
                          checked={isChosen}
                          disabled={!option.is_available}
                          onChange={() => toggle(group.name, group, option)}
                          className="h-4 w-4 accent-brick"
                        />
                        <span className="flex-1 text-sm">{option.name}</span>
                        <span className="tnum text-sm text-muted">
                          {signedMoney(option.price_delta_minor, currency)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
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
              disabled={unmet.length > 0}
              onClick={() => {
                onAdd(selected, quantity, note.trim() || undefined);
                onClose();
              }}
            >
              Add {quantity > 1 ? `${quantity} ` : ""}·{" "}
              <span className="tnum ml-1">{money(unitPrice * quantity, currency)}</span>
            </button>
          </div>
          {unmet.length > 0 && (
            <p className="mt-2 text-xs text-brick">Choose an option for {unmet.join(", ")}.</p>
          )}
        </footer>
      </div>
    </div>
  );
}
