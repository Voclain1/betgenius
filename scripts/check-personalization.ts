/**
 * Sprint 01 personalization — pure checks (no database, no network).
 *
 * Covers: market list derived from the app's market config, timezone
 * validation and day bounds, input validation and duplicate collapsing,
 * personal ranking order, upcoming-fixture rules (completed fixtures never
 * upcoming), saved-prediction settlement and the no-silent-substitution rule,
 * premium masking, onboarding targeting, the account-API access decision,
 * the rate limiter, analytics payload hygiene and public copy rules.
 *
 * The database half (ownership, duplicates, cross-user access, premium save
 * refusal, dashboard queries) is scripts/check-personalization-db.ts.
 *
 * Run: npx tsx scripts/check-personalization.ts
 */
export {};

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PREFERENCE_MARKETS,
  PreferencesUpdate,
  SaveRequest,
  buildUpcoming,
  diffIds,
  isPreferenceMarket,
  isValidTimeZone,
  kickoffInZone,
  orderedCompetitions,
  parseSavedFilter,
  matchesSavedFilter,
  orderSaved,
  recentlySettled,
  rankPersonalized,
  safeTimeZone,
  savedPredictionView,
  shouldInviteToPersonalize,
  shouldStartOnboarding,
  uniqueIds,
  zonedDayBounds,
  ONBOARDING_WINDOW_MS,
  type Interests,
} from "../src/lib/personalization";
import { MARKET_TYPES } from "../src/lib/markets";
import { decideAccountAccess } from "../src/lib/accountApi";
import { rateLimit, resetRateLimits } from "../src/lib/rateLimit";
import { PERSONALIZATION_EVENTS, pageTemplate } from "../src/lib/engagement";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}
const eq = (label: string, a: unknown, b: unknown) => check(label, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const root = join(__dirname, "..");
const src = (f: string) => readFileSync(join(root, f), "utf8");

const NOW = new Date("2026-11-13T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

console.log("markets:");
{
  const types = PREFERENCE_MARKETS.map((m) => m.type);
  check("every preference market is a real MarketType", types.every((t) => (MARKET_TYPES as readonly string[]).includes(t)));
  check("OTHER and SAME_GAME_DOUBLE are not offered", !types.includes("OTHER" as never) && !types.includes("SAME_GAME_DOUBLE" as never));
  for (const t of ["MATCH_WINNER", "DOUBLE_CHANCE", "BTTS", "OVER_UNDER", "TEAM_TOTAL"]) check(`required market ${t} offered`, types.includes(t as never));
  eq("first five in the brief's order", types.slice(0, 5), ["MATCH_WINNER", "DOUBLE_CHANCE", "BTTS", "OVER_UNDER", "TEAM_TOTAL"]);
  check("unknown market rejected", !isPreferenceMarket("ASIAN_CORNERS") && !isPreferenceMarket(""));
}

console.log("timezones:");
{
  check("Africa/Lagos valid", isValidTimeZone("Africa/Lagos"));
  check("Europe/London valid", isValidTimeZone("Europe/London"));
  check("UTC valid", isValidTimeZone("UTC"));
  for (const bad of ["Mars/Olympus", "+01:00", "africa/lagos", "", "Africa/Lagos; DROP TABLE", "x".repeat(80), 42]) check(`rejects ${JSON.stringify(bad).slice(0, 30)}`, !isValidTimeZone(bad));
  eq("invalid stored zone falls back to Lagos", safeTimeZone("Nowhere/Land"), "Africa/Lagos");
  const lagos = zonedDayBounds("Africa/Lagos", new Date("2026-11-13T23:30:00Z")); // 00:30 WAT on the 14th
  eq("Lagos day after local midnight is the 14th", [lagos.start.toISOString(), lagos.end.toISOString()], ["2026-11-13T23:00:00.000Z", "2026-11-14T23:00:00.000Z"]);
  const ny = zonedDayBounds("America/New_York", new Date("2026-03-08T12:00:00Z")); // DST starts 8 Mar 2026
  eq("New York DST day is 23 hours", (ny.end.getTime() - ny.start.getTime()) / 3_600_000, 23);
  eq("New York DST day starts at 05:00Z", ny.start.toISOString(), "2026-03-08T05:00:00.000Z");
  const kolkata = zonedDayBounds("Asia/Kolkata", NOW);
  check("canonicalised alias accepted (Asia/Kolkata)", isValidTimeZone("Asia/Kolkata"));
  eq("half-hour offset zone", kolkata.start.toISOString(), "2026-11-12T18:30:00.000Z");
  eq("kickoff label uses WAT for Lagos", kickoffInZone("2026-11-14T15:00:00Z", "Africa/Lagos"), "Sat 16:00 WAT");
  check("kickoff label in another zone carries its own abbreviation", kickoffInZone("2026-11-14T15:00:00Z", "Europe/London").startsWith("Sat 15:00"));
  eq("invalid date does not throw", kickoffInZone("not a date", "Africa/Lagos"), "Time unavailable");
}

console.log("input validation:");
{
  check("valid update parses", PreferencesUpdate.safeParse({ timezone: "Europe/Paris", preferredMarkets: ["BTTS"], teamIds: [42, "33"], leagueIds: [39] }).success);
  const parsed = PreferencesUpdate.parse({ teamIds: ["33", 33, 42] });
  eq("digit strings become numbers", parsed.teamIds, [33, 33, 42]);
  eq("duplicates collapse, order kept", uniqueIds(parsed.teamIds!), [33, 42]);
  check("unknown market rejected", !PreferencesUpdate.safeParse({ preferredMarkets: ["NOPE"] }).success);
  check("invalid timezone rejected", !PreferencesUpdate.safeParse({ timezone: "Moon/Base" }).success);
  check("team name instead of id rejected", !PreferencesUpdate.safeParse({ teamIds: ["Arsenal"] }).success);
  check("negative id rejected", !PreferencesUpdate.safeParse({ leagueIds: [-1] }).success);
  check("too many teams rejected", !PreferencesUpdate.safeParse({ teamIds: Array.from({ length: 41 }, (_, i) => i + 1) }).success);
  check("client-supplied userId rejected (strict)", !PreferencesUpdate.safeParse({ userId: "someone-else", timezone: "UTC" }).success);
  check("bad onboarding value rejected", !PreferencesUpdate.safeParse({ onboarding: "done" }).success);
  check("save: cuid accepted", SaveRequest.safeParse({ predictionId: "clx1abc2def3ghi4jkl5" }).success);
  check("save: injection-shaped id rejected", !SaveRequest.safeParse({ predictionId: "x' OR 1=1 --" }).success);
  check("save: extra userId rejected", !SaveRequest.safeParse({ predictionId: "clx1abc2def3ghi4jkl5", userId: "u2" }).success);
  eq("diff add/remove", diffIds([1, 2, 3], [2, 3, 4]), { add: [4], remove: [1] });
  eq("diff no-op", diffIds([5], [5]), { add: [], remove: [] });
  eq("saved filter default", parseSavedFilter("drop"), "all");
  eq("saved filter known", parseSavedFilter("won"), "won");
}

console.log("competitions:");
{
  const list = orderedCompetitions();
  eq("Premier League leads", list[0].name, "Premier League");
  check("popular block first, then everything else", list.findIndex((l) => !l.popular) > 5 && list.slice(list.findIndex((l) => !l.popular)).every((l) => !l.popular));
  check("no competition excluded or duplicated", new Set(list.map((l) => l.id)).size === list.length && list.length > 30);
}

console.log("ranking:");
{
  const interests: Interests = { teamIds: new Set([10]), leagueIds: new Set([39]), markets: new Set(["BTTS"]) };
  const rows = [
    { id: "plain", leagueApiId: 1, homeTeamApiId: 1, awayTeamApiId: 2, marketType: "MATCH_WINNER", confidence: 90, kickoff: hours(1), outcome: "PENDING" },
    { id: "market", leagueApiId: 1, homeTeamApiId: 3, awayTeamApiId: 4, marketType: "BTTS", confidence: 60, kickoff: hours(1), outcome: "PENDING" },
    { id: "league", leagueApiId: 39, homeTeamApiId: 5, awayTeamApiId: 6, marketType: "MATCH_WINNER", confidence: 55, kickoff: hours(10), outcome: "PENDING" },
    { id: "team", leagueApiId: 1, homeTeamApiId: 7, awayTeamApiId: 10, marketType: "MATCH_WINNER", confidence: 50, kickoff: hours(20), outcome: "PENDING" },
    { id: "team-settled", leagueApiId: 39, homeTeamApiId: 10, awayTeamApiId: 8, marketType: "BTTS", confidence: 80, kickoff: hours(-5), outcome: "WON" },
  ];
  const ranked = rankPersonalized(rows, interests, NOW);
  // A settled pick keeps its interest tier but drops below every live pick of that tier.
  const order = ranked.map((r) => r.row.id);
  check("followed team first", order[0] === "team");
  check("league before market", order.indexOf("league") < order.indexOf("market"));
  check("market before plain", order.indexOf("market") < order.indexOf("plain"));
  eq("reasons recorded", ranked.find((r) => r.row.id === "team-settled")!.reasons, ["team", "league", "market"]);
  const sooner = rankPersonalized(
    [
      { id: "later", leagueApiId: 39, confidence: 80, kickoff: hours(12), outcome: "PENDING" },
      { id: "sooner", leagueApiId: 39, confidence: 50, kickoff: hours(1), outcome: "PENDING" },
    ],
    interests,
    NOW,
  );
  eq("kickoff relevance breaks ties within a tier", sooner.map((r) => r.row.id), ["sooner", "later"]);
  const none: Interests = { teamIds: new Set(), leagueIds: new Set(), markets: new Set() };
  const fallback = rankPersonalized(
    [
      { id: "a", confidence: 60, kickoff: hours(2), outcome: "PENDING" },
      { id: "b", confidence: 80, kickoff: hours(2), outcome: "PENDING" },
    ],
    none,
    NOW,
  );
  eq("no preferences: existing display ranking (confidence) decides", fallback.map((r) => r.row.id), ["b", "a"]);
  check("no preferences: no reasons invented", fallback.every((r) => r.reasons.length === 0));
}

console.log("upcoming fixtures:");
{
  const teams = new Set([10]);
  const leagues = new Set([39]);
  const list = buildUpcoming(
    [
      { homeTeam: "Ten FC", awayTeam: "B", homeTeamApiId: 10, awayTeamApiId: 2, leagueApiId: 1, kickoff: hours(-2) }, // finished/started
      { homeTeam: "Ten FC", awayTeam: "C", homeTeamApiId: 10, awayTeamApiId: 3, leagueApiId: 1, kickoff: hours(48) },
      { homeTeam: "D", awayTeam: "E", homeTeamApiId: 4, awayTeamApiId: 5, leagueApiId: 39, kickoff: hours(1) },
      { homeTeam: "D", awayTeam: "E", homeTeamApiId: 4, awayTeamApiId: 5, leagueApiId: 39, kickoff: hours(1), predictionHref: "/predictions/match/d-vs-e" }, // same fixture, with prediction
      { homeTeam: "X", awayTeam: "Y", homeTeamApiId: 6, awayTeamApiId: 7, leagueApiId: 2, kickoff: hours(3) }, // not followed
      { homeTeam: "Ten FC", awayTeam: "Z", homeTeamApiId: 10, awayTeamApiId: 9, leagueApiId: 1, kickoff: hours(5) }, // cache says NS...
      { homeTeam: "Ten FC", awayTeam: "Z", homeTeamApiId: 10, awayTeamApiId: 9, leagueApiId: 1, kickoff: hours(5), outcome: "LOST" }, // ...but its prediction settled
    ],
    teams,
    leagues,
    NOW,
  );
  eq("only future, followed, de-duplicated, chronological", list.map((f) => `${f.homeTeam}-${f.awayTeam}`), ["D-E", "Ten FC-C"]);
  check("completed / started fixture never upcoming", !list.some((f) => f.kickoff.getTime() <= NOW.getTime()));
  check("settled prediction removes the fixture even if a cache lists it", !list.some((f) => f.awayTeam === "Z"));
  const de = list.find((f) => f.homeTeam === "D")!;
  check("prediction indicator merged across sources", de.hasPrediction && de.href === "/predictions/match/d-vs-e");
  eq("status within two hours", de.status, "Starting soon");
  eq("no favourites → nothing", buildUpcoming([{ homeTeam: "A", awayTeam: "B", kickoff: hours(3) }], new Set(), new Set(), NOW), []);
  eq("invalid date skipped, not thrown", buildUpcoming([{ homeTeam: "A", awayTeam: "B", homeTeamApiId: 10, kickoff: "garbage" }], teams, leagues, NOW), []);
}

console.log("saved predictions:");
{
  const snap = { category: "TODAY", marketType: "MATCH_WINNER", selection: { value: "HOME" }, market: "Match Winner", pick: "Home Win", odds: 1.8, confidence: 70, kickoff: hours(3) };
  const live = { status: "PUBLISHED", marketType: "MATCH_WINNER", selection: { value: "HOME" }, pick: "Home Win", outcome: "PENDING", finalHomeScore: null, finalAwayScore: null, kickoff: hours(3) };
  eq("upcoming", savedPredictionView(snap, live, true, NOW).state, "upcoming");
  eq("kicked off, not settled → awaiting", savedPredictionView(snap, { ...live, kickoff: hours(-1) }, true, NOW).state, "awaiting");
  const won = savedPredictionView(snap, { ...live, outcome: "WON", finalHomeScore: 2, finalAwayScore: 0, kickoff: hours(-3) }, true, NOW);
  eq("settled with live outcome when the selection is unchanged", [won.state, won.outcome, won.finalScore, won.changedTo], ["settled", "WON", "2–0", null]);
  // Rewritten to AWAY after save, match ends 2-0: the live row LOST, the saved HOME pick WON.
  const rewritten = savedPredictionView(snap, { ...live, selection: { value: "AWAY" }, pick: "Away Win", outcome: "LOST", finalHomeScore: 2, finalAwayScore: 0, kickoff: hours(-3) }, true, NOW);
  eq("rewritten pick: original selection settled from the score, not the live outcome", rewritten.outcome, "WON");
  eq("rewritten pick: change disclosed, never substituted", rewritten.changedTo, "Away Win");
  const rewrittenPending = savedPredictionView(snap, { ...live, selection: { value: "AWAY" }, pick: "Away Win" }, true, NOW);
  eq("rewritten pick before kickoff: still upcoming, change disclosed", [rewrittenPending.state, rewrittenPending.outcome, rewrittenPending.changedTo], ["upcoming", null, "Away Win"]);
  const deleted = savedPredictionView(snap, null, true, NOW);
  eq("deleted prediction → unavailable, no invented result", [deleted.state, deleted.outcome], ["unavailable", null]);
  const locked = savedPredictionView({ ...snap, category: "VIP" }, { ...live, outcome: "WON", finalHomeScore: 1, finalAwayScore: 0, kickoff: hours(-3) }, false, NOW);
  eq("locked: outcome hidden, change hidden", [locked.locked, locked.outcome, locked.changedTo], [true, null, null]);
  const other = savedPredictionView({ ...snap, marketType: "OTHER", selection: null, pick: "Anytime scorer" }, { ...live, marketType: "OTHER", selection: null, pick: "Different", outcome: "LOST", finalHomeScore: 1, finalAwayScore: 1, kickoff: hours(-3) }, true, NOW);
  eq("free-text market changed: left unresolved rather than guessed", other.outcome, null);

  // ---- filters and status come from the SAME view as the row (regression) ----
  const views = {
    rewrittenWon: rewritten, // live LOST, saved HOME won 2-0
    deletedFuture: savedPredictionView({ ...snap, kickoff: hours(48) }, null, true, NOW),
    lockedWon: locked,
    upcoming: savedPredictionView(snap, live, true, NOW),
    awaiting: savedPredictionView(snap, { ...live, kickoff: hours(-1) }, true, NOW),
  };
  const under = (f: Parameters<typeof matchesSavedFilter>[1]) => Object.entries(views).filter(([, v]) => matchesSavedFilter(v, f)).map(([k]) => k);
  eq("Won lists the rewritten pick the reader actually won", under("won"), ["rewrittenWon"]);
  eq("Lost does NOT list it although the live row lost", under("lost"), []);
  eq("Settled: the rewritten pick and the locked one (state only)", under("settled"), ["rewrittenWon", "lockedWon"]);
  eq("Upcoming excludes a deleted prediction even with a future kickoff", under("upcoming"), ["upcoming"]);
  eq("All lists everything, deleted included", under("all").length, 5);
  check("locked win never appears under Won (would leak the result)", !matchesSavedFilter(views.lockedWon, "won"));

  const htft = savedPredictionView(
    { ...snap, marketType: "HT_FT", selection: { ht: "HOME", ft: "HOME" }, pick: "Home/Home" },
    { ...live, marketType: "HT_FT", selection: { ht: "DRAW", ft: "HOME" }, pick: "Draw/Home", outcome: "WON", finalHomeScore: 1, finalAwayScore: 0, kickoff: hours(-3) },
    true,
    NOW,
  );
  eq("rewritten half-time market: settled, not graded, never 'awaiting' forever", [htft.state, htft.outcome, matchesSavedFilter(htft, "won"), matchesSavedFilter(htft, "lost")], ["settled", null, false, false]);
  const voided = savedPredictionView(snap, { ...live, selection: { value: "AWAY" }, pick: "Away Win", outcome: "VOID", kickoff: hours(-3) }, true, NOW);
  eq("rewritten pick on a voided (scoreless) match is void too", [voided.state, voided.outcome], ["settled", "VOID"]);

  const items = [
    { id: "a", kickoff: hours(5), view: views.upcoming },
    { id: "b", kickoff: hours(1), view: views.upcoming },
    { id: "c", kickoff: null, view: views.deletedFuture },
    { id: "d", kickoff: hours(-30), settledAt: hours(-1), view: views.rewrittenWon },
    { id: "e", kickoff: hours(-3), settledAt: hours(-20), view: views.rewrittenWon },
  ];
  eq("upcoming order: soonest first", orderSaved(items.slice(0, 2), "upcoming").map((i) => i.id), ["b", "a"]);
  eq("default order: latest kickoff first, undated last", orderSaved(items, "all").map((i) => i.id), ["a", "b", "e", "d", "c"]);
  eq("recently settled: by settlement time", recentlySettled(items, 4).map((i) => i.id), ["d", "e"]);
  const data0 = src("src/lib/personalizationData.ts");
  check("list/highlights filter in code from the views, not in SQL on the live outcome", !/prediction: \{ outcome/.test(data0) && /matchesSavedFilter\(i\.view, filter\)/.test(data0));

  // The data layer drops restricted fields server-side, not in the component.
  const data = src("src/lib/personalizationData.ts");
  check("toSavedItem nulls market/pick/odds/confidence when locked", /market: canView \? s\.market : null/.test(data) && /pick: canView \? s\.pick : null/.test(data) && /odds: canView/.test(data) && /confidence: canView/.test(data));
  check("save refuses a pick the viewer cannot view (403)", /canViewCategory\(presented[^)]*\)\) throw new SaveError\("Upgrade to save this prediction", 403\)/.test(data));
  check("save only accepts PUBLISHED predictions", /where: \{ id: predictionId, status: "PUBLISHED" \}/.test(data));
  check("unsave is owner-scoped", /deleteMany\(\{\s*where: \{ userId,/.test(data));
  check("dashboard feed only fetches paid tiers when entitled", /if \(canViewCategory\(paid, viewer\.tier/.test(data));
}

console.log("onboarding:");
{
  const fresh = { createdAt: new Date(NOW.getTime() - 60_000), hasPreferenceRow: false, favouriteCount: 0, now: NOW };
  check("new account with nothing set → onboarding", shouldStartOnboarding(fresh));
  check("existing account (older than window) → never forced", !shouldStartOnboarding({ ...fresh, createdAt: new Date(NOW.getTime() - ONBOARDING_WINDOW_MS - 1) }));
  check("already skipped/completed (row exists) → not again", !shouldStartOnboarding({ ...fresh, hasPreferenceRow: true }));
  check("already follows teams → not forced", !shouldStartOnboarding({ ...fresh, favouriteCount: 2 }));
  check("future createdAt (clock skew) → not forced", !shouldStartOnboarding({ ...fresh, createdAt: hours(1) }));
  check("invite: existing user with nothing set", shouldInviteToPersonalize({ hasPreferenceRow: false, favouriteCount: 0, marketCount: 0, skipped: false, completed: false }));
  check("invite: hidden once dismissed", !shouldInviteToPersonalize({ hasPreferenceRow: true, favouriteCount: 0, marketCount: 0, skipped: true, completed: false }));
  check("invite: hidden once personalised", !shouldInviteToPersonalize({ hasPreferenceRow: true, favouriteCount: 3, marketCount: 0, skipped: false, completed: false }));
  const dash = src("src/app/dashboard/page.tsx");
  check("redirect only on bare /dashboard (never a payment callback)", /const bare = !searchParams\.section && !searchParams\.paid/.test(dash) && /bare &&[\s\S]{0,80}shouldStartOnboarding/.test(dash));
  check("welcome page records a pending Google sign-up", /SignupConfirmation/.test(src("src/app/dashboard/welcome/page.tsx")));
}

console.log("account API access:");
{
  const ok = { ok: true } as const;
  eq("no session → 401", decideAccountAccess({ userId: null, write: false, originOk: true, rate: ok }), { ok: false, status: 401, error: "Sign in to continue" });
  eq("expired session (no user) on a write → 401 before anything else", (decideAccountAccess({ userId: undefined, write: true, originOk: false, rate: { ok: false, retryAfterSeconds: 9 } }) as { status: number }).status, 401);
  eq("cross-site write → 403", (decideAccountAccess({ userId: "u1", write: true, originOk: false, rate: ok }) as { status: number }).status, 403);
  eq("rate limited → 429", (decideAccountAccess({ userId: "u1", write: true, originOk: true, rate: { ok: false, retryAfterSeconds: 5 } }) as { status: number }).status, 429);
  eq("read ignores origin", decideAccountAccess({ userId: "u1", write: false, originOk: false, rate: ok }), { ok: true, userId: "u1" });
  eq("authenticated write", decideAccountAccess({ userId: "u1", write: true, originOk: true, rate: ok }), { ok: true, userId: "u1" });
  for (const f of ["src/app/api/preferences/route.ts", "src/app/api/saved-predictions/route.ts", "src/app/api/preferences/teams/route.ts"]) {
    const code = src(f);
    check(`${f}: every handler goes through requireAccount`, (code.match(/export async function (GET|POST|PUT|DELETE)/g) ?? []).length === (code.match(/await requireAccount\(/g) ?? []).length);
    check(`${f}: never reads a user id from the request`, !/body\.userId|parsed\.data\.userId|searchParams\.get\("user/.test(code));
    check(`${f}: force-dynamic (never statically cached)`, /export const dynamic = "force-dynamic"/.test(code));
  }
  check("account responses are private, no-store", /"cache-control": "private, no-store"/.test(src("src/lib/accountApi.ts")));
  check("/api/follows is rate limited and capped", /rateLimit\(`follows:/.test(src("src/app/api/follows/route.ts")) && /MAX_FOLLOWS/.test(src("src/app/api/follows/route.ts")));
}

console.log("rate limiter:");
{
  resetRateLimits();
  const t = 1_000_000;
  const results = Array.from({ length: 4 }, () => rateLimit("k:u1", 3, 60_000, t).ok);
  eq("3 allowed then blocked", results, [true, true, true, false]);
  check("other users unaffected", rateLimit("k:u2", 3, 60_000, t).ok);
  check("window resets", rateLimit("k:u1", 3, 60_000, t + 60_001).ok);
  rateLimit("k:u3", 1, 60_000, t);
  const blocked = rateLimit("k:u3", 1, 60_000, t + 10_000);
  check("retry-after reported", !blocked.ok && blocked.retryAfterSeconds === 50);
}

console.log("analytics:");
{
  for (const [event, params] of Object.entries(PERSONALIZATION_EVENTS)) {
    check(`${event}: no name/email/team parameters`, !(params as readonly string[]).some((p) => /name|email|team_name|league_name|user/i.test(p)));
  }
  eq("dashboard subroutes report as the dashboard template", [pageTemplate("/dashboard/saved"), pageTemplate("/dashboard/welcome")], ["dashboard", "dashboard"]);
  // Every call site passes only literals or counts.
  const files = ["src/components/SavePredictionButton.tsx", "src/components/personal/ClientBits.tsx", "src/components/personal/PreferencesForms.tsx", "src/components/FollowButton.tsx"];
  for (const f of files) {
    const calls = src(f).match(/trackEngagement\([^)]*\)/g) ?? [];
    check(`${f}: ${calls.length} call(s), none pass names`, calls.length > 0 && calls.every((c) => !/\.name|label|email|q\b/.test(c)), calls.join(" | "));
  }
}

console.log("public copy:");
{
  const dirs = ["src/app/dashboard", "src/components/personal"];
  const walk = (d: string): string[] => readdirSync(join(root, d)).flatMap((n) => (statSync(join(root, d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  const files = [...dirs.flatMap((d) => walk(d)), "src/components/SavePredictionButton.tsx", "src/lib/personalization.ts"];
  for (const f of files) {
    const text = src(f);
    // Copy only: JSX text and string literals. "AI" as a word, case-sensitive.
    check(`${f}: no "AI" wording`, !/\bAI\b|AI-powered|AI-assisted|artificial intelligence/i.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
    check(`${f}: no guarantee claims`, !/guaranteed? (win|winner|profit)|sure win|100% (sure|safe)/i.test(text));
  }
  check("onboarding states predictions are not guarantees", /never guarantees/.test(src("src/components/personal/PreferencesForms.tsx")));
  check("saved page keeps responsible-gambling link", /\/responsible-gambling/.test(src("src/app/dashboard/saved/page.tsx")));
  const parts = src("src/components/personal/DashboardParts.tsx").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  check("confidence is labelled as confidence, not probability", /Confidence \{row\.confidence\}%/.test(parts) && !/>[^<{]*(probability|chance of winning)/i.test(parts));
}

console.log("prediction table bookmark:");
{
  const t = src("src/components/PredictionsTable.tsx");
  check("no new column: ad colSpan formula unchanged", /const columnCount = 7 \+ \(showOutcome \? 1 : 0\) \+ \(linkRows \? 1 : 0\);/.test(t));
  check("no new <th>: header still 7 fixed columns + optional two", (t.match(/<th /g) ?? []).length === 9);
  const lines = t.split("\n").filter((l) => /<SavePredictionButton /.test(l));
  check("every table bookmark is withheld on locked rows", lines.length >= 4 && lines.every((l) => /\{!p\.locked (&&|\?) <SavePredictionButton /.test(l)), `${lines.length} usages`);
  check("phone bookmark sits above the row's stretched link", /relative z-10 col-start-3 row-span-3 row-start-1 flex/.test(t));
  check("phone bookmark uses the compact 32px size", /size="sm"/.test(t) && /size === "sm" \? "h-8 w-8"/.test(src("src/components/SavePredictionButton.tsx")));
}

console.log("design rules (CLAUDE.md):");
{
  const files = ["src/components/personal/DashboardParts.tsx", "src/components/personal/ClientBits.tsx", "src/components/personal/PreferencePickers.tsx", "src/components/personal/PreferencesForms.tsx", "src/app/dashboard/saved/page.tsx", "src/app/dashboard/page.tsx"];
  for (const f of files) {
    const text = src(f);
    check(`${f}: no coloured accent stripes`, !/border-[lr]-(2|4|8|\[)|border-[lr]-(brand|emerald|red|amber|yellow|blue|purple|orange)/.test(text));
    check(`${f}: no tinted status pills`, !/bg-(brand|emerald|red|amber|yellow|blue|purple|orange)-?\d*\/\d+[^"]*rounded-full|rounded-full[^"]*bg-(brand|emerald|red|amber|yellow|blue|purple|orange)-?\d*\/\d+/.test(text));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
