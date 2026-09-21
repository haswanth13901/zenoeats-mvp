import { errorMessage, request } from "@/services/apiClient";
import {
  RETURN_ERRORS, activateAndContinue, clerkErrorMessage, el, loadClerk, nextPath,
  paintRestaurantName, paintWordmarks, params, readCode, showMessage, wireSocialButtons,
  withNext,
  type ClerkInstance,
} from "./customer-shared";

/**
 * Customer sign-in: Google, Apple, Facebook, or an email and password, through Clerk.
 *
 * Reached from checkout carrying ?next=, so the cart is waiting afterwards;
 * from a social sign-in that did not complete, carrying ?error=; and from a
 * social sign-in that needs a second step, carrying ?second_factor=1.
 */

type SignIn = NonNullable<ClerkInstance["client"]>["signIn"];

type SecondFactor = "totp" | "phone_code" | "email_code" | "backup_code";

// Preferred first: an authenticator app needs no message to arrive, and a
// backup code is the last resort it is meant to be.
const SECOND_FACTOR_ORDER: SecondFactor[] = ["totp", "phone_code", "email_code", "backup_code"];

const SWITCH_LABEL: Record<SecondFactor, string> = {
  totp: "Use your authenticator app instead",
  phone_code: "Text me a code instead",
  email_code: "Email me a code instead",
  backup_code: "Use a backup code instead",
};

const form = el<HTMLFormElement>("login-form");
const emailInput = el<HTMLInputElement>("email");
const passwordInput = el<HTMLInputElement>("password");
const errorBox = el<HTMLParagraphElement>("error");
const submitButton = el<HTMLButtonElement>("submit");
const codeForm = el<HTMLFormElement>("code-form");
const codeInput = el<HTMLInputElement>("code");
const codeButton = el<HTMLButtonElement>("code-submit");
const codeIntro = el<HTMLParagraphElement>("code-intro");
const codeLabel = el<HTMLSpanElement>("code-label");
const alternatives = el<HTMLDivElement>("code-alternatives");

el<HTMLAnchorElement>("forgot").href = withNext("/account/forgot-password");
el<HTMLAnchorElement>("sign-up").href = withNext("/account/sign-up");

const returned = params().get("error");
if (returned) showMessage(errorBox, RETURN_ERRORS[returned] ?? "Sign-in didn't complete. Try again.");

void paintWordmarks();

void paintRestaurantName(el("heading"), (name) => `Sign in to order from ${name}`).then(
  (hasRestaurant) => {
    if (hasRestaurant) wireGuestCheckout();
  },
);

/**
 * "Continue as guest": order with no account behind it.
 *
 * Nothing here is verified. The address is where the receipt and the link to
 * the order are sent, and the session it creates is an httpOnly cookie -- so
 * losing this browser loses the order, which is what the panel says before
 * anyone chooses it.
 *
 * Deliberately independent of Clerk: this is the path that still works when
 * Clerk is unreachable or was never configured, and it must not wait on a
 * script that may never load.
 */
function wireGuestCheckout(): void {
  const section = el<HTMLElement>("guest-section");
  const guestForm = el<HTMLFormElement>("guest-form");
  const guestEmail = el<HTMLInputElement>("guest-email");
  const guestName = el<HTMLInputElement>("guest-name");
  const guestButton = el<HTMLButtonElement>("guest-submit");
  const guestError = el<HTMLParagraphElement>("guest-error");
  section.hidden = false;

  guestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(guestError, null);

    const email = guestEmail.value.trim();
    if (!email) {
      showMessage(guestError, "Enter an email address we can send your receipt to.");
      guestEmail.focus();
      return;
    }

    guestButton.disabled = true;
    guestButton.textContent = "Setting up…";
    try {
      await request("/orders/guest-session", {
        method: "POST",
        body: { email, full_name: guestName.value.trim() || null },
      });
      // A full navigation, like a finished sign-in: the app boots holding the
      // cookie, and the cart is where they left it.
      window.location.replace(nextPath());
    } catch (e) {
      showMessage(guestError, errorMessage(e));
      guestButton.disabled = false;
      guestButton.textContent = "Continue as guest";
    }
  });
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? "Signing in…" : "Sign in";
}

void loadClerk(errorBox).then((clerk) => {
  if (clerk) start(clerk);
});

