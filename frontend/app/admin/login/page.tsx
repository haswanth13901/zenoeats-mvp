"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api";

/** Platform administrator sign-in.
 *
 *  Deliberately not Clerk. Clerk is the customer identity provider; platform
 *  operators are declared in ADMIN_USERS and authenticate against the API,
 *  which returns an httpOnly session cookie. Nothing here ever holds a token
 *  in JavaScript, so an XSS bug elsewhere cannot lift a super-admin session.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/login", { method: "POST", body: { email, password } });
      // replace, not push: the back button should not return to a login form
      // that is now pointless.
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <h1 className="font-display text-3xl">Zenoeats platform</h1>
      <p className="mt-2 text-sm text-muted">Super administrator sign-in.</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            className="field mt-2"
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input
            className="field mt-2"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p className="border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick">
            {error}
          </p>
        )}

        <button className="btn-primary w-full" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-xs text-muted">
        Administrators are configured in the deployment environment. Contact
        whoever holds it if you need access.
      </p>
    </main>
  );
}
