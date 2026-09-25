/**
 * Asserts who receives which notification, and who must not.
 *
 * WHY PURE RATHER THAN SEEDED. Every rule here is a statement about an
 * AUDIENCE, and the dangerous direction is the negative one: a league follower
 * receiving every kickoff reminder in their competition, a user who switched
 * editorial alerts off still getting Bet of the Day, a paid pick's detail
 * reaching a free account. A seeded end-to-end run can show that the people who
 * should get mail did; it cannot practically enumerate everyone who should not.
 * So the targeting decision is pure data (followTargets / receivesEvent /
 * preferenceAllows in src/lib/notifications.ts) and the negatives are asserted
 * directly, one by one.
 *
 * The complement — leases, retries, real fan-out rows — is covered by
 * scripts/verify-notification-integration.ts, which needs a database.
 *
 * Run: npx tsx scripts/check-notification-targeting.ts
 */
import {
  EDITORIAL_DAILY_CAP,
  MATCH_INSIGHT,
  TOP_PREDICTION,
  editorialDay,
  followTargets,
  inQuietHours,
  isEditorialEvent,
  localDayStartUtc,
  matchInsightEventKey,
  preferenceAllows,
  receivesEvent,
  topPredictionEventKey,
} from "../src/lib/notifications";
import { TREND_MIN_CONFIDENCE, qualifiesAsTopPrediction } from "../src/lib/topPredictions";
import { readFileSync } from "node:fs";

/** Source text, for the structural assertions below. */
const read = (path: string) => readFileSync(path, "utf8");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, Object.is(actual, expected), Object.is(actual, expected) ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const HOME = 33;
const AWAY = 40;
const LEAGUE = 39;
const PREDICTION = "pred-1";

/** A published tip in the Premier League between two teams, tagged FEATURED. */
const event = (overrides: Partial<Parameters<typeof followTargets>[0]> = {}) => ({
  type: "NEW_PREDICTION",
  predictionId: PREDICTION,
  category: "FEATURED",
  leagueApiId: LEAGUE,
  teamApiIds: [HOME, AWAY],
  data: null as unknown,
  ...overrides,
});

const follow = (targetType: string, targetKey: string | number) => ({ targetType, targetKey: String(targetKey) });

console.log("a followed TEAM receives its match's events, and nobody else's:");
eq("the home team's follower receives it", receivesEvent(follow("TEAM", HOME), event()), true);
eq("the away team's follower receives it", receivesEvent(follow("TEAM", AWAY), event()), true);
eq("an uninvolved team's follower does not", receivesEvent(follow("TEAM", 99), event()), false);
// A team follow is not a league follow. Matching on the wrong target type is
// the mistake that would make every follow behave like every other.
eq("a team key does not match through the LEAGUE target", receivesEvent(follow("LEAGUE", HOME), event()), false);

console.log("\na followed LEAGUE receives publications in that league only:");
eq("the league's follower receives a publication", receivesEvent(follow("LEAGUE", LEAGUE), event()), true);
eq("another league's follower does not", receivesEvent(follow("LEAGUE", 140), event()), false);
eq("an event with no league reaches no league follower", receivesEvent(follow("LEAGUE", LEAGUE), event({ leagueApiId: null })), false);

console.log("\na followed MATCH (the tip itself) receives its own events:");
eq("the tip's follower receives it", receivesEvent(follow("PREDICTION", PREDICTION), event()), true);
eq("another tip's follower does not", receivesEvent(follow("PREDICTION", "pred-2"), event()), false);
// Several tips can share one fixture; a reminder names them all in data.predictionIds.
eq(
  "a co-listed tip on the same fixture is included",
  receivesEvent(follow("PREDICTION", "pred-2"), event({ type: "KICKOFF_REMINDER", data: { predictionIds: ["pred-2"] } })),
  true,
);

