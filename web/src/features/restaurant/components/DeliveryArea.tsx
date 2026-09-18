import { useState } from "react";
import { Empty, ErrorNote, Loading, SettingsHeading, Spinner } from "@/components/common/Feedback";
import { Icon } from "@/components/common/icons";
import {
  useDeliverySettingsQuery,
  useLocateRestaurantMutation,
  useSetDeliverySettingsMutation,
  useSetDeliveryZonesMutation,
  type DeliverySettings,
} from "@/features/restaurant/restaurantApi";
import { errorMessage } from "@/services/apiClient";

/** The most rings a restaurant may draw; the server refuses a ninth. */
const MAX_RINGS = 8;

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
 *
 * Every control here saves on its own: the switch, the fee-tax checkbox,
 * placing the restaurant, and Save rings. None of them touch the page's shared
 * save bar, and none of them discard a ring draft.
 *
 * `addressDirty` is the page telling this panel the trading address has been
 * edited and not yet saved. Placing now would place the old address, so the
 * button waits and says why.
 */
export function DeliveryArea({ addressDirty = false }: { addressDirty?: boolean }) {
  const settings = useDeliverySettingsQuery();
  const data = settings.data;

  return (
    <section id="settings-delivery" className="card mb-6 scroll-mt-6" aria-labelledby="settings-delivery-heading">
      <SettingsHeading
        id="settings-delivery-heading"
        title="Delivery"
        subtitle="Set the area and its fees."
      />
      <div className="mt-6">
        {settings.isLoading ? (
          <Loading />
        ) : !data ? (
          <ErrorNote
            message={errorMessage(settings.error) || "Could not load delivery settings."}
            className=""
          />
        ) : (
          <>
            <Status data={data} />
            <hr className="my-6 border-hairline" />
            <Origin data={data} addressDirty={addressDirty} />
            <hr className="my-6 border-hairline" />
            <Rings data={data} />
            <hr className="my-6 border-hairline" />
            <FeeTax data={data} />
          </>
        )}
      </div>
    </section>
  );
}

