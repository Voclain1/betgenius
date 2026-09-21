/**
 * Digest-first notification policy: deterministic checks, no database.
 *
 * Run: npx tsx scripts/check-notification-digest.ts
 */
import { readFileSync } from "node:fs";
import {
  DIGEST_MORNING,
  DIGEST_NIGHT,
  DIGEST_TIMING,
  TOP_MATCH_HIGHLIGHT_MAX,
  buildMorningDigest,
  buildNightDigest,
  lagosInstant,
  morningDigestKey,
  nightDigestDecision,
  nightDigestKey,
  pushCopy,
  pushesImmediately,
  renderDigest,
  selectTopMatches,
  shouldPush,
  type DigestPick,
} from "../src/lib/notificationDigest";
import {
  EDITORIAL_DAILY_CAP,
  createNotificationEvent,
  editorialDailyCap,
  inQuietHours,
  preferenceAllows,
  receivesEvent,
  recordPredictionEvents,
} from "../src/lib/notifications";
import { lagosDay as lagosDayKeyForTest, digestAudienceFor, followCoversItem, personaliseDigest } from "../src/lib/notificationDigest";
import { canViewCategory } from "../src/lib/access";
import type { PredictionCategory } from "../src/lib/enums";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

// Leagues by tier (src/lib/leagues.ts GENERATION_TIERS).
const EPL = 39, UCL = 2, LALIGA = 140, SERIE_A = 135, EREDIVISIE = 88, FRIENDLIES = 10, NATIONAL_LEAGUE = 43;

const DAY = "2026-09-22";
const MORNING = lagosInstant(DAY, 9 * 60 + 5);
const at = (minutes: number) => lagosInstant(DAY, minutes);

let seq = 0;
function pick(overrides: Partial<DigestPick> = {}): DigestPick {
  seq++;
  return {
    id: `p${String(seq).padStart(2, "0")}`,
    homeTeam: `Home${seq}`,
    awayTeam: `Away${seq}`,
    leagueApiId: EPL,
    leagueName: "Premier League",
    market: "1X2",
    pick: `Home${seq} win`,
    odds: 1.9,
    confidence: 70,
    kickoff: at(15 * 60 + seq),
    outcome: "PENDING",
    category: "FEATURED",
    categories: [],
    link: `/predictions/match/m${seq}`,
    ...overrides,
  };
}

const FREE = (c: string) => canViewCategory(c as PredictionCategory, null, null, "USER");
const VIP_MEMBER = (c: string) => canViewCategory(c as PredictionCategory, "VIP", "ACTIVE", "USER");
const PREMIUM_MEMBER = (c: string) => canViewCategory(c as PredictionCategory, "PREMIUM", "ACTIVE", "USER");

console.log("\nimmediate vs digest-only types:");
check("NEW_PREDICTION never pushes on its own", pushesImmediately("NEW_PREDICTION") === false);
for (const t of ["RESULT_WON", "RESULT_LOST", "RESULT_VOID"]) check(`${t} never pushes on its own`, pushesImmediately(t) === false);
for (const t of ["KICKOFF_REMINDER", "TIP_CHANGED", "WITHDRAWN", "MATCH_INSIGHT", "TOP_PREDICTION", DIGEST_MORNING, DIGEST_NIGHT]) {
  check(`${t} still pushes immediately`, pushesImmediately(t) === true);
}

console.log("\nmany published picks collapse into one morning digest:");
seq = 0;
const slate = [
  ...Array.from({ length: 8 }, () => pick({ leagueApiId: EPL, categories: ["GENIUS"] })),
  ...Array.from({ length: 4 }, () => pick({ leagueApiId: UCL, category: "VIP", categories: ["VIP"], confidence: 85 })),
  ...Array.from({ length: 3 }, () => pick({ leagueApiId: LALIGA, categories: ["BANKER"], confidence: 80 })),
  ...Array.from({ length: 6 }, () => pick({ leagueApiId: FRIENDLIES, confidence: 95 })),
];
const botd = pick({ leagueApiId: SERIE_A, categories: ["BET_OF_THE_DAY"], pick: "Over 2.5" });
slate.push(botd);
const morning = buildMorningDigest(slate, botd.id, MORNING)!;
check("22 publications produce one digest payload", morning !== null && morning.kind === "MORNING");
check("one event key for the day, whatever time it is built", morningDigestKey(DAY) === "digest:morning:2026-09-22");
check(
  "the publication events themselves stay inbox-only",
  slate.every(() => !shouldPush("NEW_PREDICTION", { pushEnabled: true, inQuietHours: false })),
);

