import { useState } from "react";
import { Empty, ErrorNote, Panel } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import {
  useRestaurantReportsQuery,
  type ReportRange,
  type RestaurantReport,
} from "@/features/restaurant/restaurantApi";
import { errorMessage } from "@/services/apiClient";
import { money } from "@/utils/format";

type Preset = "today" | "yesterday" | "last7" | "month" | "custom";

const PRESETS: { id: Exclude<Preset, "custom">; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
  { id: "month", label: "This month" },
];

/**
 * Takings for a range of the restaurant's days.
 *
 * "Today" is the restaurant's today, which the report itself says: the first
 * load asks for nothing and the server answers with its date and timezone.
 * The other presets count back from that date rather than from the browser's
 * clock, which may be on a laptop in another timezone, or wrong.
 */
export function ReportsPage() {
  const [range, setRange] = useState<ReportRange>({});
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const { data, error, isLoading, isFetching } = useRestaurantReportsQuery(range, {
    pollingInterval: 60_000,
  });

  // Known after the first answer; the presets wait for it.
  const today = data?.today;

  function choose(next: Exclude<Preset, "custom">) {
    if (!today) return;
    setPreset(next);
    if (next === "today") setRange({});
    if (next === "yesterday") setRange({ from: shift(today, -1), to: shift(today, -1) });
    if (next === "last7") setRange({ from: shift(today, -6), to: today });
    if (next === "month") setRange({ from: `${today.slice(0, 8)}01`, to: today });
  }

  return (
    <ManageShell>
      <ErrorNote message={error ? errorMessage(error) : null} />

      <div className="mb-6 flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`rounded px-3 py-1.5 text-sm ${
              preset === p.id ? "bg-ink text-white" : "border border-hairline text-muted"
            }`}
            disabled={!today}
            onClick={() => choose(p.id)}
          >
            {p.label}
          </button>
        ))}
        <button
          className={`rounded px-3 py-1.5 text-sm ${
            preset === "custom" ? "bg-ink text-white" : "border border-hairline text-muted"
          }`}
          disabled={!today}
          onClick={() => {
            setPreset("custom");
            setCustomFrom(data?.from ?? "");
            setCustomTo(data?.to ?? "");
          }}
        >
          Choose dates
        </button>
        {preset === "custom" && (
          <span className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted">
              From
              <input
                type="date"
                className="field mt-1 py-1 text-sm"
                value={customFrom}
                max={today}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label className="text-xs text-muted">
              To
              <input
                type="date"
                className="field mt-1 py-1 text-sm"
                value={customTo}
                max={today}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
            <button
              className="btn-primary px-3 py-1.5 text-sm"
              disabled={!customFrom || !customTo}
              onClick={() => setRange({ from: customFrom, to: customTo })}
            >
              Show
            </button>
          </span>
        )}
      </div>

      {isLoading || !data ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className={isFetching ? "opacity-60" : undefined}>
          <p className="mb-4 text-sm text-muted">
            {describe(data)} · days in {data.timezone}
          </p>

          <div className="mb-px grid grid-cols-2 gap-px border border-hairline bg-hairline sm:grid-cols-4">
            <Stat label="Net sales" value={money(data.net_sales_minor, data.currency)} />
            <Stat label="Paid orders" value={String(data.orders_paid)} />
            <Stat
              label="Average order"
              value={money(data.average_order_value_minor, data.currency)}
            />
            <Stat label="Tax collected" value={money(data.tax_collected_minor, data.currency)} />
          </div>
          <div className="mb-10 grid grid-cols-2 gap-px border border-t-0 border-hairline bg-hairline sm:grid-cols-4">
            <Stat small label="Gross sales" value={money(data.gross_sales_minor, data.currency)} />
            <Stat
              small
              label={`Refunds (${data.orders_refunded} ${data.orders_refunded === 1 ? "order" : "orders"})`}
              value={money(data.refunds_minor, data.currency)}
            />
            <Stat
              small
              label="Combo discounts"
              value={money(data.combo_discounts_minor, data.currency)}
            />
            <Stat small label="Cancelled orders" value={String(data.orders_cancelled)} />
          </div>

          {data.from !== data.to && (
            <Panel title="By day">
              {!data.by_day.length ? (
                <Empty>No paid orders in this range.</Empty>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-hairline text-left text-xs text-muted">
                      <th className="py-2 font-medium">Day</th>
                      <th className="text-right font-medium">Orders</th>
                      <th className="text-right font-medium">Gross</th>
                      <th className="text-right font-medium">Refunds</th>
                      <th className="text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {data.by_day.map((day) => (
                      <tr key={day.date}>
                        <td className="py-2.5">{dayLabel(day.date)}</td>
                        <td className="tnum text-right">{day.orders}</td>
                        <td className="tnum text-right">{money(day.gross_minor, data.currency)}</td>
                        <td className="tnum text-right">
                          {day.refunds_minor ? money(day.refunds_minor, data.currency) : "—"}
                        </td>
                        <td className="tnum text-right">{money(day.net_minor, data.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          )}

          {data.orders_delivery > 0 && (
            <Panel title={`Deliveries (${data.orders_delivery})`}>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-hairline text-left text-xs text-muted">
                    <th className="py-2 font-medium">Driver</th>
                    <th className="text-right font-medium">Orders</th>
                    <th className="text-right font-medium">Delivered</th>
                    <th className="text-right font-medium">Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {data.by_driver.map((row) => (
                    <tr key={row.driver}>
                      <td className="py-2.5">{row.driver}</td>
                      <td className="tnum text-right">{row.orders}</td>
                      <td className="tnum text-right">{row.delivered}</td>
                      <td className="tnum text-right">
                        {money(row.gross_minor, data.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-hairline text-sm">
                    <td className="py-2.5">All deliveries</td>
                    <td className="tnum text-right">{data.orders_delivery}</td>
                    <td className="tnum text-right">{data.orders_delivered}</td>
                    <td className="tnum text-right">
                      {money(data.delivery_sales_minor, data.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="mt-2 text-xs text-muted">
                Part of the sales above, not on top of them. A delivery counts on the day
                it was paid, like any other order.
              </p>
            </Panel>
          )}

          <Panel title="Top items">
            {!data.top_items.length ? (
              <Empty>No paid orders in this range.</Empty>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-hairline text-left text-xs text-muted">
                    <th className="py-2 font-medium">Item</th>
                    <th className="text-right font-medium">Units</th>
                    <th className="text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {data.top_items.map((item) => (
                    <tr key={item.name}>
                      <td className="py-2.5">{item.name}</td>
                      <td className="tnum text-right">{item.units}</td>
                      <td className="tnum text-right">
                        {money(item.revenue_minor, data.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-muted">
              Leaves out cancelled and fully refunded orders. Revenue is before combo
              discounts.
            </p>
          </Panel>

          <Panel title="Checkouts that did not complete">
            <div className="flex gap-8 text-sm">
              <div>
                <span className="tnum font-display text-2xl">{data.orders_pending_payment}</span>
                <p className="text-xs text-muted">waiting on payment right now</p>
              </div>
              <div>
                <span className="tnum font-display text-2xl">{data.orders_expired}</span>
                <p className="text-xs text-muted">expired unpaid in this range</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">
              Expired checkouts were never charged. A steady climb here usually means
              something is failing at the card step, not that customers changed their
              minds.
            </p>
          </Panel>
        </div>
      )}
    </ManageShell>
  );
}

/** Local to this page: the platform dashboard's Stat has different padding and
 *  type scale, and unifying them would change one of the two designs. */
function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-surface px-4 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`tnum mt-1 font-display ${small ? "text-lg" : "text-2xl"}`}>{value}</p>
    </div>
  );
}

/** Dates here are the restaurant's calendar dates, not instants, so they are
 *  handled at midnight UTC and formatted in UTC: nothing about the browser's
 *  own timezone can move them a day. */
function toUtcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function shift(iso: string, days: number): string {
  const date = toUtcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  return toUtcDate(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function describe(report: RestaurantReport): string {
  if (report.from === report.to) {
    return report.from === report.today ? `Today, ${dayLabel(report.from)}` : dayLabel(report.from);
  }
  return `${dayLabel(report.from)} to ${dayLabel(report.to)}`;
}
