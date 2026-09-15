import { useState } from "react";
import { Empty, Panel } from "@/components/common/Feedback";
import { PencilIcon } from "@/components/common/icons";
import { deltaToMinor, minorToDeltaInput, money } from "@/utils/format";
import type { DiscountKind, Meal } from "@/types";
import { rootIdOf, topLevel } from "../itemTypes";
import { errorMessage } from "@/services/apiClient";
import {
  useCreateComboMutation,
  useDeleteComboMutation,
  useUpdateComboMutation,
  type BuilderCombo,
  type ComboSlotDraft,
  type ItemTypeRow,
  type LibraryItem,
} from "../restaurantApi";

/**
 * Combos: one item from each of several types, sold together for less.
 *
 * A combo belongs to one meal period, and the choices it offers can only be
 * items that period serves. That is why the period is chosen first and the
 * item lists appear afterwards: there is nothing sensible to tick until the
 * builder has said when this deal is on sale.
 *
 * The types in a combo are not chosen separately. A type with items ticked
 * is a required choice; a type with none is not part of the deal. One step
 * instead of two, and no way to leave behind a type that asks for something
 * from an empty list.
 */
export function ComboBuilder({
  combos,
  meals,
  items,
  types,
  onError,
}: {
  combos: BuilderCombo[];
  meals: Meal[];
  items: LibraryItem[];
  types: ItemTypeRow[];
  onError: (message: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [createCombo] = useCreateComboMutation();

  const mealName = new Map(meals.map((m) => [m.id, m.name]));
  const typeName = new Map(types.map((t) => [t.id, t.name]));

  return (
    <>
      <Panel
        title="Combos"
        action={
          <button
            className="text-xs text-muted underline"
            onClick={() => {
              onError(null);
              setAdding((open) => !open);
            }}
          >
            {adding ? "cancel" : "add a combo"}
          </button>
        }
      >
        {adding ? (
          <ComboForm
            meals={meals}
            items={items}
            types={types}
            submitLabel="Create combo"
            onCancel={() => setAdding(false)}
            onSubmit={async (draft) => {
              await createCombo(draft).unwrap();
              setAdding(false);
            }}
            onError={onError}
          />
        ) : !meals.length ? (
          <p className="text-xs text-muted">
            A combo is sold during one meal period and offers items that period
            serves. Add a meal period first, and put some items on it.
          </p>
        ) : (
          <p className="text-xs text-muted">
            One item from each type you include, every one required. The saving
            comes off what those items cost separately.
          </p>
        )}
      </Panel>

      {!combos.length && !adding && meals.length > 0 && (
        <Empty>No combos yet. Add one above.</Empty>
      )}

      {combos.map((combo) =>
        editing === combo.id ? (
          <ComboEditor
            key={combo.id}
            combo={combo}
            meals={meals}
            items={items}
            types={types}
            onDone={() => setEditing(null)}
            onError={onError}
          />
        ) : (
          <section key={combo.id} className="mb-6 border border-hairline bg-surface">
            <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-4 py-3">
              <span className="flex items-baseline gap-1.5">
                <h3 className="font-display text-lg">{combo.name}</h3>
                <button
                  type="button"
                  aria-label={`Edit ${combo.name}`}
                  className="text-muted hover:text-ink"
                  onClick={() => {
                    onError(null);
                    setEditing(combo.id);
                  }}
                >
                  <PencilIcon />
                </button>
              </span>
              <span className="text-xs text-muted">
                {mealName.get(combo.meal_id) ?? "no meal period"} ·{" "}
                <span className="text-brick">{savingWords(combo)}</span>
                {!combo.is_available && <span className="text-brick"> · hidden</span>}
              </span>
            </header>

            {!combo.slots.length ? (
              <p className="px-4 py-4 text-xs text-muted">
                Nothing in this combo yet. Open it and tick the items it includes.
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {combo.slots.map((slot) => (
                  <li key={slot.id} className="flex items-baseline gap-3 px-4 py-2.5">
                    <span className="w-20 shrink-0 text-xs text-muted">
                      {typeName.get(slot.item_type_id) ?? "unknown type"}
                    </span>
                    <span className="text-sm">
                      {slot.item_ids.map((id, index) => {
                        const item = items.find((i) => i.id === id);
                        // Still ticked, but taken off this combo's period since:
                        // the storefront and checkout skip it until it is served
                        // there again, so the list says why it is missing.
                        const offPeriod = item && !item.meal_ids.includes(combo.meal_id);
                        return (
                          <span key={id}>
                            {index > 0 && " · "}
                            <span className={offPeriod ? "text-muted line-through" : undefined}>
                              {item?.name ?? "?"}
                            </span>
                            {offPeriod && (
                              <span className="text-xs text-brick">
                                {" "}
                                (not on {mealName.get(combo.meal_id) ?? "this period"})
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ),
      )}
    </>
  );
}

function ComboEditor({
  combo,
  meals,
  items,
  types,
  onDone,
  onError,
}: {
  combo: BuilderCombo;
  meals: Meal[];
  items: LibraryItem[];
  types: ItemTypeRow[];
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [updateCombo] = useUpdateComboMutation();
  const [deleteCombo] = useDeleteComboMutation();

  if (removing) {
    return (
      <section className="mb-6 border border-ink bg-paper px-4 py-4">
        <p className="text-sm text-brick">
          {combo.name} comes off the menu. The items it offered are untouched
          and stay on sale on their own.
        </p>
        <div className="mt-3 flex items-center gap-4">
          <button
            className="btn-primary px-3 py-1.5 text-sm"
            onClick={async () => {
              try {
                await deleteCombo(combo.id).unwrap();
                onError(null);
                onDone();
              } catch (e) {
                onError(errorMessage(e));
              }
            }}
          >
            Delete it
          </button>
          <button className="text-xs underline" onClick={() => setRemoving(false)}>
            keep it
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6 border border-ink bg-surface">
      <ComboForm
        initial={combo}
        meals={meals}
        items={items}
        types={types}
        submitLabel="Save changes"
        onCancel={onDone}
        onDelete={() => setRemoving(true)}
        onSubmit={async (draft) => {
          const { meal_id: _meal, ...changes } = draft;
          await updateCombo({ comboId: combo.id, changes }).unwrap();
          onDone();
        }}
        onError={onError}
      />
    </section>
  );
}

type Draft = {
  mealId: string;
  name: string;
  description: string;
  discountKind: DiscountKind;
  /** Typed as the manager thinks of it: "10" for ten percent, "1.50" for a
   *  pound fifty. Converted once, on save. */
  discountInput: string;
  /** Ticked items, keyed by item type id. A type with none is not part of
   *  the combo. */
  picked: Record<string, string[]>;
};

function seed(combo: BuilderCombo | undefined, meals: Meal[]): Draft {
  const picked: Record<string, string[]> = {};
  for (const slot of combo?.slots ?? []) picked[slot.item_type_id] = [...slot.item_ids];

  return {
    mealId: combo?.meal_id ?? meals[0]?.id ?? "",
    name: combo?.name ?? "",
    description: combo?.description ?? "",
    discountKind: combo?.discount_kind ?? "PERCENT",
    discountInput: !combo || combo.discount_kind === "NONE"
      ? ""
      : combo.discount_kind === "PERCENT"
        ? String(combo.discount_value / 100)
        : minorToDeltaInput(combo.discount_value),
    picked,
  };
}

/**
 * The combo form, used to add and to edit.
 *
 * The meal period is fixed once a combo exists. Every choice in it is an item
 * that period serves, so moving the combo would invalidate all of them at
 * once -- that is a new combo, and building it as one is clearer than a rule
 * about which choices survive.
 */
function ComboForm({
  initial,
  meals,
  items,
  types,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
  onError,
}: {
  initial?: BuilderCombo;
  meals: Meal[];
  items: LibraryItem[];
  types: ItemTypeRow[];
  submitLabel: string;
  onSubmit: (draft: {
    meal_id: string;
    name: string;
    description: string | null;
    discount_kind: DiscountKind;
    discount_value: number;
    slots: ComboSlotDraft[];
  }) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => seed(initial, meals));
  const [saving, setSaving] = useState(false);

  // Only what this period serves. An item taken off the period is no longer
  // offerable in a combo on it, and the server refuses one that is.
  const servedHere = items.filter((item) => item.meal_ids.includes(draft.mealId));

  // A slot asks for a heading, and everything inside it can fill the slot.
  // That is what lets one meal deal offer burgers or nuggets where two
  // top-level types would have forced it into two deals.
  const byType = (typeId: string) =>
    servedHere.filter((item) => rootIdOf(types, item.item_type_id) === typeId);

  // Combos are built from headings only. A slot asking for a subcategory
  // would narrow the deal every time the menu was subdivided further.
  const headings = topLevel(types);

  function togglePick(typeId: string, itemId: string) {
    setDraft((d) => {
      const current = d.picked[typeId] ?? [];
      const next = current.includes(itemId)
        ? current.filter((x) => x !== itemId)
        : [...current, itemId];
      return { ...d, picked: { ...d.picked, [typeId]: next } };
    });
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      onError("Enter a name for the combo, like Burger Meal.");
      return;
    }
    if (!draft.mealId) {
      onError("Choose the meal period this combo is sold during.");
      return;
    }

    // In the restaurant's own type order, so the slots a customer works
    // through read the same way down the page as the menu does.
    const slots: ComboSlotDraft[] = headings
      .filter((t) => (draft.picked[t.id] ?? []).length > 0)
      .map((t) => ({
        item_type_id: t.id,
        // Only choices this period still serves. A tick left over from before
        // an item was taken off the period is not on screen to untick, and the
        // server refuses it, so it is dropped here rather than failing a save
        // over something the manager cannot see.
        item_ids: (draft.picked[t.id] ?? []).filter((id) =>
          servedHere.some((item) => item.id === id),
        ),
      }))
      .filter((slot) => slot.item_ids.length > 0);

    if (!slots.length) {
      onError("Tick the items this combo includes. Each type ticked becomes a choice.");
      return;
    }
    if (slots.length < 2) {
      // Not a rule the server enforces, because one is a coherent thing to
      // store. It is almost always a half-finished combo, though, and saying
      // so costs nothing.
      onError("A combo needs at least two types. One item on its own is just an item.");
      return;
    }

    let discountValue = 0;
    if (draft.discountKind !== "NONE") {
      const typed = draft.discountInput.trim();
      if (!typed) {
        onError(
          draft.discountKind === "PERCENT"
            ? "Enter the discount as a percentage, like 10."
            : "Enter the discount as an amount, like 1.50.",
        );
        return;
      }
      if (draft.discountKind === "PERCENT") {
        const percent = Number(typed);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
          onError("Enter the discount as a percentage between 0 and 100.");
          return;
        }
        // Basis points, so 12.5% is 1250 and nothing is lost to a float.
        discountValue = Math.round(percent * 100);
      } else {
        const minor = deltaToMinor(typed);
        if (minor === null || minor < 0) {
          onError("Enter the discount as a plain amount, like 1.50.");
          return;
        }
        discountValue = minor;
      }
    }

    setSaving(true);
    try {
      await onSubmit({
        meal_id: draft.mealId,
        name,
        description: draft.description.trim() || null,
        discount_kind: draft.discountKind,
        discount_value: discountValue,
        slots,
      });
      onError(null);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 bg-paper px-4 py-4 sm:grid-cols-4">
      <label className="sm:col-span-2">
        <span className="text-xs text-muted">Combo name</span>
        <input
          className="field mt-1"
          placeholder="Burger Meal"
          value={draft.name}
          autoFocus
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </label>

      <label className="sm:col-span-2">
        <span className="text-xs text-muted">Sold during</span>
        <select
          className="field mt-1"
          value={draft.mealId}
          // Fixed after creation: every ticked item belongs to this period.
          disabled={saving || !!initial}
          onChange={(e) =>
            // The old ticks belong to the old period's menu, so they go.
            setDraft((d) => ({ ...d, mealId: e.target.value, picked: {} }))
          }
        >
          {!meals.length && <option value="">No meal periods yet</option>}
          {meals.map((meal) => (
            <option key={meal.id} value={meal.id}>
              {meal.name}
            </option>
          ))}
        </select>
      </label>

      <label className="sm:col-span-4">
        <span className="text-xs text-muted">Description</span>
        <input
          className="field mt-1"
          value={draft.description}
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
      </label>

      <label className="sm:col-span-2">
        <span className="text-xs text-muted">Discount</span>
        <select
          className="field mt-1"
          value={draft.discountKind}
          disabled={saving}
          onChange={(e) =>
            setDraft((d) => ({ ...d, discountKind: e.target.value as DiscountKind }))
          }
        >
          <option value="PERCENT">Percentage off</option>
          <option value="AMOUNT">Amount off</option>
          <option value="NONE">No discount</option>
        </select>
      </label>

      {draft.discountKind !== "NONE" && (
        <label className="sm:col-span-2">
          <span className="text-xs text-muted">
            {draft.discountKind === "PERCENT" ? "Percent off the total" : "Amount off the total"}
          </span>
          <input
            className="field tnum mt-1"
            inputMode="decimal"
            placeholder={draft.discountKind === "PERCENT" ? "10" : "1.50"}
            value={draft.discountInput}
            disabled={saving}
            onChange={(e) => setDraft((d) => ({ ...d, discountInput: e.target.value }))}
          />
        </label>
      )}

      <div className="sm:col-span-4">
        <p className="text-xs text-muted">
          What this combo includes. Tick the items a customer may choose from.
          Every type you tick becomes one required choice.
        </p>

        {!draft.mealId ? (
          <p className="mt-2 text-xs text-muted">Choose a meal period first.</p>
        ) : !servedHere.length ? (
          <p className="mt-2 text-xs text-muted">
            That meal period serves nothing yet. Put items on it first, on the
            Meal periods tab.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {headings.map((type) => {
              const available = byType(type.id);
              if (!available.length) return null;
              const picked = draft.picked[type.id] ?? [];
              return (
                <div key={type.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="w-20 shrink-0 text-xs text-muted">
                    {type.name}
                    {picked.length > 0 && <span className="text-brick"> ·</span>}
                  </span>
                  {available.map((item) => {
                    const on = picked.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={on}
                        disabled={saving}
                        onClick={() => togglePick(type.id, item.id)}
                        className={`rounded border px-2.5 py-1 text-xs ${
                          on ? "border-ink bg-ink text-white" : "border-hairline bg-surface"
                        }`}
                      >
                        {item.name}
                        <span className="ml-1.5 opacity-60">
                          {money(item.base_price_minor, item.currency)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 sm:col-span-4">
        <button className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : submitLabel}
        </button>
        <button className="text-xs text-muted underline" disabled={saving} onClick={onCancel}>
          cancel
        </button>
        {onDelete && (
          <button
            className="ml-auto text-xs text-brick underline"
            disabled={saving}
            onClick={onDelete}
          >
            delete combo
          </button>
        )}
      </div>
    </div>
  );
}

/** How the saving reads in the list. */
function savingWords(combo: BuilderCombo): string {
  if (combo.discount_kind === "PERCENT" && combo.discount_value > 0) {
    return `${Number((combo.discount_value / 100).toFixed(2))}% off`;
  }
  if (combo.discount_kind === "AMOUNT" && combo.discount_value > 0) {
    return `${money(combo.discount_value)} off`;
  }
  return "no discount";
}
