import { errorMessage, request } from "@/services/apiClient";

/**
 * Replace a temporary password. Part of the credential flow, so it stays
 * outside React with the login pages rather than being the one auth screen
 * that pulls in the whole app bundle.
 *
 * Reached automatically after signing in with the password the super admin
 * issued. The API refuses every other staff endpoint until this is done, so
 * this is not a suggestion -- it is the only thing the account can do.
 */

const MIN_LENGTH = 12;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}; the markup and script disagree.`);
  return node as T;
}

const form = el<HTMLFormElement>("change-form");
const currentInput = el<HTMLInputElement>("current");
const nextInput = el<HTMLInputElement>("next");
const confirmInput = el<HTMLInputElement>("confirm");
const lengthHint = el<HTMLSpanElement>("length-hint");
const matchHint = el<HTMLSpanElement>("match-hint");
const errorBox = el<HTMLParagraphElement>("error");
const submitButton = el<HTMLButtonElement>("submit");

/** Mirrors the server's rules so the button only enables on input the API will
 *  accept. The server enforces them regardless; this just avoids a round trip
 *  to be told something the page already knew. */
function validate(): void {
  const next = nextInput.value;
  const confirm = confirmInput.value;
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;

  lengthHint.className = `mt-1 block text-xs ${tooShort ? "text-brick" : "text-muted"}`;
  matchHint.hidden = !mismatch;
  submitButton.disabled = !(
    currentInput.value &&
    next.length >= MIN_LENGTH &&
    next === confirm
  );
}

for (const input of [currentInput, nextInput, confirmInput]) {
  input.addEventListener("input", validate);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  submitButton.disabled = true;
  submitButton.textContent = "Saving…";

  try {
    await request<void>("/restaurant/change-password", {
      method: "POST",
      body: {
        current_password: currentInput.value,
        new_password: nextInput.value,
      },
    });
    // The API clears the session on success, so the new password has to be
    // used straight away rather than the old one silently continuing.
    window.location.assign("/manage/login");
  } catch (e) {
    errorBox.textContent = errorMessage(e);
    errorBox.hidden = false;
    submitButton.textContent = "Set password";
    validate();
  }
});
