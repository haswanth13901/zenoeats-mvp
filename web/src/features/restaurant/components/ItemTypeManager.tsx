import { useState } from "react";
import { PencilIcon } from "@/components/common/icons";
import { errorMessage } from "@/services/apiClient";
import { childrenOf, topLevel } from "../itemTypes";
import {
  useCreateItemTypeMutation,
  useDeleteItemTypeMutation,
  useUpdateItemTypeMutation,
  type ItemTypeRow,
} from "../restaurantApi";

/**
 * The restaurant's own words for what it sells, and a way through them.
 *
 * These were four fixed words in the schema. A tiffin house filed tiffins,
 * thalis and chaat under "Food" and read a stranger's vocabulary back on its
 * own menu.
 *
 * Two levels: a heading, and the subcategories inside it. Food holding
 * Burgers and Nuggets. Most restaurants use none of the second level, and
 * the strip reads exactly as it did for them -- a subcategory only appears
 * once somebody makes one.
 *
 * Two modes, as everything else in this builder has. Reading, the strip is
 * the filter for the list below it: a type is the one grouping every item
 * already has, and the counts were already here, so each chip reads as "how
 * many, and show me those". Editing, one control opens every type at once --
 * renaming four headings is one pass and one save, not four trips through a
 * pencil.
 */
