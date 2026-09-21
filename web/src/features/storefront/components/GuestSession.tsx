import { useEffect, useRef } from "react";

/** What a guest keeps, in one sentence, wherever the UI names a guest. A
 *  guest session is a cookie in this browser and nothing else; the email link
 *  is the only other way back to the order. */
export const GUEST_WARNING =
  "Keep this browser and your confirmation email. If you lose both, we cannot recover your guest order or its pickup PIN.";

/**
 * Ending a guest session, asked first.
 *
 * Irreversible in a way signing out is not: nothing else can name that guest
 * or their orders again, so the consequence is spelled out and the safe
 * choice is right beside it. A signed-in customer's sign-out does not use
 * this -- they can always sign back in.
 */
export function GuestSessionConfirm({
  busy,
  onEnd,
  onKeep,
}: {
  busy: boolean;
  onEnd: () => void;
  onKeep: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  // The safe choice takes focus, so a stray Enter keeps the session.
  useEffect(() => keep.current?.focus(), []);

  return (
    <div className="inline-confirm mt-3" role="group" aria-label="End guest session">
      <p>
        <strong>End this guest session?</strong> This permanently removes this browser&apos;s
        access. Keep the confirmation email to reopen its order while the link remains valid.
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-danger" disabled={busy} onClick={onEnd}>
          {busy ? "Ending…" : "End guest session"}
        </button>
        <button ref={keep} type="button" className="link" disabled={busy} onClick={onKeep}>
          Keep my session
        </button>
      </div>
    </div>
  );
}
