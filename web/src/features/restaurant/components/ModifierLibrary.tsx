import { useEffect, useRef, useState } from "react";
import { Empty, Panel } from "@/components/common/Feedback";
import { PencilIcon } from "@/components/common/icons";
import { deltaToMinor, minorToDeltaInput, signedMoney } from "@/utils/format";
import { errorMessage } from "@/services/apiClient";
import {
  useCreateModifierGroupMutation,
  useCreateModifierOptionMutation,
  useDeleteModifierGroupMutation,
  useDeleteModifierOptionMutation,
  useUpdateModifierGroupMutation,
  useUpdateModifierOptionMutation,
  type ItemTypeRow,
  type ModifierGroupChanges,
  type ModifierGroupSummary,
} from "../restaurantApi";
import { topLevel } from "../itemTypes";
import { ImagePicker, NO_IMAGE, useUploadsInFlight, type ImageDraft } from "./ImagePicker";

/** A row of the option editor, before it is worth sending. */
type OptionDraft = { key: number; name: string; delta: string; image: ImageDraft };

/** Enough rows to show the shape of the thing without a click. */
const BLANK_ROWS = 3;

/** Only on the empty rows, so they read as examples rather than as content. */
const EXAMPLES = ["Lettuce", "Tomato", "Jalapenos"];

