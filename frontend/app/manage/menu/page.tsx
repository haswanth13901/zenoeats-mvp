"use client";

import { useState } from "react";
import { Empty, ErrorNote, Panel, Shell } from "@/components/Shell";
import { ApiError, errorMessage } from "@/lib/api";
import { money, signedMoney } from "@/lib/format";
import { useStaffResource } from "@/lib/useStaffApi";
import type { Meal } from "@/lib/types";
import { MANAGE_NAV } from "../nav";

type Group = {
  id: string;
  name: string;
  selection_type: "SINGLE" | "MULTI";
  is_required: boolean;
  min_select: number;
  max_select: number;
  applies_to_kind: string | null;
  options: { id: string; name: string; price_delta_minor: number }[];
};

const KINDS = ["FOOD", "BEVERAGE", "SAUCE"] as const;
type Kind = (typeof KINDS)[number];

export default function MenuBuilder() {
  const menu = useStaffResource<{ meals: Meal[] }>("/menu");
  const groups = useStaffResource<Group[]>("/restaurant/modifier-groups");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"structure" | "groups">("structure");

  const refreshAll = async () => {
    await Promise.all([menu.refresh(), groups.refresh()]);
  };

  return (
    <Shell title="Menu" nav={MANAGE_NAV}>
      <ErrorNote message={error ?? menu.error ?? groups.error} />

      <div className="mb-6 flex gap-1 border-b border-hairline">
        {(["structure", "groups"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t ? "border-brick text-ink" : "border-transparent text-muted"
            }`}
          >
            {t === "structure" ? "Meals and items" : "Modifier library"}
          </button>
        ))}
      </div>

      {tab === "structure" ? (
        <Structure
          meals={menu.data?.meals ?? []}
          groups={groups.data ?? []}
          call={menu.call}
          onChange={refreshAll}
          onError={setError}
        />
      ) : (
        <GroupLibrary
          groups={groups.data ?? []}
          call={groups.call}
          onChange={refreshAll}
          onError={setError}
        />
      )}
    </Shell>
  );
}

/* ---------------------------------------------------------------- meals -- */

function Structure({
  meals,
  groups,
  call,
  onChange,
  onError,
}: {
  meals: Meal[];
  groups: Group[];
  call: <T,>(p: string, o?: { method?: string; body?: unknown }) => Promise<T>;
  onChange: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [mealName, setMealName] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await onChange();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <>
      <Panel title="Meals">
        <div className="flex gap-2">
          <input
            className="field"
            placeholder="Breakfast, Lunch, Late night…"
            value={mealName}
            onChange={(e) => setMealName(e.target.value)}
          />
          <button
            className="btn-primary shrink-0"
            disabled={!mealName.trim()}
            onClick={() =>
              run(async () => {
                await call("/restaurant/meals", {
                  method: "POST",
                  body: { name: mealName.trim(), sort_order: meals.length },
                });
                setMealName("");
              })
            }
          >
            Add meal
          </button>
        </div>
      </Panel>

      {!meals.length && <Empty>No meals yet. Add one above, then add categories to it.</Empty>}

      {meals.map((meal) => (
        <section key={meal.id} className="mb-10 border border-hairline bg-surface">
          <header className="flex items-baseline justify-between border-b border-hairline px-4 py-3">
            <h2 className="font-display text-xl">{meal.name}</h2>
            <AddCategory mealId={meal.id} call={call} onChange={onChange} onError={onError} />
          </header>

          {!meal.categories.length ? (
            <p className="px-4 py-6 text-sm text-muted">
              No categories yet. A category holds items and carries a kind:
              food, beverage or sauce.
            </p>
          ) : (
            meal.categories.map((category) => (
              <div key={category.id} className="border-b border-hairline last:border-0">
                <div className="flex items-baseline justify-between px-4 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-medium">{category.name}</h3>
                    <span className="rounded bg-paper px-1.5 py-0.5 text-[11px] text-muted">
                      {category.kind.toLowerCase()}
                    </span>
                  </div>
                  <button
                    className="text-xs text-muted underline"
                    onClick={() =>
                      setAddingTo(addingTo === category.id ? null : category.id)
                    }
                  >
                    {addingTo === category.id ? "cancel" : "add item"}
                  </button>
                </div>

                {addingTo === category.id && (
                  <AddItem
                    categoryId={category.id}
                    kind={category.kind as Kind}
                    groups={groups}
                    call={call}
                    onError={onError}
                    onDone={async () => {
                      setAddingTo(null);
                      await onChange();
                    }}
                  />
                )}

                <ul className="divide-y divide-hairline border-t border-hairline">
                  {category.items.map((item) => (
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
                        onClick={() =>
                          run(() =>
                            call(
                              `/restaurant/items/${item.id}/availability?is_available=${!item.is_available}`,
                              { method: "PATCH" }
                            )
                          )
                        }
                      >
                        {item.is_available ? "in stock" : "sold out"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      ))}
    </>
  );
}

function AddCategory({
  mealId,
  call,
  onChange,
  onError,
}: {
  mealId: string;
  call: <T,>(p: string, o?: { method?: string; body?: unknown }) => Promise<T>;
  onChange: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("FOOD");

  if (!open)
    return (
      <button className="text-xs text-muted underline" onClick={() => setOpen(true)}>
        add category
      </button>
    );

  return (
    <div className="flex gap-2">
      <input
        className="field w-40"
        placeholder="Burgers"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <select
        className="field w-32"
        value={kind}
        onChange={(e) => setKind(e.target.value as Kind)}
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k.toLowerCase()}
          </option>
        ))}
      </select>
      <button
        className="btn-primary px-3 py-1.5 text-sm"
        disabled={!name.trim()}
        onClick={async () => {
          try {
            await call("/restaurant/categories", {
              method: "POST",
              body: { meal_id: mealId, name: name.trim(), kind },
            });
            setName("");
            setOpen(false);
            await onChange();
          } catch (e) {
            onError(errorMessage(e));
          }
        }}
      >
        Add
      </button>
    </div>
  );
}

function AddItem({
  categoryId,
  kind,
  groups,
  call,
  onDone,
  onError,
}: {
  categoryId: string;
  kind: Kind;
  groups: Group[];
  call: <T,>(p: string, o?: { method?: string; body?: unknown }) => Promise<T>;
  onDone: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  // Groups whose applies_to_kind matches this category, plus universal ones.
  // Adding a beverage surfaces Ice level, not Veggies.
  const relevant = groups.filter((g) => !g.applies_to_kind || g.applies_to_kind === kind);

  return (
    <div className="grid gap-3 bg-paper px-4 py-4 sm:grid-cols-3">
      <label className="sm:col-span-2">
        <span className="text-xs text-muted">Item name</span>
        <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        <span className="text-xs text-muted">Price</span>
        <input
          className="field mt-1"
          inputMode="decimal"
          placeholder="10.95"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
      <label className="sm:col-span-3">
        <span className="text-xs text-muted">Description</span>
        <input
          className="field mt-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="sm:col-span-3">
        <p className="text-xs text-muted">Modifier groups for this item</p>
        {!relevant.length ? (
          <p className="mt-1 text-xs text-muted">
            No groups for {kind.toLowerCase()} yet. Create one in the modifier library.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {relevant.map((g) => {
              const on = selected.includes(g.id);
              return (
                <button
                  key={g.id}
                  onClick={() =>
                    setSelected((prev) =>
                      on ? prev.filter((x) => x !== g.id) : [...prev, g.id]
                    )
                  }
                  className={`rounded border px-2.5 py-1 text-xs ${
                    on ? "border-ink bg-ink text-white" : "border-hairline bg-surface"
                  }`}
                >
                  {g.name}
                  {g.is_required && <span className="ml-1 opacity-60">required</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="sm:col-span-3">
        <button
          className="btn-primary"
          disabled={!name.trim() || !price}
          onClick={async () => {
            try {
              await call("/restaurant/items", {
                method: "POST",
                body: {
                  category_id: categoryId,
                  name: name.trim(),
                  description: description.trim() || null,
                  // Prices are entered in major units and converted once,
                  // here. Everything past this point is integer minor units.
                  base_price_minor: Math.round(parseFloat(price) * 100),
                  modifier_group_ids: selected,
                },
              });
              await onDone();
            } catch (e) {
              onError(errorMessage(e));
            }
          }}
        >
          Add item
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- modifier groups -- */

function GroupLibrary({
  groups,
  call,
  onChange,
  onError,
}: {
  groups: Group[];
  call: <T,>(p: string, o?: { method?: string; body?: unknown }) => Promise<T>;
  onChange: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"SINGLE" | "MULTI">("MULTI");
  const [required, setRequired] = useState(false);
  const [maxSelect, setMaxSelect] = useState("3");
  const [appliesTo, setAppliesTo] = useState<Kind | "">("");
  const [optionText, setOptionText] = useState("");

  async function create() {
    // "Lettuce", "Jalapenos +0.50" -> options with deltas
    const options = optionText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        const match = line.match(/^(.*?)\s*([+-]\s*[\d.]+)?$/);
        const label = (match?.[1] ?? line).trim();
        const delta = match?.[2] ? Math.round(parseFloat(match[2].replace(/\s/g, "")) * 100) : 0;
        return { name: label, price_delta_minor: delta, is_default: false, sort_order: i };
      });

    try {
      await call("/restaurant/modifier-groups", {
        method: "POST",
        body: {
          name: name.trim(),
          selection_type: type,
          is_required: required,
          min_select: required ? 1 : 0,
          max_select: type === "SINGLE" ? 1 : parseInt(maxSelect || "1", 10),
          applies_to_kind: appliesTo || null,
          options,
        },
      });
      setName("");
      setOptionText("");
      await onChange();
    } catch (e) {
      onError(errorMessage(e));
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
          <label>
            <span className="text-xs text-muted">Shows on</span>
            <select
              className="field mt-1"
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value as Kind | "")}
            >
              <option value="">Everything</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.toLowerCase()}
                </option>
              ))}
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

          <label className="sm:col-span-4">
            <span className="text-xs text-muted">
              Options, one per line. Add a price change at the end if there is one.
            </span>
            <textarea
              className="field mt-1 font-mono text-sm"
              rows={5}
              placeholder={"Lettuce\nTomato\nJalapenos +0.50\nNo cheese -0.50"}
              value={optionText}
              onChange={(e) => setOptionText(e.target.value)}
            />
          </label>

          <div className="sm:col-span-4">
            <button
              className="btn-primary"
              disabled={!name.trim() || !optionText.trim()}
              onClick={create}
            >
              Create group
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Library">
        {!groups.length ? (
          <Empty>
            No groups yet. Create one and it becomes reusable across every item.
          </Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.id} className="border border-hairline bg-surface p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">{g.name}</h3>
                  <span className="text-xs text-muted">
                    {g.selection_type === "SINGLE" ? "pick one" : `up to ${g.max_select}`}
                    {g.is_required && " · required"}
                  </span>
                </div>
                {g.applies_to_kind && (
                  <p className="mt-0.5 text-xs text-muted">
                    shows on {g.applies_to_kind.toLowerCase()} items
                  </p>
                )}
                <ul className="mt-2 divide-y divide-hairline border-t border-hairline text-sm">
                  {g.options.map((o) => (
                    <li key={o.id} className="flex justify-between py-1.5">
                      <span>{o.name}</span>
                      <span className="tnum text-muted">
                        {signedMoney(o.price_delta_minor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
