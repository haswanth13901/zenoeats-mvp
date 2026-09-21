import { useState } from "react";
import { Empty, ErrorNote, Loading, Panel, Spinner } from "@/components/common/Feedback";
import { OneTimeSecret } from "@/components/common/Secret";
import { PageTitle } from "@/components/layout/Shell";
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

const ROLES = ["ADMIN", "MANAGER", "KITCHEN", "CASHIER", "DRIVER", "IT_SUPPORT"] as const;
type Role = (typeof ROLES)[number];

const ROLE_HELP: Record<Role, string> = {
  ADMIN: "Everything, including the team: invitations, roles and password resets.",
  MANAGER: "Orders, menu, reports, and handing over or cancelling orders. No staff changes.",
  KITCHEN: "The order board and sold-out toggles.",
  CASHIER: "The counter: collect orders with PINs, and sold-out toggles.",
  DRIVER: "Deliveries assigned to them, and nothing else of the portal.",
  IT_SUPPORT:
    "Setup and presentation: the storefront, the restaurant’s details and the delivery area. " +
    "Reads the board, stock and menu to diagnose them, and changes none of the three. " +
    "No reports, no order actions, no staff.",
};

/** A role as it is written for a person rather than as it is stored. The
 *  lowercase reading was already what the table and both dropdowns showed;
 *  this only stops the one role code with an underscore in it arriving as
 *  "it_support" beside "kitchen". */
