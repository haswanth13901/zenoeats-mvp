import { useEffect, useState, type ReactNode } from "react";
import { Empty, Panel } from "@/components/common/Feedback";
import { PencilIcon } from "@/components/common/icons";
import { minorToInput, money, priceToMinor, signedMoney } from "@/utils/format";
import type { Meal } from "@/types";
import { errorMessage } from "@/services/apiClient";
import { ItemTypeManager } from "./ItemTypeManager";
import { ImagePicker, NO_IMAGE, useUploadsInFlight, type ImageDraft } from "./ImagePicker";
import { rootIdOf, typeLabel } from "../itemTypes";
import {
  useCreateItemMutation,
  useDeleteItemMutation,
  useSetItemAvailabilityMutation,
  useUpdateItemMutation,
  type ItemTypeRow,
  type LibraryItem,
  type ModifierGroupSummary,
} from "../restaurantApi";

/**
 * Everything the restaurant sells, in one list.
 *
 * This is the half of the menu builder that answers "what do we make", and
 * the meal periods tab answers "when do we serve it". They used to be the
 * same screen, which forced an item to be typed once per period it appeared
 * in -- two coffees, two prices to keep in step, two sold-out toggles.
 *
 * Two modes, not a pencil per row. Reading, the list is the menu as it
 * stands, with the type chips above filtering it. Editing, one control opens
 * every row at once: a price rise across a menu is one pass and one save,
 * where a pencil per item is one trip through a form per item.
 */
export function ItemLibrary({
  items,
  meals,
  types,
  groups,
  onError,
}: {
  items: LibraryItem[];
  meals: Meal[];
  types: ItemTypeRow[];
  groups: ModifierGroupSummary[];
  onError: (message: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  // Which type the list is showing, or null for all of them. Not persisted:
  // a filter is where you are looking right now, not a setting, and coming
  // back to a list that is quietly hiding most of itself is a trap.
  const [filter, setFilter] = useState<string | null>(null);
  const [createItem] = useCreateItemMutation();
  const [setAvailability] = useSetItemAvailabilityMutation();

  const mealName = new Map(meals.map((m) => [m.id, m.name]));
  const typeName = new Map(types.map((t) => [t.id, t.name]));

  // Filtering by a heading includes its subcategories. "Show me the food" is
  // what clicking Food means, and a burger filed under Food > Burgers is
  // food. A subcategory chip shows only its own, which is all it holds.
  const shown = filter
    ? items.filter((i) => i.item_type_id === filter || rootIdOf(types, i.item_type_id) === filter)
    : items;
  const filterName = filter ? typeName.get(filter) : null;

  return (
    <>
      <ItemTypeManager
        types={types}
        filter={filter}
        onFilter={setFilter}
        onError={onError}
      />

      <Panel
        title={
          <span className="flex items-center gap-1.5">
            Items
            {items.length > 0 && !adding && (
              <button
                type="button"
                aria-label={editing ? "Stop editing items" : "Edit every item"}
                title={editing ? "Stop editing" : "Edit every item at once"}
                className="text-muted hover:text-ink"
                onClick={() => {
                  onError(null);
                  setEditing((open) => !open);
                }}
              >
                <PencilIcon />
              </button>
            )}
          </span>
        }
        action={
          !editing && (
            <button
              className="text-xs text-muted underline"
              onClick={() => {
                onError(null);
                setAdding((open) => !open);
              }}
            >
              {adding ? "cancel" : "add an item"}
            </button>
          )
        }
      >
        {adding ? (
          <ItemForm
            meals={meals}
            types={types}
            groups={groups}
            submitLabel="Add item"
            onCancel={() => setAdding(false)}
            onSubmit={async (draft) => {
              await createItem(draft).unwrap();
              setAdding(false);
            }}
            onError={onError}
          />
        ) : (
          <p className="text-xs text-muted">
            An item written here can be served in any number of meal periods.
            One price, one sold-out toggle, wherever it appears.
          </p>
        )}
      </Panel>

      {!items.length && !adding && (
        <Empty>No items yet. Add one above, then put it on a meal period.</Empty>
      )}

      {/* Told apart from an empty library, because the answer is different:
          one needs an item written, the other needs the filter cleared. */}
      {items.length > 0 && !shown.length && (
        <Empty>
          Nothing typed as {filterName ?? "that"} yet.{" "}
          <button className="underline" onClick={() => setFilter(null)}>
            Show every item
          </button>
        </Empty>
      )}

      {editing && shown.length > 0 ? (
        <ItemsEditor
          items={shown}
          meals={meals}
          types={types}
          groups={groups}
          onDone={() => setEditing(false)}
          onError={onError}
        />
      ) : (
        shown.length > 0 && (
          <div className="border border-hairline bg-surface">
            {shown.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline px-4 py-3 last:border-0"
              >
                {item.image_url && (
                  <img
                    src={item.image_url}
                    alt=""
                    loading="lazy"
                    className="h-8 w-8 shrink-0 self-center rounded object-cover"
                  />
                )}
                <span className="text-sm">{item.name}</span>
                {/* Named with its heading when it has one: "Burgers" alone
                    is ambiguous in a list covering the whole menu. */}
                <span className="rounded bg-paper px-1.5 py-0.5 text-[11px] text-muted">
                  {typeLabel(types, item.item_type_id)}
                </span>
                <span className="flex-1 text-xs text-muted">
                  {item.meal_ids.length
                    ? item.meal_ids.map((id) => mealName.get(id) ?? "?").join(" · ")
                    : "not on any meal period"}
                </span>
                <span className="tnum text-sm">
                  {money(item.base_price_minor, item.currency)}
                </span>
                {/* The kitchen's toggle, not the builder's. It is used all
                    shift by staff who never edit a price and it undoes itself
                    in one click, so it stays out of the edit mode. */}
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
              </div>
            ))}
          </div>
        )
      )}
    </>
  );
}

