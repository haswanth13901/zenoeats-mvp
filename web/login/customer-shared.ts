import { request } from "@/services/apiClient";
import { clerkErrorCode, clerkErrorMessage, getClerk } from "@/services/clerk";

/**
 * What the customer account pages have in common.
 *
 * The markup is ours and stays outside React like the portal logins: a
 * separate HTML entry per page, and a full navigation back into the app once
 * signed in. Clerk works underneath -- it checks the password, runs Google,
 * sends the codes and holds the session -- but none of its UI is rendered.
 */

export type ClerkInstance = Awaited<ReturnType<typeof getClerk>>;

export { clerkErrorCode, clerkErrorMessage };

export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}; the page markup and script disagree.`);
  return node as T;
}

export function params(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/** Where to go afterwards. Same-origin paths only: an absolute URL here would
 *  be an open redirect. */
export function nextPath(fallback = "/"): string {
  const raw = params().get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return fallback;
  }
  return raw;
}

/** A link to another account page that keeps the return path. */
export function withNext(path: string): string {
  const next = nextPath("");
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

export function showMessage(box: HTMLElement, message: string | null): void {
  box.textContent = message ?? "";
  box.hidden = !message;
}

/** Load Clerk, or say on the page why sign-in cannot work right now. */
export async function loadClerk(errorBox: HTMLElement): Promise<ClerkInstance | null> {
  try {
    return await getClerk();
  } catch (e) {
    showMessage(errorBox, e instanceof Error && e.message.includes("VITE_CLERK")
      ? e.message
      : "Couldn't reach the sign-in service. Check your connection and reload.");
    return null;
  }
}

/** Instance settings, read defensively: this is Clerk's own configuration
 *  object, and a page that breaks when its shape moves is worse than one that
 *  guesses. */
function userSettings(clerk: ClerkInstance) {
  try {
    return clerk.__internal_environment?.userSettings ?? null;
  } catch {
    return null;
  }
}

export function minPasswordLength(clerk: ClerkInstance): number {
  return userSettings(clerk)?.passwordSettings?.min_length || 8;
}

/** Whether the instance collects first and last names at sign-up. Sending
 *  them to an instance that does not is an error, not a no-op. */
export function namesEnabled(clerk: ClerkInstance): boolean {
  const attributes = userSettings(clerk)?.attributes;
  return Boolean(attributes?.first_name?.enabled);
}

/** Whether the instance records agreement to the terms itself.
 *
 *  The checkbox is shown either way -- agreement is ours to ask for, not
 *  Clerk's -- but `legalAccepted` may only be sent to an instance that has
 *  the setting switched on, where it is an error rather than a no-op. When it
 *  is off, the agreement is recorded on our own side at first sign-in. */
export function legalConsentEnabled(clerk: ClerkInstance): boolean {
  // Not in Clerk's published Attributes type, though the instance sends it.
  // Read through an index rather than added to their type: this is their
  // configuration object, and asserting a shape onto it is how a page breaks
  // when the shape moves.
  const attributes: Record<string, { enabled?: boolean } | undefined> =
    userSettings(clerk)?.attributes ?? {};
  return Boolean(attributes["legal_accepted"]?.enabled);
}

/** Build a same-origin account-page URL that keeps ?next= and adds more. */
export function accountUrl(path: string, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams(extra);
  const next = nextPath("");
  if (next) query.set("next", next);
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

export type SocialStrategy = "oauth_google" | "oauth_apple" | "oauth_facebook";

type SocialProvider = {
  strategy: SocialStrategy;
  name: string;
  /** Brand treatment each provider asks for: Google's neutral button, Apple's
   *  black one, Facebook's blue one. */
  className: string;
  icon: string;
};

const BUTTON_LAYOUT = "w-full gap-3";

// Logos are static markup written by us, never data from a request.
const SOCIAL_PROVIDERS: SocialProvider[] = [
  {
    strategy: "oauth_google",
    name: "Google",
    className: `btn-quiet ${BUTTON_LAYOUT}`,
    icon: `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`,
  },
  {
    strategy: "oauth_apple",
    name: "Apple",
    className: `btn ${BUTTON_LAYOUT} border-black bg-black text-white hover:bg-black/85`,
    icon: `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>`,
  },
  {
    strategy: "oauth_facebook",
    name: "Facebook",
    className: `btn ${BUTTON_LAYOUT} border-[#1877F2] bg-[#1877F2] text-white hover:bg-[#166FE5]`,
    icon: `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>`,
  },
];

/** The social sign-ins switched on for this Clerk instance, in page order.
 *  When the settings cannot be read, Google alone: offering three buttons
 *  that might all be switched off would be worse than offering one. */
export function enabledSocialStrategies(clerk: ClerkInstance): SocialStrategy[] {
  const settings = userSettings(clerk);
  if (!settings) return ["oauth_google"];
  const enabled = new Set<string>(settings.authenticatableSocialStrategies);
  return SOCIAL_PROVIDERS.map((p) => p.strategy).filter((s) => enabled.has(s));
}

/**
 * Hand the browser to a social provider through Clerk.
 *
 * Every leg comes back to our /account/sso-callback page, which lets Clerk
 * finish -- including turning a "sign in" by someone with no account into a
 * sign-up -- and then continues to where the customer was going.
 */
