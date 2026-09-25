import { useEffect, useRef, useState } from "react";
import { Empty, Panel, Spinner } from "@/components/common/Feedback";
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
import {
  ImagePicker, ImageSizeHint, NO_IMAGE, useUploadsInFlight, type ImageDraft,
} from "./ImagePicker";

/** A row of the option editor, before it is worth sending. */
type OptionDraft = { key: number; name: string; delta: string; kcal: string; image: ImageDraft };

/** Enough rows to show the shape of the thing without a click. */
const BLANK_ROWS = 3;

/** Only on the empty rows, so they read as examples rather than as content. */
const EXAMPLES = ["Lettuce", "Tomato", "Jalapenos"];

/** Photo · name · price · action, aligned the same in the create form, the
 *  editor and the add-option row. Stacks the price under the name on a phone. */
const OPTION_GRID =
  "grid grid-cols-[38px_minmax(0,1fr)_48px] items-end gap-2.5 py-2 md:grid-cols-[38px_minmax(0,1fr)_100px_90px_48px] lg:grid-cols-[44px_minmax(0,1fr)_140px_110px_70px] lg:gap-3";

/**
 * A typed calorie change: the number, null for "no change stated", or false
 * for something that is neither. Negative is ordinary -- "no cheese" takes
 * calories off exactly as it takes money off.
 */
function caloriesDeltaOf(typed: string): number | null | false {
  const text = typed.trim();
  if (!text) return null;
  if (!/^-?\d{1,5}$/.test(text)) return false;
  const value = Number(text);
  return Math.abs(value) <= 20000 ? value : false;
}

/**
 * Which options of a required group state a calorie change and which do not.
 *
 * Half a group is the dangerous state: the customer picking the size nobody
 * filled in is shown a confident total that is simply wrong. Said in the
 * builder, where it can be fixed.
 */
