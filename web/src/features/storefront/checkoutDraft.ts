import type { Contact, CustomerSession, FulfillmentType } from "@/types";

const PREFIX = "zenoeats:checkout-draft:";
type Draft = { contact: Contact; fulfillment: FulfillmentType; note: string; email?: string; savedAt: number };
const keyFor = (slug: string, session: CustomerSession) =>
  PREFIX + JSON.stringify([slug, session.is_guest, session.email]);

/** Tab-scoped, tenant-scoped checkout details. Never persist a quote or payment secret. */
export function readCheckoutDraft(slug: string, session: CustomerSession): Draft | null {
  try {
    const key = keyFor(slug, session);
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Draft | null;
    if (!value || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > 86_400_000 ||
      !["PICKUP", "DELIVERY"].includes(value.fulfillment) ||
      typeof value.note !== "string" || (value.email !== undefined && typeof value.email !== "string") ||
      !["full_name", "phone", "address"].every(k => typeof value.contact?.[k as keyof Contact] === "string")) {
      sessionStorage.removeItem(key);
      return null;
    }
    return value;
  } catch { return null; }
}

export function saveCheckoutDraft(slug: string, session: CustomerSession, draft: Omit<Draft, "savedAt">) {
  try { sessionStorage.setItem(keyFor(slug, session), JSON.stringify({ ...draft, savedAt: Date.now() })); }
  catch { /* Checkout still works when storage is unavailable. */ }
}

export function refreshDraftContact(slug: string, session: CustomerSession, contact: Contact) {
  const draft = readCheckoutDraft(slug, session);
  if (draft) saveCheckoutDraft(slug, session, { ...draft, contact });
}

export function moveCheckoutDraft(slug: string, before: CustomerSession, after: CustomerSession) {
  if (keyFor(slug, before) === keyFor(slug, after)) return;
  const draft = readCheckoutDraft(slug, before);
  if (draft) {
    saveCheckoutDraft(slug, after, draft);
    try { sessionStorage.removeItem(keyFor(slug, before)); } catch { /* Storage may be disabled. */ }
  }
}

export function clearCheckoutDrafts() {
  try {
    Object.keys(sessionStorage).filter(k => k.startsWith(PREFIX) || k === "zenoeats:checkout-attempt")
      .forEach(k => sessionStorage.removeItem(k));
  } catch { /* Storage may be disabled. */ }
}
