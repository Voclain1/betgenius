/**
 * Who sees the post-signup plan modal, and when it stops.
 *
 * Pure — no DOM, no React, no database — so every rule can be asserted
 * directly (scripts/check-signup-upsell.ts). The server half supplies the
 * facts, the component owns the rendering, and this owns the decision.
 *
 * HOW "NEW SIGNUP" IS DETECTED, AND WHY THERE IS NO NEW COLUMN.
 *
 * A genuinely new account is one whose User row was created moments ago and
 * which has never paid. Both facts are already in the database:
 * `User.createdAt` and the Subscription row. Nothing needs to be added, and
 * nothing needs to be written at signup time.
 *
 * That matters most for the case a flag would get WRONG. The obvious
 * alternative is to have the register page set something on its way to the
 * dashboard — but that only knows about credentials signup. A first-time
 * Google user never touches /api/register: NextAuth's adapter creates their
 * row inside the OAuth callback, and the app's own code is not on that path at
 * all. `createdAt` is written by both, identically, with no extra plumbing —
 * which is exactly why it also cannot be fooled by a REPEAT Google sign-in,
 * the case a naive "came from the OAuth callback" check gets wrong every time.
 *
 * It is also what makes the deploy safe. Historical FREE accounts were created
 * weeks or months ago, so every one of them is outside the window on the day
 * this ships. A flag defaulting to "not yet shown" would have shown the modal
 * to the entire existing user base at once.
 */

/**
 * How long after account creation the modal may appear.
 *
 * Generous on purpose. It is not a "this session" window: someone can register,
 * get distracted, and come back in the evening, and that visit is still their
 * first real look at the product. The cost of being generous is bounded by the
 * dismissal below — once they close it, it is closed.
 *
 * The lower bound on safety is what actually constrains this: it must stay far
 * below the age of the youngest historical account, so a deploy can never
 * sweep existing users into "new". A day is not remotely close to that line.
 */
export const SIGNUP_UPSELL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * localStorage key for "this user has dealt with the upsell".
 *
 * KEYED BY USER ID, not a bare flag. A shared browser is the case a global key
 * gets wrong: one person dismissing it would silence it for the next person
 * who signs up on the same machine, who would then never see the offer at all.
 *
 * localStorage rather than sessionStorage because the requirement is that a
 * refresh or a navigation does not bring it back — a session-scoped key is
 * cleared by the very event it has to survive.
 */
export function signupUpsellKey(userId: string) {
  return `betgenius:signup-upsell:${userId}`;
}

/** The server-supplied facts. `createdAt` is the User row's, not the session's. */
export type SignupUpsellFacts = {
  createdAt: Date | string | number;
  /** Resolved tier — already through entitlement.ts, so an expired ACTIVE row reads as FREE. */
  tier: string | null | undefined;
  /** True when the viewer currently holds paid access. */
  paid: boolean;
  now?: Date | number;
};

/**
 * Whether this account is new enough, and unpaid enough, to be offered a plan.
 *
 * `paid` is checked first and independently of the tier string: a customer who
 * bought VIP thirty seconds after registering is inside the window and must
 * never be sold a plan they already own. That is the one mistake here that
 * costs trust rather than a click.
 */
export function isNewSignup(facts: SignupUpsellFacts): boolean {
  if (facts.paid) return false;
  const created = new Date(facts.createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  const now = facts.now == null ? Date.now() : new Date(facts.now).getTime();
  const age = now - created;
  // A future createdAt (clock skew between app and database) is not evidence of
  // a new account, but it is not evidence of an old one either. Treated as
  // brand new — age 0 — rather than rejected, since the row demonstrably did
  // not exist long ago.
  if (age < 0) return true;
  return age < SIGNUP_UPSELL_WINDOW_MS;
}

/**
 * The whole decision.
 *
 * `dismissed` is read from localStorage by the component; it is passed in
 * rather than read here so this stays pure and so the storage failure mode
 * (private browsing, blocked storage) is decided in one place: an unreadable
 * key means "not dismissed", which risks one extra modal rather than
 * suppressing the feature outright.
 */
export function shouldShowSignupUpsell(input: SignupUpsellFacts & { dismissed: boolean }): boolean {
  if (input.dismissed) return false;
  return isNewSignup(input);
}
