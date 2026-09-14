import { useState } from "react";
import { Empty, ErrorNote, Panel } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import {
  useInviteStaffMutation,
  useRevokeStaffMutation,
  useStaffQuery,
  type StaffInvite,
} from "@/features/restaurant/restaurantApi";
import { errorMessage } from "@/services/apiClient";

const ROLES = ["ADMIN", "MANAGER", "KITCHEN", "CASHIER"] as const;
type Role = (typeof ROLES)[number];

const ROLE_HELP: Record<Role, string> = {
  ADMIN: "Everything, including staff and reports.",
  MANAGER: "Orders, menu, reports. No staff changes.",
  KITCHEN: "The order board and sold-out toggles.",
  CASHIER: "The counter: collect orders and verify PINs.",
};

export function StaffPage() {
  const staff = useStaffQuery();
  const [inviteStaff] = useInviteStaffMutation();
  const [revokeStaff] = useRevokeStaffMutation();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("KITCHEN");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The last invitation sent. Held only in this component: a temporary
  // password is shown once, and leaving the page is how it goes away.
  const [issued, setIssued] = useState<StaffInvite | null>(null);

  async function invite() {
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      setIssued(await inviteStaff({ email: email.trim(), role_code: role }).unwrap());
      setEmail("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await revokeStaff(id).unwrap();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <ManageShell>
      <ErrorNote message={error ?? (staff.error ? errorMessage(staff.error) : null)} />

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
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.toLowerCase()}
              </option>
            ))}
          </select>
          <button className="btn-primary" disabled={busy || !email.includes("@")} onClick={invite}>
            {busy ? "Inviting…" : "Invite"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">{ROLE_HELP[role]}</p>
        {issued && <IssuedInvite invite={issued} />}
        <p className="mt-3 border-l-2 border-hairline pl-3 text-xs text-muted">
          An invitation grants nothing on its own. We email the person a link to this
          restaurant&apos;s sign-in page, where they accept it before the role becomes
          active. Someone new also needs the temporary password shown here, which is never
          emailed: pass it on yourself. Someone who already works at another Zenoeats
          restaurant signs in with the password they have.
        </p>
      </Panel>

      <Panel title="Team">
        {staff.isLoading ? (
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
                    <button className="text-xs text-muted underline" onClick={() => revoke(m.id)}>
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </ManageShell>
  );
}

function IssuedInvite({ invite }: { invite: StaffInvite }) {
  const signIn = `${window.location.origin}/manage/login`;
  return (
    <div className="mt-4 rounded-md border border-brick/30 bg-brick/5 px-4 py-3 text-sm">
      <p>
        Invited <span className="font-medium">{invite.email}</span>.
      </p>
      {invite.temporary_password ? (
        <>
          <p className="mt-2 text-muted">
            We&apos;ve emailed them the sign-in link. Give them this temporary password
            yourself; it is never emailed, is shown once, and cannot be looked up again.
          </p>
          <p className="tnum mt-2 select-all font-display text-2xl tracking-wider">
            {invite.temporary_password}
          </p>
        </>
      ) : (
        <p className="mt-2 text-muted">
          We&apos;ve emailed them the sign-in link. They already have a Zenoeats staff login
          and sign in with their own password.
        </p>
      )}
      <p className="mt-2 select-all text-xs text-muted">{signIn}</p>
    </div>
  );
}