function roleName(code: string): string {
  return code.replace(/_/g, " ").toLowerCase();
}

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

  const signIn = `${window.location.origin}/manage/login`;

  return (
    <ManageShell>
      <PageTitle title="Your team" subtitle="The right access for every role." />

      <ErrorNote message={error ?? (staff.error ? errorMessage(staff.error) : null)} />

      <Panel title="Invite someone">
        <form
          className="flex flex-col gap-[17px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && email.includes("@")) void invite();
          }}
        >
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
            <label className="block">
              <span className="label">Email</span>
              <input
                className="field mt-[7px]"
                type="email"
                autoComplete="off"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">Role</span>
              <select
                className="field mt-[7px]"
                value={role}
                aria-describedby="role-help"
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleName(r)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p id="role-help" className="-mt-2 text-caption text-muted" aria-live="polite">
            {ROLE_HELP[role]}
          </p>
          <div>
            <button type="submit" className="btn-primary" disabled={busy || !email.includes("@")}>
              {busy && <Spinner />}
              {busy ? "Inviting…" : "Invite"}
            </button>
          </div>
        </form>

        {issued && (
          <OneTimeSecret
            title={
              <span>
                Invited <span className="[overflow-wrap:anywhere]">{issued.email}</span>.
              </span>
            }
            secret={issued.temporary_password}
            link={signIn}
          >
            <p>
              {issued.temporary_password
                ? "We've emailed them the sign-in link. Give them this temporary password yourself; it is never emailed, is shown once, and cannot be looked up again."
                : "We've emailed them the sign-in link. They already have a Zenoeats staff login and sign in with the password they have. If they've lost it and work only here, you can reset it from the team list; otherwise Zenoeats support can."}
            </p>
          </OneTimeSecret>
        )}

        <p className="mt-6 max-w-[78ch] text-caption text-muted">
          An invitation grants nothing on its own. We email the person a link to this
          restaurant&apos;s sign-in page, where they accept it before the role becomes
          active. Someone new also needs the temporary password shown here, which is never
          emailed: pass it on yourself. Someone who already works at another Zenoeats
          restaurant signs in with the password they have.
        </p>
      </Panel>

      <Panel title="Team">
        {reset && (
          <OneTimeSecret
            title={
              <span>
                New temporary password for{" "}
                <span className="[overflow-wrap:anywhere]">{reset.email}</span>.
              </span>
            }
            secret={reset.temporary_password}
            link={signIn}
            footer={
              <button type="button" className="link" onClick={() => setReset(null)}>
                done
              </button>
            }
          >
            <p>
              Give it to them yourself; it is shown once and cannot be looked up again. They choose
              their own the next time they sign in.
            </p>
          </OneTimeSecret>
        )}
        {staff.isLoading ? (
          <Loading />
        ) : !staff.data?.length ? (
          <Empty>Just you so far.</Empty>
        ) : (
          // A table on a tablet and up; labelled cards on a phone, where four
          // columns of names, selects and links would not fit.
          <table className="data-table block md:table">
            <thead className="hidden md:table-header-group">
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {staff.data.map((m) => {
                const invited = m.status !== "ACTIVE";
                const onlyAdmin = !invited && m.role_code === "ADMIN" && activeAdmins === 1;
                const name = m.full_name ?? m.email;

                if (confirming?.id === m.id) {
                  const removing = confirming.kind === "remove";
                  return (
                    <tr key={m.id} className="block md:table-row">
                      <td colSpan={4} className="block md:table-cell">
                        {/* Replaces its own row, never a modal: the person it
                            is about stays exactly where they were. */}
                        <div className="inline-confirm">
                          <p>
                            {!removing
                              ? `Reset ${name}'s password? Their current password stops working and they are signed out on every device. You'll get a temporary password to pass on.`
                              : invited
                                ? `Cancel ${name}'s invitation? The invitation stops working.`
                                : `Remove ${name} from the team? They lose access to this restaurant straight away.`}
                          </p>
                          <div className="mt-3.5 flex flex-wrap items-center gap-4">
                            <button
                              type="button"
                              className="btn-danger"
                              disabled={acting}
                              onClick={() => void confirm(m)}
                            >
                              {acting && <Spinner />}
                              {acting
                                ? "Working…"
                                : !removing
                                  ? "Reset password"
                                  : invited
                                    ? "Cancel invitation"
                                    : "Remove"}
                            </button>
                            <button
                              type="button"
                              className="link"
                              disabled={acting}
                              onClick={() => setConfirming(null)}
                            >
                              keep
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={m.id} className="block border-b border-hairline py-[18px] md:table-row md:py-0">
                    <td className="block border-0 py-1 md:table-cell md:border-b md:py-5">
                      <strong className="font-semibold [overflow-wrap:anywhere]">{name}</strong>
                      {m.full_name && (
                        <p className="text-caption text-muted [overflow-wrap:anywhere]">{m.email}</p>
                      )}
                    </td>
                    <td className="block border-0 py-1 md:table-cell md:border-b md:py-5">
                      <span className="text-caption text-muted md:hidden">Role: </span>
                      {/* Your own role, and the only admin's, are not offered:
                          the API refuses both, since either could leave the
                          restaurant with no admin. */}
                      {m.is_you || onlyAdmin ? (
                        roleName(m.role_code)
                      ) : (
                        <select
                          className="field mt-1 max-w-[200px] md:mt-0 md:w-36"
                          aria-label={`${name}'s role`}
                          value={m.role_code}
                          disabled={savingRole === m.id}
                          onChange={(e) => void saveRole(m, e.target.value as Role)}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleName(r)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="block border-0 py-1 md:table-cell md:border-b md:py-5">
                      <span className="text-caption text-muted md:hidden">Status: </span>
                      {invited ? (
                        <span className="pill-red">waiting to accept</span>
                      ) : (
                        <span className="pill-green">active</span>
                      )}
                    </td>
                    <td className="block border-0 py-1 md:table-cell md:border-b md:py-5">
                      {m.is_you ? (
                        <span className="text-caption text-muted">you</span>
                      ) : (
                        <span className="flex flex-wrap gap-x-3 md:justify-end">
                          {/* An admin's password goes through Zenoeats support,
                              so one admin cannot sign in as another. */}
                          {m.role_code !== "ADMIN" && (
                            <button type="button" className="link min-h-[30px] text-caption" onClick={() => openConfirm(m.id, "reset")}>
                              reset password
                            </button>
                          )}
                          {onlyAdmin ? (
                            <span className="self-center text-caption text-muted">only admin</span>
                          ) : (
                            <button
                              type="button"
                              className="link-danger min-h-[30px] text-caption"
                              onClick={() => openConfirm(m.id, "remove")}
                            >
                              {invited ? "cancel invitation" : "remove"}
                            </button>
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