export async function continueWithProvider(
  clerk: ClerkInstance,
  mode: "sign-in" | "sign-up",
  strategy: SocialStrategy,
): Promise<void> {
  const origin = window.location.origin;
  const next = nextPath();
  const target = {
    strategy,
    redirectUrl: `${origin}/account/sso-callback?next=${encodeURIComponent(next)}`,
    redirectUrlComplete: `${origin}${next}`,
  };
  const client = clerk.client;
  if (!client) throw new Error("Sign-in is still starting. Try again in a moment.");
  if (mode === "sign-up") await client.signUp.authenticateWithRedirect(target);
  else await client.signIn.authenticateWithRedirect(target);
}

/** Render a button per enabled provider into `container`, and reveal
 *  `section` only if there is at least one. Turning a provider on or off in
 *  the Clerk dashboard is all it takes to change what appears. */
export function wireSocialButtons(
  clerk: ClerkInstance,
  mode: "sign-in" | "sign-up",
  container: HTMLElement,
  section: HTMLElement,
  errorBox: HTMLElement,
  /** Asked before the browser leaves for the provider, and refused if it
   *  answers false. Sign-up passes the consent checkbox: the account is
   *  created at the far end of this redirect, and Clerk finishes a social
   *  sign-up by itself whenever the provider gave it everything -- so the
   *  form's own checkbox is never reached on that path. Sign-in passes
   *  nothing, because signing in agrees to nothing new. */
  allowed?: () => boolean,
): void {
  const strategies = enabledSocialStrategies(clerk);
  if (strategies.length === 0) return;

  const verb = mode === "sign-up" ? "Sign up" : "Continue";
  const buttons: HTMLButtonElement[] = [];
  for (const provider of SOCIAL_PROVIDERS) {
    if (!strategies.includes(provider.strategy)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = provider.className;
    button.dataset.strategy = provider.strategy;
    button.innerHTML = provider.icon;
    button.append(`${verb} with ${provider.name}`);
    button.addEventListener("click", async () => {
      showMessage(errorBox, null);
      if (allowed && !allowed()) {
        showMessage(errorBox, "Agree to the terms to create your account.");
        return;
      }
      buttons.forEach((b) => (b.disabled = true));
      try {
        await continueWithProvider(clerk, mode, provider.strategy);
      } catch (e) {
        showMessage(errorBox, clerkErrorMessage(e));
        buttons.forEach((b) => (b.disabled = false));
      }
    });
    buttons.push(button);
    container.append(button);
  }
  section.hidden = false;
}

/** Make a finished sign-in the browser's session, then go on. A full
 *  navigation, so the app boots already signed in. */
export async function activateAndContinue(clerk: ClerkInstance, sessionId: string | null) {
  await clerk.setActive({ session: sessionId });
  window.location.replace(nextPath());
}

/** "Sign in to order from Spice House", when the page is on a restaurant's
 *  address. The platform root has no restaurant, and says so by failing.
 *
 *  Resolves to whether there was one, because the guest panel turns on the
 *  same answer: a guest session is created against a restaurant, so there is
 *  nothing to continue as on an address that names none. */
export async function paintRestaurantName(
  target: HTMLElement,
  template: (name: string) => string,
): Promise<boolean> {
  try {
    const portal = await restaurant();
    target.textContent = template(portal.name);
    return true;
  } catch {
    /* keep the generic heading */
    return false;
  }
}

/** The restaurant this address belongs to, read once however many parts of
 *  the page want it. */
let pending: Promise<{ name: string }> | null = null;

function restaurant(): Promise<{ name: string }> {
  pending ??= request<{ name: string }>("/portal");
  return pending;
}

/** Put the restaurant's own name in the wordmarks, as the storefront header
 *  does. These pages belong to the restaurant being ordered from, not to the
 *  platform; on the platform root there is no restaurant and the Zenoeats
 *  wordmark in the markup stands. */
export async function paintWordmarks(): Promise<void> {
  try {
    const { name } = await restaurant();
    const initial = name.trim().charAt(0).toUpperCase();
    document.querySelectorAll("[data-wordmark-name]").forEach((el) => {
      el.textContent = name;
    });
    document.querySelectorAll("[data-wordmark-mark]").forEach((el) => {
      el.textContent = initial;
    });
  } catch {
    /* keep the platform wordmark */
  }
}

/** Why a social sign-in came back to the sign-in page, in words. */
export const RETURN_ERRORS: Record<string, string> = {
  social_failed: "That sign-in didn't complete. Try again.",
  // The name used before Apple and Facebook were added; old links still work.
  google_failed: "That sign-in didn't complete. Try again.",
};

/** Mirrors Clerk's password rules so the submit button enables only on input
 *  Clerk will accept. Clerk enforces them regardless. */
export function wirePasswordPair(
  minLength: number,
  password: HTMLInputElement,
  confirm: HTMLInputElement,
  lengthHint: HTMLElement,
  matchHint: HTMLElement,
  onChange: (valid: boolean) => void,
): void {
  lengthHint.textContent = `At least ${minLength} characters.`;
  const validate = () => {
    const tooShort = password.value.length > 0 && password.value.length < minLength;
    const mismatch = confirm.value.length > 0 && password.value !== confirm.value;
    lengthHint.className = `mt-2 block text-caption ${tooShort ? "text-danger" : "text-muted"}`;
    matchHint.hidden = !mismatch;
    onChange(password.value.length >= minLength && password.value === confirm.value);
  };
  password.addEventListener("input", validate);
  confirm.addEventListener("input", validate);
  validate();
}

/** The six-digit field Clerk's email codes are typed into. Digits only, and
 *  a pasted "123 456" still works. */
export function readCode(input: HTMLInputElement): string {
  return input.value.replace(/\D/g, "").slice(0, 6);
}
