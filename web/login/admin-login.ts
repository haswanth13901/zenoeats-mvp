import { errorMessage, request } from "@/services/apiClient";

/**
 * Platform administrator sign-in. Deliberately outside React.
 *
 * This is a separate HTML entry point, not a route in the SPA, so no React
 * runtime is loaded on the credential path at all. On success the browser does
 * a full navigation into the app; by the time it renders, the httpOnly session
 * cookie is already set and the first request is authenticated.
 *
 * Written in TypeScript because "vanilla" means no framework, not untyped --
 * the response shape and the DOM lookups are both worth checking.
 */

type AdminOut = { email: string };

/** Where to go after signing in. Preserved across the redirect so a deep link
 *  that bounced to login returns to where it was headed. Only same-origin
 *  paths are accepted: an absolute URL here would be an open redirect, which
 *  is how a convincing phishing page gets to live on your own domain. */
function nextPath(): string {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/admin";
  return raw;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}; the login markup and script disagree.`);
  return node as T;
}

const form = el<HTMLFormElement>("login-form");
const emailInput = el<HTMLInputElement>("email");
const passwordInput = el<HTMLInputElement>("password");
const errorBox = el<HTMLParagraphElement>("error");
const submitButton = el<HTMLButtonElement>("submit");

function showError(message: string): void {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError(): void {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? "Signing in…" : "Sign in";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    showError("Enter your email and password.");
    return;
  }

  setBusy(true);
  try {
    await request<AdminOut>("/admin/login", {
      method: "POST",
      body: { email, password },
    });
    // assign, not href replace: a full navigation is the point. The SPA boots
    // with the cookie already present rather than having to be told about it.
    window.location.assign(nextPath());
  } catch (e) {
    // The API answers a wrong password and an unknown address identically, and
    // this shows whatever it said without adding detail of its own.
    showError(errorMessage(e));
    setBusy(false);
    passwordInput.select();
  }
});
