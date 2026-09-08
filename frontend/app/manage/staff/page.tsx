"use client";

import { useState } from "react";
import { Empty, ErrorNote, Panel, Shell } from "@/components/Shell";
import { ApiError, errorMessage } from "@/lib/api";
import { useStaffResource } from "@/lib/useStaffApi";
import { MANAGE_NAV } from "../nav";

type Member = {
  id: string;
  email: string;
  full_name: string | null;
  role_code: string;
  status: string;
  invited_at: string | null;
  accepted_at: string | null;
};

const ROLES = ["ADMIN", "MANAGER", "KITCHEN", "CASHIER"] as const;

const ROLE_HELP: Record<string, string> = {
  ADMIN: "Everything, including staff and reports.",
  MANAGER: "Orders, menu, reports. No staff changes.",
  KITCHEN: "The order board and sold-out toggles.",
  CASHIER: "The counter: collect orders and verify PINs.",
};

export default function StaffPage() {
  const staff = useStaffResource<Member[]>("/restaurant/staff");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("KITCHEN");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite() {
    setBusy(true);
    setError(null);
    try {
      await staff.call("/restaurant/staff", {
        method: "POST",
        body: { email: email.trim(), role_code: role },
      });
      setEmail("");
      await staff.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await staff.call(`/restaurant/staff/${id}`, { method: "DELETE" });
      await staff.refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Shell title="Staff" nav={MANAGE_NAV}>
      <ErrorNote message={error ?? staff.error} />

      <Panel title="Invite someone">
        <div className="flex flex-wrap gap-2">
          <input
            className="field flex-1"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="field w-40"
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.toLowerCase()}
              </option>
            ))}
          </select>
          <button className="btn-primary" disabled={busy || !email.includes("@")} onClick={invite}>
            {busy ? "Sending…" : "Send invitation"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">{ROLE_HELP[role]}</p>
        <p className="mt-3 border-l-2 border-hairline pl-3 text-xs text-muted">
          An invitation grants nothing on its own. The person has to sign in to
          this restaurant and accept it before the role becomes active. Matching
          an email address never gives anyone access.
        </p>
      </Panel>

      <Panel title="Team">
        {staff.loading ? (
          <Empty>Loading…</Empty>
        ) : !staff.data?.length ? (
          <Empty>Just you so far.</Empty>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-hairline text-left text-xs text-muted">
                <th className="py-2 font-medium">Person</th>
                <th className="font-medium">Role</th>
                <th className="font-medium">Status</th>
                <th className="text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {staff.data.map((m) => (
                <tr key={m.id}>
                  <td className="py-3">
                    {m.full_name ?? m.email}
                    {m.full_name && <div className="text-xs text-muted">{m.email}</div>}
                  </td>
                  <td>{m.role_code.toLowerCase()}</td>
                  <td>
                    {m.status === "ACTIVE" ? (
                      <span className="text-xs">active</span>
                    ) : (
                      <span className="text-xs text-brick">waiting to accept</span>
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      className="text-xs text-muted underline"
                      onClick={() => revoke(m.id)}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Shell>
  );
}