console.log("\nmatch-scoped events do NOT fan out to league or category followers:");
// The firehose case. A league follower who received every kickoff reminder and
// every insight for every match in their competition would be sent dozens of
// pushes a weekend for a single follow.
for (const type of ["KICKOFF_REMINDER", MATCH_INSIGHT]) {
  eq(`${type}: the league's follower is excluded`, receivesEvent(follow("LEAGUE", LEAGUE), event({ type })), false);
  eq(`${type}: a category follower is excluded`, receivesEvent(follow("CATEGORY", "FEATURED"), event({ type })), false);
  eq(`${type}: the team's follower is still included`, receivesEvent(follow("TEAM", HOME), event({ type })), true);
  eq(`${type}: the tip's follower is still included`, receivesEvent(follow("PREDICTION", PREDICTION), event({ type })), true);
}

console.log("\na TOP_PREDICTION broadcast uses the editorial audience, not follows:");
eq("it is recognised as editorial", isEditorialEvent(TOP_PREDICTION), true);
eq("a follow-driven type is not editorial", isEditorialEvent("NEW_PREDICTION"), false);
eq("it produces no follow targets at all", followTargets(event({ type: TOP_PREDICTION })).length, 0);
// The specific leak this prevents: a Bet of the Day carries a category and a
// league, so without the editorial branch it would ALSO reach those followers
// — under the wrong preference and outside the editorial cap.
eq(
  "a broadcast does not leak to the league's followers",
  receivesEvent(follow("LEAGUE", LEAGUE), event({ type: TOP_PREDICTION, category: "BET_OF_THE_DAY" })),
  false,
);
eq(
  "a broadcast does not leak to category followers",
  receivesEvent(follow("CATEGORY", "BET_OF_THE_DAY"), event({ type: TOP_PREDICTION, category: "BET_OF_THE_DAY" })),
  false,
);
eq("a broadcast does not leak to the teams' followers", receivesEvent(follow("TEAM", HOME), event({ type: TOP_PREDICTION })), false);

console.log("\nthe three preference controls are independent:");
const ALL_ON = { followedAlerts: true, editorialAlerts: true, kickoffReminders: true, newPredictions: true, tipChanges: true, results: true };
// 1. Editorial off must cost the user none of their own follows.
eq("editorialAlerts off blocks a top-pick push", preferenceAllows(TOP_PREDICTION, { ...ALL_ON, editorialAlerts: false }), false);
eq("...and leaves followed publications alone", preferenceAllows("NEW_PREDICTION", { ...ALL_ON, editorialAlerts: false }), true);
eq("...and leaves kickoff reminders alone", preferenceAllows("KICKOFF_REMINDER", { ...ALL_ON, editorialAlerts: false }), true);
// 2. Followed alerts off must not silence editorial or reminders.
eq("followedAlerts off blocks followed publications", preferenceAllows("NEW_PREDICTION", { ...ALL_ON, followedAlerts: false }), false);
eq("followedAlerts off blocks tip changes", preferenceAllows("TIP_CHANGED", { ...ALL_ON, followedAlerts: false }), false);
eq("followedAlerts off blocks results", preferenceAllows("RESULT_WON", { ...ALL_ON, followedAlerts: false }), false);
eq("followedAlerts off blocks match insights", preferenceAllows(MATCH_INSIGHT, { ...ALL_ON, followedAlerts: false }), false);
eq("...but not top-pick broadcasts", preferenceAllows(TOP_PREDICTION, { ...ALL_ON, followedAlerts: false }), true);
eq("...and not kickoff reminders", preferenceAllows("KICKOFF_REMINDER", { ...ALL_ON, followedAlerts: false }), true);
// 3. Kickoff reminders off must not silence anything else.
eq("kickoffReminders off blocks reminders", preferenceAllows("KICKOFF_REMINDER", { ...ALL_ON, kickoffReminders: false }), false);
eq("...and nothing else", preferenceAllows("NEW_PREDICTION", { ...ALL_ON, kickoffReminders: false }), true);
// The finer flags keep working underneath followedAlerts.
eq("newPredictions still applies while followedAlerts is on", preferenceAllows("NEW_PREDICTION", { ...ALL_ON, newPredictions: false }), false);
eq("results still applies while followedAlerts is on", preferenceAllows("RESULT_LOST", { ...ALL_ON, results: false }), false);

