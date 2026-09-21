import { useEffect, useRef, useState } from "react";
import { useAppSelector } from "@/app/hooks";
import { ErrorNote, SettingsHeading } from "@/components/common/Feedback";
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
 * endpoints behind it are open to every role while that page is not. Settings
 * shows it as its first panel; every other portal page opens it from the
 * account menu, with `onClose`, which is how a cashier or a driver reaches it.
 */
export function OwnAccount({ onClose }: { onClose?: () => void }) {
  const me = useStaffMeQuery();
  const session = useAppSelector(selectSession);
  const heading = useRef<HTMLHeadingElement>(null);

  // Opened from the account menu: the panel appears above the page, so move
  // focus to it -- otherwise a keyboard user is left on a menu that has gone.
  useEffect(() => {
    if (onClose) heading.current?.focus();
  }, [onClose]);

  return (
    <section
      id="own-account"
      aria-labelledby="own-account-heading"
      className={`card scroll-mt-6 ${onClose ? "mb-6 animate-disclose" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <SettingsHeading
          id="own-account-heading"
          headingRef={heading}
          title="Your account"
          subtitle="Only you can change these."
        />
        {onClose && (
          <button type="button" className="link" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <NameForm current={me.data?.full_name ?? null} />
      <hr className="my-6 border-hairline" />
      <EmailForm current={me.data?.email ?? session.email ?? ""} />
      <hr className="my-6 border-hairline" />
      <div className="text-sm">
        <h3 className="text-base font-semibold">Password</h3>
        <p className="field-hint">Changing it signs you out on every device, this one included.</p>
        <a className="link" href="/manage/change-password">
          Change password
        </a>
      </div>
    </section>
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
    <div className="mt-6">
      <ErrorNote message={error} />
      <label className="block">
        <span className="label">Your name</span>
        <input
          className="field mt-[7px] max-w-sm"
          value={shown}
          maxLength={160}
          autoComplete="name"
          placeholder="Shown to the rest of the team"
          onChange={(e) => {
            setSaved(false);
            setValue(e.target.value);
          }}
        />
        <span className="field-hint block max-w-prose">
          Appears beside the orders you hand over, and on the team list. Leave it empty to show
          your email address instead.
        </span>
      </label>
      <div className="mt-3 flex items-center gap-3" aria-live="polite">
        <button
          type="button"
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
        {saved && !dirty && <span className="text-caption text-success">Saved.</span>}
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
    <div className="text-sm">
      <h3 className="text-base font-semibold">Sign-in address</h3>
      <p className="mt-1 text-muted" style={{ overflowWrap: "anywhere" }}>
        {saved ? email || current : current}
      </p>

      {!open ? (
        <button
          type="button"
          className="link"
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          Change address
        </button>
      ) : (
        <form
          className="mt-4 flex max-w-sm animate-disclose flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (isLoading || !email.trim() || !password) return;
            setError(null);
            try {
              await change({ email: email.trim(), current_password: password }).unwrap();
              setPassword("");
              setOpen(false);
              setSaved(true);
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <label className="block">
            <span className="label">New address</span>
            <input
              className="field mt-[7px]"
              type="email"
              autoComplete="username"
              value={email}
              maxLength={320}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">Your current password</span>
            <input
              className="field mt-[7px]"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="field-hint block">
              Asked for because this is how you sign in. A signed-in tablet left on a counter
              should not be a way to move someone&apos;s login.
            </span>
          </label>
          <ErrorNote message={error} className="mb-0" />
          <div className="flex items-center gap-4">
            <button type="submit" className="btn-primary" disabled={isLoading || !email.trim() || !password}>
              {isLoading ? "Saving…" : "Change address"}
            </button>
            <button type="button" className="link" onClick={close}>
              cancel
            </button>
          </div>
        </form>
      )}
      {saved && !open && (
        <p className="mt-2 text-success" aria-live="polite">
          Saved. Use this address next time you sign in.
        </p>
      )}
    </div>
  );
}