console.log("\ncategory-first ordering:");
check(
  "categories are listed in editorial order (Banker, Genius, VIP)",
  JSON.stringify(morning.categories.map((c) => c.category)) === JSON.stringify(["BANKER", "GENIUS", "VIP"]),
  morning.categories,
);
check("with counts", JSON.stringify(morning.categories.map((c) => c.count)) === JSON.stringify([3, 8, 4]));
const freeMorning = renderDigest(morning, FREE);
check("title leads with categories", freeMorning.title === "Today's Banker, Genius and VIP picks are ready", freeMorning.title);
const lines = freeMorning.body.split("\n");
check("Bet of the Day is the first line", lines[0].startsWith("Bet of the Day:"), lines);
check("top matches come before the category counts", lines[1].startsWith("Top:") && lines[2].startsWith("Banker 3"), lines);

console.log("\ntop-match highlights are capped at 1-3:");
check("the cap constant is 3", TOP_MATCH_HIGHLIGHT_MAX === 3);
check("morning digest carries at most 3 highlights", morning.highlights.length <= 3 && morning.highlights.length >= 1, morning.highlights.length);
seq = 0;
const allCore = Array.from({ length: 20 }, () => pick({ leagueApiId: EPL, confidence: 90 }));
check("20 Premier League picks still yield 3", selectTopMatches(allCore).length === 3);
check("a larger requested max is clamped", selectTopMatches(allCore, { max: 10 }).length === 3);
check("Bet of the Day is not repeated as a highlight", !morning.highlights.some((h) => h.id === botd.id));

console.log("\nFALLBACK / DEEP_FALLBACK never become individual highlights:");
seq = 0;
const fallbackOnly = [
  pick({ leagueApiId: FRIENDLIES, confidence: 99, categories: ["BANKER"] }),
  pick({ leagueApiId: NATIONAL_LEAGUE, confidence: 99 }),
];
check("a FALLBACK/DEEP_FALLBACK-only day has no highlights", selectTopMatches(fallbackOnly).length === 0);
check("even at 95% confidence they lose to CORE", !morning.highlights.some((h) => slate.find((p) => p.id === h.id)?.leagueApiId === FRIENDLIES));
check("...but they still count in their category", buildMorningDigest(fallbackOnly, null, MORNING)!.categories.some((c) => c.category === "BANKER"));
seq = 0;
const secondaryFill = selectTopMatches([pick({ leagueApiId: EPL }), pick({ leagueApiId: EREDIVISIE, confidence: 99 }), pick({ leagueApiId: FRIENDLIES, confidence: 99 })]);
check("SECONDARY only fills slots CORE leaves", secondaryFill.length === 2 && secondaryFill[0].leagueApiId === EPL && secondaryFill[1].leagueApiId === EREDIVISIE);
seq = 0;
check("an unpriced CORE pick is not highlighted", selectTopMatches([pick({ odds: null })]).length === 0);

console.log("\nCORE alone does not bypass the individual-push cap:");
check("EDITORIAL_DAILY_CAP defaults to 1", EDITORIAL_DAILY_CAP >= 1 && editorialDailyCap(undefined) === 1);
check("a configured 50 is clamped to 3", editorialDailyCap("50") === 3);
check("garbage falls back to 1, never unlimited", editorialDailyCap("lots") === 1 && editorialDailyCap("-4") === 1);
check("a CORE publication is still inbox-only", !pushesImmediately("NEW_PREDICTION"));

