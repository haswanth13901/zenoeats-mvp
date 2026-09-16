import { useEffect, useState } from "react";
import { ErrorNote, Panel } from "@/components/common/Feedback";
import {
  useDeliverySettingsQuery,
  useLocateRestaurantMutation,
  useSetDeliveryEnabledMutation,
  useSetDeliveryZonesMutation,
  type DeliverySettings,
} from "@/features/restaurant/restaurantApi";
import { errorMessage } from "@/services/apiClient";

/**
 * Where the restaurant delivers, and what it charges.
 *
 * Three things in a deliberate order, because they only make sense that way:
 * place the restaurant on the map, draw the rings, then switch delivery on.
 * The switch is last and the API refuses it early, so this panel shows what is
 * still missing rather than letting someone flip a toggle that does nothing.
 *
 * A ring is typed as its outer edge and a fee. The inner edge is never a free
 * choice -- a gap between rings would be an address that can be neither
 * charged for nor refused -- so the display fills it in and the form does not
 * ask for it.
 */
export function DeliveryArea() {
  const settings = useDeliverySettingsQuery();
  const data = settings.data;

  if (settings.isLoading) {
    return (
      <Panel title="Delivery">
        <p className="bg-surface px-5 py-5 text-sm text-muted">Loading…</p>
      </Panel>
    );
  }
  if (!data) {
    return (
      <Panel title="Delivery">
        <ErrorNote message={errorMessage(settings.error) || "Could not load delivery settings."} />
      </Panel>
    );
  }

  return (
    <Panel title="Delivery">
      <div className="divide-y divide-hairline bg-surface">
        <Status data={data} />
        <Origin data={data} />
        <Rings data={data} />
      </div>
    </Panel>
  );
}

