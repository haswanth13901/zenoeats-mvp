import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { StatusPill } from "@/components/common/Feedback";
import { RestaurantEditForm } from "./RestaurantEditForm";
import type { Restaurant, RestaurantPatch, StripeSync } from "../adminApi";
import { storefrontUrl } from "@/utils/storefront";

/** Stripe prefixes person requirements with the person id, which means nothing
 *  to an operator reading "what is this restaurant waiting on". */
function readableRequirement(req: string): string {
  return req.replace(/^person_[^.]+\./, "");
}

export type RowActions = {
  onEdit: () => void;
  onSave: (changes: RestaurantPatch) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPurge: () => void;
  onActivate: () => void;
  onSuspend: () => void;
  onOnboard: () => void;
  onRefreshStripe: () => void;
  onOwner: () => void;
};

export function RestaurantRow({
  restaurant: r,
  busy,
  editing,
  stripeStatus,
  actions,
}: {
  restaurant: Restaurant;
  busy: boolean;
  editing: boolean;
  stripeStatus: StripeSync | undefined;
  actions: RowActions;
}) {
  const deleted = r.deleted_at !== null;
  const outstanding = stripeStatus
    ? [...new Set([...stripeStatus.past_due, ...stripeStatus.currently_due])]
    : [];

  return (
    <Fragment>
      <tr className={deleted ? "opacity-50" : undefined}>
        <td className="py-3">
          <div>
            {r.name}
            {deleted && <span className="ml-2 text-xs text-brick">deleted</span>}
          </div>
          <a
            href={storefrontUrl(r.slug)}
            className="text-xs text-muted underline"
            target="_blank"
            rel="noreferrer"
          >
            {r.slug}
          </a>
        </td>

        <td>
          <StatusPill status={r.status} />
        </td>

        <td className="text-xs">
          {!r.stripe_account_id ? (
            <span className="text-muted">Not connected</span>
          ) : r.charges_enabled ? (
            <span>Charges enabled</span>
          ) : (
            <span className="text-brick">Onboarding incomplete</span>
          )}

          {/* Why, not just that. Without the outstanding requirement there is
              nothing for an operator to act on. */}
          {stripeStatus && !stripeStatus.charges_enabled && (
            <div className="mt-1 text-muted">
              {stripeStatus.disabled_reason && <div>Stripe: {stripeStatus.disabled_reason}</div>}
              {outstanding.length > 0 && (
                <div>Needs: {outstanding.map(readableRequirement).join(", ")}</div>
              )}
            </div>
          )}
          {stripeStatus?.charges_enabled && (
            <div className="mt-1 text-muted">Synced from Stripe.</div>
          )}
        </td>

        <td className="py-3 text-right">
          <div className="inline-flex flex-wrap justify-end gap-2">
            {deleted ? (
              <>
                <button
                  className="btn-primary px-2 py-1 text-xs"
                  disabled={busy}
                  onClick={actions.onRestore}
                >
                  Restore
                </button>
                {/* Two clicks, because this is the one action on this page
                    with nothing behind it. The server refuses any restaurant
                    holding an order or a payment, so the worst a misclick can
                    reach is a menu nobody sold from. */}
                <PurgeButton busy={busy} name={r.name} onPurge={actions.onPurge} />
              </>
            ) : (
              <>
                {!r.charges_enabled && (
                  <button
                    className="btn-quiet px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={actions.onOnboard}
                  >
                    {r.stripe_account_id ? "Resume Stripe" : "Connect Stripe"}
                  </button>
                )}
                {r.stripe_account_id && (
                  <button
                    className="btn-quiet px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={actions.onRefreshStripe}
                  >
                    Refresh Stripe
                  </button>
                )}
                {r.status !== "ACTIVE" ? (
                  <button
                    className="btn-primary px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={actions.onActivate}
                  >
                    Activate
                  </button>
                ) : (
                  <button
                    className="btn-quiet px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={actions.onSuspend}
                  >
                    Suspend
                  </button>
                )}
                <button
                  className="btn-quiet px-2 py-1 text-xs"
                  onClick={editing ? actions.onCancelEdit : actions.onEdit}
                >
                  {editing ? "Close" : "Edit"}
                </button>
                <button className="btn-quiet px-2 py-1 text-xs" onClick={actions.onOwner}>
                  Owner login
                </button>
                <Link
                  className="btn-quiet px-2 py-1 text-xs"
                  to={`/admin/restaurants/${r.id}/orders`}
                >
                  Orders
                </Link>
                {/* The API refuses to delete an ACTIVE restaurant. Hiding the
                    button avoids offering a certain 409. */}
                {r.status !== "ACTIVE" && (
                  <button
                    className="btn-quiet px-2 py-1 text-xs text-brick"
                    disabled={busy}
                    onClick={actions.onDelete}
                  >
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>

      {editing && (
        <tr>
          <td colSpan={4} className="bg-paper px-3 py-4">
            <RestaurantEditForm
              restaurant={r}
              busy={busy}
              onCancel={actions.onCancelEdit}
              onSave={actions.onSave}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
}


/**
 * Permanent deletion, behind a second click.
 *
 * Not a browser confirm(): it is unstyled, it blocks the tab, and it reads
 * the same for "delete a draft" as for anything else. The armed state says
 * what goes instead, and moving the mouse away is enough to change your mind.
 */
function PurgeButton({
  busy,
  name,
  onPurge,
}: {
  busy: boolean;
  name: string;
  onPurge: () => void;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        className="btn-quiet px-2 py-1 text-xs text-brick"
        disabled={busy}
        onClick={() => setArmed(true)}
      >
        Delete for good
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-xs text-brick">
        Erase {name} and its menu? This cannot be undone.
      </span>
      <button
        className="btn-primary px-2 py-1 text-xs"
        disabled={busy}
        onClick={() => {
          setArmed(false);
          onPurge();
        }}
      >
        Erase
      </button>
      <button className="text-xs underline" disabled={busy} onClick={() => setArmed(false)}>
        keep it
      </button>
    </span>
  );
}
