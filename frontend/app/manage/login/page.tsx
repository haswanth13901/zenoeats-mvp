"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api";

type StaffMe = {
  role_code: string;
  must_change_password: boolean;
};

/** Restaurant staff sign-in.
 *
 *  Not Clerk. Staff credentials are issued by the platform: the super admin
 *  creates the owner's login, the owner adds their own team. The API returns
 *  an httpOnly session cookie, so nothing here ever holds a token in
 *  JavaScript.
 *
 *  Which restaurant this is comes from the subdomain, never from a field on
 *  the form, so the same page serves every tenant and nobody can sign in to a
 *  restaurant by typing its name.
 */
export default function StaffLoginPage() {
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
      const me = await api<StaffMe>("/restaurant/login", {
        method: "POST",
        body: { email, password },
      });
      // A temporary password gets you exactly one place. The API refuses
      // everything else until it is replaced, so going anywhere but here
      // would just bounce.
      router.replace(me.must_change_password ? "/manage/change-password" : "/manage");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <h1 className="font-display text-3xl">Restaurant sign-in</h1>
      <p className="mt-2 text-sm text-muted">Staff access for this restaurant.</p>

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
        Forgotten your password? Ask Zenoeats to issue a new one — there is no
        self-service reset yet.
      </p>
    </main>
  );
}
