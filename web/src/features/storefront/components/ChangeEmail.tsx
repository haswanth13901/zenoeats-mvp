import { useState } from "react";
import { ErrorNote, Spinner } from "@/components/common/Feedback";
import { getClerk, clerkErrorMessage } from "@/services/clerk";
import { errorMessage } from "@/services/apiClient";
import { useSyncProfileEmailMutation } from "../storefrontApi";
import { moveCheckoutDraft } from "../checkoutDraft";
import type { CustomerSession } from "@/types";

type ClerkUser = NonNullable<Awaited<ReturnType<typeof getClerk>>["user"]>;
type Email = Awaited<ReturnType<ClerkUser["createEmailAddress"]>>;

/** Clerk owns verification; the API independently reads the verified primary
 * address before updating its mirror. A failed sync can be retried safely. */
export function ChangeEmail({
  session,
  slug,
  open,
  onOpenChange,
}: {
  session: CustomerSession;
  slug: string;
  /** Held by the page, because the link that opens this sits beside the
   *  email field rather than inside this component. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Email | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sync] = useSyncProfileEmailMutation();
  const [sent, setSent] = useState(false);

  async function confirm(address: Email) {
    const clerk = await getClerk();
    if (!clerk.user) throw new Error("Sign in again to change your email.");
    await clerk.user.update({ primaryEmailAddressId: address.id });
    const updated = await sync().unwrap();
    moveCheckoutDraft(slug, session, updated);
    setOpen(false);
    setPending(null);
    setCode("");
    setEmail("");
    setSaved(true);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const clerk = await getClerk();
      if (!clerk.user) throw new Error("Sign in again to change your email.");
      if (pending) {
        const verified = pending.verification.status === "verified"
          ? pending : await pending.attemptVerification({ code: code.trim() });
        setPending(verified);
        if (verified.verification.status !== "verified") throw new Error("Enter the verification code from your email.");
        await confirm(verified);
      } else {
        const value = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value === session.email.toLowerCase())
          throw new Error("Enter a different, valid email address.");
        const address = clerk.user.emailAddresses.find(e => e.emailAddress.toLowerCase() === value)
          ?? await clerk.user.createEmailAddress({ email: value });
        // Remember the resource even if sending a code fails, so retry does
        // not try to create the same address again.
        setPending(address);
        if (address.verification.status === "verified") await confirm(address);
        else {
          await address.prepareVerification({ strategy: "email_code" });
          setSent(true);
        }
      }
    } catch (e) {
      setError(clerkErrorMessage(e) || errorMessage(e));
    } finally { setBusy(false); }
  }

  async function resend() {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      await pending.prepareVerification({ strategy: "email_code" });
      setSent(true);
    } catch (e) { setError(clerkErrorMessage(e) || errorMessage(e)); }
    finally { setBusy(false); }
  }

  if (session.is_guest) return null;
  // Nothing of its own until it is opened: the link that opens it is beside
  // the email field, where the address it changes is.
  if (!open && !saved) return null;
  return (
    <div className="mt-6 border-t border-hairline pt-6">
      {saved && <p className="note-success mb-4" role="status">Your verified email is saved.</p>}
      {!open ? null : (
        <form onSubmit={e => { e.preventDefault(); void submit(); }} className="space-y-4">
          <h3 className="font-semibold">Change email address</h3>
          <p className="text-sm text-muted">Verify the new address before it becomes your sign-in and receipt email.</p>
          {pending ? (
            <>
              <p className="text-sm" role="status">
                {pending.verification.status === "verified" ? "Verified. Save to finish updating your profile."
                  : sent ? "Enter the code sent to " + pending.emailAddress + "." : "Request a code to verify " + pending.emailAddress + "."}
              </p>
              {pending.verification.status !== "verified" && <label className="block label">Verification code
                <input autoFocus className="field mt-2" autoComplete="one-time-code" inputMode="numeric"
                  value={code} onChange={e => setCode(e.target.value)} disabled={busy} required maxLength={12} />
              </label>}
            </>
          ) : <label className="block label">New email address
            <input autoFocus className="field mt-2" type="email" autoComplete="email" required maxLength={320}
              value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
          </label>}
          <ErrorNote message={error} />
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy && <Spinner />}{pending ? "Verify and save" : "Send verification code"}
            </button>
            {pending && pending.verification.status !== "verified" &&
              <button type="button" className="btn-quiet" disabled={busy} onClick={() => void resend()}>Resend code</button>}
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => {
              setOpen(false); setPending(null); setCode(""); setSent(false); setError(null);
            }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