console.log("\na legacy user gains no notification they had not already agreed to:");
// followedAlerts defaults true, so everything that already reached them still
// does. This is the whole reason the two columns have different defaults.
for (const type of ["NEW_PREDICTION", "KICKOFF_REMINDER", "TIP_CHANGED", "WITHDRAWN", "RESULT_WON", MATCH_INSIGHT]) {
  eq(`${type} is unchanged with no preferences stored`, preferenceAllows(type, null), true);
}
eq("an empty preference object is equally permissive for follow-driven types", preferenceAllows("NEW_PREDICTION", {}), true);
// THE OPT-IN RULE. A broadcast is a new category of notification nobody has
// consented to, and a column appearing in a migration is not consent. A legacy
// row — one written before editorialAlerts existed — carries no value for it,
// and must read as OFF rather than as agreement.
eq("a legacy row with no editorial field is opted OUT", preferenceAllows(TOP_PREDICTION, { followedAlerts: true, newPredictions: true }), false);
eq("no preference row at all is opted OUT", preferenceAllows(TOP_PREDICTION, null), false);
eq("an empty preference object is opted OUT", preferenceAllows(TOP_PREDICTION, {}), false);
eq("an explicit false is opted out", preferenceAllows(TOP_PREDICTION, { editorialAlerts: false }), false);
// ...and only an explicit true opts in.
eq("only an explicit true opts in", preferenceAllows(TOP_PREDICTION, { editorialAlerts: true }), true);
// The asymmetry is the point: the same absent-row input gives opposite answers
// for the two audiences.
check(
  "absent preferences mean yes for follows and no for broadcasts",
  preferenceAllows("NEW_PREDICTION", null) === true && preferenceAllows(TOP_PREDICTION, null) === false,
);

console.log("\nduplicate top-pick events collapse onto one key:");
const DAY = "2026-09-19";
eq("the same prediction on the same day is one key", topPredictionEventKey("p1", DAY), topPredictionEventKey("p1", DAY));
check("a different prediction is a different key", topPredictionEventKey("p1", DAY) !== topPredictionEventKey("p2", DAY));
// Deliberate: re-featuring the same pick on a LATER day is an editorial
// decision someone may legitimately make.
check("a later day is a different key", topPredictionEventKey("p1", DAY) !== topPredictionEventKey("p1", "2026-09-20"));
// The key is built from the LAGOS day, not the UTC one. 23:30Z is already
// 00:30 on the 20th in Lagos, so a click then and another the next UTC morning
// are the same editorial day and collapse to one broadcast — which they would
// not if this used the UTC date.
eq("23:30Z is already the next day in Lagos", editorialDay(new Date("2026-09-19T23:30:00Z")), "2026-09-20");
eq(
  "a late-night click and the next morning share one Lagos day",
  editorialDay(new Date("2026-09-19T23:30:00Z")),
  editorialDay(new Date("2026-09-20T10:00:00Z")),
);
// ...and the hour before it is still the previous day, so the boundary is a
// boundary rather than the whole evening collapsing forward.
eq("22:00Z is still the 19th in Lagos", editorialDay(new Date("2026-09-19T22:00:00Z")), "2026-09-19");
check(
  "picks either side of Lagos midnight are different broadcasts",
  topPredictionEventKey("p1", editorialDay(new Date("2026-09-19T22:00:00Z"))) !==
    topPredictionEventKey("p1", editorialDay(new Date("2026-09-19T23:30:00Z"))),
);

console.log("\nan insight is announced once per match, not once per team run:");
check(
  "the same run on a later match is a different event",
  matchInsightEventKey("pred-1", `${HOME}:ALL:WIN_STREAK`) !== matchInsightEventKey("pred-2", `${HOME}:ALL:WIN_STREAK`),
);
eq("the same insight on the same match is one event", matchInsightEventKey("pred-1", "33:ALL:WIN_STREAK"), matchInsightEventKey("pred-1", "33:ALL:WIN_STREAK"));

