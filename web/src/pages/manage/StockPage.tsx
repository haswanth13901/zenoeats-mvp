import { useState, type ReactNode } from "react";
import { Empty, ErrorNote, Loading, Spinner } from "@/components/common/Feedback";
import { PageTitle } from "@/components/layout/Shell";
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
  // The row moves section once the server agrees; this says where it went.
  const [announcement, setAnnouncement] = useState("");

  async function toggle(item: StockItem) {
    setBusy(item.id);
    setError(null);
    try {
      await setAvailability({ itemId: item.id, is_available: !item.is_available }).unwrap();
      setAnnouncement(`${item.name} is ${item.is_available ? "sold out" : "back in stock"}.`);
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
      <PageTitle title="Stock" subtitle="Keep today’s menu up to date." />

      <ErrorNote message={error ?? (stock.error ? errorMessage(stock.error) : null)} />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <label className="mb-7 block sm:max-w-[510px]">
        <span className="label">Find an item</span>
        <input
          className="field mt-[7px]"
          type="search"
          placeholder="Search by item name or type"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      {stock.isLoading ? (
        <Loading />
      ) : !items.length ? (
        <Empty>No items on the menu yet.</Empty>
      ) : !shown.length ? (
        <Empty>Nothing matches “{search.trim()}”.</Empty>
      ) : (
        <>
          <Section title="Sold out" count={soldOut.length}>
            {!soldOut.length ? (
              <Empty>Everything is in stock.</Empty>
            ) : (
              soldOut.map((item) => (
                <Row key={item.id} item={item} busy={busy === item.id} onToggle={toggle} />
              ))
            )}
          </Section>
          {inStock.length > 0 && (
            <Section title="In stock" count={inStock.length}>
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

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="mb-[30px]">
      <h2 className="text-lg font-semibold">
        {title} <span className="tnum font-normal text-muted">({count})</span>
      </h2>
      <div>{children}</div>
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
    <div className="flex animate-fade items-center justify-between gap-3 border-b border-hairline py-[18px] sm:gap-6">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[15px] font-semibold sm:text-[17px]">{item.name}</h3>
        <p className="mt-[3px] text-caption text-muted">{item.type}</p>
      </div>
      {/* A large target: this gets tapped on a greasy tablet mid-rush. */}
      <button
        type="button"
        className={`${item.is_available ? "btn-quiet" : "btn-primary"} btn-touch min-w-[134px] shrink-0 px-3 text-caption sm:min-w-[155px] sm:px-[19px] sm:text-sm`}
        disabled={busy}
        aria-pressed={!item.is_available}
        onClick={() => onToggle(item)}
      >
        {busy && <Spinner />}
        {busy ? "Saving…" : item.is_available ? "Mark sold out" : "Back in stock"}
      </button>
    </div>
  );
}
