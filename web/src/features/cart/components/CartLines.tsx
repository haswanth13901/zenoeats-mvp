import { useAppDispatch } from "@/app/hooks";
import { QuantityStepper } from "@/components/common/Sheet";
import { money } from "@/utils/format";
import type { CartComboLine, CartLine } from "@/types";
import { comboQuantitySet, lineQuantitySet } from "../cartSlice";

/**
 * The cart, itemised and editable.
 *
 * One definition, drawn by the cart page and by checkout's own list: a
 * customer who changes a quantity in one place and finds a different row in
 * the other is looking at two carts, and only one of them is real.
 *
 * Combos come first, each as a single row. A meal deal listed as its three
 * items would read as three orders, and would let a customer take the drink
 * out of a deal that requires one.
 */
export function CartLines({
  lines,
  combos,
  currency,
}: {
  lines: CartLine[];
  combos: CartComboLine[];
  currency: string;
}) {
  const dispatch = useAppDispatch();
  return (
    <ul>
      {combos.map((line) => (
        <li key={line.key} className="border-b border-hairline py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-semibold">{line.name}</p>
              <ul className="mt-[7px] text-[13px] text-muted">
                {line.selections.map((sel) => (
                  <li key={sel.slot_id}>
                    {sel.slotLabel}: {sel.itemName}
                    {sel.modifiers.length > 0 && (
                      <span> · {sel.modifiers.map((m) => m.label).join(" · ")}</span>
                    )}
                  </li>
                ))}
              </ul>
              {line.note && <p className="mt-[7px] text-[13px] italic text-muted">{line.note}</p>}
            </div>
            <span className="tnum whitespace-nowrap text-[15px]">
              {money(line.unitPreviewMinor * line.quantity, currency)}
            </span>
          </div>
          {/* Minus at one removes the line: there is no separate remove
              button, and no upper limit here. */}
          <div className="mt-3">
            <QuantityStepper
              value={line.quantity}
              min={0}
              label={line.name}
              onChange={(quantity) => dispatch(comboQuantitySet({ key: line.key, quantity }))}
            />
          </div>
        </li>
      ))}

      {lines.map((line) => (
        <li key={line.key} className="border-b border-hairline py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-semibold">{line.name}</p>
              {line.modifiers.length > 0 && (
                <p className="mt-[7px] text-[13px] text-muted">
                  {line.modifiers.map((m) => m.label).join(" · ")}
                </p>
              )}
              {line.note && <p className="mt-[7px] text-[13px] italic text-muted">{line.note}</p>}
            </div>
            <span className="tnum whitespace-nowrap text-[15px]">
              {money(line.unitPreviewMinor * line.quantity, currency)}
            </span>
          </div>
          <div className="mt-3">
            <QuantityStepper
              value={line.quantity}
              min={0}
              label={line.name}
              onChange={(quantity) => dispatch(lineQuantitySet({ key: line.key, quantity }))}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
