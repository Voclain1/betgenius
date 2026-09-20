/**
 * When Google One Tap may appear.
 *
 * Pure — no DOM, no React — so every gate is assertable
 * (scripts/check-google-one-tap.ts), including the ones that only matter when
 * they are wrong: a signed-in user being asked to sign in, or the prompt
 * fighting the Google button on the login page.
 *
 * WHAT ONE TAP IS NOT. It does not read the browser's Google account, and
 * nothing here tries to. The prompt is rendered and controlled by Google
 * Identity Services in the browser; the site asks it to consider showing, and
 * Google decides — based on its own session state, the user's prior
 * dismissals, and (under FedCM) the browser's own permission model. Every
 * suppression rule Google applies is on top of the ones below, never instead
 * of them.
 */

/** The GIS script. Loaded only when the gates below pass, so a signed-in user never fetches it. */
export const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/**
 * localStorage key recording that the visitor dismissed the prompt.
 *
 * Google already applies its own exponential cool-down, but that state lives
 * with Google and is not something this app can reason about or test. This is
 * the site's own restraint, and it is the one that can be asserted.
 */
export const ONE_TAP_DISMISSED_KEY = "betgenius:one-tap-dismissed";

/**
 * How long a dismissal suppresses the prompt.
 *
 * A week. Someone who closed it has answered; asking again tomorrow is the
 * behaviour that makes One Tap feel like a popup rather than a convenience,
 * and the fallback "Continue with Google" button on /login and /register is
 * always there for anyone who changes their mind in the meantime.
 */
export const ONE_TAP_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Paths where One Tap must stay out of the way.
 *
 * /login and /register already present a full-width "Continue with Google"
 * button. Floating a second Google affordance over a page that has one is
 * confusing on its own, and on a narrow screen the prompt lands on top of the
 * button it duplicates. The requirement is explicit about this, and it is also
 * simply where a visitor has already chosen how they want to sign in.
 */
export const ONE_TAP_EXCLUDED_PATHS = ["/login", "/register", "/reset-password"];

export function isExcludedPath(pathname: string): boolean {
  return ONE_TAP_EXCLUDED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Parses the stored dismissal timestamp, tolerating anything that is not one. */
export function dismissedRecently(raw: string | null, now: number = Date.now()): boolean {
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at) || at <= 0) return false;
  // A future timestamp (clock moved backwards) would otherwise suppress the
  // prompt indefinitely. Fail towards showing: the cost is one prompt.
  if (at > now) return false;
  return now - at < ONE_TAP_DISMISS_COOLDOWN_MS;
}

/**
 * NextAuth's session status, plus the "we have not asked yet" state.
 * "loading" is a distinct answer and must not be collapsed into
 * "unauthenticated" — see below.
 */
export type SessionStatus = "authenticated" | "unauthenticated" | "loading";

/**
 * The whole decision.
 *
 * ORDER MATTERS. `authenticated` is refused first and unconditionally: showing
 * a signed-in user a prompt to sign in is the single most visible way this
 * feature can be wrong, and it is what a naive "is there a Google session"
 * check gets wrong on every page load.
 *
 * `loading` is refused too, and that is not the same gate. NextAuth reports
 * "loading" briefly on first paint before it has resolved the session, so
 * treating it as unauthenticated would flash One Tap at signed-in users for a
 * few hundred milliseconds on every cold load — the same bug, just harder to
 * notice and impossible to reproduce on a fast connection.
 */
export function shouldInitializeOneTap(input: {
  status: SessionStatus;
  pathname: string;
  /** Google Identity Services is usable here — see oneTapSupported. */
  supported: boolean;
  /** NEXT_PUBLIC_GOOGLE_CLIENT_ID is configured. */
  configured: boolean;
  dismissed: boolean;
}): boolean {
  if (input.status !== "unauthenticated") return false;
  if (!input.configured) return false;
  if (!input.supported) return false;
  if (input.dismissed) return false;
  if (isExcludedPath(input.pathname)) return false;
  return true;
}

/**
 * Whether this environment can run One Tap at all.
 *
 * Deliberately a capability check, not a browser sniff. GIS needs a DOM, a
 * document to inject into, and third-party-cookie-ish storage access; where it
 * cannot run it simply never invokes the callback, which is why every failure
 * below degrades to "no prompt" rather than to an error. The signed-out
 * visitor still has the ordinary Google button and the email form.
 *
 * `cookieEnabled` is the one that matters in practice: with cookies blocked,
 * GIS cannot establish the state it needs and the prompt is suppressed by
 * Google anyway. Checking it here means the script is never even fetched.
 */
export function oneTapSupported(env: {
  hasDocument: boolean;
  cookieEnabled: boolean;
}): boolean {
  return env.hasDocument && env.cookieEnabled;
}