export function ItemTypeManager({
  types,
  filter,
  onFilter,
  onError,
}: {
  types: ItemTypeRow[];
  /** The type being shown, or null for all of them. */
  filter: string | null;
  onFilter: (typeId: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  // How many types this pass has created. Only used to say so: the row stays
  // open on purpose, and without a count it looks like nothing happened.
  const [added, setAdded] = useState(0);
  const [createType, { isLoading: creating }] = useCreateItemTypeMutation();

  const total = types.reduce((n, t) => n + t.items, 0);
  const headings = topLevel(types);

  /** Returns whether the type was created, so Done knows not to close on a
   *  refusal and throw away what is still in the box. */
  async function add(): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) {
      onError("Enter a name for the type, like Tiffins.");
      return false;
    }
    try {
      await createType({ name: trimmed, parent_id: parentId || null }).unwrap();
      setName("");
      setParentId("");
      setAdded((n) => n + 1);
      onError(null);
      return true;
    } catch (e) {
      onError(errorMessage(e));
      return false;
    }
  }

  function close() {
    setAdding(false);
    setName("");
    setParentId("");
    setAdded(0);
    onError(null);
  }

  /** Save and close.
   *
   *  Adding is immediate, so there is never a batch of unsaved types waiting
   *  here -- but a name typed and not submitted is real work, and closing on
   *  it silently was the whole complaint. Done commits that last one first
   *  and stays open if the server refuses it. */
  async function done() {
    if (name.trim() && !(await add())) return;
    close();
  }

  if (editing) {
    return (
      <TypesEditor
        types={types}
        onDone={() => setEditing(false)}
        onError={onError}
      />
    );
  }

  return (
    <div className="mb-6 border border-hairline bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="mr-1 flex items-center gap-1 text-xs text-muted">
          Item types
          {types.length > 0 && (
            <button
              type="button"
              aria-label="Edit item types"
              title="Rename, nest or delete item types"
              className="hover:text-ink"
              onClick={() => {
                onError(null);
                setAdding(false);
                setEditing(true);
              }}
            >
              <PencilIcon />
            </button>
          )}
        </span>

        <Chip on={filter === null} onClick={() => onFilter(null)}>
          All <span className="opacity-60">{total}</span>
        </Chip>

        {types.map((type) => {
          const kids = childrenOf(types, type.id);
          // What the filter will show, which for a heading is its own items
          // plus everything in its subcategories. The chips are filters, not
          // a sum, so each one says how many rows clicking it produces.
          const shown = type.items + kids.reduce((n, k) => n + k.items, 0);
          return (
            <Chip
              key={type.id}
              on={filter === type.id}
              nested={!!type.parent_id}
              onClick={() => onFilter(filter === type.id ? null : type.id)}
            >
              {type.name} <span className="opacity-60">{shown}</span>
            </Chip>
          );
        })}

        <button
          className="text-xs text-muted underline"
          onClick={() => {
            if (adding) {
              close();
              return;
            }
            onError(null);
            setAdding(true);
          }}
        >
          {adding ? "cancel" : "add a type"}
        </button>
      </div>

      {adding && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="field w-48 text-sm"
            placeholder="Tiffins, Thalis, Desserts…"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
          />
          {/* Offered only once there is something to nest under, so a
              restaurant setting up its first types is not asked a question
              that has one answer. */}
          {headings.length > 0 && (
            <select
              className="field w-48 text-sm"
              aria-label="Where the new type goes"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">as a heading of its own</option>
              {headings.map((h) => (
                <option key={h.id} value={h.id}>
                  inside {h.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn-primary px-3 py-1.5 text-sm"
            disabled={creating}
            onClick={() => void add()}
          >
            {creating ? "Adding…" : "Add type"}
          </button>
          {/* The way out. Add type keeps the row open so a restaurant can
              file its whole vocabulary in one pass; this is what ends that
              pass, and it saves a name still sitting in the box first. */}
          <button
            type="button"
            className="px-3 py-1.5 text-sm text-muted underline"
            disabled={creating}
            onClick={() => void done()}
          >
            Done
          </button>
        </div>
      )}

      {adding && added > 0 && (
        <p className="mt-2 text-xs text-muted">
          {added} {added === 1 ? "type" : "types"} added and saved. Add another,
          or choose Done to close this row.
        </p>
      )}
    </div>
  );
}

/** A type, its count, and whether the list below is showing only it.
 *
 *  A subcategory is indented and quieter than the heading it follows, so the
 *  strip reads as one list at two levels rather than as a row of equals. */
function Chip({
  on,
  nested = false,
  onClick,
  children,
}: {
  on: boolean;
  nested?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded border px-2.5 py-1 text-xs ${nested ? "ml-1" : ""} ${
        on
          ? "border-ink bg-ink text-white"
          : nested
            ? "border-dashed border-hairline bg-surface text-muted"
            : "border-hairline bg-surface"
      }`}
    >
      {nested && <span className="mr-1 opacity-50">└</span>}
      {children}
    </button>
  );
}

/**
 * Every type as a field, with removing staged behind Save.
 *
 * The same two-rule contract the rest of the builder keeps: removing is
 * staged so cancel is a real undo, and adding is immediate because it is not
 * destructive. A type still on items is refused by the server, and the count
 * of what is in the way comes back in its own words.
 *
 * The heading dropdown is the one control that can be refused for a reason
 * the browser cannot see. A heading that combos or modifier groups are built
 * on may not become a subcategory, because both of those read top-level
 * types only. Rather than guess at that here and get it wrong, the editor
 * stays open holding the edits and shows what the server said.
 */
function TypesEditor({
  types,
  onDone,
  onError,
}: {
  types: ItemTypeRow[];
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(types.map((t) => [t.id, t.name])),
  );
  const [parents, setParents] = useState<Record<string, string>>(() =>
    Object.fromEntries(types.map((t) => [t.id, t.parent_id ?? ""])),
  );
  const [removed, setRemoved] = useState<Record<string, true>>({});
  const [saving, setSaving] = useState(false);
  const [updateType] = useUpdateItemTypeMutation();
  const [deleteType] = useDeleteItemTypeMutation();

  const doomed = types.filter((t) => removed[t.id]);
  const headings = topLevel(types);

  async function save() {
    const jobs: (() => Promise<unknown>)[] = [];

    for (const type of types) {
      if (removed[type.id]) {
        jobs.push(() => deleteType(type.id).unwrap());
        continue; // renaming something on its way out is wasted work
      }
      const name = (names[type.id] ?? "").trim();
      if (!name) {
        onError(`${type.name} needs a name. It cannot be left blank.`);
        return;
      }
      const changes: { name?: string; parent_id?: string | null } = {};
      if (name !== type.name) changes.name = name;

      // Only sent when it actually changed, so an untouched type is never
      // refiled and the server is never asked to re-check a move nobody made.
      const parent = parents[type.id] ?? "";
      if (parent !== (type.parent_id ?? "")) changes.parent_id = parent || null;

      if (Object.keys(changes).length) {
        jobs.push(() => updateType({ typeId: type.id, changes }).unwrap());
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
      // Stays open holding the edits, so a refusal can be answered rather
      // than retyped. A type the server would not delete is the usual one,
      // and its message says how many items are in the way.
      onError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 border border-ink bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-2">
        <span className="mr-1 mt-1.5 text-xs text-muted">Item types</span>

        {types.map((type) => {
          const going = !!removed[type.id];
          const kids = childrenOf(types, type.id);
          return (
            <span
              key={type.id}
              className="flex flex-col gap-1 rounded border border-hairline px-2 py-1"
            >
              <span className="flex items-center gap-1.5">
                {going ? (
                  <span className="text-xs text-muted line-through">{type.name}</span>
                ) : (
                  <input
                    className="field w-28 text-xs"
                    value={names[type.id] ?? ""}
                    disabled={saving}
                    aria-label={`${type.name} name`}
                    onChange={(e) =>
                      setNames((n) => ({ ...n, [type.id]: e.target.value }))
                    }
                  />
                )}
                {/* Direct only. It is the number the deletion rule reads, so
                    a heading shows what is filed on the heading itself. */}
                <span className="text-[11px] text-muted">{type.items}</span>
                <button
                  className={`text-[11px] underline ${going ? "" : "text-brick"}`}
                  disabled={saving}
                  onClick={() =>
                    setRemoved((r) => {
                      const next = { ...r };
                      if (next[type.id]) delete next[type.id];
                      else next[type.id] = true;
                      return next;
                    })
                  }
                >
                  {going ? "keep it" : "delete"}
                </button>
              </span>

              {!going && (
                <select
                  className="field w-32 text-[11px]"
                  aria-label={`Where ${type.name} sits`}
                  value={parents[type.id] ?? ""}
                  // A heading with subcategories of its own cannot move
                  // under a third: a menu goes two levels deep. Moving the
                  // subcategories out first is what opens this back up.
                  disabled={saving || kids.length > 0}
                  title={
                    kids.length
                      ? `${type.name} has subcategories, so it stays a heading.`
                      : undefined
                  }
                  onChange={(e) =>
                    setParents((p) => ({ ...p, [type.id]: e.target.value }))
                  }
                >
                  <option value="">a heading</option>
                  {headings
                    .filter((h) => h.id !== type.id)
                    .map((h) => (
                      <option key={h.id} value={h.id}>
                        inside {h.name}
                      </option>
                    ))}
                </select>
              )}
            </span>
          );
        })}

        <button
          className="btn-primary mt-0.5 px-3 py-1.5 text-sm"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save types"}
        </button>
        <button
          className="mt-2 text-xs text-muted underline"
          disabled={saving}
          onClick={() => {
            onError(null);
            onDone();
          }}
        >
          cancel
        </button>
      </div>

      <p className="mt-2 text-xs text-muted">
        {doomed.length ? (
          <span className="text-brick">
            Saving will delete {doomed.length}{" "}
            {doomed.length === 1 ? "type" : "types"}. A type still on items, or
            a heading with subcategories under it, is refused, and the message
            says what is in the way.
          </span>
        ) : (
          "Renaming a type changes its heading everywhere at once. No item moves. " +
          "A subcategory is a subheading on the storefront only: combos and " +
          "modifier groups read the heading above it."
        )}
      </p>
    </div>
  );
}
