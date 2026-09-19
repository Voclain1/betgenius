/**
 * Asserts every rule the push onboarding prompt enforces.
 *
 * Same shape as check-install-prompt.ts, and for the same reason: this
 * feature's failure modes are all "shown (or asked) when it should not have
 * been", and those are invisible in a screenshot of the working case. A modal
 * that appears correctly on a first visit tells you nothing about whether it
 * also reappears the next day after a "Not now", or whether a blocked browser
 * gets asked again. So the decision is pure (src/lib/pushOnboarding.ts) and
 * every gate is asserted here, including the cases a browser test cannot
 * practically reach: a five-day-old dismissal, a corrupted storage value, a
 * clock that moved backwards.
 *
 * Run: npx tsx scripts/check-push-onboarding.ts
 */
import {
  PUSH_ONBOARDING_COOLDOWN,
  cooldownElapsed,
  countSession,
  parseDismissal,
  recordDismissal,
  resolvePushOnboarding,
  type SoftDismissal,
} from "../src/lib/pushOnboarding";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, Object.is(actual, expected), Object.is(actual, expected) ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse("2026-09-19T12:00:00Z");
const daysAgo = (n: number) => NOW - n * DAY;

/** A fresh, supported, undecided visitor. Each case below changes one input. */
const base = {
  supported: true,
  permission: "default" as const,
  shownThisSession: false,
  dismissal: null as SoftDismissal | null,
  now: NOW,
};

console.log("first eligible visit:");
eq("a supported, undecided first visit shows the prompt", resolvePushOnboarding(base), "prompt");
eq("an unsupported browser shows nothing", resolvePushOnboarding({ ...base, supported: false }), null);
// The whole reason this feature exists: the prompt is ours, so it can be shown
// without spending the browser's single permission ask.
eq("the prompt is reachable with permission still at default", resolvePushOnboarding({ ...base, permission: "default" }), "prompt");

console.log("\n'Not now' suppresses it during the cooldown:");
const justDismissed = recordDismissal(NOW);
eq("a dismissal starts its session tally at zero", justDismissed.sessions, 0);
eq("the dismissing visit itself shows nothing more", resolvePushOnboarding({ ...base, dismissal: justDismissed }), null);
// Each of the two gates alone must NOT be enough. These are the cases that
// would let a cooldown leak: a heavy reader clearing it in one afternoon, or a
// calendar clearing it for someone who never came back.
eq(
  "three sessions but no elapsed days is not enough",
  resolvePushOnboarding({ ...base, dismissal: { dismissedAt: daysAgo(0), sessions: 3 } }),
  null,
);
eq(
  "many elapsed days but too few sessions is not enough",
  resolvePushOnboarding({ ...base, dismissal: { dismissedAt: daysAgo(60), sessions: 2 } }),
  null,
);
eq("one session and one day is not enough", resolvePushOnboarding({ ...base, dismissal: { dismissedAt: daysAgo(1), sessions: 1 } }), null);

console.log("\nit becomes eligible again once BOTH thresholds are met:");
const ripe = { dismissedAt: daysAgo(PUSH_ONBOARDING_COOLDOWN.MIN_DAYS), sessions: PUSH_ONBOARDING_COOLDOWN.MIN_SESSIONS };
eq("exactly at both thresholds it is eligible again", resolvePushOnboarding({ ...base, dismissal: ripe }), "prompt");
eq("comfortably past both thresholds it is eligible", resolvePushOnboarding({ ...base, dismissal: { dismissedAt: daysAgo(30), sessions: 9 } }), "prompt");
// Boundary, asserted on cooldownElapsed directly so the failure names the gate.
eq("one session short of the threshold has not elapsed", cooldownElapsed({ ...ripe, sessions: ripe.sessions - 1 }, NOW), false);
eq("one day short of the threshold has not elapsed", cooldownElapsed({ ...ripe, dismissedAt: daysAgo(PUSH_ONBOARDING_COOLDOWN.MIN_DAYS) + 1 }, NOW), false);

