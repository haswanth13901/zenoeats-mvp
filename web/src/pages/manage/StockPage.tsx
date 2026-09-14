import { useState, type ReactNode } from "react";
import { Empty, ErrorNote } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import {
  useSetItemAvailabilityMutation,
  useStockQuery,
  type StockItem,
} from "@/features/restaurant/restaurantApi";
import { errorMessage } from "@/services/apiClient";

/**
 * The sold-out toggles, for everyone on the floor.
 *
 * The toggle used to live only in the menu builder's item list, which reads
 * the managers-only item library -- so the kitchen staff it is meant for could
 * not reach it. This page reads a list any staff role may see and does one
 * thing: flip an item between in stock and sold out, which the storefront
 * picks up on its next read.
 *
 * Sold-out items are listed first. During a rush the question is almost always
 * "what is off right now", and the answer should not need a scroll.
 */
export function StockPage() {
  // Polled, because two people can be flipping these from different devices
  // and a stale "in stock" is exactly the mistake this screen exists to stop.
  const stock = useStockQuery(undefined, { pollingInterval: 30_000 });
  const [setAvailability] = useSetItemAvailabilityMutation();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(item: StockItem) {
    setBusy(item.id);
    setError(null);
    try {
      await setAvailability({ itemId: item.id, is_available: !item.is_available }).unwrap();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const items = stock.data ?? [];
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? items.filter(
        (i) => i.name.toLowerCase().includes(needle) || i.type.toLowerCase().includes(needle),
      )
    : items;
  const soldOut = shown.filter((i) => !i.is_available);
  const inStock = shown.filter((i) => i.is_available);

  return (
    <ManageShell>
      <ErrorNote message={error ?? (stock.error ? errorMessage(stock.error) : null)} />

      <input
        className="field mb-6"
        type="search"
        placeholder="Find an item"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {stock.isLoading ? (
        <Empty>Loading…</Empty>
      ) : !items.length ? (
        <Empty>No items on the menu yet.</Empty>
      ) : !shown.length ? (
        <Empty>Nothing matches “{search.trim()}”.</Empty>
      ) : (
        <>
          <Section title={`Sold out (${soldOut.length})`}>
            {!soldOut.length ? (
              <p className="px-4 py-3 text-sm text-muted">Everything is in stock.</p>
            ) : (
              soldOut.map((item) => (
                <Row key={item.id} item={item} busy={busy === item.id} onToggle={toggle} />
              ))
            )}
          </Section>
          {inStock.length > 0 && (
            <Section title={`In stock (${inStock.length})`}>
              {inStock.map((item) => (
                <Row key={item.id} item={item} busy={busy === item.id} onToggle={toggle} />
              ))}
            </Section>
          )}
        </>
      )}
    </ManageShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      <div className="divide-y divide-hairline border border-hairline bg-surface">{children}</div>
    </section>
  );
}

function Row({
  item,
  busy,
  onToggle,
}: {
  item: StockItem;
  busy: boolean;
  onToggle: (item: StockItem) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{item.name}</div>
        <div className="text-xs text-muted">{item.type}</div>
      </div>
      {/* A large target: this gets tapped on a greasy tablet mid-rush. */}
      <button
        className={`shrink-0 px-4 py-2 text-sm ${item.is_available ? "btn-quiet" : "btn-primary"}`}
        disabled={busy}
        aria-pressed={!item.is_available}
        onClick={() => onToggle(item)}
      >
        {busy ? "Saving…" : item.is_available ? "Mark sold out" : "Back in stock"}
      </button>
    </div>
  );
}