function Status({ data }: { data: DeliverySettings }) {
  const [setEnabled, { isLoading }] = useSetDeliveryEnabledMutation();
  const [error, setError] = useState<string | null>(null);

  // What is missing, minus "it is switched off" -- which is the switch's own
  // business and would read as a reason it cannot be switched on.
  const missing = data.blockers.filter((b) => !b.startsWith("Delivery is switched off"));
  const ready = missing.length === 0;

  return (
    <div className="px-5 py-5">
      <ErrorNote message={error} />
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          disabled={isLoading || (!ready && !data.delivery_enabled)}
          checked={data.delivery_enabled}
          onChange={async (e) => {
            setError(null);
            try {
              await setEnabled(e.target.checked).unwrap();
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        />
        <span>
          Offer delivery at checkout
          <span className="block text-muted">
            Customers choose delivery, give an address, and are charged the fee for the ring it
            falls in. Collection stays available either way.
          </span>
        </span>
      </label>

      {missing.length > 0 && (
        <ul className="mt-3 space-y-1 border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick">
          {missing.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
      {data.delivery_enabled && !ready && (
        <p className="mt-2 text-sm text-brick">
          Delivery is switched on but nothing can be quoted, so customers are being offered
          collection only until this is fixed.
        </p>
      )}
    </div>
  );
}

function Origin({ data }: { data: DeliverySettings }) {
  const [locate, { isLoading }] = useLocateRestaurantMutation();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="px-5 py-5 text-sm">
      <div className="font-medium">Where distances are measured from</div>
      <ErrorNote message={error} />

      {!data.pickup_address ? (
        <p className="mt-1 text-muted">
          Add the restaurant&apos;s address above, then place it on the map.
        </p>
      ) : (
        <>
          <p className="mt-1 text-muted">{data.pickup_address}</p>
          {data.origin_is_current ? (
            <p className="mt-1 text-xs text-muted">
              Placed at {data.latitude?.toFixed(5)}, {data.longitude?.toFixed(5)}.
            </p>
          ) : (
            <p className="mt-2 border-l-2 border-brick bg-brick/5 px-3 py-2 text-brick">
              {data.geocoded_address
                ? "The address changed since this was last placed, so delivery is paused until it is placed again. Distances from the old address would have charged the wrong fee."
                : "Not placed yet."}
            </p>
          )}

          {!data.geocoding_configured ? (
            <p className="mt-2 text-xs text-muted">
              Address lookup is not configured on this deployment, so the restaurant cannot be
              placed and delivery cannot be switched on.
            </p>
          ) : (
            <button
              className="btn-quiet mt-3"
              disabled={isLoading}
              onClick={async () => {
                setError(null);
                try {
                  await locate().unwrap();
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              {isLoading ? "Placing…" : data.origin_is_current ? "Place again" : "Place on the map"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

type Draft = { max_miles: string; fee: string };

function Rings({ data }: { data: DeliverySettings }) {
  const [save, { isLoading }] = useSetDeliveryZonesMutation();
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fromServer: Draft[] = data.zones.map((z) => ({
    max_miles: String(z.max_miles),
    fee: (z.fee_minor / 100).toFixed(2),
  }));
  const draft = rows ?? fromServer;

  // Back to the server's answer whenever it changes under us, so another
  // admin's save is not silently overwritten by a stale form.
  useEffect(() => {
    setRows(null);
  }, [data.zones]);

  function edit(index: number, patch: Partial<Draft>) {
    setSaved(false);
    setRows(draft.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const sorted = [...draft].sort(byMiles);
  const dirty = JSON.stringify(draft) !== JSON.stringify(fromServer);

  return (
    <div className="px-5 py-5 text-sm">
      <div className="font-medium">Rings</div>
      <p className="mt-1 text-muted">
        Each ring is how far it reaches and what it costs. Anywhere past the furthest ring is not
        delivered to.
      </p>
      <ErrorNote message={error} />

      {draft.length === 0 ? (
        <p className="mt-3 border border-dashed border-hairline px-4 py-6 text-center text-muted">
          No rings yet, so nothing can be delivered.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {draft.map((row, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-muted">{bandLabel(sorted, row)}</span>
              <span className="text-muted">up to</span>
              <input
                className="field w-24"
                inputMode="decimal"
                value={row.max_miles}
                onChange={(e) => edit(index, { max_miles: e.target.value })}
              />
              <span className="text-muted">miles ·</span>
              <input
                className="field w-28"
                inputMode="decimal"
                value={row.fee}
                onChange={(e) => edit(index, { fee: e.target.value })}
              />
              <span className="text-muted">{data.currency}</span>
              <button
                className="text-muted underline"
                onClick={() => {
                  setSaved(false);
                  setRows(draft.filter((_, i) => i !== index));
                }}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className="btn-quiet"
          onClick={() => {
            setSaved(false);
            setRows([...draft, { max_miles: "", fee: "" }]);
          }}
        >
          Add a ring
        </button>
        <button
          className="btn-primary"
          disabled={!dirty || isLoading}
          onClick={async () => {
            setError(null);
            const zones = draft
              .map((row) => ({
                max_miles: Number.parseFloat(row.max_miles),
                fee_minor: Math.round(Number.parseFloat(row.fee || "0") * 100),
              }))
              .filter((z) => Number.isFinite(z.max_miles) && Number.isFinite(z.fee_minor));
            if (zones.length !== draft.length) {
              setError("Every ring needs a distance and a fee.");
              return;
            }
            try {
              await save({ zones }).unwrap();
              setRows(null);
              setSaved(true);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          {isLoading ? "Saving…" : "Save rings"}
        </button>
        {saved && !dirty && <span className="text-muted">Saved.</span>}
      </div>
    </div>
  );
}

function byMiles(a: Draft, b: Draft) {
  return (Number.parseFloat(a.max_miles) || 0) - (Number.parseFloat(b.max_miles) || 0);
}

/** "0–2 mi" for the innermost ring, "2–5 mi" for the next: the inner edge is
 *  the previous ring's outer one, which the restaurant never types. */
function bandLabel(sorted: Draft[], row: Draft): string {
  const index = sorted.indexOf(row);
  if (index < 0 || !row.max_miles) return "—";
  const from = index === 0 ? 0 : Number.parseFloat(sorted[index - 1]?.max_miles ?? "") || 0;
  return `${from}–${row.max_miles} mi`;
}
