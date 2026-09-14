import { useState } from "react";
import { Empty, Panel } from "@/components/common/Feedback";
import { PencilIcon } from "@/components/common/icons";
import { mealHours, money } from "@/utils/format";
import type { Item, Meal } from "@/types";
import { allDayItemIds, countServed, foldAllDay } from "../allDay";
import { errorMessage } from "@/services/apiClient";
import {
  useAddMealItemsMutation,
  useCreateMealMutation,
  useDeleteMealMutation,
  useRemoveMealItemMutation,
  useUpdateMealMutation,
  useSetItemAvailabilityMutation,
  type ItemTypeRow,
  type LibraryItem,
} from "../restaurantApi";

/**
 * When each item is served.
 *
 * A period holds no items of its own -- it lists items from the library, and
 * the same item can be on as many periods as it is sold in. So everything
 * here adds and removes listings; nothing here creates or destroys an item.
 * That distinction is the whole reason the builder is two tabs, and the
 * wording of every control on this screen keeps it: an item is "added" and
 * "removed", never "deleted".
 *
 * The headings inside a period are the server's, derived from the kinds of
 * the items served. There is nothing to name and nothing to create -- put a
 * drink on breakfast and Drinks appears.
 *
 * An item ticked for every period is served all day, and it is folded away
 * rather than printed under every heading of every period. Repeating the same
 * dozen staples down the whole tab buried the handful of rows that actually
 * differ between periods, which is the only thing this screen exists to show.
 * Folded, not dropped: each period says how many it is holding and opens them
 * in one click, because taking an all-day item off one period has to stay
 * possible from the screen that owns when things are served.
 */
