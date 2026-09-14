import { useState } from "react";
import type { Restaurant } from "../adminApi";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Create a restaurant.
 *
 * The slug rule is duplicated from the API on purpose. It is the tenant's
 * permanent public address and cannot be changed afterwards, so catching a bad
 * one before submission is worth the duplication.
 */
export function CreateRestaurantForm({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: {
    slug: string;
    name: string;
    tax_rate_bps: number;
    tagline: string | null;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [taxPct, setTaxPct] = useState("8.25");

  const cleanSlug = slug.toLowerCase().trim();
  const slugValid = cleanSlug === "" || SLUG_PATTERN.test(cleanSlug);

  return (
    <form
      className="mb-4 border border-hairline bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({
          slug: cleanSlug,
          name: name.trim(),
          tax_rate_bps: Math.round(parseFloat(taxPct || "0") * 100),
          tagline: null,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs text-muted">Restaurant name</span>
          <input
            className="field mt-1"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Subdomain</span>
          <input
            className="field mt-1"
            required
            placeholder="spicehouse"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          {!slugValid && (
            <span className="mt-1 block text-xs text-brick">
              Lowercase letters, numbers and hyphens; must start with a letter or number.
            </span>
          )}
        </label>
        <label className="block">
          <span className="text-xs text-muted">Tax rate %</span>
          <input
            className="field tnum mt-1"
            inputMode="decimal"
            value={taxPct}
            onChange={(e) => setTaxPct(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          className="btn-primary px-3 py-1.5 text-sm"
          disabled={busy || !name || !cleanSlug || !slugValid}
        >
          {busy ? "Creating…" : "Create as draft"}
        </button>
        <button type="button" className="btn-quiet px-3 py-1.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
        <span className="text-xs text-muted">
          Created restaurants stay in draft until Stripe is connected and you activate them.
        </span>
      </div>
    </form>
  );
}

/**
 * Issue or reissue the owner login for a restaurant.
 *
 * One account per restaurant, with the ADMIN role. The owner adds their own
 * staff from the restaurant portal, so this deliberately offers no role choice.
 */
export function OwnerForm({
  restaurant,
  busy,
  onCancel,
  onCreate,
  onReset,
}: {
  restaurant: Restaurant;
  busy: boolean;
  onCancel: () => void;
  onCreate: (email: string, fullName: string) => void;
  onReset: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const clean = email.trim().toLowerCase();

  return (
    <form
      className="mb-4 border border-hairline bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(clean, fullName.trim());
      }}
    >
      <h3 className="text-sm font-medium">Owner login for {restaurant.name}</h3>
      <p className="mt-1 text-sm text-muted">
        Makes this person the restaurant&apos;s owner (ADMIN). A new address gets a
        temporary password they replace at first sign-in. Someone who already runs
        another Zenoeats restaurant keeps their own password: they&apos;re emailed an
        invitation and accept it after signing in here. Use Reset password for an
        owner who has forgotten theirs.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-muted">Owner email</span>
          <input
            className="field mt-1"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Full name (optional)</span>
          <input
            className="field mt-1"
            value={fullName}
            maxLength={160}
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary px-3 py-1.5 text-sm" disabled={busy || !clean}>
          {busy ? "Working…" : "Create login"}
        </button>
        {/* type="button" so it does not submit the create form. */}
        <button
          type="button"
          className="btn-quiet px-3 py-1.5 text-sm"
          disabled={busy || !clean}
          onClick={() => onReset(clean)}
        >
          Reset password
        </button>
        <button type="button" className="btn-quiet px-3 py-1.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Shown once after a credential is issued. The API returns the password
 *  exactly once and stores only its hash, so there is no second chance. */
export function IssuedCredentialPanel({
  email,
  password,
  status,
  restaurant,
  onDismiss,
}: {
  email: string;
  password: string | null;
  status: "ACTIVE" | "INVITED";
  restaurant: Restaurant;
  onDismiss: () => void;
}) {
  if (password === null) {
    // An existing login, invited rather than issued anything.
    return (
      <div className="mb-4 border border-hairline bg-surface p-4">
        <h3 className="text-sm font-medium">Owner invited</h3>
        <p className="mt-1 text-sm text-muted">
          {email} already has a Zenoeats staff login, so no password was issued and theirs
          is unchanged. They&apos;ve been emailed an invitation to own {restaurant.name}: they
          sign in to its portal with their existing password and accept it.
        </p>
        <button className="btn-quiet mt-4 px-3 py-1.5 text-sm" onClick={onDismiss}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 border border-hairline bg-surface p-4">
      <h3 className="text-sm font-medium">
        Temporary password issued{status === "INVITED" ? " (invitation still to accept)" : ""}
      </h3>
      <p className="mt-1 text-sm text-muted">
        Give these to the owner now. The password is not stored and cannot be shown
        again — only reissued. They must replace it at first sign-in before the
        portal will do anything else.
      </p>
      <dl className="mt-3 grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-20 text-muted">Email</dt>
          <dd>{email}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 text-muted">Password</dt>
          <dd className="tnum font-medium tracking-wide">{password}</dd>
        </div>
      </dl>
      <button className="btn-quiet mt-4 px-3 py-1.5 text-sm" onClick={onDismiss}>
        I have saved it
      </button>
    </div>
  );
}
