/**
 * Decision logic for the BetGenius-controlled push onboarding prompt.
 *
 * Pure functions, no DOM and no React, so every rule can be asserted directly
 * (scripts/check-push-onboarding.ts) rather than only observed by driving a
 * browser. src/components/PushOnboarding.tsx owns the storage and the
 * rendering; this file owns "should it be on screen at all".
 *
 * WHY A CUSTOM PROMPT AT ALL. Notification.requestPermission() is a one-shot,
 * effectively irreversible ask: a "Block" can never be re-requested by the
 * page, only undone by the visitor in browser settings. Firing it on load
 * spends that single chance on someone who has not yet been told what they
 * would be subscribing to. So the native dialog is opened ONLY from an explicit
 * click on our own "Enable notifications" button, never from a mount, an effect
 * or a timer. The component enforces that, but it is the reason this file
 * exists at all.
 *
 * THE THREE STATES ARE NOT THE SAME FACT, and conflating any two of them is the
 * defect this module is shaped to prevent:
 *
 *   "default"  - the browser has no answer. Eligible for our soft prompt.
 *   "granted"  - answered yes. Onboarding is over, permanently.
 *   "denied"   - answered no AT THE BROWSER LEVEL. Irreversible from here.
 *
 * and, orthogonal to all three, OUR OWN "Not now". That is a soft dismissal of
 * a BetGenius modal, not a browser decision: permission is still "default", the
 * native dialog was never opened, and the visitor stays eligible once the
 * cooldown below has passed. Storing the two in one flag would either turn a
 * "maybe later" into a permanent no, or keep re-showing a modal to someone
 * whose browser has already blocked us.
 */

/**
 * localStorage key holding the soft dismissal: {dismissedAt, sessions}.
 *
 * DELIBERATELY localStorage, unlike the install banner's sessionStorage
 * dismissal. The cooldown below is measured in DAYS and in SESSIONS, and a
 * session-scoped key is destroyed by the very event it has to count - the next
 * visit - so it could never observe either quantity.
 */
export const DISMISS_KEY = "betgenius:push-onboarding-dismissed";

/**
 * sessionStorage key marking the modal already shown during THIS visit.
 *
 * Separate from the dismissal because it answers a different question. A
 * visitor who has seen and ignored (not dismissed) the modal, then navigates,
 * must not be shown it again on the next page of the same sitting.
 */
export const SHOWN_KEY = "betgenius:push-onboarding-shown";

/**
 * sessionStorage key marking this visit as already counted against the
 * post-dismissal session tally.
 *
 * Without it the tally counts PAGE VIEWS, not visits: a dismissed visitor
 * reading four pages in one sitting would clear a three-session cooldown inside
 * that same sitting, which is the opposite of what a cooldown is. The key's own
 * lifetime is the definition of "one session" - the browser clears it when the
 * tab goes - which is a more honest boundary than any duration this file could
 * invent.
 */
export const SESSION_COUNTED_KEY = "betgenius:push-onboarding-session-counted";

/**
 * sessionStorage flag set when an anonymous visitor clicks Enable and is sent
 * to log in. Read once on return so the subscription flow resumes by itself
 * rather than making them find the button again.
 */
export const RESUME_KEY = "betgenius:push-onboarding-resume";

/**
 * THE COOLDOWN. Both gates must pass - see cooldownElapsed.
 *
 * One place on purpose: these are the numbers most likely to be tuned once
 * there is live data on how many dismissals convert, and hunting them through
 * component code would guarantee the two halves drift apart.
 */
export const PUSH_ONBOARDING_COOLDOWN = {
  /** Distinct later visits required after a "Not now". */
  MIN_SESSIONS: 3,
  /** Days that must also have passed since the "Not now". */
  MIN_DAYS: 5,
} as const;

const DAY_MS = 24 * 60 * 60_000;

/** The browser's three answers. Mirrors NotificationPermission without needing the DOM lib. */
export type PushPermission = "default" | "granted" | "denied";

/** A recorded soft dismissal. `sessions` counts visits SINCE the dismissal, not including it. */
export type SoftDismissal = {
  dismissedAt: number;
  sessions: number;
};