function Status({ data }: { data: DeliverySettings }) {
  const [save, { isLoading }] = useSetDeliverySettingsMutation();
  const [error, setError] = useState<string | null>(null);

  // What is missing, minus "it is switched off" -- which is the switch's own
  // business and would read as a reason it cannot be switched on.
  const missing = data.blockers.filter((b) => !b.startsWith("Delivery is switched off"));
  const ready = missing.length === 0;

  return (
    <div>
      <ErrorNote message={error} />
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0"
          disabled={isLoading || (!ready && !data.delivery_enabled)}
          checked={data.delivery_enabled}
          aria-describedby={missing.length ? "delivery-missing" : undefined}
          onChange={async (e) => {
            setError(null);
            try {
              await save({ delivery_enabled: e.target.checked }).unwrap();
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        />
        <span>
          <span className="font-semibold">Offer delivery at checkout</span>
          {isLoading && <Spinner className="ml-2 align-[-2px]" />}
          <span className="field-hint block">
            Customers choose delivery, give an address, and are charged the fee for the ring it
            falls in. Collection stays available either way.
          </span>
        </span>
      </label>

      {missing.length > 0 && (
        <ul id="delivery-missing" className="note-error mt-3 flex flex-col gap-1">
          {missing.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
      {data.delivery_enabled && !ready && (
        <p className="note-error mt-3" role="alert">
          Delivery is switched on but nothing can be quoted, so customers are being offered
          collection only until this is fixed.
        </p>
      )}
    </div>
  );
}

/**
 * Whether the fee is taxed.
 *
 * Delivery charges are taxable in some states and not others, so there is no
 * default that is right for everyone and the restaurant has to answer. Under
 * Stripe Tax nobody answers it: Stripe is told the amount and decides for the
 * jurisdiction, which is the reason to be on Stripe Tax, so the switch is
 * replaced by a sentence saying so rather than left there doing nothing.
 */
function FeeTax({ data }: { data: DeliverySettings }) {
  const [save, { isLoading }] = useSetDeliverySettingsMutation();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <h3 className="text-base font-semibold">Delivery fee tax</h3>
      {data.tax_mode === "STRIPE_TAX" ? (
        <p className="field-hint max-w-prose">
          Stripe works out whether delivery is taxed where you are, along with the rest of the tax
          on each order.
        </p>
      ) : (
        <div className="mt-3">
          <ErrorNote message={error} />
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0"
              disabled={isLoading}
              checked={data.delivery_fee_taxable}
              onChange={async (e) => {
                setError(null);
                try {
                  await save({ delivery_fee_taxable: e.target.checked }).unwrap();
                } catch (err) {
                  setError(errorMessage(err));
                }
              }}
            />
            <span>
              Charge tax on the delivery fee
              {isLoading && <Spinner className="ml-2 align-[-2px]" />}
              <span className="field-hint block max-w-prose">
                Some states tax delivery and some do not. If you are unsure, ask whoever files your
                sales tax — this changes what customers are charged.
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

function Origin({ data, addressDirty }: { data: DeliverySettings; addressDirty: boolean }) {
  const [locate, { isLoading }] = useLocateRestaurantMutation();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="text-sm">
      <h3 className="text-base font-semibold">Where distances are measured from</h3>

      {!data.pickup_address ? (
        <p className="field-hint">Add the restaurant&apos;s address above, then place it on the map.</p>
      ) : (
        <>
          <p className="mt-2">{data.pickup_address}</p>
          {data.origin_is_current ? (
            <p className="mt-1 text-caption text-muted">
              Placed at {data.latitude?.toFixed(5)}, {data.longitude?.toFixed(5)}.
            </p>
          ) : (
            <p className="note-error mt-3">
              {data.geocoded_address
                ? "The address changed since this was last placed, so delivery is paused until it is placed again. Distances from the old address would have charged the wrong fee."
                : "Not placed yet."}
            </p>
          )}

          {addressDirty && (
            <p className="note-warning mt-3">
              Save the new trading address first. Delivery will pause until that address is
              placed again.
            </p>
          )}

          {/* No lookup configured: a sentence rather than a button that could
              only fail. A lookup that refuses comes back as the server's own
              message, which is ours to fix and deliberately says so. */}
          {!data.geocoding_configured ? (
            <p className="note mt-3">
              Address lookup is not configured on this deployment, so the restaurant cannot be
              placed and delivery cannot be switched on.
            </p>
          ) : (
            <button
              type="button"
              className="btn-quiet mt-3"
              disabled={isLoading || addressDirty}
              onClick={async () => {
                setError(null);
                try {
                  await locate().unwrap();
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              {isLoading && <Spinner />}
              {isLoading ? "Placing…" : data.origin_is_current ? "Place again" : "Place on the map"}
            </button>
          )}
          <ErrorNote message={error} className="mt-3" />
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

  // Deliberately no resync from the server while rows are being edited.
  //
  // Four mutations invalidate the Delivery tag -- placing the restaurant, the
  // switch, the fee-tax checkbox and a profile save -- and three of them are
  // on this very screen. Resetting the draft when fresh data arrives meant
  // typing three rings, ticking "charge tax on the delivery fee" just above,
  // and watching the rings vanish. The draft returns to the server's answer
  // when a save succeeds, which is the only moment the two are known to agree.

  function edit(index: number, patch: Partial<Draft>) {
    setSaved(false);
    setRows(draft.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const sorted = [...draft].sort(byMiles);
  const dirty = JSON.stringify(draft) !== JSON.stringify(fromServer);
  const full = draft.length >= MAX_RINGS;

  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Distance rings</h3>
        <span className="text-caption text-muted">
          {draft.length} of {MAX_RINGS} rings
        </span>
      </div>
      <p className="field-hint max-w-prose">
        Type the outer edge only: each ring starts where the last one ends. Anywhere past the
        furthest ring is not delivered to.
      </p>

      {draft.length === 0 ? (
        <div className="mt-3">
          <Empty>No rings yet, so nothing can be delivered.</Empty>
        </div>
      ) : (
        <ul className="mt-3 grid gap-3">
          {draft.map((row, index) => (
            <li
              key={index}
              className="grid animate-fade grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] items-end gap-2.5 rounded-[12px] border border-hairline bg-paper p-[13px] sm:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)_44px] sm:gap-3 sm:p-[15px]"
            >
              {/* Computed from the outer edges, never typed. */}
              <span className="col-span-full text-caption font-[650] sm:col-span-1 sm:self-center">
                {bandLabel(sorted, row)}
              </span>
              <label className="block min-w-0">
                <span className="label">Up to · miles</span>
                <input
                  className="field tnum mt-[7px]"
                  inputMode="decimal"
                  value={row.max_miles}
                  onChange={(e) => edit(index, { max_miles: e.target.value })}
                />
              </label>
              <label className="block min-w-0">
                <span className="label">Fee · {data.currency}</span>
                <input
                  className="field tnum mt-[7px]"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={row.fee}
                  aria-invalid={error !== null && !row.fee.trim() ? true : undefined}
                  onChange={(e) => edit(index, { fee: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="icon-btn h-10 w-10 sm:h-11 sm:w-11"
                aria-label={`Remove ring ${index + 1}`}
                onClick={() => {
                  setSaved(false);
                  setRows(draft.filter((_, i) => i !== index));
                }}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ErrorNote message={error} className="mt-3" />

      <div className="mt-3 flex flex-wrap items-center gap-3" aria-live="polite">
        <button
          type="button"
          className="btn-quiet"
          disabled={full}
          onClick={() => {
            setSaved(false);
            setRows([...draft, { max_miles: "", fee: "" }]);
          }}
        >
          <Icon name="plus" className="h-4 w-4" />
          Add a ring
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || isLoading}
          onClick={async () => {
            setError(null);
            // No `|| "0"` on the fee. It used to be there, and it turned a
            // ring someone forgot to price into free delivery for that whole
            // band, silently, while the error below claimed to prevent it.
            const zones = draft.map((row) => ({
              max_miles: Number.parseFloat(row.max_miles),
              fee_minor: Math.round(Number.parseFloat(row.fee) * 100),
            }));
            if (zones.some((z) => !Number.isFinite(z.max_miles) || !Number.isFinite(z.fee_minor))) {
              setError(
                "Every ring needs a distance and a fee. Type 0 as the fee for free delivery.",
              );
              return;
            }
            if (zones.some((z) => z.max_miles <= 0 || z.fee_minor < 0)) {
              setError("A ring has to reach further than zero miles, and cannot cost less than nothing.");
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
          {isLoading && <Spinner />}
          {isLoading ? "Saving…" : "Save rings"}
        </button>
        {saved && !dirty && <span className="text-caption text-success">Saved.</span>}
      </div>
      {full && <p className="field-hint">Eight rings is the maximum.</p>}
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
