import { errorMessage, request } from "@/services/apiClient";

/**
 * Restaurant staff sign-in. Deliberately outside React, like the admin one.
 *
 * Which restaurant this is comes from the subdomain the page was served on,
 * never from a field on the form, so the same entry point serves every tenant
 * and nobody can sign in to a restaurant by typing its name.
 */

type StaffMe = {
  role_code: string;
  must_change_password: boolean;
};

/** Where this person lands. A driver has no kitchen board -- the portal would
 *  only tell them the page is not part of their role. */
function home(me: StaffMe): string {
  const next = nextPath();
  if (next === "/manage" && me.role_code === "DRIVER") return "/manage/deliveries";
  return next;
}

function nextPath(): string {
  const raw = new URLSearchParams(window.location.search).get("next");
  // Same-origin paths only. An absolute URL here would be an open redirect.
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/manage";
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

function setBusy(busy: boolean): void {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? "Signing in…" : "Sign in";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    showError("Enter your email and password.");
    return;
  }

  setBusy(true);
  try {
    const me = await request<StaffMe>("/restaurant/login", {
      method: "POST",
      body: { email, password },
    });
    // A temporary password gets you exactly one place. The API refuses every
    // other staff endpoint until it is replaced, so going anywhere else would
    // only bounce.
    window.location.assign(
      me.must_change_password ? "/manage/change-password" : home(me),
    );
  } catch (e) {
    showError(errorMessage(e));
    setBusy(false);
    passwordInput.select();
  }
});