function start(clerk: ClerkInstance): void {
  // Already signed in: this page has nothing to offer.
  if (clerk.user) {
    window.location.replace(nextPath());
    return;
  }

  const signIn = (): SignIn => clerk.client!.signIn;
  let factor: SecondFactor | null = null;

  /** The second-step methods this sign-in offers that this page can handle,
   *  in preference order. */
  function availableFactors(attempt: SignIn): SecondFactor[] {
    const offered = new Set((attempt.supportedSecondFactors ?? []).map((f) => f.strategy));
    return SECOND_FACTOR_ORDER.filter((s) => offered.has(s));
  }

  /** Ask for (and, where it is sent, send) one second-step code. */
  async function beginSecondFactor(attempt: SignIn, chosen: SecondFactor): Promise<void> {
    const offered = attempt.supportedSecondFactors ?? [];
    const details = offered.find((f) => f.strategy === chosen);
    const where = details && "safeIdentifier" in details ? details.safeIdentifier : null;

    if (chosen === "phone_code") {
      await attempt.prepareSecondFactor({
        strategy: "phone_code",
        ...(details && "phoneNumberId" in details ? { phoneNumberId: details.phoneNumberId } : {}),
      });
      codeIntro.textContent = `We texted a 6-digit code to ${where ?? "your phone"}.`;
    } else if (chosen === "email_code") {
      await attempt.prepareSecondFactor({
        strategy: "email_code",
        ...(details && "emailAddressId" in details ? { emailAddressId: details.emailAddressId } : {}),
      });
      codeIntro.textContent = `We sent a 6-digit code to ${where ?? "your email"}.`;
    } else if (chosen === "totp") {
      codeIntro.textContent = "Enter the 6-digit code from your authenticator app.";
    } else {
      codeIntro.textContent = "Enter one of the backup codes you saved when you set up two-step verification.";
    }

    factor = chosen;
    // Backup codes are letters and digits; the others are six digits.
    const backup = chosen === "backup_code";
    codeLabel.textContent = backup ? "Backup code" : "Verification code";
    codeInput.inputMode = backup ? "text" : "numeric";
    codeInput.autocomplete = backup ? "off" : "one-time-code";
    codeInput.maxLength = backup ? 32 : 7;
    codeInput.value = "";

    alternatives.replaceChildren();
    for (const other of availableFactors(attempt)) {
      if (other === chosen) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link";
      button.textContent = SWITCH_LABEL[other];
      button.addEventListener("click", async () => {
        showMessage(errorBox, null);
        try {
          await beginSecondFactor(signIn(), other);
        } catch (e) {
          showMessage(errorBox, clerkErrorMessage(e));
        }
      });
      alternatives.append(button);
    }

    el("password-section").hidden = true;
    el("code-section").hidden = false;
    codeInput.focus();
  }

  /** Finish, or move to the second step, or say plainly that we cannot. */
  async function advance(attempt: SignIn): Promise<void> {
    if (attempt.status === "complete") {
      await activateAndContinue(clerk, attempt.createdSessionId);
      return;
    }

    // needs_second_factor: two-step verification is on for this account.
    // needs_client_trust: Clerk wants this new device confirmed with a code.
    if (attempt.status === "needs_second_factor" || attempt.status === "needs_client_trust") {
      const [first] = availableFactors(attempt);
      if (first) {
        await beginSecondFactor(attempt, first);
        return;
      }
    }

    showMessage(
      errorBox,
      "This account needs a sign-in step this page doesn't support. Try another way to sign in, or reset your password.",
    );
  }

  // Sent back here by the social callback, mid-sign-in.
  const pending = signIn();
  if (params().get("second_factor") === "1" && pending?.status === "needs_second_factor") {
    void advance(pending).catch((e) => showMessage(errorBox, clerkErrorMessage(e)));
  }

  wireSocialButtons(clerk, "sign-in", el("social-buttons"), el("social-section"), errorBox);
  submitButton.disabled = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(errorBox, null);

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      showMessage(errorBox, "Enter your email and password.");
      return;
    }

    setBusy(true);
    try {
      await advance(await signIn().create({ strategy: "password", identifier: email, password }));
    } catch (e) {
      showMessage(errorBox, clerkErrorMessage(e));
      passwordInput.select();
    }
    setBusy(false);
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(errorBox, null);
    if (!factor) return;

    const code = factor === "backup_code" ? codeInput.value.trim() : readCode(codeInput);
    if (factor === "backup_code" ? code.length === 0 : code.length !== 6) {
      showMessage(
        errorBox,
        factor === "backup_code" ? "Enter a backup code." : "Enter the 6-digit code.",
      );
      return;
    }

    codeButton.disabled = true;
    codeButton.textContent = "Checking…";
    try {
      const attempt = await signIn().attemptSecondFactor({ strategy: factor, code });
      if (attempt.status === "complete") {
        await activateAndContinue(clerk, attempt.createdSessionId);
        return;
      }
      showMessage(errorBox, "That didn't finish signing you in. Start again.");
    } catch (e) {
      showMessage(errorBox, clerkErrorMessage(e));
    }
    codeButton.disabled = false;
    codeButton.textContent = "Continue";
  });
}