console.log("\nonly an explicitly selected prediction may be broadcast:");
const live = { status: "PUBLISHED", outcome: "PENDING", confidence: 90, odds: 1.8, provenance: "MARKET_CONFIRMED" };
eq("a pinned, published, unsettled pick qualifies", qualifiesAsTopPrediction(live, "ADMIN_PINNED"), true);
eq("a draft never qualifies", qualifiesAsTopPrediction({ ...live, status: "DRAFT" }, "ADMIN_PINNED"), false);
eq("an archived pick never qualifies", qualifiesAsTopPrediction({ ...live, status: "ARCHIVED" }, "BET_OF_THE_DAY"), false);
eq("a settled pick never qualifies", qualifiesAsTopPrediction({ ...live, outcome: "WON" }, "BET_OF_THE_DAY"), false);
// The one source with no human in the loop carries the extra bar.
eq("a trend pick needs market confirmation", qualifiesAsTopPrediction({ ...live, provenance: "STANDARD_CURATED" }, "TREND_SELECTED"), false);
eq("a trend pick needs the confidence floor", qualifiesAsTopPrediction({ ...live, confidence: TREND_MIN_CONFIDENCE - 1 }, "TREND_SELECTED"), false);
eq("a trend pick needs a price", qualifiesAsTopPrediction({ ...live, odds: null }, "TREND_SELECTED"), false);
eq("a trend pick clearing every bar qualifies", qualifiesAsTopPrediction(live, "TREND_SELECTED"), true);
// The human-selected sources are not held to the trend bar — a pin IS the decision.
eq("an admin pin needs no market confirmation", qualifiesAsTopPrediction({ ...live, provenance: "STANDARD_CURATED", confidence: 50 }, "ADMIN_PINNED"), true);

console.log("\nthe opt-in is wired end to end:");
// Source-level assertions, because these are STRUCTURAL guarantees about which
// code path may write which column — the kind of thing that stays true only if
// something fails when it stops being true. A behavioural test would need a
// database and a browser and would still not prove the negative.
const schema = read("prisma/schema.prisma");
const preference = schema.slice(schema.indexOf("model NotificationPreference"), schema.indexOf("model PushSubscription"));
check("followedAlerts defaults true in the schema", /followedAlerts\s+Boolean\s+@default\(true\)/.test(preference));
// The one that must not regress. A default of true here would opt every
// existing user into broadcasts the moment the migration ran.
check("editorialAlerts defaults FALSE in the schema", /editorialAlerts\s+Boolean\s+@default\(false\)/.test(preference));

const subscriptions = read("src/app/api/push-subscriptions/route.ts");
check('the endpoint distinguishes an onboarding accept from a settings enable', /source:\s*z\.enum\(\["onboarding",\s*"settings"\]\)/.test(subscriptions));
check("only the onboarding source opts a user in", /source\s*===\s*"onboarding"/.test(subscriptions));
// Written only to TRUE, and only on that path: a settings enable or a silent
// re-persist must not be able to overwrite a deliberate opt-out on its way past.
check("editorialAlerts is never written false by this endpoint", !/editorialAlerts:\s*false/.test(subscriptions));
check("the write is conditional, not unconditional", /optIntoEditorial\s*\?\s*\{\s*editorialAlerts:\s*true\s*\}/.test(subscriptions));

const client = read("src/lib/pushClient.ts");
check("the reconciliation path never claims to be onboarding", /source:\s*"settings"/.test(client));
check('"onboarding" is passed by the modal, not hardcoded in the client', !/enablePush\("onboarding"\)/.test(client));
check("the onboarding modal is what passes it", /enablePush\("onboarding"\)/.test(read("src/components/PushOnboarding.tsx")));
check("the settings panel passes settings", /enablePush\("settings"\)/.test(read("src/components/PushSettings.tsx")));

