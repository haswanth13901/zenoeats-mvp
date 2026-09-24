import { useMemo, useState } from "react";
import { MenuImage } from "@/components/common/MenuImage";
import { QuantityStepper, Sheet } from "@/components/common/Sheet";
import { money } from "@/utils/format";
import { kcal } from "@/features/cart/calories";
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
  const helper = unmet.length > 0 ? `Choose an option for ${unmet.join(", ")}.` : null;

  return (
    <Sheet
      title={item.name}
      description={item.description}
      eyebrow={
        kcal(item.calories) ? (
          <p className="mt-2 text-caption text-muted">{kcal(item.calories)}</p>
        ) : undefined
      }
      onClose={onClose}
      // Above the header rather than in it. The header sticks while the
      // choices scroll, and a photo stuck there would take half a phone
      // screen away from the options a customer is trying to read.
      hero={
        <MenuImage
          src={item.image_url}
          className="block h-[175px] w-full bg-paper object-cover sm:h-[200px]"
        />
      }
      footer={
        <>
          {helper && (
            <p id="sheet-helper" className="mb-2.5 text-caption text-danger">
              {helper}
            </p>
          )}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <QuantityStepper value={quantity} min={1} max={20} label="items" onChange={setQuantity} />
            <button
              type="button"
              className="btn-primary flex-1 rounded-full px-[11px] sm:px-[19px]"
              disabled={unmet.length > 0}
              aria-describedby={helper ? "sheet-helper" : undefined}
              onClick={() => {
                onAdd(selected, quantity, note.trim() || undefined);
                onClose();
              }}
            >
              Add {quantity} · <span className="tnum">{money(price * quantity, currency)}</span>
            </button>
          </div>
        </>
      }
    >
      <ModifierGroups
        item={item}
        currency={currency}
        selected={selected}
        scope={item.id}
        onToggle={toggle}
      />

      <label className="block">
        <span className="label">Note for the kitchen</span>
        <textarea
          className="field mt-[7px]"
          value={note}
          maxLength={280}
          placeholder="Allergies, how you'd like it cooked"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
    </Sheet>
  );
}