console.log("\nrecorded lifecycle events: publication inbox-only, tip change immediate:");
const created: { type: string; eventKey: string }[] = [];
const fakeTx = {
  notificationEvent: {
    upsert: async ({ create }: { create: { type: string; eventKey: string } }) => {
      created.push(create);
      return create;
    },
  },
} as never;
const base = {
  id: "row1", status: "PUBLISHED", outcome: "PENDING", market: "1X2", pick: "Home", odds: 1.8,
  kickoff: at(20 * 60), publishedAt: at(8 * 60), settledAt: null, updatedAt: at(8 * 60),
  homeTeam: "A", awayTeam: "B", homeTeamApiId: 1, awayTeamApiId: 2, fixtureApiId: 9, leagueApiId: EPL, category: "FEATURED", categories: [],
};
(async () => {
  await recordPredictionEvents(fakeTx, { ...base, status: "PENDING_REVIEW" }, base, "PUBLISH");
  await recordPredictionEvents(fakeTx, base, { ...base, pick: "Away" }, "EDIT");
  const pub = created.find((e) => e.type === "NEW_PREDICTION");
  const change = created.find((e) => e.type === "TIP_CHANGED");
  check("publishing records a NEW_PREDICTION (inbox history kept)", !!pub);
  check("...which does not push", pub ? !pushesImmediately(pub.type) : false);
  check("a material pick change records TIP_CHANGED", !!change);
  check("...which pushes immediately", change ? shouldPush(change.type, { pushEnabled: true, inQuietHours: false }) : false);

  console.log("\nkickoff reminders stay immediate:");
  check("KICKOFF_REMINDER pushes", shouldPush("KICKOFF_REMINDER", { pushEnabled: true, inQuietHours: false }));
  const reminders = readFileSync("src/app/api/admin/notifications/reminders/route.ts", "utf8");
  check("the reminder event is available immediately, not held for a digest", /type: "KICKOFF_REMINDER"[\s\S]*?availableAt: now/.test(reminders));
  check("kickoffReminders preference still governs it", preferenceAllows("KICKOFF_REMINDER", { kickoffReminders: false }) === false);

  console.log("\nmorning and night digests are idempotent:");
  check("morning key is stable across the window", morningDigestKey(DAY) === morningDigestKey("2026-09-22"));
  check("night key differs from morning", nightDigestKey(DAY) !== morningDigestKey(DAY));
  check("the Lagos day rolls at Lagos midnight", lagosDayKeyForTest(new Date("2026-09-22T22:59:00Z")) === "2026-09-22" && lagosDayKeyForTest(new Date("2026-09-22T23:01:00Z")) === "2026-09-23");
  const rows = new Map<string, unknown>();
  let creates = 0;
  const fakeDb = {
    notificationEvent: {
      upsert: async ({ where, create }: { where: { eventKey: string }; create: unknown }) => {
        if (!rows.has(where.eventKey)) {
          rows.set(where.eventKey, create);
          creates++;
        }
        return rows.get(where.eventKey);
      },
    },
  } as never;
  const night = buildNightDigest(slate.map((p) => ({ ...p, outcome: "WON" })), botd.id, at(23 * 60));
  for (let i = 0; i < 3; i++) {
    await createNotificationEvent({ eventKey: morningDigestKey(DAY), type: DIGEST_MORNING, title: "t", body: "b", link: "/predictions/today", data: morning }, fakeDb);
    await createNotificationEvent({ eventKey: nightDigestKey(DAY), type: DIGEST_NIGHT, title: "t", body: "b", link: "/track-record", data: night }, fakeDb);
  }
  check("three runs create one morning and one night event", creates === 2, creates);
  const dailyDigests = readFileSync("src/lib/dailyDigests.ts", "utf8");
  check("creation is keyed on the day key, not the clock", dailyDigests.includes("morningDigestKey(day)") && dailyDigests.includes("nightDigestKey(day)"));

  console.log("\nnight digest timing (completion-aware, 23:00 to 23:55 Lagos):");
  const settled = slate.map((p) => ({ ...p, outcome: "WON" }));
  const halfway = slate.map((p, i) => ({ ...p, outcome: i % 2 ? "LOST" : "PENDING" }));
  const nearlyAll = slate.map((p, i) => ({ ...p, outcome: i === 0 ? "PENDING" : "WON" })); // 21 of 22 settled
  check("evaluation starts at 23:00", DIGEST_TIMING.nightFrom === 23 * 60);
  check("hard cutoff is 23:55", DIGEST_TIMING.nightDeadline === 23 * 60 + 55);
  check("no digest before 23:00, even fully settled", !nightDigestDecision(settled, at(21 * 60)).send && !nightDigestDecision(settled, at(22 * 60 + 59)).send);
  check("sent at 23:00 once every pick has settled", JSON.stringify(nightDigestDecision(settled, at(23 * 60))) === JSON.stringify({ send: true, partial: false }));
  check(
    "sent once substantially settled, labelled partial",
    JSON.stringify(nightDigestDecision(nearlyAll, at(23 * 60 + 10))) === JSON.stringify({ send: true, partial: true }),
    nightDigestDecision(nearlyAll, at(23 * 60 + 10)),
  );
  check("an unresolved slate defers at 23:00", !nightDigestDecision(halfway, at(23 * 60)).send);
  check("...and still defers at 23:50", !nightDigestDecision(halfway, at(23 * 60 + 50)).send);
  check("the 23:55 cutoff sends it partial", JSON.stringify(nightDigestDecision(halfway, at(23 * 60 + 55))) === JSON.stringify({ send: true, partial: true }));
  check("nothing when nothing settled, even at the cutoff", !nightDigestDecision(slate, at(23 * 60 + 55)).send);
  const cutoff = renderDigest(buildNightDigest(halfway, botd.id, at(23 * 60 + 55)), FREE);
  check(
    "cutoff digest is Results so far, with the unsettled count",
    cutoff.title.startsWith("Results so far") && /11 still awaiting results/.test(cutoff.body) && !/All \d+ of today/.test(cutoff.body),
    cutoff,
  );
  const lateNow = new Date(lagosInstant(DAY, 23 * 60 + 59).getTime() + 59_000);
  check(
    "close to midnight the digest day is still the day summarised",
    lagosDayKeyForTest(lateNow) === DAY && buildNightDigest(settled, botd.id, lateNow).day === DAY && nightDigestKey(lagosDayKeyForTest(lateNow)) === "digest:night:2026-09-22",
  );
  check("just after midnight nothing is evaluated", !nightDigestDecision(settled, lagosInstant(DAY, 24 * 60 + 5)).send);
  const full = renderDigest(night, FREE);
  check("a full digest says so", full.title.startsWith("Today's results") && /All \d+ of today's picks settled/.test(full.body));
  check("Bet of the Day result is included", /Bet of the Day: .* WON/.test(full.body), full.body);
  check("completed categories are listed", /Completed: Banker, Genius, VIP/.test(full.body), full.body);
  check("links to the track record", full.link === "/track-record");

  console.log("\nmorning behaviour is unchanged:");
  check(
    "morning window is 09:00-13:00, expiring 14:00",
    DIGEST_TIMING.morningFrom === 9 * 60 && DIGEST_TIMING.morningUntil === 13 * 60 && DIGEST_TIMING.morningExpires === 14 * 60,
  );
  check(
    "an editorial reader's morning digest is exactly the global digest",
    JSON.stringify(personaliseDigest(morning, { editorial: true, followed: false, follows: [] }, FREE)) === JSON.stringify(freeMorning),
  );

  console.log("\ndigest audience:");
  const vipPick = slate.find((p) => p.category === "VIP")!;
  const eplPick = slate.find((p) => p.leagueApiId === EPL)!;
  const followEpl = [{ targetType: "LEAGUE", targetKey: String(EPL) }];
  const editorialOnly = personaliseDigest(morning, digestAudienceFor(DIGEST_MORNING, { editorialAlerts: true, followedAlerts: false }, followEpl), FREE);
  check("editorial-only user gets the global digest", editorialOnly?.title === freeMorning.title && editorialOnly.body === freeMorning.body);
  const followedOnly = personaliseDigest(morning, digestAudienceFor(DIGEST_MORNING, { editorialAlerts: false, followedAlerts: true }, followEpl), FREE);
  check("followed-only user gets a digest", followedOnly !== null);
  check(
    "...without unrelated global categories, Bet of the Day or top matches",
    !!followedOnly &&
      !/Banker|Genius|VIP|Bet of the Day|Top:/.test(followedOnly.title + followedOnly.body) &&
      !followedOnly.links.some((l) => l.href.startsWith("/predictions/vip") || l.href === "/predictions/banker"),
    followedOnly,
  );
  check(
    "...containing the followed league's picks",
    !!followedOnly && followedOnly.body.includes(`${eplPick.homeTeam} vs ${eplPick.awayTeam}`) && /8 picks today on what you follow/.test(followedOnly.title),
    followedOnly,
  );
  seq = 200;
  const teamSlate = [
    pick({ leagueApiId: FRIENDLIES, homeTeamApiId: 501, awayTeamApiId: 502, pick: "Team pick" }),
    pick({ leagueApiId: EPL, homeTeamApiId: 9, awayTeamApiId: 10 }),
  ];
  const teamDigest = buildMorningDigest(teamSlate, null, MORNING)!;
  const teamOnly = personaliseDigest(teamDigest, digestAudienceFor(DIGEST_MORNING, { followedAlerts: true }, [{ targetType: "TEAM", targetKey: "501" }]), FREE);
  check("a team follow covers its match, even in a FALLBACK competition", !!teamOnly && teamOnly.body.includes("Team pick") && !teamOnly.body.includes("Home202"), teamOnly);
  check(
    "a follower with nothing relevant today gets nothing",
    personaliseDigest(teamDigest, digestAudienceFor(DIGEST_MORNING, { followedAlerts: true }, [{ targetType: "TEAM", targetKey: "999" }]), FREE) === null,
  );
  const lockedFollow = personaliseDigest(morning, digestAudienceFor(DIGEST_MORNING, { followedAlerts: true }, [{ targetType: "CATEGORY", targetKey: "VIP" }]), FREE);
  check(
    "a followed VIP pick is counted, never named, for a free reader",
    !!lockedFollow && /4 members-only picks/.test(lockedFollow.body) && !lockedFollow.body.includes(vipPick.pick) && !lockedFollow.body.includes(`${vipPick.homeTeam} vs`),
    lockedFollow,
  );
  const both = personaliseDigest(morning, digestAudienceFor(DIGEST_MORNING, { editorialAlerts: true, followedAlerts: true }, followEpl), FREE);
  check(
    "both enabled: one combined digest (global, plus a follows section)",
    !!both && both.title === freeMorning.title && both.body.startsWith(freeMorning.body) && /Your follows:/.test(both.body),
    both,
  );
  check("...one rendering, so one push", pushCopy({ type: DIGEST_MORNING, title: "", body: "", link: "/", category: null }, both)?.title === freeMorning.title);
  const dispatchSource = readFileSync("src/lib/notificationDispatch.ts", "utf8");
  check("...one delivery per user per event, personalised in place", dispatchSource.includes("personaliseDigest(") && dispatchSource.includes("nothing in digest for this user"));
  check(
    "neither enabled: no digest",
    personaliseDigest(morning, digestAudienceFor(DIGEST_MORNING, { editorialAlerts: false, followedAlerts: false }, followEpl), FREE) === null,
  );
  check(
    "followedAlerts on but newPredictions off: no follower morning digest",
    personaliseDigest(morning, digestAudienceFor(DIGEST_MORNING, { followedAlerts: true, newPredictions: false }, followEpl), FREE) === null,
  );
  const nightFollowed = personaliseDigest(buildNightDigest(halfway, botd.id, at(23 * 60 + 55)), digestAudienceFor(DIGEST_NIGHT, { followedAlerts: true }, followEpl), FREE);
  check(
    "a followed-only night digest is scoped and honest",
    !!nightFollowed && /^Your follows so far: /.test(nightFollowed.title) && /awaiting results/.test(nightFollowed.body) && !/Bet of the Day|Completed:/.test(nightFollowed.body),
    nightFollowed,
  );

  console.log("\nfollow matching agrees with the existing targeting rules:");
  const follows = [
    { targetType: "PREDICTION", targetKey: vipPick.id },
    { targetType: "TEAM", targetKey: "501" },
    { targetType: "TEAM", targetKey: "77" },
    { targetType: "CATEGORY", targetKey: "BANKER" },
    { targetType: "CATEGORY", targetKey: "VIP" },
    { targetType: "LEAGUE", targetKey: String(EPL) },
    { targetType: "LEAGUE", targetKey: "999" },
  ];
  let agree = true;
  for (const item of [...morning.items, ...teamDigest.items]) {
    for (const f of follows) {
      const legacy = receivesEvent(f, {
        type: "NEW_PREDICTION", predictionId: item.id, category: item.category, leagueApiId: item.leagueApiId, teamApiIds: item.teamApiIds, data: { categories: item.categories },
      });
      if (legacy !== followCoversItem(f, item)) agree = false;
    }
  }
  check("followCoversItem matches receivesEvent for every follow type", agree);

  console.log("\nentitlement-safe copy:");
  const vipSelection = vipPick.pick;
  const vipMorning = renderDigest(morning, VIP_MEMBER);
  check("free reader never sees a VIP selection", !freeMorning.body.includes(vipSelection) && !freeMorning.links.some((l) => l.label.includes(vipPick.homeTeam!)));
  check("free reader's VIP link goes to pricing", freeMorning.links.find((l) => l.label === "VIP")?.href === "/pricing");
  check("VIP member's VIP link goes to the feed", vipMorning.links.find((l) => l.label === "VIP")?.href === "/predictions/vip");
  seq = 100;
  const vipOnly = buildMorningDigest([pick({ leagueApiId: UCL, category: "VIP", categories: ["VIP"], pick: "Secret VIP call" })], null, MORNING)!;
  check("a VIP pick can be a highlight", vipOnly.highlights.length === 1);
  check("...the free reader sees neither it nor its match", !renderDigest(vipOnly, FREE).body.includes("Secret VIP call") && !renderDigest(vipOnly, FREE).body.includes("Home101"));
  check("...the VIP member sees it", renderDigest(vipOnly, VIP_MEMBER).body.includes("Secret VIP call"));
  check("Premium follows the same rule", renderDigest(morning, PREMIUM_MEMBER).links.find((l) => l.label === "VIP")?.href === "/predictions/vip");
  const pushed = pushCopy(
    { type: DIGEST_MORNING, title: "stored", body: "stored", link: "/predictions/today", category: null },
    personaliseDigest(morning, { editorial: true, followed: false, follows: [] }, FREE),
  );
  check("push copy is the per-recipient rendering, not the stored row", pushed?.title === freeMorning.title && !pushed.body.includes(vipSelection));
  check("a digest with no rendering for the recipient never falls back to the stored copy", pushCopy({ type: DIGEST_MORNING, title: "g", body: "g", link: "/", category: null }, null) === null);
  const nightFree = renderDigest(night, FREE);
  check("night digest carries no VIP selection", !nightFree.body.includes(vipSelection));
  check(
    "a paid individual event keeps the generic line",
    pushCopy({ type: "TIP_CHANGED", title: "t", body: "secret", link: "/predictions", category: "VIP" })?.body === "A followed tip has an update.",
  );

  console.log("\nquiet hours still suppress push:");
  const lagosNight = new Date("2026-09-22T22:30:00Z");
  const quiet = inQuietHours(lagosNight, "Africa/Lagos", 22 * 60, 7 * 60);
  check("inside quiet hours", quiet);
  for (const t of ["KICKOFF_REMINDER", "TIP_CHANGED", DIGEST_NIGHT]) check(`${t} does not ring in quiet hours`, !shouldPush(t, { pushEnabled: true, inQuietHours: quiet }));
  check("push disabled means no push", !shouldPush(DIGEST_MORNING, { pushEnabled: false, inQuietHours: false }));

  console.log("\npreferences still apply to digests:");
  check("editorial opt-in receives the morning digest", preferenceAllows(DIGEST_MORNING, { editorialAlerts: true, followedAlerts: false }));
  check("a follower with publication alerts receives it", preferenceAllows(DIGEST_MORNING, { followedAlerts: true, newPredictions: true }));
  check("followedAlerts off and no editorial opt-in: no digest", !preferenceAllows(DIGEST_MORNING, { followedAlerts: false, editorialAlerts: false }));
  check("results off: no night digest for a follower", !preferenceAllows(DIGEST_NIGHT, { followedAlerts: true, results: false }));

  if (failures) {
    console.error(`\n${failures} notification digest check(s) failed`);
    process.exit(1);
  }
  console.log("\nnotification digest checks passed");
})();