console.log("\nthe inbox and browser push are gated separately:");
const notifications = read("src/lib/notifications.ts");
const dispatch = read("src/lib/notificationDispatch.ts");
// Opting in must not require a live browser subscription. Someone who opted in
// and later lost their subscription — new device, a 410 that pruned the row,
// permission revoked — still belongs in the fan-out, because the inbox works
// without push and is what /notifications exists to serve.
const audience = notifications.slice(notifications.indexOf("async function editorialAudience"), notifications.indexOf("async function eligibleRecipients"));
check("the editorial audience is selected on editorialAlerts", /editorialAlerts:\s*true/.test(audience));
check("...and not narrowed by pushEnabled", !/pushEnabled/.test(audience));
check("...and not narrowed by having a subscription", !/pushSubscription/i.test(audience));

// The two-stage rule, asserted by position: the preference check must come
// BEFORE the inbox row is written, so a disabled editorial alert produces no
// inbox entry at all; and pushEnabled must be consulted only after it, so it
// can suppress the push without suppressing the inbox.
const prefGate = dispatch.indexOf("preferenceAllows(row.event.type, pref)");
const inboxWrite = dispatch.indexOf("prisma.userNotification.upsert");
const pushGate = dispatch.indexOf("pref?.pushEnabled");
check("the preference gate precedes the inbox write", prefGate > -1 && inboxWrite > -1 && prefGate < inboxWrite);
check("so disabling editorial alerts suppresses the inbox entry too", prefGate < inboxWrite);
check("the pushEnabled gate comes after the inbox write", pushGate > inboxWrite);
check("...so a user with push off still receives the inbox entry", pushGate > inboxWrite);
// The editorial cap must sit alongside the global one, not replace it.
// The cap is decided by dailyCapAllows, per class; its behaviour (default 12,
// push-class capped, history exempt) is asserted in check-inbox-history-cap.ts.
check(
  "the global daily cap is still enforced",
  /if \(!dailyCapAllows\(capClass, sentToday, pref\?\.dailyCap\)\) \{\s*await skip\(row\.id, capClass === "history" \? "inbox history ceiling" : "daily cap"\);\s*continue;/.test(dispatch) &&
    dispatch.indexOf("dailyCapAllows(capClass") < dispatch.indexOf("isEditorialEvent(row.event.type)"),
);
check("the editorial cap is applied only to editorial events", /isEditorialEvent\(row\.event\.type\)/.test(dispatch));
check("quiet hours still gate the push", /inQuietHours\(/.test(dispatch));

console.log("\nthe anti-spam rules still apply, and the editorial cap sits under them:");
eq("the editorial cap is conservative", EDITORIAL_DAILY_CAP <= 3, true);
check("the editorial cap is at least one", EDITORIAL_DAILY_CAP >= 1);
// Far below the global default of 12, which is the point: a broadcast must not
// be able to consume a reader's whole daily allowance.
check("the editorial cap is well below the global default", EDITORIAL_DAILY_CAP < 12);
eq("overnight quiet hours wrap midnight", inQuietHours(new Date("2026-09-14T22:30:00Z"), "Africa/Lagos", 22 * 60, 7 * 60), true);
eq("midday is outside overnight quiet hours", inQuietHours(new Date("2026-09-14T11:30:00Z"), "Africa/Lagos", 22 * 60, 7 * 60), false);
eq("no quiet window configured is never quiet", inQuietHours(new Date("2026-09-14T22:30:00Z"), "Africa/Lagos", null, null), false);
eq(
  "the daily cap resets at Lagos midnight",
  localDayStartUtc(new Date("2026-09-14T23:30:00Z"), "Africa/Lagos").toISOString(),
  "2026-09-14T23:00:00.000Z",
);
// The editorial cap counts over the same window as the global cap, so the two
// cannot disagree about when "today" began for a user.
eq(
  "both caps share one day boundary",
  localDayStartUtc(new Date("2026-09-19T22:00:00Z"), "Africa/Lagos").toISOString(),
  localDayStartUtc(new Date("2026-09-19T12:00:00Z"), "Africa/Lagos").toISOString(),
);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
if (failures) process.exitCode = 1;