/** Every editable field of one item, as it sits in the form. */
type RowDraft = {
  name: string;
  typeId: string;
  price: string;
  description: string;
  mealIds: string[];
  groupIds: string[];
  includedIds: string[];
  image: ImageDraft;
};

function rowOf(item: LibraryItem): RowDraft {
  return {
    name: item.name,
    typeId: item.item_type_id,
    price: minorToInput(item.base_price_minor),
    description: item.description ?? "",
    mealIds: [...item.meal_ids],
    groupIds: item.modifier_groups.map((g) => g.id),
    includedIds: [...item.included_option_ids],
    image: { path: item.image_path, url: item.image_url },
  };
}

/**
 * The whole list as a form: every item's name, type and price at once, with
 * its periods and modifier groups a click away.
 *
 * Two rules, split by direction rather than by kind of change, the same pair
 * the rest of this builder keeps:
 *
 * Removing is staged. A row marked for removal is struck through and can be
 * put back, and nothing is deleted until Save. That is what makes cancel mean
 * cancel, and it lets a handful of retired items go in one pass instead of
 * one confirmation each.
 *
 * Adding is not here at all. A new item needs fields this row does not show,
 * and it belongs in the form above where it cannot be mistaken for an edit.
 *
 * Only what actually changed is sent. The server takes partial updates, so an
 * untouched row costs no request, and a price edit does not restate an item's
 * meal periods.
 */
