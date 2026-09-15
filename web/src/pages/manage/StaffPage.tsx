import { useState } from "react";
import { Empty, ErrorNote, Panel } from "@/components/common/Feedback";
import { ManageShell } from "@/features/restaurant/components/ManageShell";
import {
  useChangeStaffRoleMutation,
  useInviteStaffMutation,
  useResetStaffPasswordMutation,
  useRevokeStaffMutation,
  useStaffQuery,
  type StaffInvite,
  type StaffMember,
  type StaffPasswordReset,
} from "@/features/restaurant/restaurantApi";
import { errorMessage } from "@/services/apiClient";

const ROLES = ["ADMIN", "MANAGER", "KITCHEN", "CASHIER", "DRIVER"] as const;
type Role = (typeof ROLES)[number];

const ROLE_HELP: Record<Role, string> = {
  ADMIN: "Everything, including the team: invitations, roles and password resets.",
  MANAGER: "Orders, menu, reports, and handing over or cancelling orders. No staff changes.",
  KITCHEN: "The order board and sold-out toggles.",
  CASHIER: "The counter: collect orders with PINs, and sold-out toggles.",
  DRIVER: "Deliveries assigned to them, and nothing else of the portal.",
};

/** One row asking "are you sure", for one of the two actions that need it. */
type Confirming = { id: string; kind: "remove" | "reset" };

export function StaffPage() {
  const staff = useStaffQuery();
  const [inviteStaff] = useInviteStaffMutation();
  const [revokeStaff] = useRevokeStaffMutation();
  const [changeRole] = useChangeStaffRoleMutation();
  const [resetPassword] = useResetStaffPasswordMutation();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("KITCHEN");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The last invitation sent, and the last password reset. Held only in this
  // component: a temporary password is shown once, and leaving the page is
  // how it goes away.
  const [issued, setIssued] = useState<StaffInvite | null>(null);
  const [reset, setReset] = useState<StaffPasswordReset | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [acting, setActing] = useState(false);
  const [savingRole, setSavingRole] = useState<string | null>(null);

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

  async function confirm(member: StaffMember) {
    if (!confirming) return;
    setError(null);
    setActing(true);
    try {
      if (confirming.kind === "remove") {
        await revokeStaff(member.id).unwrap();
      } else {
        setReset(await resetPassword(member.id).unwrap());
      }
      setConfirming(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setActing(false);
    }
  }

  async function saveRole(member: StaffMember, next: Role) {
    if (next === member.role_code) return;
    setError(null);
    setSavingRole(member.id);
    try {
      await changeRole({ membershipId: member.id, role_code: next }).unwrap();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSavingRole(null);
    }
  }

  // The API refuses removing or demoting the last active admin; the row says
  // so up front rather than offering controls that can only fail.
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
        {reset && <IssuedReset reset={reset} onDone={() => setReset(null)} />}
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

                if (confirming?.id === m.id) {
                  const removing = confirming.kind === "remove";
                  return (
                    <tr key={m.id} className="bg-brick/5">
                      <td colSpan={4} className="px-3 py-3">
                        <p className="text-sm">
                          {!removing
                            ? `Reset ${name}'s password? Their current password stops working and they are signed out on every device. You'll get a temporary password to pass on.`
                            : invited
                              ? `Cancel ${name}'s invitation? The invitation stops working.`
                              : `Remove ${name} from the team? They lose access to this restaurant straight away.`}
                        </p>
                        <div className="mt-2 flex items-center gap-4">
                          <button
                            className="btn-primary px-3 py-1.5 text-sm"
                            disabled={acting}
                            onClick={() => void confirm(m)}
                          >
                            {acting
                              ? "Working…"
                              : !removing
                                ? "Reset password"
                                : invited
                                  ? "Cancel invitation"
                                  : "Remove"}
                          </button>
                          <button
                            className="text-xs underline"
                            disabled={acting}
                            onClick={() => setConfirming(null)}
                          >
                            keep
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={m.id}>
                    <td className="py-3">
                      {name}
                      {m.full_name && <div className="text-xs text-muted">{m.email}</div>}
                    </td>
                    <td>
                      {/* Your own role, and the only admin's, are not offered:
                          the API refuses both, since either could leave the
                          restaurant with no admin. */}
                      {m.is_you || onlyAdmin ? (
                        m.role_code.toLowerCase()
                      ) : (
                        <select
                          className="field w-32 py-1 text-sm"
                          aria-label={`${name}'s role`}
                          value={m.role_code}
                          disabled={savingRole === m.id}
                          onChange={(e) => void saveRole(m, e.target.value as Role)}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r.toLowerCase()}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
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
                      ) : (
                        <span className="inline-flex gap-3">
                          {/* An admin's password goes through Zenoeats support,
                              so one admin cannot sign in as another. */}
                          {m.role_code !== "ADMIN" && (
                            <RowAction onClick={() => openConfirm(m.id, "reset")}>
                              reset password
                            </RowAction>
                          )}
                          {onlyAdmin ? (
                            <span className="text-xs text-muted">only admin</span>
                          ) : (
                            <RowAction onClick={() => openConfirm(m.id, "remove")}>
                              {invited ? "cancel invitation" : "remove"}
                            </RowAction>
                          )}
                        </span>
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

  function openConfirm(id: string, kind: Confirming["kind"]) {
    setError(null);
    setConfirming({ id, kind });
  }
}

function RowAction({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button className="text-xs text-muted underline" onClick={onClick}>
      {children}
    </button>
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
          and sign in with the password they have. If they&apos;ve lost it and work only
          here, you can reset it from the team list; otherwise Zenoeats support can.
        </p>
      )}
      <p className="mt-2 select-all text-xs text-muted">{signIn}</p>
    </div>
  );
}

function IssuedReset({ reset, onDone }: { reset: StaffPasswordReset; onDone: () => void }) {
  const signIn = `${window.location.origin}/manage/login`;
  return (
    <div className="mb-4 rounded-md border border-brick/30 bg-brick/5 px-4 py-3 text-sm">
      <p>
        New temporary password for <span className="font-medium">{reset.email}</span>. Give it
        to them yourself; it is shown once and cannot be looked up again. They choose their
        own the next time they sign in.
      </p>
      <p className="tnum mt-2 select-all font-display text-2xl tracking-wider">
        {reset.temporary_password}
      </p>
      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="select-all text-xs text-muted">{signIn}</p>
        <button className="text-xs underline" onClick={onDone}>
          done
        </button>
      </div>
    </div>
  );
}
