import { useEffect, useId, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Icon } from "@/components/common/icons";
import { sessionEnded, selectSession } from "@/features/session/sessionSlice";
import { useStaffLogoutEverywhereMutation, useStaffLogoutMutation } from "../restaurantApi";

/**
 * Who is signed in, shown beside the account control on wide screens.
 *
 * A shared kitchen tablet often is not obviously anyone's -- and the role
 * decides which controls the portal offers -- so the header says both.
 */
export function StaffIdentity() {
  const session = useAppSelector(selectSession);
  if (!session.email) return null;
  return (
    <>
      <span>
        {session.fullName ?? session.email}
        {session.roleCode && ` · ${session.roleCode.toLowerCase()}`}
      </span>
      {/* A full navigation: the page is its own entry outside React, like the
          sign-in pages. */}
      <a className="text-[11px] text-muted underline underline-offset-[3px] hover:text-ink" href="/manage/change-password">
        Change password
      </a>
    </>
  );
}

/**
 * The account disclosure: identity, your own account, password, and the two
 * ways out, at every width.
 *
 * Two ways out. "Sign out this device" is this device only, on purpose: a
 * restaurant often shares one login across its tablets, and one person leaving
 * must not sign the tablet on the pass out mid-service. "Sign out all devices"
 * ends every session the account holds -- the answer to a lost phone -- and
 * asks first, because it takes those shared tablets with it.
 *
 * The cookie is httpOnly, so only the server can clear it.
 */
export function StaffSignOut({ onOpenAccount }: { onOpenAccount: () => void }) {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectSession);
  const [logout, { isLoading }] = useStaffLogoutMutation();
  const [logoutEverywhere, everywhere] = useStaffLogoutEverywhereMutation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  async function leave(run: () => Promise<unknown>) {
    await run().catch(() => undefined);
    dispatch(sessionEnded());
    window.location.assign("/manage/login");
  }

  function close(restoreFocus: boolean) {
    setOpen(false);
    setConfirming(false);
    if (restoreFocus) trigger.current?.focus();
  }

  const busy = isLoading || everywhere.isLoading;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) close(true);
    }
    function onPointer(e: PointerEvent) {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t) && !busy) close(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, busy]);

  const itemClass = "link block w-full text-left";

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        className="icon-btn"
        aria-label="Your account"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Icon name="user" />
      </button>

      {open && (
        <div
          ref={menu}
          id={menuId}
          className="absolute right-0 top-[calc(100%+12px)] z-[45] max-h-[70vh] w-[250px] max-w-[calc(100vw-24px)] animate-disclose overflow-y-auto rounded-button border border-hairline bg-surface p-3.5 shadow-raised"
        >
          {session.email && (
            <>
              <p className="truncate text-sm font-semibold" title={session.fullName ?? session.email}>
                {session.fullName ?? session.email}
              </p>
              {session.roleCode && (
                <p className="text-caption text-muted">{session.roleCode.toLowerCase()}</p>
              )}
            </>
          )}
          <div className="mt-1">
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close(false);
                onOpenAccount();
              }}
            >
              Your account
            </button>
            <a className={itemClass} href="/manage/change-password">
              Change password
            </a>
            {confirming ? (
              <div className="inline-confirm my-2 p-4">
                <p>Sign out every device using this login, shared tablets included?</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="btn-danger btn-compact"
                    disabled={busy}
                    onClick={() => void leave(() => logoutEverywhere().unwrap())}
                  >
                    {everywhere.isLoading ? "Signing out…" : "Sign out everywhere"}
                  </button>
                  <button
                    type="button"
                    className="link"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className={itemClass} onClick={() => setConfirming(true)}>
                Sign out all devices
              </button>
            )}
            <button
              type="button"
              className={itemClass}
              disabled={busy}
              onClick={() => void leave(() => logout().unwrap())}
            >
              {isLoading ? "Signing out…" : "Sign out this device"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