function ItemsEditor({
  items,
  meals,
  types,
  groups,
  onDone,
  onError,
}: {
  items: LibraryItem[];
  meals: Meal[];
  types: ItemTypeRow[];
  groups: ModifierGroupSummary[];
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState<Record<string, RowDraft>>(() =>
    Object.fromEntries(items.map((i) => [i.id, rowOf(i)])),
  );
  const [removed, setRemoved] = useState<Record<string, true>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, trackUpload] = useUploadsInFlight();
  const [updateItem] = useUpdateItemMutation();
  const [deleteItem] = useDeleteItemMutation();

  // An item created in the form above arrives through a refetch while this is
  // open. Take only rows the draft has never seen, so edits in progress live.
  useEffect(() => {
    setDraft((d) => {
      let changed = false;
      const next = { ...d };
      for (const item of items) {
        if (!(item.id in next)) {
          next[item.id] = rowOf(item);
          changed = true;
        }
      }
      return changed ? next : d;
    });
  }, [items]);

  function setRow(id: string, patch: Partial<RowDraft>) {
    setDraft((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));
  }

  function toggleIn(
    id: string,
    field: "mealIds" | "groupIds" | "includedIds",
    value: string,
  ) {
    setDraft((d) => {
      const row = d[id]!;
      const current = row[field];
      return {
        ...d,
        [id]: {
          ...row,
          [field]: current.includes(value)
            ? current.filter((x) => x !== value)
            : [...current, value],
        },
      };
    });
  }

  /** Dropping a group drops what it included. The server refuses an
   *  inclusion from a group the item does not offer, so a form that let the
   *  two disagree would only fail on save. */
  function toggleGroup(id: string, group: ModifierGroupSummary) {
    setDraft((d) => {
      const row = d[id]!;
      const on = row.groupIds.includes(group.id);
      const optionIds = group.options.map((o) => o.id);
      return {
        ...d,
        [id]: {
          ...row,
          groupIds: on
            ? row.groupIds.filter((x) => x !== group.id)
            : [...row.groupIds, group.id],
          includedIds: on
            ? row.includedIds.filter((x) => !optionIds.includes(x))
            : row.includedIds,
        },
      };
    });
  }

  const doomed = items.filter((i) => removed[i.id]);

  async function save() {
    const jobs: (() => Promise<unknown>)[] = [];

    for (const item of items) {
      if (removed[item.id]) {
        jobs.push(() => deleteItem(item.id).unwrap());
        continue; // editing something on its way out is wasted work
      }

      const row = draft[item.id];
      if (!row) continue;

      const changes: Record<string, unknown> = {};

      const name = row.name.trim();
      if (!name) {
        onError(`${item.name} needs a name. It cannot be left blank.`);
        return;
      }
      if (name !== item.name) changes.name = name;

      if (!row.price.trim()) {
        onError(`Enter a price for ${item.name}. Use 0 if it is free.`);
        return;
      }
      const minor = priceToMinor(row.price);
      if (minor === null) {
        onError(`Enter the price for ${item.name} as a plain amount, like 10.95.`);
        return;
      }
      if (minor !== item.base_price_minor) changes.base_price_minor = minor;

      if (row.typeId !== item.item_type_id) changes.item_type_id = row.typeId;

      const description = row.description.trim() || null;
      if (description !== (item.description ?? null)) changes.description = description;

      // Compared as sorted text: ticking a period off and back on rebuilds
      // the array with the same contents and must not read as an edit.
      if ([...row.mealIds].sort().join() !== [...item.meal_ids].sort().join()) {
        changes.meal_ids = row.mealIds;
      }
      const wasGroups = item.modifier_groups.map((g) => g.id);
      if ([...row.groupIds].sort().join() !== [...wasGroups].sort().join()) {
        changes.modifier_group_ids = row.groupIds;
      }
      if (
        [...row.includedIds].sort().join() !==
        [...item.included_option_ids].sort().join()
      ) {
        changes.included_option_ids = row.includedIds;
      }

      // Sent only when it changed. The server reads a null image_path as
      // "take the photo off", so an unchanged row must leave the key out.
      if (row.image.path !== item.image_path) changes.image_path = row.image.path;

      if (Object.keys(changes).length) {
        jobs.push(() => updateItem({ itemId: item.id, changes }).unwrap());
      }
    }

    if (!jobs.length) {
      onError(null);
      onDone();
      return;
    }

    setSaving(true);
    try {
      await Promise.all(jobs.map((run) => run()));
      onError(null);
      onDone();
    } catch (e) {
      // Stays open holding the edits, so a rejected change can be corrected
      // rather than retyped.
      onError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-ink bg-surface">
      {items.map((item) => {
        const row = draft[item.id];
        const going = !!removed[item.id];
        const open = expanded === item.id;
        if (!row) return null;

        // Groups offered for the type this row is set to, plus the ones
        // offered for every type. Re-filters live if the type is corrected.
        //
        // Matched on the heading, because groups are named against headings:
        // a burger filed under Food > Burgers is offered whatever Food is.
        const relevant = groups.filter(
          (g) =>
            !g.applies_to_type_ids.length ||
            g.applies_to_type_ids.includes(rootIdOf(types, row.typeId)),
        );

        return (
          <div key={item.id} className="border-b border-hairline last:border-0">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              {going ? (
                <span className="flex-1 text-sm text-muted line-through">{item.name}</span>
              ) : (
                <>
                  <ImagePicker
                    kind="items"
                    size="sm"
                    image={row.image}
                    label={item.name}
                    disabled={saving}
                    onChange={(image) => setRow(item.id, { image })}
                    onError={onError}
                    onBusyChange={trackUpload}
                  />
                  <input
                    className="field min-w-[10rem] flex-1 text-sm"
                    value={row.name}
                    disabled={saving}
                    aria-label={`${item.name} name`}
                    onChange={(e) => setRow(item.id, { name: e.target.value })}
                  />
                  <select
                    className="field w-32 text-sm"
                    value={row.typeId}
                    disabled={saving}
                    aria-label={`${item.name} type`}
                    onChange={(e) => setRow(item.id, { typeId: e.target.value })}
                  >
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {typeLabel(types, t.id)}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field tnum w-24 text-sm"
                    inputMode="decimal"
                    value={row.price}
                    disabled={saving}
                    aria-label={`${item.name} price`}
                    onChange={(e) => setRow(item.id, { price: e.target.value })}
                  />
                  <button
                    className="text-xs text-muted underline"
                    disabled={saving}
                    onClick={() => setExpanded(open ? null : item.id)}
                  >
                    {open ? "less" : "periods & options"}
                  </button>
                </>
              )}
              <button
                className={`text-xs underline ${going ? "" : "text-brick"}`}
                disabled={saving}
                onClick={() =>
                  setRemoved((r) => {
                    const next = { ...r };
                    if (next[item.id]) delete next[item.id];
                    else next[item.id] = true;
                    return next;
                  })
                }
              >
                {going ? "keep it" : "delete"}
              </button>
            </div>

            {/* Behind a disclosure rather than always on: a row of chips per
                item would bury the names and prices, which are what a menu
                edit is usually about. */}
            {open && !going && (
              <div className="grid gap-3 bg-paper px-4 py-3">
                <label>
                  <span className="text-xs text-muted">Description</span>
                  <input
                    className="field mt-1 text-sm"
                    value={row.description}
                    disabled={saving}
                    onChange={(e) => setRow(item.id, { description: e.target.value })}
                  />
                </label>

                <div>
                  <p className="text-xs text-muted">Served during</p>
                  {!meals.length ? (
                    <p className="mt-1 text-xs text-muted">No meal periods yet.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {meals.map((meal) => (
                        <Chip
                          key={meal.id}
                          on={row.mealIds.includes(meal.id)}
                          disabled={saving}
                          onClick={() => toggleIn(item.id, "mealIds", meal.id)}
                        >
                          {meal.name}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs text-muted">Modifier groups</p>
                  <GroupsAndInclusions
                    groups={relevant}
                    groupIds={row.groupIds}
                    includedIds={row.includedIds}
                    disabled={saving}
                    emptyNote="No groups for this type yet."
                    onToggleGroup={(groupId) => {
                      const group = relevant.find((g) => g.id === groupId);
                      if (group) toggleGroup(item.id, group);
                    }}
                    onToggleIncluded={(optionId) =>
                      toggleIn(item.id, "includedIds", optionId)
                    }
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-4 border-t border-hairline px-4 py-3">
        <button
          className="btn-primary"
          disabled={saving || uploading > 0}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : uploading > 0 ? "Uploading photo…" : "Save changes"}
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
        <p className="text-xs text-muted">
          {doomed.length ? (
            <span className="text-brick">
              Saving will delete {doomed.length}{" "}
              {doomed.length === 1 ? "item" : "items"} from every meal period.
              Cancel and nothing is removed.
            </span>
          ) : (
            "A new price applies to new orders only."
          )}
        </p>
      </div>
    </div>
  );
}

type Draft = {
  name: string;
  typeId: string;
  price: string;
  description: string;
  mealIds: string[];
  groupIds: string[];
  includedIds: string[];
  image: ImageDraft;
};

function seed(types: ItemTypeRow[]): Draft {
  return {
    name: "",
    // The first type is the default because it is the top of the menu, which
    // is where most restaurants put what they mostly sell.
    typeId: types[0]?.id ?? "",
    price: "",
    description: "",
    mealIds: [],
    groupIds: [],
    includedIds: [],
    image: NO_IMAGE,
  };
}

/**
 * The form for a new item.
 *
 * Editing happens in the list itself, so this one only ever adds. The period
 * checkboxes are here rather than only on the other tab because the moment
 * you have finished describing a new item is the moment you know where it
 * goes.
 */
function ItemForm({
  meals,
  types,
  groups,
  submitLabel,
  onSubmit,
  onCancel,
  onError,
}: {
  meals: Meal[];
  types: ItemTypeRow[];
  groups: ModifierGroupSummary[];
  submitLabel: string;
  onSubmit: (draft: {
    name: string;
    item_type_id: string;
    description: string | null;
    base_price_minor: number;
    meal_ids: string[];
    modifier_group_ids: string[];
    included_option_ids: string[];
    image_path: string | null;
  }) => Promise<void>;
  onCancel: () => void;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => seed(types));
  const [saving, setSaving] = useState(false);
  const [uploading, trackUpload] = useUploadsInFlight();

  const chosenType = draft.typeId ? typeLabel(types, draft.typeId) : "this type";

  // Groups offered for this type, plus the ones offered for every type.
  // Choosing a drink surfaces Ice level rather than Veggies, and re-filters
  // live if the type is corrected. A group listing several types -- Size, on
  // drinks and sides -- shows up under each of them.
  // Matched on the heading: a group is named against Food, and a burger
  // filed under Food > Burgers is offered exactly what a food is offered.
  const relevant = groups.filter(
    (g) =>
      !g.applies_to_type_ids.length ||
      g.applies_to_type_ids.includes(rootIdOf(types, draft.typeId)),
  );

  function toggle(field: "mealIds" | "groupIds" | "includedIds", id: string) {
    setDraft((d) => ({
      ...d,
      [field]: d[field].includes(id)
        ? d[field].filter((x) => x !== id)
        : [...d[field], id],
    }));
  }

  /** Dropping a group drops what it included, as in the editor. */
  function toggleGroup(group: ModifierGroupSummary) {
    setDraft((d) => {
      const on = d.groupIds.includes(group.id);
      const optionIds = group.options.map((o) => o.id);
      return {
        ...d,
        groupIds: on
          ? d.groupIds.filter((x) => x !== group.id)
          : [...d.groupIds, group.id],
        includedIds: on
          ? d.includedIds.filter((x) => !optionIds.includes(x))
          : d.includedIds,
      };
    });
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      onError("Enter a name for the item.");
      return;
    }
    if (!draft.typeId) {
      onError("Choose a type for this item, or add one first.");
      return;
    }
    // Blank and unreadable are different mistakes and get different answers.
    if (!draft.price.trim()) {
      onError(`Enter a price for ${name}. Use 0 if it is free.`);
      return;
    }
    // Prices are entered in major units and converted once, here. Everything
    // past this point is integer minor units.
    const minor = priceToMinor(draft.price);
    if (minor === null) {
      onError(`Enter the price for ${name} as a plain amount, like 10.95.`);
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        name,
        item_type_id: draft.typeId,
        description: draft.description.trim() || null,
        base_price_minor: minor,
        meal_ids: draft.mealIds,
        modifier_group_ids: draft.groupIds,
        included_option_ids: draft.includedIds,
        image_path: draft.image.path,
      });
      onError(null);
    } catch (e) {
      // Stay open holding the edits, so a rejected change can be corrected
      // rather than retyped.
      onError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 bg-paper px-4 py-4 sm:grid-cols-4">
      <label className="sm:col-span-2">
        <span className="text-xs text-muted">Item name</span>
        <input
          className="field mt-1"
          value={draft.name}
          autoFocus
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </label>
      <label>
        <span className="text-xs text-muted">Type</span>
        <select
          className="field mt-1"
          value={draft.typeId}
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, typeId: e.target.value }))}
        >
          {!types.length && <option value="">No types yet</option>}
          {/* Flat, and in menu order, with a subcategory named under its
              heading: "Burgers" alone says less than "Food / Burgers". */}
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {typeLabel(types, t.id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="text-xs text-muted">Price</span>
        <input
          className="field mt-1"
          inputMode="decimal"
          placeholder="10.95"
          value={draft.price}
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
        />
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

      <div className="sm:col-span-4">
        <p className="text-xs text-muted">Photo</p>
        <div className="mt-2">
          <ImagePicker
            kind="items"
            image={draft.image}
            label={draft.name.trim() || "this item"}
            disabled={saving}
            onChange={(image) => setDraft((d) => ({ ...d, image }))}
            onError={onError}
            onBusyChange={trackUpload}
          />
        </div>
      </div>

      <div className="sm:col-span-4">
        <p className="text-xs text-muted">Served during</p>
        {!meals.length ? (
          <p className="mt-1 text-xs text-muted">
            No meal periods yet. Add one on the next tab, then tick it here.
            The item is saved either way and waits until it has somewhere to go.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {meals.map((meal) => (
              <Chip
                key={meal.id}
                on={draft.mealIds.includes(meal.id)}
                disabled={saving}
                onClick={() => toggle("mealIds", meal.id)}
              >
                {meal.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="sm:col-span-4">
        <p className="text-xs text-muted">
          Modifier groups for this item, and what it comes with
        </p>
        <GroupsAndInclusions
          groups={relevant}
          groupIds={draft.groupIds}
          includedIds={draft.includedIds}
          disabled={saving}
          emptyNote={`No groups for ${chosenType} yet. Create one in the modifier library.`}
          onToggleGroup={(groupId) => {
            const group = relevant.find((g) => g.id === groupId);
            if (group) toggleGroup(group);
          }}
          onToggleIncluded={(optionId) => toggle("includedIds", optionId)}
        />
      </div>

      <div className="flex items-center gap-4 sm:col-span-4">
        <button
          className="btn-primary"
          disabled={saving || uploading > 0}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : uploading > 0 ? "Uploading photo…" : submitLabel}
        </button>
        <button className="text-xs text-muted underline" disabled={saving} onClick={onCancel}>
          cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The groups an item offers, and within each, what it comes with.
 *
 * One block rather than two lists, because the second question only makes
 * sense inside the first: an option can only be included if the item offers
 * the group holding it, which is what the server checks too. Ticking a group
 * opens its options; unticking it takes its inclusions with it, so the form
 * cannot ask for something the save would refuse.
 *
 * An included option is free on this item, which is why the price beside it
 * is replaced rather than struck through -- there is no price here to strike.
 */
function GroupsAndInclusions({
  groups,
  groupIds,
  includedIds,
  disabled,
  emptyNote,
  onToggleGroup,
  onToggleIncluded,
}: {
  groups: ModifierGroupSummary[];
  groupIds: string[];
  includedIds: string[];
  disabled?: boolean;
  emptyNote: string;
  onToggleGroup: (groupId: string) => void;
  onToggleIncluded: (optionId: string) => void;
}) {
  if (!groups.length) return <p className="mt-1 text-xs text-muted">{emptyNote}</p>;

  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <Chip
            key={g.id}
            on={groupIds.includes(g.id)}
            disabled={disabled}
            onClick={() => onToggleGroup(g.id)}
          >
            {g.name}
            {g.is_required && <span className="ml-1 opacity-60">required</span>}
          </Chip>
        ))}
      </div>

      {groups
        .filter((g) => groupIds.includes(g.id))
        .map((g) => (
          <div key={g.id} className="border-l-2 border-hairline pl-3">
            <p className="text-[11px] text-muted">
              Comes with, from {g.name}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {g.options.map((o) => {
                const on = includedIds.includes(o.id);
                return (
                  <Chip
                    key={o.id}
                    on={on}
                    disabled={disabled}
                    onClick={() => onToggleIncluded(o.id)}
                  >
                    {o.name}
                    <span className="ml-1.5 opacity-60">
                      {on ? "free" : signedMoney(o.price_delta_minor) || "+0.00"}
                    </span>
                  </Chip>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

/** A toggle that reads as a tick, not a button that fires on click. */
function Chip({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded border px-2.5 py-1 text-xs ${
        on ? "border-ink bg-ink text-white" : "border-hairline bg-surface"
      }`}
    >
      {children}
    </button>
  );
}
