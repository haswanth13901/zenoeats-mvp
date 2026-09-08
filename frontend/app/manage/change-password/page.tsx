"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api";

const MIN_LENGTH = 12;

/** Replace a temporary password.
 *
 *  Reached automatically after signing in with the password the super admin
 *  issued. The API refuses every other staff endpoint until this is done, so
 *  this page is not a suggestion -- it is the only thing the account can do.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const ready = current && next.length >= MIN_LENGTH && next === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/restaurant/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      // The API clears the session on success, so the new password has to be
      // used straight away rather than the old one silently continuing.
      router.replace("/manage/login");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <h1 className="font-display text-3xl">Choose a password</h1>
      <p className="mt-2 text-sm text-muted">
        Your account was created with a temporary password. Pick your own to
        continue — nobody at Zenoeats will know it.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Temporary password</span>
          <input
            className="field mt-2"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">New password</span>
          <input
            className="field mt-2"
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <span className={`mt-1 block text-xs ${tooShort ? "text-brick" : "text-muted"}`}>
            At least {MIN_LENGTH} characters.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Confirm new password</span>
          <input
            className="field mt-2"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch && (
            <span className="mt-1 block text-xs text-brick">
              These do not match.
            </span>
          )}
        </label>

        {error && (
          <p className="border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick">
            {error}
          </p>
        )}

        <button className="btn-primary w-full" disabled={busy || !ready}>
          {busy ? "Saving…" : "Set password"}
        </button>
      </form>
    </main>
  );
}
