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
  MANAGER: "Orders, menu, reports, and handing over or cancelling orders. No staff changes.",
  KITCHEN: "The order board and sold-out toggles.",
  CASHIER: "The counter: collect orders with PINs, and sold-out toggles.",
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
  // The row asking "are you sure", and whether its removal is in flight.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

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
    setRemoving(true);
    try {
      await revokeStaff(id).unwrap();
      setConfirming(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRemoving(false);
    }
  }

  // The API refuses removing the last active admin; the row says so up front
  // rather than offering a button that can only fail.
  const activeAdmins = (staff.data ?? []).filter(
    (m) => m.role_code === "ADMIN" && m.status === "ACTIVE",
  ).length;

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
              {staff.data.map((m) => {
                const invited = m.status !== "ACTIVE";
                const onlyAdmin = !invited && m.role_code === "ADMIN" && activeAdmins === 1;
                const name = m.full_name ?? m.email;
                return confirming === m.id ? (
                  <tr key={m.id} className="bg-brick/5">
                    <td colSpan={4} className="px-3 py-3">
                      <p className="text-sm">
                        {invited
                          ? `Cancel ${name}'s invitation? The invitation stops working.`
                          : `Remove ${name} from the team? They lose access to this restaurant straight away.`}
                      </p>
                      <div className="mt-2 flex items-center gap-4">
                        <button
                          className="btn-primary px-3 py-1.5 text-sm"
                          disabled={removing}
                          onClick={() => void revoke(m.id)}
                        >
                          {removing ? "Removing…" : invited ? "Cancel invitation" : "Remove"}
                        </button>
                        <button
                          className="text-xs underline"
                          disabled={removing}
                          onClick={() => setConfirming(null)}
                        >
                          keep
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={m.id}>
                    <td className="py-3">
                      {name}
                      {m.full_name && <div className="text-xs text-muted">{m.email}</div>}
                    </td>
                    <td>{m.role_code.toLowerCase()}</td>
                    <td>
                      {invited ? (
                        <span className="text-xs text-brick">waiting to accept</span>
                      ) : (
                        <span className="text-xs">active</span>
                      )}
                    </td>
                    <td className="text-right">
                      {m.is_you ? (
                        <span className="text-xs text-muted">you</span>
                      ) : onlyAdmin ? (
                        <span className="text-xs text-muted">only admin</span>
                      ) : (
                        <button
                          className="text-xs text-muted underline"
                          onClick={() => {
                            setError(null);
                            setConfirming(m.id);
                          }}
                        >
                          {invited ? "cancel invitation" : "remove"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
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
          and sign in with the password they have. If they&apos;ve lost it, Zenoeats
          support can reset it; no new password is issued from here.
        </p>
      )}
      <p className="mt-2 select-all text-xs text-muted">{signIn}</p>
    </div>
  );
}
