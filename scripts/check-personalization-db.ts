/**
 * Sprint 01 personalization — database integration checks.
 *
 * Writes its own users, predictions and cache rows to an ISOLATED database
 * (assertIntegrationDatabase refuses anything else) and deletes them in
 * `finally`. Covers what the pure suite cannot: user ownership, duplicate
 * prevention by unique keys, cross-user access attempts, premium save refusal
 * and post-lapse masking, settlement display, deleted predictions, and the
 * dashboard queries (new user, multiple preferences, completed fixtures).
 *
 * Run: npm run preflight:integration  (or directly with the integration env)
 */
export {};

import { assertIntegrationDatabase } from "./lib/dbSafety";
const react = require("react");
react.cache = (fn: any) => fn;

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}
const eq = (label: string, a: unknown, b: unknown) => check(label, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
async function rejects(label: string, p: Promise<unknown>, status?: number) {
  try {
    await p;
    check(label, false, "did not throw");
  } catch (e: any) {
    check(label, status == null || e?.status === status, `status ${e?.status} ${e?.message}`);
  }
}

const TAG = `it-personal-${Date.now()}`;
const TEAM_A = 99_100_001;
const TEAM_B = 99_100_002;
const TEAM_C = 99_100_003;
const LEAGUE = 39;

async function main() {
  await assertIntegrationDatabase();
  const { prisma } = await import("../src/lib/prisma");
  const data = await import("../src/lib/personalizationData");
  const { entitlementFor } = await import("../src/lib/entitlement");

  const now = new Date();
  const userIds: string[] = [];
  const predictionIds: string[] = [];
  try {
    const mkUser = async (suffix: string, tier: string) => {
      const u = await prisma.user.create({ data: { email: `${TAG}-${suffix}@example.invalid`, subscription: { create: { tier, status: "ACTIVE" } } } });
      userIds.push(u.id);
      return u;
    };
    const author = await mkUser("author", "FREE");
    const alice = await mkUser("alice", "FREE");
    const bob = await mkUser("bob", "FREE");
    const vip = await mkUser("vip", "VIP");
    const free = entitlementFor({ tier: "FREE", status: "ACTIVE", currentPeriodEnd: null }, "USER");
    const vipEnt = entitlementFor({ tier: "VIP", status: "ACTIVE", currentPeriodEnd: null }, "USER");

    const mkPrediction = async (o: { cats: string[]; kickoff: Date; status?: string; outcome?: string; home?: number; away?: number; marketType?: string; selection?: object; pick?: string; scores?: [number, number] }) => {
      const p = await prisma.prediction.create({
        data: {
          category: o.cats[0],
          categories: { create: o.cats.map((category) => ({ category })) },
          status: o.status ?? "PUBLISHED",
          outcome: o.outcome ?? "PENDING",
          leagueApiId: LEAGUE,
          leagueName: "Premier League",
          homeTeam: `${TAG} Home ${o.home ?? TEAM_A}`,
          awayTeam: `${TAG} Away ${o.away ?? TEAM_B}`,
          homeTeamApiId: o.home ?? TEAM_A,
          awayTeamApiId: o.away ?? TEAM_B,
          kickoff: o.kickoff,
          marketType: o.marketType ?? "MATCH_WINNER",
          selection: o.selection ?? { value: "HOME" },
          market: "Match Winner",
          pick: o.pick ?? "Home Win",
          confidence: 70,
          reasoning: "Integration fixture.",
          authorId: author.id,
          publishedAt: o.status && o.status !== "PUBLISHED" ? null : now,
          finalHomeScore: o.scores?.[0] ?? null,
          finalAwayScore: o.scores?.[1] ?? null,
        },
      });
      predictionIds.push(p.id);
      return p;
    };

    // Lagos "today": safely inside the current Lagos day.
    const { start } = (await import("../src/lib/personalization")).zonedDayBounds("Africa/Lagos", now);
    const later = new Date(Math.max(now.getTime() + 30 * 60_000, start.getTime() + 60_000));
    const todayKick = later.getTime() < start.getTime() + 86_400_000 ? later : new Date(start.getTime() + 23 * 3_600_000);
    const freeToday = await mkPrediction({ cats: ["TODAY"], kickoff: todayKick, home: TEAM_A, away: TEAM_B, marketType: "BTTS", selection: { value: "YES" }, pick: "Yes" });
    const otherToday = await mkPrediction({ cats: ["TODAY"], kickoff: todayKick, home: TEAM_C, away: TEAM_C + 10 });
    const vipToday = await mkPrediction({ cats: ["VIP"], kickoff: todayKick, home: TEAM_C + 20, away: TEAM_C + 21 });
    const draft = await mkPrediction({ cats: ["TODAY"], kickoff: todayKick, status: "DRAFT" });
    const settled = await mkPrediction({ cats: ["TODAY"], kickoff: new Date(now.getTime() - 26 * 3_600_000), outcome: "WON", scores: [2, 0], home: TEAM_A, away: TEAM_C });
    const future = await mkPrediction({ cats: ["TODAY"], kickoff: new Date(now.getTime() + 3 * 86_400_000), home: TEAM_B, away: TEAM_A });

    console.log("preferences:");
    const s1 = await data.updatePreferences(alice.id, { teamIds: [TEAM_A, TEAM_A, TEAM_B], leagueIds: [LEAGUE, LEAGUE], preferredMarkets: ["BTTS", "BTTS"], timezone: "Europe/London" });
    eq("create: duplicates collapse to one follow each", [s1.teams.map((t) => t.id).sort(), s1.leagues.map((l) => l.id)], [[TEAM_A, TEAM_B], [LEAGUE]]);
    eq("create: markets de-duplicated", s1.preferredMarkets, ["BTTS"]);
    eq("create: timezone stored", s1.timezone, "Europe/London");
    check("team labels come from published data, not the client", s1.teams.every((t) => t.name.startsWith(TAG)));
    eq("one TEAM follow row per team (unique key)", await prisma.userFollow.count({ where: { userId: alice.id, targetType: "TEAM" } }), 2);
    const s2 = await data.updatePreferences(alice.id, { teamIds: [TEAM_A] });
    eq("update: removed team unfollowed, other fields untouched", [s2.teams.map((t) => t.id), s2.leagues.length, s2.timezone], [[TEAM_A], 1, "Europe/London"]);
    await rejects("invalid: unknown team id refused", data.updatePreferences(alice.id, { teamIds: [98_765_432] }), 400);
    await rejects("invalid: unknown league id refused", data.updatePreferences(alice.id, { leagueIds: [98_765_432] }), 400);
    eq("invalid input left state unchanged", (await data.readPersonalizationFresh(alice.id)).teams.map((t) => t.id), [TEAM_A]);
    const bobState = await data.readPersonalizationFresh(bob.id);
    eq("isolation: another user sees none of it", [bobState.hasPreferenceRow, bobState.teams.length, bobState.preferredMarkets.length], [false, 0, 0]);
    await prisma.notificationPreference.create({ data: { userId: bob.id } });
    await data.updatePreferences(bob.id, { timezone: "Asia/Dubai", onboarding: "complete" });
    eq("timezone kept in step with existing notification row", (await prisma.notificationPreference.findUnique({ where: { userId: bob.id } }))?.timezone, "Asia/Dubai");
    await data.updatePreferences(alice.id, { timezone: "Africa/Lagos" });
    check("no notification row is created for a user without one", !(await prisma.notificationPreference.findUnique({ where: { userId: alice.id } })));
    check("onboarding completion persisted", !!(await prisma.userPreference.findUnique({ where: { userId: bob.id } }))?.onboardingCompletedAt);

    console.log("favourites (follow / unfollow):");
    await data.updatePreferences(bob.id, { teamIds: [TEAM_C], leagueIds: [LEAGUE] });
    eq("follow team + competition", (await data.readPersonalizationFresh(bob.id)).teams.map((t) => t.id).concat((await data.readPersonalizationFresh(bob.id)).leagues.map((l) => l.id)), [TEAM_C, LEAGUE]);
    await data.updatePreferences(bob.id, { teamIds: [], leagueIds: [] });
    eq("unfollow team + competition", await prisma.userFollow.count({ where: { userId: bob.id, targetType: { in: ["TEAM", "LEAGUE"] } } }), 0);
    await prisma.userFollow.create({ data: { userId: bob.id, targetType: "PREDICTION", targetKey: future.id } });
    await data.updatePreferences(bob.id, { teamIds: [TEAM_A] });
    await data.resetPreferences(bob.id);
    const reset = await data.readPersonalizationFresh(bob.id);
    eq("reset clears teams/leagues/markets/timezone", [reset.teams.length, reset.leagues.length, reset.preferredMarkets.length, reset.timezone], [0, 0, 0, "Africa/Lagos"]);
    eq("reset keeps match-alert follows (not a preference)", await prisma.userFollow.count({ where: { userId: bob.id, targetType: "PREDICTION" } }), 1);

    console.log("saved predictions:");
    const first = await data.savePrediction(alice.id, freeToday.id, free);
    const again = await data.savePrediction(alice.id, freeToday.id, free);
    eq("save then repeat: one row, second reports existing", [first.created, again.created, again.saved.id === first.saved.id], [true, false, true]);
    const racing = await Promise.allSettled([data.savePrediction(alice.id, otherToday.id, free), data.savePrediction(alice.id, otherToday.id, free)]);
    eq("concurrent duplicate saves: both resolve, one row", [racing.every((r) => r.status === "fulfilled"), await prisma.savedPrediction.count({ where: { userId: alice.id, predictionId: otherToday.id } })], [true, 1]);
    await rejects("premium: FREE user cannot save a VIP pick", data.savePrediction(alice.id, vipToday.id, free), 403);
    await rejects("draft prediction cannot be saved", data.savePrediction(alice.id, draft.id, free), 404);
    await rejects("nonexistent id → 404", data.savePrediction(alice.id, "clnotarealid000000000", free), 404);
    eq("ids endpoint data is the owner's only", (await data.savedPredictionIds(bob.id)).length, 0);
    eq("cross-user unsave by prediction id removes nothing", await data.unsavePrediction(bob.id, { predictionId: freeToday.id }), 0);
    eq("cross-user unsave by bookmark id removes nothing", await data.unsavePrediction(bob.id, { savedId: first.saved.id }), 0);
    check("owner's bookmark still present", (await data.savedPredictionIds(alice.id)).includes(freeToday.id));
    eq("cross-user list is empty", (await data.listSaved(bob.id, free, "all", 1)).total, 0);
    eq("owner unsave", await data.unsavePrediction(alice.id, { predictionId: otherToday.id }), 1);

    console.log("settlement display:");
    await data.savePrediction(alice.id, settled.id, free);
    const settledList = await data.listSaved(alice.id, free, "settled", 1);
    const item = settledList.items.find((i) => i.predictionId === settled.id);
    eq("settled filter + WON with final score", [item?.view.state, item?.view.outcome, item?.view.finalScore], ["settled", "WON", "2–0"]);
    eq("won filter", (await data.listSaved(alice.id, free, "won", 1)).items.map((i) => i.predictionId), [settled.id]);
    eq("upcoming filter excludes settled", (await data.listSaved(alice.id, free, "upcoming", 1)).items.some((i) => i.predictionId === settled.id), false);
    // An admin rewrites the pick after the reader saved it.
    await prisma.prediction.update({ where: { id: settled.id }, data: { selection: { value: "AWAY" }, pick: "Away Win", outcome: "LOST" } });
    const rewritten = (await data.listSaved(alice.id, free, "all", 1)).items.find((i) => i.predictionId === settled.id)!;
    eq("rewrite: saved pick shown, change disclosed, saved selection settled from the score", [rewritten.pick, rewritten.view.changedTo, rewritten.view.outcome], ["Home Win", "Away Win", "WON"]);

    console.log("premium after lapse:");
    const vipSave = await data.savePrediction(vip.id, vipToday.id, vipEnt);
    check("VIP can save a VIP pick", vipSave.created);
    const lapsed = (await data.listSaved(vip.id, free, "all", 1)).items[0];
    eq("lapsed subscriber: pick, market, odds, confidence withheld server-side", [lapsed.view.locked, lapsed.pick, lapsed.market, lapsed.odds, lapsed.confidence], [true, null, null, null, null]);
    const active = (await data.listSaved(vip.id, vipEnt, "all", 1)).items[0];
    eq("active subscriber sees it", [active.view.locked, active.pick], [false, "Home Win"]);

    console.log("deleted prediction:");
    const doomed = await mkPrediction({ cats: ["TODAY"], kickoff: new Date(now.getTime() + 5 * 3_600_000), home: TEAM_C + 30, away: TEAM_C + 31 });
    await data.savePrediction(alice.id, doomed.id, free);
    await prisma.prediction.delete({ where: { id: doomed.id } });
    const orphan = await prisma.savedPrediction.findFirst({ where: { userId: alice.id, homeTeamApiId: TEAM_C + 30 }, include: { prediction: true } });
    eq("bookmark survives with its snapshot (SetNull)", [!!orphan, orphan?.predictionId, orphan?.pick], [true, null, "Home Win"]);
    const orphanItem = (await data.listSaved(alice.id, free, "all", 1)).items.find((i) => i.id === orphan?.id);
    eq("shown as unavailable, no result invented", [orphanItem?.view.state, orphanItem?.view.outcome], ["unavailable", null]);
    eq("orphan removable by bookmark id (owner only)", [await data.unsavePrediction(bob.id, { savedId: orphan!.id }), await data.unsavePrediction(alice.id, { savedId: orphan!.id })], [0, 1]);

    console.log("dashboard:");
    const freePicks = (await data.todaysPicks(free, "Africa/Lagos", now)).filter((p) => predictionIds.includes(p.id));
    check("today: free published picks included", freePicks.some((p) => p.id === freeToday.id) && freePicks.some((p) => p.id === otherToday.id));
    check("today: VIP pick never fetched for a FREE viewer", !freePicks.some((p) => p.id === vipToday.id));
    check("today: drafts never included", !freePicks.some((p) => p.id === draft.id));
    check("today: VIP viewer gets the VIP pick", (await data.todaysPicks(vipEnt, "Africa/Lagos", now)).some((p) => p.id === vipToday.id));
    await data.updatePreferences(alice.id, { teamIds: [TEAM_A], leagueIds: [], preferredMarkets: ["BTTS"] });
    const alicePrefs = await data.readPersonalizationFresh(alice.id);
    const ranked = data.personalizePicks(freePicks, data.interestsOf(alicePrefs), now);
    eq("multiple preferences: followed team's pick leads, with reasons", [ranked.relevant[0]?.row.id, ranked.relevant[0]?.reasons], [freeToday.id, ["team", "market"]]);
    check("non-matching picks listed separately", ranked.others.some((r) => r.row.id === otherToday.id));
    const newUser = await data.readPersonalizationFresh(author.id);
    const plain = data.personalizePicks(freePicks, data.interestsOf(newUser), now);
    eq("user without preferences: no 'relevant' bucket, defaults shown", [plain.relevant.length, plain.others.length > 0], [0, true]);
    eq("no relevant fixtures: empty relevant list", data.personalizePicks(freePicks, { teamIds: new Set([1]), leagueIds: new Set(), markets: new Set() }, now).relevant.length, 0);

    // A league cache that still lists a match that has already kicked off.
    const existingCache = await prisma.leagueEnrichmentCache.findUnique({ where: { leagueApiId: 40_000_001 } });
    if (!existingCache) {
      await prisma.leagueEnrichmentCache.create({
        data: {
          leagueApiId: 40_000_001,
          fetchedAt: now,
          upcomingJson: [
            { id: 1, date: new Date(now.getTime() - 3_600_000).toISOString(), homeTeam: "Stale", awayTeam: "Past", homeLogo: null, awayLogo: null, homeId: TEAM_A, awayId: TEAM_C + 40 },
            { id: 2, date: new Date(now.getTime() + 6 * 86_400_000).toISOString(), homeTeam: "Cache", awayTeam: "Future", homeLogo: null, awayLogo: null, homeId: TEAM_A, awayId: TEAM_C + 41 },
          ],
        },
      });
      await prisma.teamEnrichmentCache.upsert({ where: { teamApiId: TEAM_A }, update: { leagueApiId: 40_000_001 }, create: { teamApiId: TEAM_A, leagueApiId: 40_000_001 } });
    }
    const upcoming = await data.upcomingForFavourites(alicePrefs, now);
    check("upcoming: future prediction fixture included with indicator", upcoming.some((f) => f.homeTeamApiId === TEAM_B && f.hasPrediction && !!f.href));
    check("upcoming: cached future fixture included", upcoming.some((f) => f.homeTeam === "Cache"));
    check("upcoming: completed / started fixtures excluded", !upcoming.some((f) => f.homeTeam === "Stale" || f.kickoff.getTime() <= now.getTime()));
    check("upcoming: settled match excluded", !upcoming.some((f) => f.awayTeamApiId === TEAM_C && f.homeTeamApiId === TEAM_A));
    eq("upcoming: no favourites → empty, no query fallbacks invented", await data.upcomingForFavourites(newUser, now), []);

    console.log("cascade:");
    await prisma.user.delete({ where: { id: bob.id } });
    userIds.splice(userIds.indexOf(bob.id), 1);
    eq("deleting a user removes their preferences and follows", [await prisma.userPreference.count({ where: { userId: bob.id } }), await prisma.userFollow.count({ where: { userId: bob.id } })], [0, 0]);
  } finally {
    await prisma.savedPrediction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.prediction.deleteMany({ where: { id: { in: predictionIds } } });
    await prisma.leagueEnrichmentCache.deleteMany({ where: { leagueApiId: 40_000_001 } });
    await prisma.teamEnrichmentCache.deleteMany({ where: { teamApiId: TEAM_A } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } });
    check("cleanup: no test users remain", left === 0);
    await prisma.$disconnect();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
