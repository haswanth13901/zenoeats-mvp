import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Empty, ErrorNote, Panel } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import {
  useRestaurantProfileQuery,
  useUpdateRestaurantProfileMutation,
  type RestaurantProfile,
  type RestaurantProfilePatch,
} from "@/features/restaurant/restaurantApi";
import { errorMessage } from "@/services/apiClient";

/**
 * The restaurant's own record, for its admin.
 *
 * Everything here used to be the platform's to change, so fixing a typo in a
 * trading name was a support ticket. The fields the platform still owns are
 * shown but not editable, because "you cannot change this here" is a more
 * useful answer than leaving them off the page and letting someone hunt.
 *
 * Saving sends only what was actually edited. Two admins with the page open
 * can change different things without either one's save reverting the other's,
 * and it is what lets the tagline be cleared -- null means "remove it", where
 * an unsent field means "leave it alone".
 */
export function SettingsPage() {
  const profile = useRestaurantProfileQuery();
  const [save, { isLoading: saving }] = useUpdateRestaurantProfileMutation();

  const [draft, setDraft] = useState<RestaurantProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The server's answer is the starting point, and becomes it again after a
  // save: the response is the row as it was actually stored, trimmed and
  // normalised, which is not always exactly what was typed.
  useEffect(() => {
    if (profile.data) setDraft(profile.data);
  }, [profile.data]);

  const patch = useMemo(
    () => (profile.data && draft ? changedFields(profile.data, draft) : {}),
    [profile.data, draft],
  );
  const dirty = Object.keys(patch).length > 0;

  function edit(changes: Partial<RestaurantProfile>) {
    setSaved(false);
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  async function submit() {
    setError(null);
    try {
      await save(patch).unwrap();
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (profile.isLoading) {
    return (
      <ManageShell>
        <Empty>Loading…</Empty>
      </ManageShell>
    );
  }
  if (!draft) {
    return (
      <ManageShell>
        <ErrorNote message={errorMessage(profile.error) || "Could not load your settings."} />
      </ManageShell>
    );
  }

  const stripeTaxAvailable = draft.charges_enabled;

  return (
    <ManageShell>
      <ErrorNote message={error} />
      {saved && !dirty && (
        <p className="mb-4 border-l-2 border-ink bg-surface px-3 py-2 text-sm">Saved.</p>
      )}

      <Panel title="The basics">
        <div className="space-y-4 bg-surface px-5 py-5">
          <Field label="Restaurant name" hint="What customers see on your menu and receipts.">
            <input
              className="field"
              value={draft.name}
              maxLength={160}
              onChange={(e) => edit({ name: e.target.value })}
            />
          </Field>
          <Field label="Tagline" hint="Optional. A line under your name on the menu.">
            <input
              className="field"
              value={draft.tagline ?? ""}
              maxLength={200}
              placeholder="Since 1998"
              onChange={(e) => edit({ tagline: e.target.value })}
            />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.accepting_orders}
              onChange={(e) => edit({ accepting_orders: e.target.checked })}
            />
            <span>
              Taking orders
              <span className="block text-muted">
                Turn this off to stop new orders while keeping your menu readable. Orders already
                paid for are unaffected.
              </span>
            </span>
          </label>
        </div>
      </Panel>

      <Panel title="Where you are">
        <div className="space-y-4 bg-surface px-5 py-5">
          <p className="text-sm text-muted">
            Where customers collect their orders. It is also the address your sales tax is worked
            out for, so it needs to be the real trading address rather than a head office.
          </p>
          <Field label="Street">
            <input
              className="field"
              value={draft.address_line1 ?? ""}
              maxLength={200}
              onChange={(e) => edit({ address_line1: e.target.value })}
            />
          </Field>
          <Field label="Street, line 2" hint="Optional. Unit or suite.">
            <input
              className="field"
              value={draft.address_line2 ?? ""}
              maxLength={200}
              onChange={(e) => edit({ address_line2: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City">
              <input
                className="field"
                value={draft.address_city ?? ""}
                maxLength={100}
                onChange={(e) => edit({ address_city: e.target.value })}
              />
            </Field>
            <Field label="State">
              <input
                className="field"
                value={draft.address_state ?? ""}
                maxLength={100}
                onChange={(e) => edit({ address_state: e.target.value })}
              />
            </Field>
            <Field label="Postal code">
              <input
                className="field"
                value={draft.address_postal_code ?? ""}
                maxLength={20}
                onChange={(e) => edit({ address_postal_code: e.target.value })}
              />
            </Field>
            <Field label="Country" hint="Two letters, like US.">
              <input
                className="field uppercase"
                value={draft.address_country ?? ""}
                maxLength={2}
                onChange={(e) => edit({ address_country: e.target.value.toUpperCase() })}
              />
            </Field>
          </div>
          <Field
            label="Timezone"
            hint="Which day an order counts on in your reports. A name like America/Chicago."
          >
            <input
              className="field"
              value={draft.timezone}
              maxLength={64}
              onChange={(e) => edit({ timezone: e.target.value })}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Tax">
        <div className="space-y-4 bg-surface px-5 py-5">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={draft.tax_mode === "FLAT"}
              onChange={() => edit({ tax_mode: "FLAT" })}
            />
            <span>
              One flat rate
              <span className="block text-muted">
                The same percentage on every order. Simple, and only correct where your local rate
                really is a single number.
              </span>
            </span>
          </label>

          {draft.tax_mode === "FLAT" && (
            <div className="pl-7">
              <Field label="Rate" hint="A percentage, up to 30. For example 8.75.">
                <input
                  className="field max-w-[8rem]"
                  inputMode="decimal"
                  value={percentText(draft.tax_rate_bps)}
                  onChange={(e) => edit({ tax_rate_bps: bpsFromPercent(e.target.value) })}
                />
              </Field>
            </div>
          )}

          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              className="mt-1"
              disabled={!stripeTaxAvailable}
              checked={draft.tax_mode === "STRIPE_TAX"}
              onChange={() => edit({ tax_mode: "STRIPE_TAX" })}
            />
            <span className={stripeTaxAvailable ? "" : "text-muted"}>
              Work it out per order, through Stripe
              <span className="block text-muted">
                State, county and city rates for the address above, calculated on your own Stripe
                account, and reported there.{" "}
                {!stripeTaxAvailable &&
                  "Available once your Stripe account is connected and taking payments."}
              </span>
            </span>
          </label>

          {draft.tax_mode === "STRIPE_TAX" && (
            <div className="pl-7">
              <Field
                label="Product tax code"
                hint="txcd_40060003 covers prepared food and drink. Change it only if Stripe told you to."
              >
                <input
                  className="field max-w-[16rem]"
                  value={draft.tax_code}
                  onChange={(e) => edit({ tax_code: e.target.value })}
                />
              </Field>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Set by Zenoeats">
        <dl className="divide-y divide-hairline bg-surface px-5">
          <ReadOnly
            label="Your web address"
            value={`${draft.slug}.zenoeats.com`}
            why="It is printed on your tables and saved in customers' bookmarks, so moving it is a job we do with you rather than a text box."
          />
          <ReadOnly
            label="Status"
            value={draft.status.toLowerCase()}
            why="Going live and pausing a restaurant have checks of their own."
          />
          <ReadOnly
            label="Currency"
            value={draft.currency}
            why="What every order and payment you already have is counted in."
          />
        </dl>
      </Panel>

      <div className="sticky bottom-0 -mx-5 border-t border-hairline bg-paper px-5 py-4">
        <div className="flex items-center gap-4">
          <button className="btn-primary" disabled={!dirty || saving} onClick={submit}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          {dirty && (
            <button
              className="text-sm text-muted underline"
              disabled={saving}
              onClick={() => {
                setError(null);
                setDraft(profile.data ?? null);
              }}
            >
              Discard
            </button>
          )}
          {!dirty && !saving && <span className="text-sm text-muted">Nothing to save.</span>}
        </div>
      </div>
    </ManageShell>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function ReadOnly({ label, value, why }: { label: string; value: string; why: string }) {
  return (
    <div className="py-4 text-sm">
      <dt className="font-medium">{label}</dt>
      <dd className="text-ink">{value}</dd>
      <dd className="mt-0.5 text-xs text-muted">{why}</dd>
    </div>
  );
}

/** 875 -> "8.75". Kept as a string so a half-typed "8." survives the render. */
function percentText(bps: number): string {
  return String(bps / 100);
}

function bpsFromPercent(text: string): number {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return 0;
  // Round rather than truncate: 8.75 in binary floating point is 874.9999…,
  // and a tax rate quietly one hundredth of a percent low is the kind of bug
  // nobody notices until an accountant does.
  return Math.max(0, Math.round(value * 100));
}

/**
 * What actually changed, in the shape the API takes.
 *
 * An empty text field means "there isn't one" and is sent as null, which is
 * how the tagline and the optional address lines are cleared. The server trims
 * and normalises too -- this is about not sending fields nobody edited.
 */
function changedFields(original: RestaurantProfile, draft: RestaurantProfile) {
  const patch: RestaurantProfilePatch = {};
  const editable = [
    "name",
    "tagline",
    "timezone",
    "accepting_orders",
    "tax_mode",
    "tax_rate_bps",
    "tax_code",
    "address_line1",
    "address_line2",
    "address_city",
    "address_state",
    "address_postal_code",
    "address_country",
  ] as const;

  for (const key of editable) {
    const before = original[key];
    const after = draft[key];
    const cleaned = typeof after === "string" ? after.trim() : after;
    // The name has no "none": an empty one is not a change worth sending, and
    // the server would refuse it anyway.
    const value = cleaned === "" && key !== "name" ? null : cleaned;
    if (value === before || (value === null && before === null)) continue;
    if (key === "name" && value === "") continue;
    (patch as Record<string, unknown>)[key] = value;
  }
  return patch;
}
