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
  nightDigestDay,
  nightDigestDecision,
  nightDigestKey,
  digestDayLabel,
  digestDeliverNotBefore,
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
import {
  lagosDay as lagosDayKeyForTest,
  MORNING_EARLY_MIN_READY,
  digestAudienceFor,
  followCoversItem,
  isInboxOnlyEvent,
  morningDigestDecision,
  personaliseDigest,
  topPredictionDelivery,
  topPredictionPushEligible,
  type MorningDigestData,
} from "../src/lib/notificationDigest";
import { createDailyDigests } from "../src/lib/dailyDigests";
import { prisma } from "../src/lib/prisma";
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
  const night = buildNightDigest(slate.map((p) => ({ ...p, outcome: "WON" })), botd.id, DAY);
  for (let i = 0; i < 3; i++) {
    await createNotificationEvent({ eventKey: morningDigestKey(DAY), type: DIGEST_MORNING, title: "t", body: "b", link: "/predictions/today", data: morning }, fakeDb);
    await createNotificationEvent({ eventKey: nightDigestKey(DAY), type: DIGEST_NIGHT, title: "t", body: "b", link: "/track-record", data: night }, fakeDb);
  }
  check("three runs create one morning and one night event", creates === 2, creates);
  const dailyDigests = readFileSync("src/lib/dailyDigests.ts", "utf8");
  check(
    "creation is keyed on the day key, not the clock",
    dailyDigests.includes("morningDigestKey(day)") && dailyDigests.includes("nightDigestKey(summarised)") && dailyDigests.includes("nightDigestDay(now)"),
  );

  console.log("\nnight digest timing (previous Lagos day, created 03:10 to 03:30, delivered from 07:00):");
  const settled = slate.map((p) => ({ ...p, outcome: "WON" }));
  const halfway = slate.map((p, i) => ({ ...p, outcome: i % 2 ? "LOST" : "PENDING" }));
  const nearlyAll = slate.map((p, i) => ({ ...p, outcome: i === 0 ? "PENDING" : "WON" })); // 21 of 22 settled
  // Minutes on the Lagos morning AFTER the summarised day.
  const NEXT = "2026-09-23";
  const after = (minutes: number) => lagosInstant(NEXT, minutes);
  check("evaluation starts at 03:10, after the 03:00 settlement run", DIGEST_TIMING.nightFrom === 3 * 60 + 10);
  check("hard cutoff is 03:30", DIGEST_TIMING.nightDeadline === 3 * 60 + 30);
  check("no longer created from 04:00", DIGEST_TIMING.nightUntil === 4 * 60);
  check("delivery is held until 07:00", DIGEST_TIMING.nightDeliverFrom === 7 * 60);
  check("before midnight it points at the day before, never the day still being played", nightDigestDay(at(23 * 60 + 30)) === "2026-09-21");
  check("after midnight it summarises the previous Lagos day", nightDigestDay(after(190)) === DAY && nightDigestDay(after(0)) === DAY && nightDigestDay(after(5 * 60 + 59)) === DAY);
  check("...so the event key is digest:night:<summarised day>", nightDigestKey(nightDigestDay(after(190))) === "digest:night:2026-09-22");
  check("month and year boundaries roll back correctly", nightDigestDay(lagosInstant("2026-10-01", 70)) === "2026-09-30" && nightDigestDay(lagosInstant("2027-01-01", 70)) === "2026-12-31");
  check("the Lagos day boundary is 23:00 UTC", nightDigestDay(new Date("2026-09-22T23:10:00Z")) === DAY && nightDigestDay(new Date("2026-09-22T22:50:00Z")) === "2026-09-21");
  check("nothing on the evening itself, even fully settled", !nightDigestDecision(settled, at(23 * 60)).send && !nightDigestDecision(settled, at(23 * 60 + 55)).send);
  check("nothing between midnight and 03:10, even fully settled", !nightDigestDecision(settled, after(0)).send && !nightDigestDecision(settled, after(70)).send && !nightDigestDecision(settled, after(185)).send);
  check("03:05: not yet", !nightDigestDecision(settled, after(185)).send);
  check("created at 03:10 once every pick has settled", JSON.stringify(nightDigestDecision(settled, after(190))) === JSON.stringify({ send: true, partial: false }));
  check(
    "sent once substantially settled, labelled partial",
    JSON.stringify(nightDigestDecision(nearlyAll, after(195))) === JSON.stringify({ send: true, partial: true }),
    nightDigestDecision(nearlyAll, after(195)),
  );
  check("an unresolved slate defers at 03:10", !nightDigestDecision(halfway, after(190)).send);
  check("...and still defers at 03:25", !nightDigestDecision(halfway, after(205)).send);
  check("the 03:30 cutoff sends it partial", JSON.stringify(nightDigestDecision(halfway, after(210))) === JSON.stringify({ send: true, partial: true }));
  check("nothing when nothing settled, even at the cutoff", !nightDigestDecision(slate, after(210)).send);
  check("...or later", !nightDigestDecision(slate, after(225)).send);
  check("not created from 04:00, even fully settled", !nightDigestDecision(settled, after(4 * 60)).send);
  check(
    "delivery of the 22 Sep digest is held until 07:00 on 23 Sep",
    digestDeliverNotBefore({ type: DIGEST_NIGHT, data: buildNightDigest(settled, botd.id, DAY) })?.getTime() === after(7 * 60).getTime(),
  );
  check("no other event type is held", digestDeliverNotBefore({ type: DIGEST_MORNING, data: morning }) === null && digestDeliverNotBefore({ type: "TIP_CHANGED", data: {} }) === null);
  check("the copy never says tonight", !/tonight/i.test(JSON.stringify([renderDigest(buildNightDigest(settled, botd.id, DAY), FREE), renderDigest(buildNightDigest(halfway, botd.id, DAY), FREE)])));
  const cutoff = renderDigest(buildNightDigest(halfway, botd.id, DAY), FREE);
  check(
    "cutoff digest is Results so far, dated, with the unsettled count",
    cutoff.title.startsWith("Results so far for Tue 22 Sep") && /11 still awaiting results/.test(cutoff.body) && !/All \d+ of/.test(cutoff.body),
    cutoff,
  );
  check("the payload's day is the day summarised, not the day it is built", buildNightDigest(settled, botd.id, DAY).day === DAY);
  const full = renderDigest(night, FREE);
  check(
    "a full digest says so, by date rather than 'today'",
    full.title.startsWith("Results for Tue 22 Sep") && /All \d+ of Tue 22 Sep's picks settled/.test(full.body) && !/today/i.test(full.title + full.body),
    full,
  );
  check("Bet of the Day result is included", /Bet of the Day: .* WON/.test(full.body), full.body);
  check("completed categories are listed", /Completed: Banker, Genius, VIP/.test(full.body), full.body);
  check("links to the track record", full.link === "/track-record");
  check("the date label is stable", digestDayLabel("2026-09-22") === "Tue 22 Sep" && digestDayLabel("2026-12-31") === "Thu 31 Dec");

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
  const nightFollowed = personaliseDigest(buildNightDigest(halfway, botd.id, DAY), digestAudienceFor(DIGEST_NIGHT, { followedAlerts: true }, followEpl), FREE);
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

  console.log("\nmorning readiness rule:");
  seq = 300;
  const bankerPick = pick({ leagueApiId: EPL, categories: ["BANKER"] });
  const vipLater = pick({ leagueApiId: UCL, category: "VIP", categories: ["VIP"] });
  const botdOnly = pick({ leagueApiId: SERIE_A, categories: ["BET_OF_THE_DAY"] });
  const featuredOnly = pick({ leagueApiId: EPL });
  const decide = (picks: DigestPick[], minutes: number, botdId: string | null = null) => morningDigestDecision(buildMorningDigest(picks, botdId, at(minutes)), at(minutes));
  check("never before 09:00, even with a full slate", !decide([bankerPick, vipLater], 8 * 60 + 59).send);
  check("09:00 with one category waits", !decide([bankerPick], 9 * 60).send);
  check("09:00 with two categories sends", decide([bankerPick, vipLater], 9 * 60).send);
  check("09:00 with Bet of the Day plus a category sends", decide([bankerPick, botdOnly], 9 * 60, botdOnly.id).send);
  check("09:29 with one category still waits", !decide([bankerPick], 9 * 60 + 29).send);
  check("09:30 with one category sends", decide([bankerPick], 9 * 60 + 30).send);
  check("09:45 with only uncategorised picks waits", !decide([featuredOnly], 9 * 60 + 45).send);
  check("10:00 (hard latest) with only uncategorised picks sends", decide([featuredOnly], 10 * 60).send);
  check("no usable picks: never", !decide([], 11 * 60).send);
  check("after 13:00: no longer created", !decide([bankerPick, vipLater], 13 * 60).send);
  check("thresholds are named", MORNING_EARLY_MIN_READY === 2 && DIGEST_TIMING.morningSettle === 9 * 60 + 30 && DIGEST_TIMING.morningHardLatest === 10 * 60);

  // The real createDailyDigests, run every 5 minutes against an in-memory
  // stand-in for the reads and the one write it makes.
  const db = prisma as unknown as Record<string, Record<string, unknown>>;
  // `settleAt`/`result`: when the settlement job resolves the pick, and to what.
  let published: { pick: DigestPick; at: number; settleAt?: number; result?: string }[] = [];
  let taggedBotd: string | null = null;
  const events = new Map<string, { type: string; data: MorningDigestData; createdAt: Date }>();
  let eventCreates = 0;
  let clock = 0;
  db.prediction.findMany = async ({ where }: { where?: { kickoff?: { gte: Date; lt: Date } } } = {}) =>
    published
      .filter((p) => p.at <= clock)
      .filter(({ pick: p }) => !where?.kickoff || (!!p.kickoff && p.kickoff >= where.kickoff.gte && p.kickoff < where.kickoff.lt))
      .map(({ pick: p, settleAt, result }) => ({
        ...p,
        outcome: settleAt != null && settleAt <= clock ? result ?? "WON" : p.outcome,
        categories: p.categories.map((category) => ({ category })),
      }));
  db.prediction.findFirst = async () => (taggedBotd && published.some((p) => p.pick.id === taggedBotd && p.at <= clock) ? { id: taggedBotd } : null);
  db.notificationEvent.findUnique = async ({ where }: { where: { eventKey: string } }) => (events.has(where.eventKey) ? { id: where.eventKey } : null);
  db.notificationEvent.upsert = async ({ where, create }: { where: { eventKey: string }; create: { type: string; data: MorningDigestData } }) => {
    if (!events.has(where.eventKey)) {
      events.set(where.eventKey, { ...create, createdAt: new Date(clock) });
      eventCreates++;
    }
    return events.get(where.eventKey);
  };
  async function runMorning() {
    const created: string[] = [];
    for (let m = 8 * 60 + 50; m <= 13 * 60 + 10; m += 5) {
      clock = at(m).getTime();
      const r = await createDailyDigests(new Date(clock));
      if (r.morning === "created") created.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    }
    return created;
  }

  published = [{ pick: bankerPick, at: at(9 * 60).getTime() }, { pick: vipLater, at: at(9 * 60 + 15).getTime() }];
  events.clear(); eventCreates = 0;
  const staggered = await runMorning();
  const staggeredEvent = events.get(morningDigestKey(DAY));
  check("Banker at 09:00, VIP at 09:15: nothing frozen at 09:00", !staggered.includes("09:00") && !staggered.includes("09:05") && !staggered.includes("09:10"), staggered);
  check("...created at 09:15 when VIP arrives", JSON.stringify(staggered) === JSON.stringify(["09:15"]), staggered);
  check(
    "...and it names both categories",
    JSON.stringify(staggeredEvent?.data.categories.map((c) => c.category)) === JSON.stringify(["BANKER", "VIP"]),
    staggeredEvent?.data.categories,
  );
  check("idempotent: 51 reminders runs, one morning event", eventCreates === 1 && events.size === 1, eventCreates);

  published = [{ pick: bankerPick, at: at(9 * 60).getTime() }];
  events.clear(); eventCreates = 0;
  const sparse = await runMorning();
  check("a genuinely sparse day (one category) still sends, by 09:30", JSON.stringify(sparse) === JSON.stringify(["09:30"]), sparse);
  published = [{ pick: featuredOnly, at: at(8 * 60).getTime() }];
  events.clear(); eventCreates = 0;
  const bare = await runMorning();
  check("a day with no digest category sends at the 10:00 hard latest point", JSON.stringify(bare) === JSON.stringify(["10:00"]), bare);
  check("...still exactly one event", eventCreates === 1);
  published = [];
  events.clear(); eventCreates = 0;
  check("an empty day creates nothing", (await runMorning()).length === 0 && eventCreates === 0);
  taggedBotd = null;

  // Every reminders run (every 5 minutes) between two Lagos instants; returns
  // the runs at which a night digest was created, as "YYYY-MM-DD HH:MM" Lagos.
  const events2 = events as unknown as Map<string, { type: string; title: string; body: string; data: { day: string }; expiresAt: Date }>;
  async function runNights(fromDay: string, fromMinute: number, toDay: string, toMinute: number) {
    const created: string[] = [];
    const reasons = new Map<string, string>();
    for (let t = lagosInstant(fromDay, fromMinute).getTime(); t <= lagosInstant(toDay, toMinute).getTime(); t += 5 * 60_000) {
      clock = t;
      const r = await createDailyDigests(new Date(clock));
      const minute = Math.round((t - lagosInstant(lagosDayKeyForTest(new Date(t)), 0).getTime()) / 60_000);
      const label = `${lagosDayKeyForTest(new Date(t))} ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      reasons.set(label, r.night);
      if (r.night.startsWith("created")) created.push(label);
    }
    return { created, reasons };
  }
  const settleRun = (day: string, minutes: number) => lagosInstant(day, minutes).getTime();

  console.log("\nnight digest across midnight: the 22 Sep 2026 production pattern:");
  // Production, 22 Sep: 89 published picks, last kickoff 23:30 Lagos. Settlement
  // runs every three hours. Nothing had settled by 23:55, so the old 23:00-23:55
  // window logged "nothing settled by the cutoff" and the day never got a
  // digest. Settled counts read from production: 50 after the 00:00 run on
  // 23 Sep, 70 after the 03:00 run, 82 only after the 18:00 run; 7 never.
  seq = 400;
  const SEP22 = "2026-09-22", SEP23 = "2026-09-23", SEP24 = "2026-09-24";
  published = Array.from({ length: 89 }, (_, i) => ({
    pick: pick({ kickoff: lagosInstant(SEP22, 12 * 60 + Math.round((i * 11.5 * 60) / 88)), categories: i === 0 ? ["BET_OF_THE_DAY"] : i % 4 ? [] : ["GENIUS"] }),
    at: lagosInstant(SEP22, 8 * 60).getTime(),
    settleAt: i < 50 ? settleRun(SEP23, 0) : i < 70 ? settleRun(SEP23, 3 * 60) : i < 82 ? settleRun(SEP23, 18 * 60) : undefined,
    result: i % 3 ? "WON" : "LOST",
  }));
  taggedBotd = published[0].pick.id;
  events.clear(); eventCreates = 0;
  clock = lagosInstant(SEP22, 23 * 60 + 55).getTime();
  const at2355 = (await prisma.prediction.findMany({ where: { kickoff: { gte: lagosInstant(SEP22, 0), lt: lagosInstant(SEP22, 24 * 60) } } } as never)) as { outcome: string }[];
  check("22 Sep at 23:55: 0 of 89 settled, which is why the old same-evening window skipped it", at2355.length === 89 && at2355.every((p) => p.outcome === "PENDING"));
  const sep22Run = await runNights(SEP22, 22 * 60 + 55, SEP23, 6 * 60 + 10);
  const sep22Event = events2.get("digest:night:2026-09-22");
  check("nothing is created on the evening of 22 Sep", ![...sep22Run.reasons.entries()].some(([k, v]) => k.startsWith(SEP22) && v.startsWith("created")));
  check("from 00:00 to 03:05 on 23 Sep nothing is evaluated", ["00:30", "01:10", "02:00", "03:05"].every((t) => sep22Run.reasons.get(`${SEP23} ${t}`) === "outside window"));
  check("03:10 with 70 of 89 settled (79%, under 90%): deferred", sep22Run.reasons.get(`${SEP23} 03:10`) === "deferred: 19 still unsettled", sep22Run.reasons.get(`${SEP23} 03:10`));
  check("the 22 Sep digest is created on 23 Sep at the 03:30 cutoff", JSON.stringify(sep22Run.created) === JSON.stringify([`${SEP23} 03:30`]), sep22Run.created);
  check("...under the 22 Sep key", !!sep22Event && sep22Event.data.day === SEP22 && events2.size === 1);
  check(
    "...honestly partial: Results so far, with the unsettled count",
    !!sep22Event && sep22Event.title.startsWith("Results so far for Tue 22 Sep: ") && sep22Event.body.includes("70 of 89 settled — 19 still awaiting results."),
    sep22Event,
  );
  check("...with the day's Bet of the Day result, still tagged after midnight", !!sep22Event && /^Bet of the Day: .*: LOST$/m.test(sep22Event.body), sep22Event?.body);
  check("...expiring at 12:00 on 23 Sep", sep22Event?.expiresAt.getTime() === lagosInstant(SEP23, 12 * 60).getTime());
  check("every later run up to 04:00 is a no-op", sep22Run.reasons.get(`${SEP23} 03:35`) === "already created" && sep22Run.reasons.get(`${SEP23} 03:55`) === "already created" && eventCreates === 1);
  check("from 04:00 the night window is closed", sep22Run.reasons.get(`${SEP23} 04:00`) === "outside window" && sep22Run.reasons.get(`${SEP23} 06:00`) === "outside window");

  console.log("\nnight digest across midnight: a day that settles by the 00:00 run (23 Sep):");
  // Production, 23 Sep: 74 picks, last kickoff 20:00. 44 had settled by 23:55,
  // so the old window sent a partial "Results so far" at 23:55. The 00:00 run
  // on 24 Sep settled the other 30.
  seq = 600;
  published = Array.from({ length: 74 }, (_, i) => ({
    pick: pick({ kickoff: lagosInstant(SEP23, 13 * 60 + Math.round((i * 7 * 60) / 73)) }),
    at: lagosInstant(SEP23, 8 * 60).getTime(),
    settleAt: i < 44 ? settleRun(SEP23, 21 * 60) : settleRun(SEP24, 0),
    result: i % 2 ? "WON" : "LOST",
  }));
  taggedBotd = null;
  events.clear(); eventCreates = 0;
  const sep23Run = await runNights(SEP23, 22 * 60 + 55, SEP24, 6 * 60 + 10);
  const sep23Event = events2.get("digest:night:2026-09-23");
  check("created once, at 03:10 on 24 Sep", JSON.stringify(sep23Run.created) === JSON.stringify([`${SEP24} 03:10`]) && eventCreates === 1, sep23Run.created);
  check(
    "...as the completed-results recap, not Results so far",
    !!sep23Event && sep23Event.title.startsWith("Results for Wed 23 Sep: ") && sep23Event.body.includes("All 74 of Wed 23 Sep's picks settled."),
    sep23Event,
  );

  console.log("\nnight digest: no duplicates, and nothing for a day with no results:");
  // Deploy night: the old code already made tonight's digest in its 23:00-23:55 window.
  events.clear(); eventCreates = 0;
  events.set("digest:night:2026-09-23", { type: DIGEST_NIGHT, data: {} as MorningDigestData, createdAt: lagosInstant(SEP23, 23 * 60 + 55) });
  const dupRun = await runNights(SEP24, 0, SEP24, 6 * 60 + 10);
  check("an existing digest for the summarised day is never repeated", dupRun.created.length === 0 && eventCreates === 0 && dupRun.reasons.get(`${SEP24} 03:10`) === "already created");
  seq = 800;
  published = Array.from({ length: 10 }, (_, i) => ({ pick: pick({ kickoff: lagosInstant(SEP23, 19 * 60 + i) }), at: lagosInstant(SEP23, 8 * 60).getTime() }));
  events.clear(); eventCreates = 0;
  const noneRun = await runNights(SEP24, 0, SEP24, 6 * 60 + 10);
  check("zero settled: nothing created, before or after the cutoff", noneRun.created.length === 0 && eventCreates === 0, noneRun.created);
  check("...and the run says why", noneRun.reasons.get(`${SEP24} 03:30`) === "nothing settled by the cutoff");
  published = [];
  events.clear(); eventCreates = 0;
  const emptyRun = await runNights(SEP24, 0, SEP24, 6 * 60 + 10);
  check("a day with no published picks creates nothing", emptyRun.created.length === 0 && emptyRun.reasons.get(`${SEP24} 03:10`) === "no published picks that day");

  console.log("\nTOP_PREDICTION push eligibility:");
  const SWEDEN = 113;
  check("CORE is eligible", topPredictionPushEligible(EPL) && topPredictionPushEligible(UCL));
  check("a selected strong SECONDARY league is eligible", topPredictionPushEligible(EREDIVISIE) && topPredictionPushEligible(399));
  check("other SECONDARY leagues are not", !topPredictionPushEligible(SWEDEN));
  check("FALLBACK is never eligible", !topPredictionPushEligible(FRIENDLIES));
  check("DEEP_FALLBACK is never eligible", !topPredictionPushEligible(NATIONAL_LEAGUE));
  check("an unknown league is not eligible", !topPredictionPushEligible(null) && !topPredictionPushEligible(undefined));
  const on = { pushEnabled: true, inQuietHours: false };
  check("a CORE top prediction pushes", shouldPush("TOP_PREDICTION", { ...on, leagueApiId: EPL }));
  check("...subject to push being enabled", !shouldPush("TOP_PREDICTION", { ...on, pushEnabled: false, leagueApiId: EPL }));
  check("...and to quiet hours", !shouldPush("TOP_PREDICTION", { ...on, inQuietHours: true, leagueApiId: EPL }));
  check("...and to editorialAlerts", !preferenceAllows("TOP_PREDICTION", { editorialAlerts: false }));
  check("a FALLBACK top prediction does not push", !shouldPush("TOP_PREDICTION", { ...on, leagueApiId: FRIENDLIES }));
  check("a DEEP_FALLBACK top prediction does not push", !shouldPush("TOP_PREDICTION", { ...on, leagueApiId: NATIONAL_LEAGUE }));
  check("...but it is delivered to the inbox, not skipped", topPredictionDelivery(FRIENDLIES, 0, 3) === "inbox-only" && topPredictionDelivery(NATIONAL_LEAGUE, 5, 1) === "inbox-only");
  check("...and counted as an inbox-only event", isInboxOnlyEvent({ type: "TOP_PREDICTION", leagueApiId: FRIENDLIES }) && !isInboxOnlyEvent({ type: "TOP_PREDICTION", leagueApiId: EPL }));
  const dispatch = readFileSync("src/lib/notificationDispatch.ts", "utf8");
  check(
    "dispatch writes the inbox row before deciding the push, and only 'capped' skips it",
    dispatch.indexOf("userNotification.upsert") < dispatch.indexOf("shouldPush(row.event.type") && /=== "capped"\) \{\s*await skip\(row\.id, "editorial daily cap"\)/.test(dispatch),
  );
  check("the push decision passes the event's league", dispatch.includes("leagueApiId: row.event.leagueApiId"));
  function pushesOver(leagues: (number | null)[], cap: number) {
    let eligibleToday = 0;
    let pushes = 0;
    for (const league of leagues) {
      const d = topPredictionDelivery(league, eligibleToday, cap);
      if (d === "push") {
        pushes++;
        eligibleToday++;
      }
    }
    return pushes;
  }
  check("5 eligible top predictions with the cap configured at 50: at most 3 push", pushesOver([EPL, UCL, LALIGA, SERIE_A, EREDIVISIE], editorialDailyCap("50")) === 3);
  check("...even if a cap above 3 reached the decision directly", pushesOver([EPL, UCL, LALIGA, SERIE_A, EREDIVISIE], 10) === 3);
  check("with the default cap of 1: one", pushesOver([EPL, UCL, LALIGA], editorialDailyCap(undefined)) === 1);
  check("fallback top predictions do not use up the cap", pushesOver([FRIENDLIES, NATIONAL_LEAGUE, FRIENDLIES, EPL], 1) === 1);
  check(
    "Bet of the Day in the morning digest is unaffected by the push gate",
    buildMorningDigest([pick({ leagueApiId: FRIENDLIES, categories: ["BET_OF_THE_DAY"] })], `p${String(seq).padStart(2, "0")}`, MORNING)?.betOfTheDay !== null,
  );

  if (failures) {
    console.error(`\n${failures} notification digest check(s) failed`);
    process.exit(1);
  }
  console.log("\nnotification digest checks passed");
})();