/** Reusable modifier groups, shared across every item that opts into them. */
export function ModifierLibrary({
  groups,
  types,
  onError,
}: {
  groups: ModifierGroupSummary[];
  types: ItemTypeRow[];
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"SINGLE" | "MULTI">("MULTI");
  const [required, setRequired] = useState(false);
  const [maxSelect, setMaxSelect] = useState("3");
  const [appliesTo, setAppliesTo] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploading, trackUpload] = useUploadsInFlight();
  const [createGroup] = useCreateModifierGroupMutation();

  // Rows are identified by a counter rather than by their index, so removing
  // the middle one does not make React reuse its input for the row below and
  // carry the text down with it.
  const keys = useRef(0);
  function blankRow(): OptionDraft {
    keys.current += 1;
    return { key: keys.current, name: "", delta: "", image: NO_IMAGE };
  }

  const [options, setOptions] = useState<OptionDraft[]>(() =>
    Array.from({ length: BLANK_ROWS }, blankRow),
  );
  // autoFocus fires on mount, which is exactly when a row appears, so naming
  // the new row is all the focus management this needs.
  const [focusKey, setFocusKey] = useState<number | null>(null);

  function addRowAfter(index: number) {
    const fresh = blankRow();
    setOptions((prev) => [...prev.slice(0, index + 1), fresh, ...prev.slice(index + 1)]);
    setFocusKey(fresh.key);
  }

  function setRow(key: number, patch: Partial<OptionDraft>) {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  const named = options.filter((o) => o.name.trim());

  /**
   * Check every field, and name the one that is wrong.
   *
   * The button used to be disabled until the form looked complete, which
   * says nothing about which field is missing -- and a field the form did
   * not check at all, like a blank Max choices, went to the server and came
   * back as a generic failure. So the button always submits and each field
   * answers for itself.
   */
  async function create() {
    const groupName = name.trim();
    if (!groupName) {
      onError("Enter a name for the group, like Veggies or Ice level.");
      return;
    }

    // Only a pick-several group has a maximum to set. A pick-one group is one
    // by definition, so its field is not on screen and is not read here.
    let max = 1;
    if (type === "MULTI") {
      max = Number(maxSelect.trim());
      if (!maxSelect.trim()) {
        onError("Enter Max choices: how many options a customer may pick.");
        return;
      }
      if (!Number.isInteger(max) || max < 1) {
        onError("Enter Max choices as a whole number, 1 or more.");
        return;
      }
    }

    // An empty row is a row nobody filled in, not an error. Three appear by
    // default and a group of two options is ordinary, so refusing to save
    // over a blank one would be refusing the common case.
    const parsed = [];
    for (const option of named) {
      const label = option.name.trim();
      const typed = option.delta.trim();
      // Blank is the common case and means no change. Parsed rather than
      // defaulted to zero when present, because a price that cannot be read
      // must be said out loud rather than silently charged as nothing.
      const minor = typed ? deltaToMinor(typed) : 0;
      if (minor === null) {
        onError(
          `Enter the price change for ${label} as a plain amount, like 0.50 or -0.50.`,
        );
        return;
      }
      parsed.push({
        name: label,
        price_delta_minor: minor,
        is_default: false,
        sort_order: parsed.length,
        image_path: option.image.path,
      });
    }

    if (!parsed.length) {
      onError("Add at least one option. A group with none has nothing to offer.");
      return;
    }
    if (required && parsed.length < 1) {
      onError("A group a customer must choose from needs at least one option.");
      return;
    }

    setCreating(true);
    try {
      await createGroup({
        name: groupName,
        selection_type: type,
        is_required: required,
        min_select: required ? 1 : 0,
        max_select: max,
        applies_to_type_ids: appliesTo,
        options: parsed,
      }).unwrap();
      setName("");
      setAppliesTo([]);
      setOptions(Array.from({ length: BLANK_ROWS }, blankRow));
      onError(null);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Panel title="New modifier group">
        <div className="grid gap-3 border border-hairline bg-surface p-4 sm:grid-cols-4">
          <label className="sm:col-span-2">
            <span className="text-xs text-muted">Group name</span>
            <input
              className="field mt-1"
              placeholder="Veggies, Ice level, Sauce add-ons"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            <span className="text-xs text-muted">Choice</span>
            <select
              className="field mt-1"
              value={type}
              onChange={(e) => setType(e.target.value as "SINGLE" | "MULTI")}
            >
              <option value="MULTI">Pick several</option>
              <option value="SINGLE">Pick one</option>
            </select>
          </label>
          {type === "MULTI" && (
            <label>
              <span className="text-xs text-muted">Max choices</span>
              <input
                className="field mt-1"
                inputMode="numeric"
                value={maxSelect}
                onChange={(e) => setMaxSelect(e.target.value)}
              />
            </label>
          )}
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brick"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            Customer must choose
          </label>

          <div className="sm:col-span-4">
            <TypePicker types={types} value={appliesTo} onChange={setAppliesTo} />
          </div>

          {/* Two columns rather than one text field parsed for a trailing
              amount. The price is a separate thing from the name, it lines up
              down the column where a mistake is visible, and it is the same
              pair of fields the editor below uses -- so a group reads the
              same whether it is being written or corrected. */}
          <div className="sm:col-span-4">
            <div className="flex items-center gap-2">
              <span className="w-9 text-xs text-muted">Photo</span>
              <span className="flex-1 text-xs text-muted">Options</span>
              <span className="w-24 text-xs text-muted">Price change</span>
              <span className="w-14" />
            </div>

            <div className="mt-1 space-y-2">
              {options.map((option, index) => (
                <div key={option.key} className="flex items-center gap-2">
                  <ImagePicker
                    kind="options"
                    size="sm"
                    image={option.image}
                    label={option.name.trim() || `option ${index + 1}`}
                    disabled={creating}
                    onChange={(image) => setRow(option.key, { image })}
                    onError={onError}
                    onBusyChange={trackUpload}
                  />
                  <input
                    className="field flex-1 text-sm"
                    placeholder={EXAMPLES[index] ?? "Another option"}
                    value={option.name}
                    autoFocus={option.key === focusKey}
                    aria-label={`Option ${index + 1}`}
                    onChange={(e) => setRow(option.key, { name: e.target.value })}
                    // Enter opens the next row, so a list can be typed
                    // straight through the way the old textarea allowed.
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addRowAfter(index);
                      }
                    }}
                  />
                  <input
                    className="field tnum w-24 text-sm"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={option.delta}
                    aria-label={`Price change for option ${index + 1}`}
                    onChange={(e) => setRow(option.key, { delta: e.target.value })}
                  />
                  <button
                    type="button"
                    // Kept in the layout rather than dropped, so the rows
                    // above do not shift when the last one becomes removable.
                    className={`w-14 text-xs text-brick underline ${
                      options.length > 1 ? "" : "invisible"
                    }`}
                    disabled={options.length < 2}
                    onClick={() =>
                      setOptions((prev) => prev.filter((o) => o.key !== option.key))
                    }
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>

            <p className="mt-2 text-xs text-muted">
              Leave a price blank for no change. A negative one is allowed:
              type -0.50 for no cheese.
            </p>
            <button
              type="button"
              className="mt-2 text-xs text-muted underline"
              onClick={() => addRowAfter(options.length - 1)}
            >
              add another option
            </button>
          </div>

          <div className="sm:col-span-4">
            {/* Always submits. What is missing is said in words above the
                form, not implied by a button that will not press. */}
            <button
              className="btn-primary"
              disabled={creating || uploading > 0}
              onClick={create}
            >
              {creating ? "Creating…" : uploading > 0 ? "Uploading photo…" : "Create group"}
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Library">
        {!groups.length ? (
          <Empty>No groups yet. Create one and it becomes reusable across every item.</Empty>
        ) : (
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {groups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                types={types}
                onError={onError}
              />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

/**
 * Which item types a group is offered for, chosen as a row of toggles.
 *
 * Toggles rather than a multi-select list box. A native multiple select hides
 * how many are picked behind a scrollbar and needs ctrl-click to add a second
 * one, which is exactly the interaction this screen exists to make obvious --
 * a Size group belongs on drinks and sides, and both have to be visibly on.
 *
 * Nothing selected means every type. That is the same rule the server keeps,
 * and it is spelled out on screen rather than left as a blank row to puzzle
 * over.
 *
 * The types are the restaurant's own, read from the same list the item forms
 * offer, so a group can never name a type that does not exist on the menu.
 *
 * Headings only. Named against Burgers, a group would have to be named again
 * against Nuggets and again against every subcategory added afterwards --
 * the duplication subcategories exist to avoid. An item is matched by the
 * heading above it, so offering a group for Food reaches every burger.
 */
function TypePicker({
  types,
  value,
  onChange,
  disabled,
}: {
  types: ItemTypeRow[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <p className="text-xs text-muted">
        Shows on{" "}
        {value.length ? (
          <span>these item types, and anything filed under them</span>
        ) : (
          <span>every item type. Pick one or more to narrow it.</span>
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {topLevel(types).map((t) => {
          const on = value.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() =>
                onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])
              }
              className={`rounded border px-2.5 py-1 text-xs ${
                on ? "border-ink bg-ink text-white" : "border-hairline bg-surface"
              }`}
            >
              {t.name}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** The phrase both modes read, so they cannot word it differently.
 *
 *  A type deleted since the group named it simply drops out of the sentence:
 *  the server removed the link, and a heading nobody has any more is not
 *  worth naming. */
function showsOn(typeIds: string[], types: ItemTypeRow[]): string {
  const byId = new Map(types.map((t) => [t.id, t.name]));
  const words = typeIds.map((id) => byId.get(id)).filter((w): w is string => !!w);
  if (!words.length) return "shows on every item that opts in";
  const list =
    words.length > 1
      ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
      : words[0];
  return `shows on ${list} items`;
}

/** How a group's rules read in one line, in both modes. */
function rules(group: ModifierGroupSummary): string {
  const choice =
    group.selection_type === "SINGLE" ? "pick one" : `up to ${group.max_select}`;
  return group.is_required ? `${choice} · required` : choice;
}

/**
 * One group, read or edited.
 *
 * The same two modes as a meal on the other tab, for the same reason: this is
 * the library as the menu builder reads it, and the pencil opens everything
 * that changes it. Keeping the two tabs behaving alike matters more here than
 * usual, because the same person moves between them mid-task.
 */
function GroupCard({
  group,
  types,
  onError,
}: {
  group: ModifierGroupSummary;
  types: ItemTypeRow[];
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <GroupEditor
        group={group}
        types={types}
        onError={onError}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="border border-hairline bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-1.5">
          <h3 className="text-sm font-medium">{group.name}</h3>
          <button
            type="button"
            aria-label={`Edit ${group.name}`}
            title={`Edit ${group.name} and its options`}
            className="text-muted hover:text-ink"
            onClick={() => {
              onError(null);
              setEditing(true);
            }}
          >
            <PencilIcon />
          </button>
        </span>
        <span className="text-xs text-muted">{rules(group)}</span>
      </div>
      {group.applies_to_type_ids.length > 0 && (
        <p className="mt-0.5 text-xs text-muted">
          {showsOn(group.applies_to_type_ids, types)}
        </p>
      )}
      <ul className="mt-2 divide-y divide-hairline border-t border-hairline text-sm">
        {group.options.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 py-1.5">
            {o.image_url && (
              <img
                src={o.image_url}
                alt=""
                loading="lazy"
                className="h-7 w-7 shrink-0 rounded object-cover"
              />
            )}
            <span className="flex-1">{o.name}</span>
            <span className="tnum text-muted">{signedMoney(o.price_delta_minor)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type OptionEdit = { name: string; delta: string; image: ImageDraft };

type GroupDraft = {
  name: string;
  typeIds: string[];
  selection: "SINGLE" | "MULTI";
  required: boolean;
  /** As typed. Read only for a pick-several group. */
  max: string;
  options: Record<string, OptionEdit>;
};

function optionEdit(option: ModifierGroupSummary["options"][number]): OptionEdit {
  return {
    name: option.name,
    delta: minorToDeltaInput(option.price_delta_minor),
    image: { path: option.image_path, url: option.image_url },
  };
}

/**
 * The rule fields to send for this draft, only where they differ from the
 * group; or, if the draft cannot be read, what to tell the manager.
 *
 * The minimum follows "customer must choose" the way the create form sets it,
 * 1 or 0, but only when that answer or the choice type changes. A group made
 * with a larger minimum keeps it through an edit that did not touch either.
 */
function ruleChanges(
  group: ModifierGroupSummary,
  draft: GroupDraft,
): Omit<ModifierGroupChanges, "name" | "applies_to_type_ids"> | string {
  let max = 1;
  if (draft.selection === "MULTI") {
    max = Number(draft.max.trim());
    if (!draft.max.trim() || !Number.isInteger(max) || max < 1) {
      return "Enter Max choices as a whole number, 1 or more.";
    }
  }

  const reshaped =
    draft.required !== group.is_required || draft.selection !== group.selection_type;
  const min = reshaped ? (draft.required ? 1 : 0) : group.min_select;

  const out: Omit<ModifierGroupChanges, "name" | "applies_to_type_ids"> = {};
  if (draft.selection !== group.selection_type) out.selection_type = draft.selection;
  if (draft.required !== group.is_required) out.is_required = draft.required;
  if (max !== group.max_select) out.max_select = max;
  if (min !== group.min_select) out.min_select = min;
  return out;
}

function seed(group: ModifierGroupSummary): GroupDraft {
  const options: GroupDraft["options"] = {};
  for (const option of group.options) {
    options[option.id] = optionEdit(option);
  }
  return {
    name: group.name,
    typeIds: [...group.applies_to_type_ids],
    selection: group.selection_type,
    required: group.is_required,
    max: String(group.max_select),
    options,
  };
}

/**
 * One group as a form: its name, and the name and price change of every
 * option in it.
 *
 * The rules of the same two-rule contract the meal editor uses, so moving
 * between the tabs does not mean learning a second set of habits. Removing is
 * staged and applies on Save, which is what makes cancel a real undo; adding
 * is immediate, because it is not destructive and staging it would mean
 * inventing rows that do not exist on the server yet.
 *
 * A price change here may be negative. "No cheese -0.50" is the documented
 * exception to the non-negative money rule, which is why these fields parse
 * through deltaToMinor rather than the item parser next door.
 */
function GroupEditor({
  group,
  types,
  onDone,
  onError,
}: {
  group: ModifierGroupSummary;
  types: ItemTypeRow[];
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState<GroupDraft>(() => seed(group));
  const [removed, setRemoved] = useState<Record<string, true>>({});
  const [removingGroup, setRemovingGroup] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, trackUpload] = useUploadsInFlight();
  const [updateGroup] = useUpdateModifierGroupMutation();
  const [deleteGroup] = useDeleteModifierGroupMutation();
  const [updateOption] = useUpdateModifierOptionMutation();
  const [deleteOption] = useDeleteModifierOptionMutation();

  // Options added while the form is open arrive through a refetch. Take only
  // the ones the draft has never seen, so edits in progress survive.
  useEffect(() => {
    setDraft((d) => {
      const options = { ...d.options };
      let changed = false;
      for (const option of group.options) {
        if (!(option.id in options)) {
          options[option.id] = optionEdit(option);
          changed = true;
        }
      }
      return changed ? { ...d, options } : d;
    });
  }, [group]);

  function setOption(id: string, patch: Partial<OptionEdit>) {
    setDraft((d) => ({
      ...d,
      options: { ...d.options, [id]: { ...d.options[id]!, ...patch } },
    }));
  }

  function toggleRemoved(id: string) {
    setRemoved((r) => {
      const next = { ...r };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  const doomed = removingGroup
    ? group.options.length
    : group.options.filter((o) => removed[o.id]).length;

  async function save() {
    const jobs: (() => Promise<unknown>)[] = [];
    // The group's own edit goes first and alone. Its rules decide whether an
    // option may be deleted -- a required "choose 2" needs two left -- so
    // sending both at once would check each against the other's old state.
    let groupJob: (() => Promise<unknown>) | null = null;

    if (removingGroup) {
      // Its options go with it, so nothing else is worth sending.
      jobs.push(() => deleteGroup(group.id).unwrap());
    } else {
      const name = draft.name.trim();
      if (!name) {
        onError("Enter a name for the group. It cannot be left blank.");
        return;
      }

      // Name, kinds and rules are one PATCH, and only what changed is sent.
      // Comparing as sorted text rather than by reference, because ticking a
      // kind off and back on rebuilds the array with the same contents and
      // would otherwise read as an edit.
      const changes: ModifierGroupChanges = {};
      if (name !== group.name) changes.name = name;
      if (
        [...draft.typeIds].sort().join() !==
        [...group.applies_to_type_ids].sort().join()
      ) {
        changes.applies_to_type_ids = draft.typeIds;
      }

      const rules = ruleChanges(group, draft);
      if (typeof rules === "string") {
        onError(rules);
        return;
      }
      Object.assign(changes, rules);

      if (Object.keys(changes).length) {
        groupJob = () => updateGroup({ groupId: group.id, changes }).unwrap();
      }

      // Every option gone is a group that offers nothing, which the storefront
      // renders as an empty required choice a customer cannot satisfy.
      if (doomed === group.options.length && group.options.length > 0) {
        onError("A group needs at least one option. Delete the whole group instead.");
        return;
      }

      for (const option of group.options) {
        if (removed[option.id]) {
          jobs.push(() => deleteOption(option.id).unwrap());
          continue;
        }
        const edited = draft.options[option.id];
        if (!edited) continue;

        const changes: {
          name?: string;
          price_delta_minor?: number;
          image_path?: string | null;
        } = {};
        const optionName = edited.name.trim();
        if (!optionName) {
          onError(`Enter a name for the option currently called ${option.name}.`);
          return;
        }
        if (optionName !== option.name) changes.name = optionName;

        const minor = deltaToMinor(edited.delta);
        if (minor === null) {
          onError(
            `Enter the price change for ${option.name} as a plain amount, like 0.50 or -0.50.`,
          );
          return;
        }
        if (minor !== option.price_delta_minor) changes.price_delta_minor = minor;

        // Only when it changed: null means "take the photo off".
        if (edited.image.path !== option.image_path) changes.image_path = edited.image.path;

        if (Object.keys(changes).length) {
          jobs.push(() => updateOption({ optionId: option.id, changes }).unwrap());
        }
      }
    }

    if (!jobs.length && !groupJob) {
      onError(null);
      onDone();
      return;
    }

    setSaving(true);
    try {
      if (groupJob) await groupJob();
      await Promise.all(jobs.map((run) => run()));
      onError(null);
      onDone();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-ink bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {removingGroup ? (
          <span className="flex items-baseline gap-3">
            <h3 className="text-sm font-medium text-muted line-through">{group.name}</h3>
            <button className="text-xs underline" onClick={() => setRemovingGroup(false)}>
              keep it
            </button>
          </span>
        ) : (
          <input
            className="field w-48 text-sm font-medium"
            value={draft.name}
            autoFocus
            disabled={saving}
            aria-label="Group name"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        )}
        <span className="text-xs text-muted">{rules(group)}</span>
      </div>

      {/* The rules reach every item offering the group, on the storefront and
          at checkout, the moment this saves. The server refuses rules the
          group's options cannot meet, and a maximum below what an item already
          comes with, so a mistake here is refused rather than shipped. */}
      {!removingGroup && (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label>
            <span className="text-xs text-muted">Choice</span>
            <select
              className="field mt-1 py-1 text-sm"
              value={draft.selection}
              disabled={saving}
              onChange={(e) =>
                setDraft((d) => ({ ...d, selection: e.target.value as "SINGLE" | "MULTI" }))
              }
            >
              <option value="MULTI">Pick several</option>
              <option value="SINGLE">Pick one</option>
            </select>
          </label>
          {draft.selection === "MULTI" && (
            <label>
              <span className="text-xs text-muted">Max choices</span>
              <input
                className="field mt-1 w-20 py-1 text-sm"
                inputMode="numeric"
                value={draft.max}
                disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, max: e.target.value }))}
              />
            </label>
          )}
          <label className="flex items-center gap-2 pb-1.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brick"
              checked={draft.required}
              disabled={saving}
              onChange={(e) => setDraft((d) => ({ ...d, required: e.target.checked }))}
            />
            Customer must choose
          </label>
        </div>
      )}

      {removingGroup ? (
        <p className="mt-0.5 text-xs text-muted">
          {showsOn(group.applies_to_type_ids, types)}
        </p>
      ) : (
        <div className="mt-2">
          <TypePicker
            types={types}
            value={draft.typeIds}
            disabled={saving}
            onChange={(typeIds) => setDraft((d) => ({ ...d, typeIds }))}
          />
        </div>
      )}

      {removingGroup ? (
        <p className="mt-3 border-t border-hairline pt-3 text-xs text-muted">
          This group and its {group.options.length} options will be deleted when
          you save. Every item offering it stops offering it.
        </p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-hairline border-t border-hairline">
            {group.options.map((option) => {
              const going = !!removed[option.id];
              return (
                <li key={option.id} className="flex items-center gap-2 py-1.5">
                  {going ? (
                    <>
                      {/* Holds the photo column, so a row marked for removal
                          stays lined up with the rows around it. */}
                      <span className="w-9 shrink-0" />
                      <span className="flex-1 text-sm text-muted line-through">
                        {option.name}
                      </span>
                      <span className="tnum w-20 text-right text-sm text-muted line-through">
                        {signedMoney(option.price_delta_minor) || "—"}
                      </span>
                    </>
                  ) : (
                    <>
                      <ImagePicker
                        kind="options"
                        size="sm"
                        image={draft.options[option.id]?.image ?? NO_IMAGE}
                        label={option.name}
                        disabled={saving}
                        onChange={(image) => setOption(option.id, { image })}
                        onError={onError}
                        onBusyChange={trackUpload}
                      />
                      <input
                        className="field flex-1 text-sm"
                        value={draft.options[option.id]?.name ?? ""}
                        disabled={saving}
                        aria-label={`${option.name} name`}
                        onChange={(e) => setOption(option.id, { name: e.target.value })}
                      />
                      <input
                        className="field tnum w-20 text-sm"
                        inputMode="decimal"
                        value={draft.options[option.id]?.delta ?? ""}
                        disabled={saving}
                        aria-label={`${option.name} price change`}
                        onChange={(e) => setOption(option.id, { delta: e.target.value })}
                      />
                    </>
                  )}
                  <button
                    className={`text-xs underline ${going ? "" : "text-brick"}`}
                    disabled={saving}
                    onClick={() => toggleRemoved(option.id)}
                  >
                    {going ? "keep it" : "delete"}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 border-t border-hairline pt-2">
            {adding ? (
              <AddOption
                groupId={group.id}
                onError={onError}
                onDone={() => setAdding(false)}
              />
            ) : (
              <button
                className="text-xs text-muted underline"
                disabled={saving}
                onClick={() => setAdding(true)}
              >
                add option
              </button>
            )}
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-hairline pt-3">
        <button
          className="btn-primary px-3 py-1.5 text-sm"
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
        {!removingGroup && (
          <button
            className="ml-auto text-xs text-brick underline"
            disabled={saving}
            onClick={() => setRemovingGroup(true)}
          >
            delete group
          </button>
        )}
      </div>

      {!removingGroup && doomed > 0 && (
        <p className="mt-2 text-xs text-brick">
          Saving will delete {doomed} {doomed === 1 ? "option" : "options"}. Cancel
          and nothing is removed.
        </p>
      )}
    </div>
  );
}

/**
 * One new option on an existing group.
 *
 * Immediate, like adding a category or an item on the other tab. The price
 * change is optional and defaults to none, which is what most options are.
 */
function AddOption({
  groupId,
  onDone,
  onError,
}: {
  groupId: string;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [delta, setDelta] = useState("0.00");
  const [image, setImage] = useState<ImageDraft>(NO_IMAGE);
  const [uploading, trackUpload] = useUploadsInFlight();
  const [createOption] = useCreateModifierOptionMutation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ImagePicker
        kind="options"
        size="sm"
        image={image}
        label={name.trim() || "the new option"}
        onChange={setImage}
        onError={onError}
        onBusyChange={trackUpload}
      />
      <input
        className="field flex-1 text-sm"
        placeholder="Extra pickles"
        value={name}
        autoFocus
        aria-label="Option name"
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="field tnum w-20 text-sm"
        inputMode="decimal"
        value={delta}
        aria-label="Price change"
        onChange={(e) => setDelta(e.target.value)}
      />
      <button
        className="btn-primary px-3 py-1.5 text-sm"
        disabled={uploading > 0}
        onClick={async () => {
          if (!name.trim()) {
            onError("Enter a name for the option before adding it.");
            return;
          }
          const minor = deltaToMinor(delta);
          if (minor === null) {
            onError("Enter the price change as a plain amount, like 0.50 or -0.50.");
            return;
          }
          try {
            await createOption({
              groupId,
              name: name.trim(),
              price_delta_minor: minor,
              image_path: image.path,
            }).unwrap();
            setName("");
            setDelta("0.00");
            setImage(NO_IMAGE);
            onError(null);
            onDone();
          } catch (e) {
            onError(errorMessage(e));
          }
        }}
      >
        Add
      </button>
      <button className="text-xs text-muted underline" onClick={onDone}>
        cancel
      </button>
    </div>
  );
}
