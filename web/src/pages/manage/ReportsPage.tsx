import { useState, type ReactNode } from "react";
import { Empty, ErrorNote, Loading, Panel, Stat, StatGrid } from "@/components/common/Feedback";
import { PageTitle } from "@/components/layout/Shell";
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
 *
 * While a new range loads, the previous figures stay on screen, dimmed, rather
 * than blanking: a manager comparing two ranges keeps the first in view.
 */
export function ReportsPage() {
  const [range, setRange] = useState<ReportRange>({});
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const { data, error, isLoading, isFetching } = useRestaurantReportsQuery(range, {
    pollingInterval: 60_000,
  });

  // Known after the first answer; the presets wait for it.
  const today = data?.today;

  function choose(next: Exclude<Preset, "custom">) {
    if (!today) return;
    setRangeError(null);
    setPreset(next);
    if (next === "today") setRange({});
    if (next === "yesterday") setRange({ from: shift(today, -1), to: shift(today, -1) });
    if (next === "last7") setRange({ from: shift(today, -6), to: today });
    if (next === "month") setRange({ from: `${today.slice(0, 8)}01`, to: today });
  }

  return (
    <ManageShell>
      <PageTitle title="Reports" subtitle="A clear view of your restaurant’s days." />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Report range">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip"
            aria-pressed={preset === p.id}
            disabled={!today}
            onClick={() => choose(p.id)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          aria-pressed={preset === "custom"}
          disabled={!today}
          onClick={() => {
            setPreset("custom");
            setCustomFrom(data?.from ?? "");
            setCustomTo(data?.to ?? "");
          }}
        >
          Choose dates
        </button>
      </div>

      {preset === "custom" && (
        <form
          className="mt-3 grid max-w-[600px] animate-disclose grid-cols-2 items-end gap-[15px] sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!customFrom || !customTo) return;
            if (customFrom > customTo) {
              setRangeError("Choose a start date on or before the end date.");
              return;
            }
            setRangeError(null);
            setRange({ from: customFrom, to: customTo });
          }}
        >
          <label className="block">
            <span className="label">From</span>
            <input
              type="date"
              className="field mt-[7px]"
              value={customFrom}
              max={today}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">To</span>
            <input
              type="date"
              className="field mt-[7px]"
              value={customTo}
              max={today}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </label>
          <button type="submit" className="btn-primary col-span-2 sm:col-span-1" disabled={!customFrom || !customTo}>
            Show
          </button>
          <ErrorNote message={rangeError} className="col-span-full" />
        </form>
      )}

      <ErrorNote message={error ? errorMessage(error) : null} className="mt-4" />

      {isLoading || !data ? (
        <div className="mt-6">
          <Loading />
        </div>
      ) : (
        <>
          <p className="mt-3 text-caption text-muted" aria-live="polite">
            {describe(data)} · days in {data.timezone}
            {isFetching && " · Updating range…"}
          </p>
          <div
            className={`mt-6 transition-opacity duration-color ${isFetching ? "opacity-[.48]" : ""}`}
            aria-busy={isFetching}
          >
            <StatGrid className="grid-cols-2 lg:grid-cols-4">
              <Stat label="Net sales" value={money(data.net_sales_minor, data.currency)} />
              <Stat label="Paid orders" value={String(data.orders_paid)} />
              <Stat label="Average order" value={money(data.average_order_value_minor, data.currency)} />
              <Stat label="Tax collected" value={money(data.tax_collected_minor, data.currency)} />
            </StatGrid>
            <StatGrid className="mb-9 mt-3 grid-cols-2 lg:grid-cols-4">
              <SmallStat label="Gross sales" value={money(data.gross_sales_minor, data.currency)} />
              <SmallStat
                label={`Refunds (${data.orders_refunded} ${data.orders_refunded === 1 ? "order" : "orders"})`}
                value={money(data.refunds_minor, data.currency)}
              />
              <SmallStat label="Combo discounts" value={money(data.combo_discounts_minor, data.currency)} />
              <SmallStat label="Cancelled orders" value={String(data.orders_cancelled)} />
            </StatGrid>

            {data.from !== data.to && (
              <Panel title="By day">
                {!data.by_day.length ? (
                  <Empty>No paid orders in this range.</Empty>
                ) : (
                  <TableCard>
                    <table className="data-table min-w-[500px]">
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th className="text-right">Orders</th>
                          <th className="text-right">Gross</th>
                          <th className="text-right">Refunds</th>
                          <th className="text-right">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.by_day.map((day) => (
                          <tr key={day.date}>
                            <td>{dayLabel(day.date)}</td>
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
                  </TableCard>
                )}
              </Panel>
            )}

            {data.orders_delivery > 0 && (
              <Panel title={`Deliveries (${data.orders_delivery})`}>
                <TableCard
                  note="Part of the sales above, not on top of them. A delivery counts on the day it was paid, like any other order."
                >
                  <table className="data-table min-w-[500px]">
                    <thead>
                      <tr>
                        <th>Driver</th>
                        <th className="text-right">Orders</th>
                        <th className="text-right">Delivered</th>
                        <th className="text-right">Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_driver.map((row) => (
                        <tr key={row.driver}>
                          <td>{row.driver}</td>
                          <td className="tnum text-right">{row.orders}</td>
                          <td className="tnum text-right">{row.delivered}</td>
                          <td className="tnum text-right">{money(row.gross_minor, data.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="font-semibold">All deliveries</td>
                        <td className="tnum text-right">{data.orders_delivery}</td>
                        <td className="tnum text-right">{data.orders_delivered}</td>
                        <td className="tnum text-right">{money(data.delivery_sales_minor, data.currency)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </TableCard>
              </Panel>
            )}

            <Panel title="Top items">
              <TableCard note="Leaves out cancelled and fully refunded orders. Revenue is before combo discounts.">
                {!data.top_items.length ? (
                  <Empty>No paid orders in this range.</Empty>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="text-right">Units</th>
                        <th className="text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_items.map((item) => (
                        <tr key={item.name}>
                          <td>{item.name}</td>
                          <td className="tnum text-right">{item.units}</td>
                          <td className="tnum text-right">{money(item.revenue_minor, data.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </TableCard>
            </Panel>

            <Panel title="Checkouts that did not complete">
              <div className="card">
                <div className="grid grid-cols-2 gap-6 sm:gap-[30px]">
                  <div>
                    <strong className="tnum my-2 block font-display text-4xl font-normal">
                      {data.orders_pending_payment}
                    </strong>
                    <p className="text-sm">waiting on payment right now</p>
                  </div>
                  <div>
                    <strong className="tnum my-2 block font-display text-4xl font-normal">
                      {data.orders_expired}
                    </strong>
                    <p className="text-sm">expired unpaid in this range</p>
                  </div>
                </div>
                <p className="field-hint mt-6">
                  Expired checkouts were never charged. A steady climb here usually means something
                  is failing at the card step, not that customers changed their minds.
                </p>
              </div>
            </Panel>
          </div>
        </>
      )}
    </ManageShell>
  );
}

/** The four smaller figures under the headline ones: body type, not display. */
function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface p-[18px] sm:p-[23px]">
      <p className="text-caption text-muted">{label}</p>
      <p className="tnum mt-2 text-[21px] leading-snug sm:text-[23px]">{value}</p>
    </div>
  );
}

/** A table on a white card that scrolls sideways within itself on a phone. */
function TableCard({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="card">
      <div className="overflow-x-auto">{children}</div>
      {note && <p className="field-hint">{note}</p>}
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
