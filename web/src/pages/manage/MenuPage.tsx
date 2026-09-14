import { useState } from "react";
import { ErrorNote } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import { ItemLibrary } from "@/features/restaurant/components/ItemLibrary";
import { MenuPreview } from "@/features/restaurant/components/MenuPreview";
import { MealPeriods } from "@/features/restaurant/components/MealPeriods";
import { ComboBuilder } from "@/features/restaurant/components/ComboBuilder";
import { ModifierLibrary } from "@/features/restaurant/components/ModifierLibrary";
import {
  useCombosQuery,
  useItemTypesQuery,
  useItemsQuery,
  useMenuQuery,
  useModifierGroupsQuery,
} from "@/features/restaurant/restaurantApi";
import { errorMessage } from "@/services/apiClient";

const TABS = [
  { id: "preview", label: "Preview" },
  { id: "items", label: "Items" },
  { id: "periods", label: "Meal periods" },
  { id: "combos", label: "Combos" },
  { id: "groups", label: "Modifier library" },
] as const;

type Tab = (typeof TABS)[number]["id"];

/**
 * Menu builder.
 *
 * Preview first, then four tabs in the order a menu is built: what do we
 * sell, when do we serve it, what do we bundle, and what can be changed about
 * any of it. Combos come after meal periods because a combo can only offer
 * items a period already serves, so there is nothing to build until that is
 * done.
 *
 * Preview leads and is where the page opens, because it is the only tab that
 * answers what the menu now says rather than asking another question about
 * it. It edits nothing, so landing there costs a click at worst.
 *
 * Only routing between the tabs and surfacing errors lives here; the tabs
 * themselves own their forms and mutations. RTK Query tags handle the
 * refresh, so the children need no manual onChange threading.
 */
export function MenuPage() {
  const [tab, setTab] = useState<Tab>("preview");
  const [error, setError] = useState<string | null>(null);

  const menu = useMenuQuery();
  const items = useItemsQuery();
  const itemTypes = useItemTypesQuery();
  const combos = useCombosQuery();
  const groups = useModifierGroupsQuery();

  const loadError =
    (menu.error ? errorMessage(menu.error) : null) ??
    (items.error ? errorMessage(items.error) : null) ??
    (itemTypes.error ? errorMessage(itemTypes.error) : null) ??
    (combos.error ? errorMessage(combos.error) : null) ??
    (groups.error ? errorMessage(groups.error) : null);

  const meals = menu.data?.meals ?? [];
  const types = itemTypes.data ?? [];

  return (
    <ManageShell>
      <ErrorNote message={error ?? loadError} />

      <div className="mb-6 flex gap-1 border-b border-hairline">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setError(null);
              setTab(t.id);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t.id ? "border-brick text-ink" : "border-transparent text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "preview" && <MenuPreview meals={meals} types={types} />}
      {tab === "items" && (
        <ItemLibrary
          items={items.data ?? []}
          meals={meals}
          types={types}
          groups={groups.data ?? []}
          onError={setError}
        />
      )}
      {tab === "periods" && (
        <MealPeriods
          meals={meals}
          items={items.data ?? []}
          types={types}
          onError={setError}
        />
      )}
      {tab === "combos" && (
        <ComboBuilder
          combos={combos.data ?? []}
          meals={meals}
          items={items.data ?? []}
          types={types}
          onError={setError}
        />
      )}
      {tab === "groups" && (
        <ModifierLibrary groups={groups.data ?? []} types={types} onError={setError} />
      )}
    </ManageShell>
  );
}
