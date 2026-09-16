import { useState } from "react";
import { useAppSelector } from "@/app/hooks";
import { ErrorNote, Panel } from "@/components/common/Feedback";
import { selectSession } from "@/features/session/sessionSlice";
import {
  useChangeStaffEmailMutation,
  useStaffMeQuery,
  useUpdateOwnAccountMutation,
} from "@/features/restaurant/restaurantApi";
import { errorMessage } from "@/services/apiClient";

/**
 * Your own account: the name colleagues see, and the address you sign in with.
 *
 * The two are deliberately not one form. A name is not a credential -- getting
 * it wrong costs nothing that cannot be typed again -- so it saves on its own.
 * The address is how you sign in, so changing it asks for the password, and
 * asking for a password inside a form that also holds a display name would
 * make the password feel like the price of fixing a typo.
 *
 * It lives in its own component rather than in the Settings page, because the
 * endpoints behind it are open to every role while that page is not: a "Your
 * account" screen for the whole team is a route away, not a rewrite.
 */
export function OwnAccount() {
  const me = useStaffMeQuery();
  const session = useAppSelector(selectSession);

  return (
    <Panel title="Your account">
      <div className="divide-y divide-hairline bg-surface">
        <NameForm current={me.data?.full_name ?? null} />
        <EmailForm current={me.data?.email ?? session.email ?? ""} />
        <div className="px-5 py-5 text-sm">
          <div className="font-medium">Password</div>
          <p className="mt-1 text-muted">
            Changing it signs you out on every device, this one included.
          </p>
          <a className="btn-quiet mt-3 inline-flex" href="/manage/change-password">
            Change password
          </a>
        </div>
      </div>
    </Panel>
  );
}

function NameForm({ current }: { current: string | null }) {
  const [save, { isLoading }] = useUpdateOwnAccountMutation();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // null means "not edited yet", which is how the field keeps showing the
  // server's answer until someone actually types -- including after a save.
  const shown = value ?? current ?? "";
  const dirty = value !== null && value.trim() !== (current ?? "");

  return (
    <div className="px-5 py-5">
      <ErrorNote message={error} />
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Your name</span>
        <input
          className="field max-w-sm"
          value={shown}
          maxLength={160}
          placeholder="Shown to the rest of the team"
          onChange={(e) => {
            setSaved(false);
            setValue(e.target.value);
          }}
        />
        <span className="mt-1 block text-xs text-muted">
          Appears beside the orders you hand over, and on the team list. Leave it empty to show
          your email address instead.
        </span>
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button
          className="btn-quiet"
          disabled={!dirty || isLoading}
          onClick={async () => {
            setError(null);
            try {
              await save({ full_name: (value ?? "").trim() || null }).unwrap();
              setValue(null);
              setSaved(true);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          {isLoading ? "Saving…" : "Save name"}
        </button>
        {saved && !dirty && <span className="text-sm text-muted">Saved.</span>}
      </div>
    </div>
  );
}

function EmailForm({ current }: { current: string }) {
  const [change, { isLoading }] = useChangeStaffEmailMutation();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function close() {
    setOpen(false);
    setEmail("");
    setPassword("");
    setError(null);
  }

  return (
    <div className="px-5 py-5 text-sm">
      <div className="font-medium">Sign-in address</div>
      <p className="mt-1 text-muted">{saved ? email || current : current}</p>

      {!open ? (
        <button
          className="btn-quiet mt-3"
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          Change address
        </button>
      ) : (
        <div className="mt-4 max-w-sm space-y-3">
          <ErrorNote message={error} />
          <label className="block">
            <span className="mb-1 block font-medium">New address</span>
            <input
              className="field"
              type="email"
              autoComplete="username"
              value={email}
              maxLength={320}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Your current password</span>
            <input
              className="field"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="mt-1 block text-xs text-muted">
              Asked for because this is how you sign in. A signed-in tablet left on a counter
              should not be a way to move someone&apos;s login.
            </span>
          </label>
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={isLoading || !email.trim() || !password}
              onClick={async () => {
                setError(null);
                try {
                  await change({ email: email.trim(), current_password: password }).unwrap();
                  setPassword("");
                  setOpen(false);
                  setSaved(true);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              {isLoading ? "Saving…" : "Change address"}
            </button>
            <button className="text-sm text-muted underline" onClick={close}>
              cancel
            </button>
          </div>
        </div>
      )}
      {saved && !open && (
        <p className="mt-2 text-muted">Saved. Use this address next time you sign in.</p>
      )}
    </div>
  );
}
