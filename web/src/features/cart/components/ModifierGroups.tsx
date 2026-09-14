import { MenuImage } from "@/components/common/MenuImage";
import { signedMoney } from "@/utils/format";
import type { Item, Option } from "@/types";
import { isIncluded, type Selection } from "../modifiers";

/**
 * The modifier groups of one item, as a list of choices.
 *
 * Shared by the item sheet and the combo sheet so a group looks and behaves
 * the same whether the item is ordered alone or as part of a meal deal. A
 * combo does not relax the rules, and it should not read as though it might.
 *
 * `scope` disambiguates the radio inputs. Two slots of one combo can offer
 * the same item, and radios sharing a name would act as one group across
 * both, so choosing light ice for the drink would clear it for the other.
 */
export function ModifierGroups({
  item,
  currency,
  selected,
  scope,
  onToggle,
}: {
  item: Item;
  currency: string;
  selected: Selection;
  scope: string;
  onToggle: (group: Item["modifier_groups"][number], option: Option) => void;
}) {
  return (
    <>
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
                      name={`${scope}:${group.id}`}
                      checked={isChosen}
                      disabled={!option.is_available}
                      onChange={() => onToggle(group, option)}
                      className="h-4 w-4 accent-brick"
                    />
                    <MenuImage
                      src={option.image_url}
                      className="h-10 w-10 shrink-0 rounded bg-paper object-cover"
                    />
                    <span className="flex-1 text-sm">{option.name}</span>
                    {/* "Included" rather than a price, because on this item
                        there is no price. The same option on an item that
                        does not come with it still shows what it costs. */}
                    <span className="tnum text-sm text-muted">
                      {isIncluded(item, option.id)
                        ? "Included"
                        : signedMoney(option.price_delta_minor, currency)}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </>
  );
}