function halfStatedCalories(group: {
  is_required: boolean;
  options: { calories_delta?: number | null }[];
}): boolean {
  if (!group.is_required || group.options.length < 2) return false;
  const stated = group.options.filter((o) => typeof o.calories_delta === "number").length;
  return stated > 0 && stated < group.options.length;
}

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
    return { key: keys.current, name: "", delta: "", kcal: "", image: NO_IMAGE };
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
      const kcalDelta = caloriesDeltaOf(option.kcal);
      if (kcalDelta === false) {
        onError(`Enter the calorie change for ${label} as a whole number, like 130 or -90.`);
        return;
      }
      parsed.push({
        name: label,
        price_delta_minor: minor,
        calories_delta: kcalDelta,
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
        <div className="card flex flex-col gap-[17px]">
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
            <label className="block">
              <span className="label">Group name</span>
              <input
                className="field mt-[7px]"
                placeholder="Veggies, Ice level, Sauce add-ons"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">Choice</span>
              <select
                className="field mt-[7px]"
                value={type}
                onChange={(e) => setType(e.target.value as "SINGLE" | "MULTI")}
              >
                <option value="MULTI">Pick several</option>
                <option value="SINGLE">Pick one</option>
              </select>
            </label>
            {type === "MULTI" && (
              <label className="block">
                <span className="label">Max choices</span>
                <input
                  className="field mt-[7px]"
                  inputMode="numeric"
                  value={maxSelect}
                  onChange={(e) => setMaxSelect(e.target.value)}
                />
              </label>
            )}
            <label className="flex min-h-[46px] items-center gap-2.5 self-end text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
              Customer must choose
            </label>
          </div>

          <TypePicker types={types} value={appliesTo} onChange={setAppliesTo} />

          {/* Two columns rather than one text field parsed for a trailing
              amount. The price is a separate thing from the name, it lines up
              down the column where a mistake is visible, and it is the same
              pair of fields the editor below uses -- so a group reads the
              same whether it is being written or corrected. */}
          <fieldset>
            <legend className="mb-1 text-sm font-semibold">Options</legend>
            <ImageSizeHint kind="options" className="mb-2" />
            <div
              aria-hidden="true"
              className={`${OPTION_GRID} hidden py-0 text-caption text-muted md:grid`}
            >
              <span>Photo</span>
              <span>Options</span>
              <span>Price change</span>
              <span />
            </div>

            {options.map((option, index) => (
              <div key={option.key} className={`${OPTION_GRID} animate-fade`}>
                <span className="pb-1">
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
                </span>
                <input
                  className="field"
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
                  className="field tnum col-start-2 md:col-start-auto"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={option.delta}
                  aria-label={`Price change for option ${index + 1}`}
                  onChange={(e) => setRow(option.key, { delta: e.target.value })}
                />
                <input
                  className="field tnum col-start-2 md:col-start-auto"
                  inputMode="numeric"
                  placeholder="+kcal"
                  value={option.kcal}
                  aria-label={`Calorie change for option ${index + 1}`}
                  onChange={(e) => setRow(option.key, { kcal: e.target.value })}
                />
                <button
                  type="button"
                  // Kept in the layout rather than dropped, so the rows
                  // above do not shift when the last one becomes removable.
                  className={`link-danger row-start-1 [grid-column:3] md:row-start-auto md:[grid-column:auto] ${
                    options.length > 1 ? "" : "invisible"
                  }`}
                  disabled={options.length < 2}
                  tabIndex={options.length > 1 ? undefined : -1}
                  onClick={() => setOptions((prev) => prev.filter((o) => o.key !== option.key))}
                >
                  remove
                </button>
              </div>
            ))}

            <p className="field-hint">
              Leave a price blank for no change. A negative one is allowed: type -0.50 for no
              cheese.
            </p>
            <button type="button" className="link" onClick={() => addRowAfter(options.length - 1)}>
              add another option
            </button>
          </fieldset>

          <div>
            {/* Always submits. What is missing is said in words above the
                form, not implied by a button that will not press. */}
            <button
              type="button"
              className="btn-primary"
              disabled={creating || uploading > 0}
              onClick={create}
            >
              {(creating || uploading > 0) && <Spinner />}
              {creating ? "Creating…" : uploading > 0 ? "Uploading photo…" : "Create group"}
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Library">
        {!groups.length ? (
          <Empty>No groups yet. Create one and it becomes reusable across every item.</Empty>
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
            {groups.map((group) => (
              <GroupCard key={group.id} group={group} types={types} onError={onError} />
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
    <fieldset>
      <legend className="mb-1 text-sm font-semibold">Item types</legend>
      <p className="text-caption text-muted" aria-live="polite">
        Shows on{" "}
        {value.length
          ? "these item types, and anything filed under them"
          : "every item type. Pick one or more to narrow it."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {topLevel(types).map((t) => {
          const on = value.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}
              className="chip"
            >
              {t.name}
            </button>
          );
        })}
      </div>
    </fieldset>
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
      <div className="md:col-span-2">
        <GroupEditor group={group} types={types} onError={onError} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <article className="card">
      <header className="flex items-center justify-between gap-3">
        <h3 className="font-display text-[26px] leading-tight tracking-[-.5px]">{group.name}</h3>
        <button
          type="button"
          aria-label={`Edit ${group.name}`}
          title={`Edit ${group.name} and its options`}
          className="link min-h-[32px] px-1 text-base no-underline"
          onClick={() => {
            onError(null);
            setEditing(true);
          }}
        >
          <PencilIcon />
        </button>
      </header>
      <p className="field-hint">{rules(group)}</p>
      {group.applies_to_type_ids.length > 0 && (
        <p className="mt-1 text-caption text-muted">{showsOn(group.applies_to_type_ids, types)}</p>
      )}
      <ul className="mt-5">
        {group.options.map((o) => (
          <li
            key={o.id}
            className="flex items-center justify-between gap-3 border-b border-hairline py-[9px] text-sm last:border-0"
          >
            {o.image_url && (
              <img src={o.image_url} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded-status object-cover" />
            )}
            <span className="min-w-0 flex-1">{o.name}</span>
            <span className="tnum text-caption text-muted">
              {signedMoney(o.price_delta_minor) || "No change"}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

type OptionEdit = { name: string; delta: string; kcal: string; image: ImageDraft };

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
    kcal: option.calories_delta === null || option.calories_delta === undefined
      ? ""
      : String(option.calories_delta),
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
  // As typed, not as saved: the warning has to follow what is on screen,
  // and an option on its way out is no longer part of the group.
  const draftOptionCalories = group.options
    .filter((o) => !removed[o.id])
    .map((o) => {
      // A typed 0 is a stated change of none, not a blank: "|| null" would
      // quietly call it unstated and hide the warning that matters.
      const parsed = caloriesDeltaOf(draft.options[o.id]?.kcal ?? "");
      return { calories_delta: typeof parsed === "number" ? parsed : null };
    });

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
          calories_delta?: number | null;
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

        const kcalDelta = caloriesDeltaOf(edited.kcal);
        if (kcalDelta === false) {
          onError(
            `Enter the calorie change for ${option.name} as a whole number, like 130 or -90.`,
          );
          return;
        }
        if (kcalDelta !== (option.calories_delta ?? null)) changes.calories_delta = kcalDelta;

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
    <article className="editor animate-disclose">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {removingGroup ? (
          <h3 className="font-display text-[26px] leading-tight text-muted line-through">{group.name}</h3>
        ) : (
          <h3 className="text-lg font-semibold">Edit {group.name}</h3>
        )}
        <span className="pill text-muted">{rules(group)}</span>
      </header>

      {removingGroup ? (
        <div className="mt-5 flex flex-col items-start gap-2">
          <p className="note-warning w-full">
            This group and its {group.options.length} options will be deleted when you save. Every
            item offering it stops offering it.
          </p>
          <p className="text-caption text-muted">{showsOn(group.applies_to_type_ids, types)}</p>
          <button type="button" className="link" onClick={() => setRemovingGroup(false)}>
            keep it
          </button>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-[17px]">
          <label className="block sm:max-w-[calc(50%-9px)]">
            <span className="label">Group name</span>
            <input
              className="field mt-[7px]"
              value={draft.name}
              autoFocus
              disabled={saving}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </label>

          {/* The rules reach every item offering the group, on the storefront and
              at checkout, the moment this saves. The server refuses rules the
              group's options cannot meet, and a maximum below what an item already
              comes with, so a mistake here is refused rather than shipped. */}
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-3">
            <label className="block">
              <span className="label">Choice</span>
              <select
                className="field mt-[7px]"
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
              <label className="block">
                <span className="label">Max choices</span>
                <input
                  className="field mt-[7px]"
                  inputMode="numeric"
                  value={draft.max}
                  disabled={saving}
                  onChange={(e) => setDraft((d) => ({ ...d, max: e.target.value }))}
                />
              </label>
            )}
            <label className="flex min-h-[46px] items-center gap-2.5 self-end text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={draft.required}
                disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, required: e.target.checked }))}
              />
              Customer must choose
            </label>
          </div>

          <TypePicker
            types={types}
            value={draft.typeIds}
            disabled={saving}
            onChange={(typeIds) => setDraft((d) => ({ ...d, typeIds }))}
          />

          <fieldset>
            <legend className="mb-1 text-sm font-semibold">Options</legend>
            <ImageSizeHint kind="options" className="mb-2" />
            {/* Half a required group is the dangerous state: every customer
                who picks the size nobody filled in is shown a total that is
                confidently short. */}
            {halfStatedCalories({ is_required: draft.required, options: draftOptionCalories }) && (
              <p className="note-warning mb-3">
                Some choices here state a calorie change and some do not. A customer choosing one
                of the blank ones sees a total as if it added nothing.
              </p>
            )}
            {group.options.map((option) => {
              const going = !!removed[option.id];
              return (
                <div
                  key={option.id}
                  className={`${OPTION_GRID} transition-colors duration-stage ${
                    going ? "-mx-2 rounded-chip bg-[#FCF2F2] px-2" : ""
                  }`}
                >
                  {going ? (
                    <>
                      {/* Holds the photo column, so a row marked for removal
                          stays lined up with the rows around it. */}
                      <span />
                      <span className="min-h-[46px] py-3 text-muted line-through">{option.name}</span>
                      <span className="tnum col-start-2 py-3 text-muted line-through md:col-start-auto">
                        {signedMoney(option.price_delta_minor) || "—"}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="pb-1">
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
                      </span>
                      <input
                        className="field"
                        value={draft.options[option.id]?.name ?? ""}
                        disabled={saving}
                        aria-label={`${option.name} name`}
                        onChange={(e) => setOption(option.id, { name: e.target.value })}
                      />
                      <input
                        className="field tnum col-start-2 md:col-start-auto"
                        inputMode="decimal"
                        value={draft.options[option.id]?.delta ?? ""}
                        disabled={saving}
                        aria-label={`${option.name} price change`}
                        onChange={(e) => setOption(option.id, { delta: e.target.value })}
                      />
                      <input
                        className="field tnum col-start-2 md:col-start-auto"
                        inputMode="numeric"
                        placeholder="+kcal"
                        value={draft.options[option.id]?.kcal ?? ""}
                        disabled={saving}
                        aria-label={`${option.name} calorie change`}
                        onChange={(e) => setOption(option.id, { kcal: e.target.value })}
                      />
                    </>
                  )}
                  <button
                    type="button"
                    className={`${going ? "link" : "link-danger"} row-start-1 [grid-column:3] md:row-start-auto md:[grid-column:auto]`}
                    disabled={saving}
                    onClick={() => toggleRemoved(option.id)}
                  >
                    {going ? "keep it" : "delete"}
                  </button>
                </div>
              );
            })}
          </fieldset>

          {adding ? (
            <AddOption groupId={group.id} onError={onError} onDone={() => setAdding(false)} />
          ) : (
            <button type="button" className="link self-start" disabled={saving} onClick={() => setAdding(true)}>
              add option
            </button>
          )}
        </div>
      )}

      <footer className="mt-6 flex flex-wrap items-center gap-3.5 border-t border-hairline pt-[18px]">
        <button
          type="button"
          className="btn-primary"
          disabled={saving || uploading > 0}
          onClick={() => void save()}
        >
          {(saving || uploading > 0) && <Spinner />}
          {saving ? "Saving…" : uploading > 0 ? "Uploading photo…" : "Save changes"}
        </button>
        <button
          type="button"
          className="link"
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
            type="button"
            className="link-danger sm:ml-auto"
            disabled={saving}
            onClick={() => setRemovingGroup(true)}
          >
            delete group
          </button>
        )}
        {!removingGroup && doomed > 0 && (
          <p className="w-full text-caption text-danger">
            Saving will delete {doomed} {doomed === 1 ? "option" : "options"}. Cancel and nothing is
            removed.
          </p>
        )}
      </footer>
    </article>
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
  const [kcalDelta, setKcalDelta] = useState("");
  const [image, setImage] = useState<ImageDraft>(NO_IMAGE);
  const [adding, setAdding] = useState(false);
  const [uploading, trackUpload] = useUploadsInFlight();
  const [createOption] = useCreateModifierOptionMutation();

  return (
    <div className="animate-fade rounded-ticket border border-ink p-4">
      <h4 className="text-[15px] font-semibold">Add option</h4>
      <ImageSizeHint kind="options" className="mt-1" />
      <div className={OPTION_GRID}>
        <span className="pb-1">
          <ImagePicker
            kind="options"
            size="sm"
            image={image}
            label={name.trim() || "the new option"}
            onChange={setImage}
            onError={onError}
            onBusyChange={trackUpload}
          />
        </span>
        <label className="block min-w-0">
          <span className="label">Option name</span>
          <input
            className="field mt-[7px]"
            placeholder="Extra pickles"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="col-start-2 block min-w-0 md:col-start-auto">
          <span className="label">Price change</span>
          <input
            className="field tnum mt-[7px]"
            inputMode="decimal"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
          />
        </label>
        <label className="col-start-2 block min-w-0 md:col-start-auto">
          <span className="label">Calorie change</span>
          <input
            className="field tnum mt-[7px]"
            inputMode="numeric"
            placeholder="+kcal"
            value={kcalDelta}
            onChange={(e) => setKcalDelta(e.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="btn-primary"
          disabled={uploading > 0 || adding}
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
            setAdding(true);
            try {
              const kcalChange = caloriesDeltaOf(kcalDelta);
              if (kcalChange === false) {
                onError("Enter the calorie change as a whole number, like 130 or -90.");
                return;
              }
              await createOption({
                groupId,
                name: name.trim(),
                price_delta_minor: minor,
                calories_delta: kcalChange,
                image_path: image.path,
              }).unwrap();
              setName("");
              setDelta("0.00");
              setKcalDelta("");
              setImage(NO_IMAGE);
              onError(null);
              onDone();
            } catch (e) {
              onError(errorMessage(e));
            } finally {
              setAdding(false);
            }
          }}
        >
          {adding && <Spinner />}
          Add
        </button>
        <button type="button" className="link" onClick={onDone}>
          cancel
        </button>
      </div>
    </div>
  );
}