export function MealPeriods({
  meals,
  items,
  types,
  onError,
}: {
  meals: Meal[];
  items: LibraryItem[];
  types: ItemTypeRow[];
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [createMeal] = useCreateMealMutation();

  // Ticked for every period there is. Tested against the periods on screen
  // rather than by counting meal_ids, so an id left over from a deleted
  // period cannot make an item look all-day when it is not.
  //
  // One period is not a schedule: everything on it would qualify, and folding
  // the entire tab away would leave a screen that shows nothing at all.
  const allDay = allDayItemIds(meals, items);

  return (
    <>
      <Panel title="Meal periods">
        <div className="flex gap-2">
          <input
            className="field"
            placeholder="Breakfast, Lunch, Late night…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn-primary shrink-0"
            onClick={async () => {
              if (!name.trim()) {
                onError("Enter a name for the meal period, like Breakfast.");
                return;
              }
              try {
                await createMeal({ name: name.trim(), sort_order: meals.length }).unwrap();
                setName("");
                onError(null);
              } catch (e) {
                onError(errorMessage(e));
              }
            }}
          >
            Add period
          </button>
        </div>
      </Panel>

      {!meals.length && (
        <Empty>
          No meal periods yet. Add one above, then choose which items it serves.
        </Empty>
      )}

      {meals.map((meal) => (
        <MealSection
          key={meal.id}
          meal={meal}
          items={items}
          types={types}
          allDay={allDay}
          onError={onError}
        />
      ))}
    </>
  );
}

function MealSection({
  meal,
  items,
  types,
  allDay,
  onError,
}: {
  meal: Meal;
  items: LibraryItem[];
  types: ItemTypeRow[];
  /** Item ids served on every period, folded away below. */
  allDay: Set<string>;
  onError: (message: string | null) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [picking, setPicking] = useState(false);
  const [showAllDay, setShowAllDay] = useState(false);

  // The library minus what this period already serves, which is what the
  // picker offers. Reading it from the library rather than from the menu
  // tree means an item on no period at all still shows up here.
  const available = items.filter((item) => !item.meal_ids.includes(meal.id));

  const { served, folded } = countServed(meal.sections, allDay);
  const shown = showAllDay ? meal.sections : foldAllDay(meal.sections, allDay);
  const hours = mealHours(meal.starts_at, meal.ends_at);

  return (
    <section className="mb-10 border border-hairline bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-4 py-3">
        {editingName ? (
          <MealEditor meal={meal} onDone={() => setEditingName(false)} onError={onError} />
        ) : (
          <>
            <span className="flex flex-wrap items-baseline gap-1.5">
              <h2 className="font-display text-xl">{meal.name}</h2>
              {/* Only where there is something to say. A period with no hours
                  set reads as the plain name it has always been. */}
              {hours && <span className="text-xs text-muted">{hours}</span>}
              <button
                type="button"
                aria-label={`Edit ${meal.name}`}
                className="text-muted hover:text-ink"
                onClick={() => {
                  onError(null);
                  setEditingName(true);
                }}
              >
                <PencilIcon />
              </button>
            </span>
            <button
              className="text-xs text-muted underline"
              onClick={() => {
                onError(null);
                setPicking((open) => !open);
              }}
            >
              {picking ? "cancel" : "add items"}
            </button>
          </>
        )}
      </header>

      {picking && (
        <ItemPicker
          meal={meal}
          available={available}
          types={types}
          onDone={() => setPicking(false)}
          onError={onError}
        />
      )}

      {folded > 0 && (
        <p className="border-b border-hairline bg-paper px-4 py-2.5 text-xs text-muted">
          {folded} {folded === 1 ? "item is" : "items are"} on every period, so{" "}
          {folded === 1 ? "it is" : "they are"} served all day.{" "}
          <button
            type="button"
            className="underline hover:text-ink"
            onClick={() => setShowAllDay((was) => !was)}
          >
            {showAllDay ? "fold them away" : `show ${folded === 1 ? "it" : "them"}`}
          </button>
        </p>
      )}

      {!served ? (
        <p className="px-4 py-6 text-sm text-muted">
          Nothing served in this period yet. Add items from the library, or
          write a new one on the Items tab and tick this period.
        </p>
      ) : !shown.length ? (
        <p className="px-4 py-6 text-sm text-muted">
          Everything {meal.name} serves is served all day. Nothing is on this
          period alone.
        </p>
      ) : (
        shown.map((section) => (
          <div
            key={section.item_type_id}
            className="border-b border-hairline last:border-0"
          >
            <h3 className="px-4 py-2.5 text-sm font-medium">{section.label}</h3>
            {section.items.length > 0 && (
              <ServedRows items={section.items} mealId={meal.id} onError={onError} />
            )}

            {/* Subcategories of this heading, each with a subheading of its
                own. Most menus send none and this loop does nothing. */}
            {section.groups.map((group) => (
              <div key={group.item_type_id}>
                <h4 className="border-t border-hairline px-4 py-2 pl-7 text-[13px] text-muted">
                  {group.label}
                </h4>
                <ServedRows items={group.items} mealId={meal.id} onError={onError} />
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

/** The period itself: its name, the hours it is served, and deleting it.
 *  What it serves is edited row by row, below. */
function MealEditor({
  meal,
  onDone,
  onError,
}: {
  meal: Meal;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState(meal.name);
  // "" is the empty time input, which is how the hours get cleared. The
  // server is sent nulls for that, never empty strings.
  const [starts, setStarts] = useState(meal.starts_at ?? "");
  const [ends, setEnds] = useState(meal.ends_at ?? "");
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updateMeal] = useUpdateMealMutation();
  const [deleteMeal] = useDeleteMealMutation();

  // Everything the period serves, subcategories included: what is filed on a
  // heading and what is filed in a group inside it are both items on this
  // period, and the sentence below counts what deleting it would let go of.
  const served = meal.sections.reduce(
    (n, s) => n + s.items.length + s.groups.reduce((k, g) => k + g.items.length, 0),
    0,
  );

  if (removing) {
    return (
      <div className="w-full">
        <p className="text-sm text-brick">
          {meal.name} will be deleted.{" "}
          {served
            ? `The ${served} ${served === 1 ? "item" : "items"} it serves are kept and stay on any other period serving them.`
            : "It serves nothing, so nothing else changes."}
        </p>
        <div className="mt-3 flex items-center gap-4">
          <button
            className="btn-primary px-3 py-1.5 text-sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await deleteMeal(meal.id).unwrap();
                onError(null);
                onDone();
              } catch (e) {
                onError(errorMessage(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            Delete period
          </button>
          <button className="text-xs underline" onClick={() => setRemoving(false)}>
            keep it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-3">
      <input
        className="field w-56 font-display text-xl"
        value={name}
        autoFocus
        disabled={saving}
        aria-label="Meal period name"
        onChange={(e) => setName(e.target.value)}
      />

      {/* Hours are optional and always a pair. They are for a customer to
          read: nothing here or on the server stops an order arriving outside
          them, because no restaurant carries a timezone to judge the clock
          against. */}
      <span className="flex items-center gap-2 text-xs text-muted">
        <label className="flex items-center gap-1.5">
          served
          <input
            type="time"
            className="field w-32 text-sm"
            value={starts}
            disabled={saving}
            aria-label="Served from"
            onChange={(e) => setStarts(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5">
          to
          <input
            type="time"
            className="field w-32 text-sm"
            value={ends}
            disabled={saving}
            aria-label="Served until"
            onChange={(e) => setEnds(e.target.value)}
          />
        </label>
        {starts && ends && ends <= starts && (
          <span className="text-ink">runs into the next day</span>
        )}
      </span>
      <button
        className="btn-primary px-3 py-1.5 text-sm"
        disabled={saving}
        onClick={async () => {
          const trimmed = name.trim();
          if (!trimmed) {
            onError("Enter a name for the meal period. It cannot be left blank.");
            return;
          }
          // The same pair rule the server keeps, answered here so a half-set
          // range is caught while both boxes are still on screen.
          if (!starts !== !ends) {
            onError(
              "Set both a start and an end time, or clear both to leave the " +
                "hours unsaid.",
            );
            return;
          }
          if (starts && starts === ends) {
            onError("The start and end times are the same. Set an end later than the start.");
            return;
          }

          const changes: {
            name?: string;
            starts_at?: string | null;
            ends_at?: string | null;
          } = {};
          if (trimmed !== meal.name) changes.name = trimmed;
          // Sent only when they actually changed, so an untouched period is
          // never rewritten and "" goes out as null rather than as a time.
          if (starts !== (meal.starts_at ?? "")) changes.starts_at = starts || null;
          if (ends !== (meal.ends_at ?? "")) changes.ends_at = ends || null;

          if (!Object.keys(changes).length) {
            onError(null);
            onDone();
            return;
          }

          setSaving(true);
          try {
            await updateMeal({ mealId: meal.id, changes }).unwrap();
            onError(null);
            onDone();
          } catch (e) {
            onError(errorMessage(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        Save
      </button>
      <button
        className="text-xs text-muted underline"
        disabled={saving}
        onClick={() => {
          onError(null);
          onDone();
        }}
      >
        cancel
      </button>
      <button
        className="ml-auto text-xs text-brick underline"
        disabled={saving}
        onClick={() => setRemoving(true)}
      >
        delete period
      </button>
    </div>
  );
}

/**
 * Pull items from the library onto this period.
 *
 * Ticked and added in one request rather than one per click: a manager
 * setting up dinner is choosing a dozen things at once, and a screen that
 * refetches between every tick loses the ones ticked while it was busy.
 */
function ItemPicker({
  meal,
  available,
  types,
  onDone,
  onError,
}: {
  meal: Meal;
  available: LibraryItem[];
  types: ItemTypeRow[];
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [addMealItems] = useAddMealItemsMutation();
  const typeName = new Map(types.map((t) => [t.id, t.name]));

  if (!available.length) {
    return (
      <p className="border-b border-hairline bg-paper px-4 py-4 text-xs text-muted">
        Every item in the library is already on {meal.name}. Write a new one on
        the Items tab.
      </p>
    );
  }

  return (
    <div className="border-b border-hairline bg-paper px-4 py-4">
      <p className="text-xs text-muted">
        Items not yet on {meal.name}. Adding one lists it here; it stays on
        every other period serving it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {available.map((item) => {
          const on = chosen.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              disabled={saving}
              onClick={() =>
                setChosen((prev) =>
                  on ? prev.filter((x) => x !== item.id) : [...prev, item.id],
                )
              }
              className={`rounded border px-2.5 py-1 text-xs ${
                on ? "border-ink bg-ink text-white" : "border-hairline bg-surface"
              }`}
            >
              {item.name}
              <span className="ml-1.5 opacity-60">
                {typeName.get(item.item_type_id) ?? ""}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-4">
        <button
          className="btn-primary px-3 py-1.5 text-sm"
          disabled={saving}
          onClick={async () => {
            if (!chosen.length) {
              onError(`Tick the items to add to ${meal.name} first.`);
              return;
            }
            setSaving(true);
            try {
              await addMealItems({ mealId: meal.id, item_ids: chosen }).unwrap();
              onError(null);
              onDone();
            } catch (e) {
              onError(errorMessage(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving
            ? "Adding…"
            : `Add ${chosen.length || ""} ${chosen.length === 1 ? "item" : "items"}`.trim()}
        </button>
        <button className="text-xs text-muted underline" disabled={saving} onClick={onDone}>
          cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The items served in one heading, or in one of its subcategories.
 *
 * The same row either way -- a burger under a Burgers subheading is the same
 * item as one filed straight on Food, with the same sold-out toggle and the
 * same way off the period. Only the heading above it differs, so only the
 * heading is written twice.
 */
function ServedRows({
  items,
  mealId,
  onError,
}: {
  items: Item[];
  mealId: string;
  onError: (message: string | null) => void;
}) {
  const [setAvailability] = useSetItemAvailabilityMutation();
  const [removeMealItem] = useRemoveMealItemMutation();

  return (
    <ul className="divide-y divide-hairline border-t border-hairline">
      {items.map((item) => (
        <li key={item.id} className="flex items-baseline gap-4 px-4 py-3">
          <div className="flex-1">
            <span className="text-sm">{item.name}</span>
            {item.modifier_groups.length > 0 && (
              <span className="ml-2 text-xs text-muted">
                {item.modifier_groups.map((g) => g.name).join(" · ")}
              </span>
            )}
          </div>
          <span className="tnum text-sm">
            {money(item.base_price_minor, item.currency)}
          </span>
          <button
            className={`text-xs underline ${
              item.is_available ? "text-muted" : "text-brick"
            }`}
            onClick={async () => {
              try {
                await setAvailability({
                  itemId: item.id,
                  is_available: !item.is_available,
                }).unwrap();
                onError(null);
              } catch (e) {
                onError(errorMessage(e));
              }
            }}
          >
            {item.is_available ? "in stock" : "sold out"}
          </button>
          {/* No confirmation, deliberately. This takes the item off
              one period and nothing else -- the item, its price and
              every other period keep going -- so the cost of a
              misclick is one click back. */}
          <button
            className="text-xs text-brick underline"
            onClick={async () => {
              try {
                await removeMealItem({ mealId, itemId: item.id }).unwrap();
                onError(null);
              } catch (e) {
                onError(errorMessage(e));
              }
            }}
          >
            remove
          </button>
        </li>
      ))}
    </ul>
  );
}
