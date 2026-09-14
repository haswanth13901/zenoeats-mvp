import {
  activateAndContinue, clerkErrorMessage, el, loadClerk, minPasswordLength, readCode,
  showMessage, wirePasswordPair, withNext, type ClerkInstance,
} from "./customer-shared";

/**
 * Reset a forgotten password, through Clerk.
 *
 * Clerk emails a 6-digit code; the customer types it here with the new
 * password, and is signed in on this device once Clerk accepts both.
 */

const emailForm = el<HTMLFormElement>("email-form");
const emailInput = el<HTMLInputElement>("email");
const emailButton = el<HTMLButtonElement>("email-submit");
const resetForm = el<HTMLFormElement>("reset-form");
const codeInput = el<HTMLInputElement>("code");
const passwordInput = el<HTMLInputElement>("password");
const confirmInput = el<HTMLInputElement>("confirm");
const resetButton = el<HTMLButtonElement>("reset-submit");
const resendButton = el<HTMLButtonElement>("resend");
const errorBox = el<HTMLParagraphElement>("error");

el<HTMLAnchorElement>("sign-in").href = withNext("/account/sign-in");

void loadClerk(errorBox).then((clerk) => {
  if (clerk) start(clerk);
});

function start(clerk: ClerkInstance): void {
  emailButton.disabled = false;
  let passwordsValid = false;

  wirePasswordPair(
    minPasswordLength(clerk), passwordInput, confirmInput, el("length-hint"), el("match-hint"),
    (valid) => {
      passwordsValid = valid;
      resetButton.disabled = !valid;
    },
  );

  async function sendCode(email: string): Promise<void> {
    await clerk.client!.signIn.create({ strategy: "reset_password_email_code", identifier: email });
  }

  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(errorBox, null);

    const email = emailInput.value.trim();
    if (!email.includes("@")) {
      showMessage(errorBox, "Enter your email address.");
      return;
    }

    emailButton.disabled = true;
    emailButton.textContent = "Sending…";
    try {
      await sendCode(email);
      el("sent-to").textContent = email;
      el("email-section").hidden = true;
      el("reset-section").hidden = false;
      codeInput.focus();
    } catch (e) {
      showMessage(errorBox, clerkErrorMessage(e));
      emailButton.disabled = false;
      emailButton.textContent = "Send code";
    }
  });

  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(errorBox, null);
    const code = readCode(codeInput);
    if (code.length !== 6) {
      showMessage(errorBox, "Enter the 6-digit code from your email.");
      return;
    }
    if (!passwordsValid) return;

    resetButton.disabled = true;
    resetButton.textContent = "Saving…";
    try {
      const attempt = await clerk.client!.signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code,
        password: passwordInput.value,
      });
      if (attempt.status === "complete") {
        await activateAndContinue(clerk, attempt.createdSessionId);
        return;
      }
      showMessage(
        errorBox,
        "Your password was changed, but this account needs another sign-in step. Sign in to continue.",
      );
    } catch (e) {
      showMessage(errorBox, clerkErrorMessage(e));
    }
    resetButton.textContent = "Set password";
    resetButton.disabled = !passwordsValid;
  });

  resendButton.addEventListener("click", async () => {
    showMessage(errorBox, null);
    resendButton.disabled = true;
    try {
      await sendCode(emailInput.value.trim());
      codeInput.value = "";
      codeInput.focus();
    } catch (e) {
      showMessage(errorBox, clerkErrorMessage(e));
    }
    setTimeout(() => {
      resendButton.disabled = false;
    }, 15_000);
  });
}