/**
 * Reads a stored dismissal, or null when there is nothing usable.
 *
 * Fails towards NO DISMISSAL on anything unrecognised, which is the safe
 * direction for the same reason the install banner fails towards showing: a
 * corrupt or hand-edited key must not be able to suppress the feature
 * permanently. The worst case is one extra modal; the alternative worst case is
 * a visitor who can never be asked again.
 *
 * A future-dated `dismissedAt` (clock moved backwards, or a value copied
 * between machines) is rejected rather than trusted, because it would otherwise
 * push the day gate out indefinitely.
 */
export function parseDismissal(raw: string | null, now: number = Date.now()): SoftDismissal | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { dismissedAt, sessions } = parsed as Record<string, unknown>;
    if (typeof dismissedAt !== "number" || !Number.isFinite(dismissedAt) || dismissedAt <= 0) return null;
    if (dismissedAt > now) return null;
    const count = typeof sessions === "number" && Number.isFinite(sessions) && sessions > 0 ? Math.floor(sessions) : 0;
    return { dismissedAt, sessions: count };
  } catch {
    return null;
  }
}

/** The value to persist when "Not now" is clicked. Resets the session tally - the cooldown restarts. */
export function recordDismissal(now: number = Date.now()): SoftDismissal {
  return { dismissedAt: now, sessions: 0 };
}

/**
 * The dismissal with this visit counted, or the input unchanged when this visit
 * has already been counted.
 *
 * Idempotent on purpose: React remounts an effect for reasons that have nothing
 * to do with a new visit (StrictMode double-invokes in development, a Suspense
 * or error boundary can rebuild a subtree), and every one of those would
 * otherwise tick the cooldown forward.
 */
export function countSession(dismissal: SoftDismissal | null, alreadyCounted: boolean): SoftDismissal | null {
  if (!dismissal || alreadyCounted) return dismissal;
  return { ...dismissal, sessions: dismissal.sessions + 1 };
}

/**
 * Whether a soft dismissal has expired. BOTH gates, never either.
 *
 * Sessions alone would let a heavy reader clear it in an afternoon; days alone
 * would re-prompt someone who has not been back at all, wasting the ask on a
 * visitor who has shown no further interest. Requiring both means the modal
 * returns only to a visitor who both waited and came back.
 */
export function cooldownElapsed(dismissal: SoftDismissal, now: number = Date.now()): boolean {
  const daysSince = (now - dismissal.dismissedAt) / DAY_MS;
  return dismissal.sessions >= PUSH_ONBOARDING_COOLDOWN.MIN_SESSIONS && daysSince >= PUSH_ONBOARDING_COOLDOWN.MIN_DAYS;
}

/**
 * What to render.
 *
 *   "prompt"  - the full onboarding modal.
 *   "blocked" - a small, non-intrusive line telling the visitor that
 *               notifications are blocked in their browser settings, since
 *               nothing this site does can undo that for them.
 */
export type PushOnboardingMode = "prompt" | "blocked";

/**
 * The whole decision in one place.
 *
 * Order matters and each step is a hard gate.
 *
 * `permission: "denied"` returns "blocked" and NEVER "prompt". That is what
 * keeps the component from offering a button whose only possible action is to
 * call requestPermission() again - a call the browser resolves to "denied"
 * without showing anything, so it can only ever mislead.
 *
 * `permission: "granted"` returns null unconditionally, ahead of every other
 * input including a stale dismissal: someone who has already said yes is done
 * with onboarding, and a leftover "Not now" from before they enabled it must
 * not resurrect the modal.
 */
export function resolvePushOnboarding(input: {
  /** Service worker + PushManager + Notification all present. */
  supported: boolean;
  permission: PushPermission;
  /** Already displayed during this visit - see SHOWN_KEY. */
  shownThisSession: boolean;
  /** The stored soft dismissal, with this visit already counted. */
  dismissal: SoftDismissal | null;
  now?: number;
}): PushOnboardingMode | null {
  if (!input.supported) return null;
  if (input.permission === "granted") return null;
  // Returned before the session and cooldown gates: this is a persistent state
  // readout, not a prompt, so it is neither "shown once per session" nor
  // subject to a cooldown that exists to limit interruptions.
  if (input.permission === "denied") return "blocked";
  if (input.shownThisSession) return null;
  if (!input.dismissal) return "prompt";
  return cooldownElapsed(input.dismissal, input.now ?? Date.now()) ? "prompt" : null;
}
