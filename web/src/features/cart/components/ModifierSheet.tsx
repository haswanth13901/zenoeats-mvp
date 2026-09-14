import { useMemo, useState } from "react";
import { MenuImage } from "@/components/common/MenuImage";
import { money } from "@/utils/format";
import type { Item, Option } from "@/types";
import {
  defaultSelection,
  toggleOption,
  unitPrice as unitPriceOf,
  unmetGroups,
  type Selection,
} from "../modifiers";
import { ModifierGroups } from "./ModifierGroups";

/**
 * Choose modifiers for one item.
 *
 * The rules enforced here -- required groups, single versus multi, min and max
 * -- are a courtesy to the customer. The server enforces the same rules again
 * at checkout and its answer is the one that counts.
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
  const [selected, setSelected] = useState<Selection>(() => defaultSelection(item));
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  function toggle(group: Item["modifier_groups"][number], option: Option) {
    setSelected((prev) => toggleOption(prev, group, option));
  }

  const unmet = useMemo(() => unmetGroups(item, selected), [item, selected]);
  const price = unitPriceOf(item, selected);

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
        {/* Above the header rather than in it. The header sticks while the
            choices scroll, and a photo stuck there would take half a phone
            screen away from the options a customer is trying to read. */}
        <MenuImage
          src={item.image_url}
          className="aspect-[16/9] w-full bg-paper object-cover"
        />
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
          <ModifierGroups
            item={item}
            currency={currency}
            selected={selected}
            scope={item.id}
            onToggle={toggle}
          />

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
              <span className="tnum ml-1">{money(price * quantity, currency)}</span>
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
