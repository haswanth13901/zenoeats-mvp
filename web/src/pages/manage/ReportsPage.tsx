import { Empty, ErrorNote, Panel } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import { useRestaurantReportsQuery } from "@/features/restaurant/restaurantApi";
import { errorMessage } from "@/services/apiClient";
import { money } from "@/utils/format";

export function ReportsPage() {
  const { data, error, isLoading } = useRestaurantReportsQuery(undefined, {
    pollingInterval: 60_000,
  });

  return (
    <ManageShell>
      <ErrorNote message={error ? errorMessage(error) : null} />

      {isLoading || !data ? (
        <Empty>Loading…</Empty>
      ) : (
        <>
          <div className="mb-10 grid grid-cols-2 gap-px border border-hairline bg-hairline sm:grid-cols-4">
            <Stat label="Paid orders" value={String(data.orders_paid)} />
            <Stat label="Gross revenue" value={money(data.gross_revenue_minor, data.currency)} />
            <Stat
              label="Average order"
              value={money(data.average_order_value_minor, data.currency)}
            />
            <Stat label="Tax collected" value={money(data.tax_collected_minor, data.currency)} />
          </div>

          <Panel title="Top items">
            {!data.top_items.length ? (
              <Empty>No paid orders yet.</Empty>
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
          </Panel>

          <Panel title="Checkouts that did not complete">
            <div className="flex gap-8 text-sm">
              <div>
                <span className="tnum font-display text-2xl">{data.orders_pending_payment}</span>
                <p className="text-xs text-muted">waiting on payment right now</p>
              </div>
              <div>
                <span className="tnum font-display text-2xl">{data.orders_expired}</span>
                <p className="text-xs text-muted">expired unpaid</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">
              Expired checkouts were never charged. A steady climb here usually means
              something is failing at the card step, not that customers changed their
              minds.
            </p>
          </Panel>
        </>
      )}
    </ManageShell>
  );
}

/** Local to this page: the platform dashboard's Stat has different padding and
 *  type scale, and unifying them would change one of the two designs. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="tnum mt-1 font-display text-2xl">{value}</p>
    </div>
  );
}