console.log("\nthe session tally counts VISITS, not page views:");
eq("an uncounted session increments the tally", countSession({ dismissedAt: daysAgo(9), sessions: 1 }, false)?.sessions, 2);
// React remounts an effect for reasons that are not a new visit (StrictMode
// double-invocation, a rebuilt Suspense subtree). Without idempotence here, a
// three-session cooldown could be cleared inside one sitting.
eq("an already-counted session does not increment it again", countSession({ dismissedAt: daysAgo(9), sessions: 1 }, true)?.sessions, 1);
eq("with no dismissal there is nothing to count", countSession(null, false), null);
// The path that actually matters: four visits after a dismissal, only one of
// which is a fresh session, must not clear a three-session gate.
let walked: SoftDismissal | null = recordDismissal(daysAgo(10));
walked = countSession(walked, false);
walked = countSession(walked, true);
walked = countSession(walked, true);
eq("three page views in one visit count as one session", walked?.sessions, 1);
eq("...and that is still inside the cooldown", resolvePushOnboarding({ ...base, dismissal: walked }), null);

console.log("\nbrowser 'denied' never leads to another permission request:");
// "blocked" is a readout, not a prompt. The component renders no button for
// it, so there is no path from this state back to requestPermission().
eq("denied resolves to the blocked readout, never the prompt", resolvePushOnboarding({ ...base, permission: "denied" }), "blocked");
eq("denied beats a fresh first visit", resolvePushOnboarding({ ...base, permission: "denied", dismissal: null }), "blocked");
eq("denied beats an elapsed cooldown", resolvePushOnboarding({ ...base, permission: "denied", dismissal: ripe }), "blocked");
check(
  "no input combination turns denied into a prompt",
  [true, false].every((shown) =>
    [null, justDismissed, ripe].every((d) => resolvePushOnboarding({ ...base, permission: "denied", shownThisSession: shown, dismissal: d }) !== "prompt"),
  ),
);

console.log("\n'granted' ends onboarding permanently:");
eq("granted shows nothing", resolvePushOnboarding({ ...base, permission: "granted" }), null);
eq("granted outranks an elapsed cooldown", resolvePushOnboarding({ ...base, permission: "granted", dismissal: ripe }), null);
// A leftover "Not now" from before the visitor enabled push must not resurrect
// the modal once they have said yes.
eq("granted outranks a stale dismissal", resolvePushOnboarding({ ...base, permission: "granted", dismissal: justDismissed }), null);

console.log("\nit is shown at most once per session:");
eq("already shown this session suppresses it", resolvePushOnboarding({ ...base, shownThisSession: true }), null);
eq("already shown suppresses it even after the cooldown elapsed", resolvePushOnboarding({ ...base, shownThisSession: true, dismissal: ripe }), null);
// But the blocked readout is a state, not an interruption, so it is not
// subject to the once-per-session rule.
eq("the blocked readout is not once-per-session", resolvePushOnboarding({ ...base, permission: "denied", shownThisSession: true }), "blocked");

console.log("\nstored dismissals are read defensively:");
eq("absent storage is no dismissal", parseDismissal(null, NOW), null);
eq("unparseable JSON is no dismissal", parseDismissal("{not json", NOW), null);
eq("a non-object is no dismissal", parseDismissal('"nope"', NOW), null);
eq("a missing timestamp is no dismissal", parseDismissal('{"sessions":4}', NOW), null);
eq("a non-numeric timestamp is no dismissal", parseDismissal('{"dismissedAt":"yesterday"}', NOW), null);
// A clock moved backwards, or a value copied between machines, would otherwise
// push the day gate out indefinitely — a permanent suppression from a corrupt
// value, which is exactly the failure direction this must not have.
eq("a future timestamp is rejected rather than trusted", parseDismissal(JSON.stringify({ dismissedAt: NOW + DAY, sessions: 9 }), NOW), null);
eq("a missing session count reads as zero", parseDismissal(JSON.stringify({ dismissedAt: daysAgo(9) }), NOW)?.sessions, 0);
eq("a negative session count reads as zero", parseDismissal(JSON.stringify({ dismissedAt: daysAgo(9), sessions: -5 }), NOW)?.sessions, 0);
eq("a valid dismissal round-trips", parseDismissal(JSON.stringify(ripe), NOW)?.sessions, ripe.sessions);
// The safe direction: a corrupt key means "ask again", never "never ask again".
eq("a corrupt value fails towards showing the prompt", resolvePushOnboarding({ ...base, dismissal: parseDismissal("garbage", NOW) }), "prompt");

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
if (failures) process.exitCode = 1;
