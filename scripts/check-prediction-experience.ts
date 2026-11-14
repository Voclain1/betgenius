/**
 * Sprint 03 — prediction experience: pure checks (no database, no network).
 *
 * Covers the status wording rules (including their exact boundaries), the
 * saved-prediction "unplayed" state, terminology and copy rules, Sprint 01 /
 * Sprint 02 compatibility, and — importantly — the ownership boundary with the
 * VIP Reliability workstream: this sprint's presentation code must never import
 * the generation, curation, odds, settlement or publishing modules, and the
 * access contract it relies on (lockedPredictionView) must be unchanged.
 *
 * Run: npx tsx scripts/check-prediction-experience.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IN_PLAY_WINDOW_MS, clockPhase, rowStatus, trustedStatusCode } from "../src/lib/predictionStatus";
import { matchState } from "../src/lib/matchState";
import { matchState as matchStateViaCentre } from "../src/lib/matchCentre";
import { matchesSavedFilter, savedPredictionView } from "../src/lib/personalization";
import { lockedPredictionView } from "../src/lib/lockedPrediction";

// categoryPredictions uses React's server-only cache(); the pure tier shims it.
const react = require("react");
react.cache = (fn: unknown) => fn;

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
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const KICK = new Date("2026-11-14T15:00:00Z");
const at = (ms: number) => new Date(KICK.getTime() + ms);
const MIN = 60_000;

async function main() {
  const { CATEGORY_CHIP_LABELS, CATEGORY_NAMES } = await import("../src/lib/categoryPredictions");
console.log("status wording from the clock alone:");
{
  const s = (nowOffset: number, extra: Record<string, unknown> = {}) => rowStatus({ kickoff: KICK, now: at(nowOffset), ...extra });
  eq("before kickoff: nothing to say", [s(-1).kind, s(-1).label], ["upcoming", null]);
  eq("far before kickoff: nothing to say", s(-72 * 60 * MIN).label, null);
  eq("at kickoff exactly: started", s(0).kind, "started");
  eq("started is worded 'Kicked off', never 'Live'", s(30 * MIN).label, "Kicked off");
  eq("last instant of the in-play window: still started", s(IN_PLAY_WINDOW_MS).kind, "started");
  eq("one millisecond past the window: awaiting a result", s(IN_PLAY_WINDOW_MS + 1).kind, "awaiting");
  eq("awaiting wording", s(5 * 60 * MIN).label, "Awaiting result");
  eq("the window is 150 minutes", IN_PLAY_WINDOW_MS, 150 * MIN);
  check("window equals the live-score poll's own constant (LiveScores.tsx)", new RegExp(`LIVE_WINDOW_MS = 150 \\* 60_000`).test(src("src/components/LiveScores.tsx")));
  eq("missing kickoff: no claim", rowStatus({ kickoff: null, now: KICK }).label, null);
  eq("invalid kickoff string: no claim", rowStatus({ kickoff: "not a date", now: KICK }).label, null);
  eq("clock phases", [clockPhase(KICK, at(-1)), clockPhase(KICK, at(1)), clockPhase(KICK, at(IN_PLAY_WINDOW_MS + 1)), clockPhase(null), clockPhase("x")], ["upcoming", "started", "awaiting", "unknown", "unknown"]);
}

console.log("status from a score or outcome:");
{
  const late = at(6 * 60 * MIN);
  const fin = rowStatus({ kickoff: KICK, now: late, finalScore: { home: 2, away: 1 } });
  eq("a stored score is full time", [fin.kind, fin.label], ["final", "FT"]);
  eq("0-0 is a score, not a missing one", rowStatus({ kickoff: KICK, now: late, finalScore: { home: 0, away: 0 } }).kind, "final");
  eq("a score beats the clock even inside the window", rowStatus({ kickoff: KICK, now: at(10 * MIN), finalScore: { home: 1, away: 0 } }).kind, "final");
  eq("VOID without a score: void", rowStatus({ kickoff: KICK, now: late, outcome: "VOID" }).label, "Void");
  eq("WON/LOST without a score (manual settlement): final, not 'awaiting'", [rowStatus({ kickoff: KICK, now: late, outcome: "WON" }).kind, rowStatus({ kickoff: KICK, now: late, outcome: "LOST" }).kind], ["final", "final"]);
  eq("PENDING outcome changes nothing", rowStatus({ kickoff: KICK, now: late, outcome: "PENDING" }).kind, "awaiting");
}

console.log("status from a provider code (only end states are believed):");
{
  const row = (c: string | null, extra: Record<string, unknown> = {}, nowOffset = 6 * 60 * MIN) => rowStatus({ statusCode: c, kickoff: KICK, now: at(nowOffset), ...extra });
  const table: Array<[string, string, string, boolean]> = [
    ["PST", "postponed", "Postponed", true],
    ["CANC", "cancelled", "Cancelled", true],
    ["ABD", "abandoned", "Abandoned", true],
    ["SUSP", "suspended", "Suspended", true],
    ["INT", "suspended", "Suspended", true],
    ["AWD", "awarded", "Result awarded", false],
    ["WO", "awarded", "Result awarded", false],
  ];
  for (const [c, kind, label, unplayed] of table) {
    const r = row(c);
    eq(`${c} → ${label}`, [r.kind, r.label, r.tone, r.unplayed], [kind, label, "warn", unplayed]);
  }
  for (const c of ["FT", "AET", "PEN"]) eq(`${c} → final`, row(c).kind, "final");
  eq("PST beats a stored score (a postponed match is never 'full time')", row("PST", { finalScore: { home: 1, away: 0 } }).kind, "postponed");
  eq("ABD beats a stored score", row("ABD", { finalScore: { home: 2, away: 2 } }).kind, "abandoned");
  eq("PST on a match whose kickoff is still ahead is postponed, not upcoming", row("PST", {}, -48 * 60 * MIN).kind, "postponed");
  for (const c of ["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "NS", "TBD", "NOPE", ""]) {
    eq(`cached '${c}' is not believed; the clock decides`, [trustedStatusCode(c), row(c).kind], [null, "awaiting"]);
  }
  eq("a cached live code inside the window still reads as the clock says", row("2H", {}, 40 * MIN).label, "Kicked off");
  eq("null / undefined code", [row(null).kind, rowStatus({ kickoff: KICK, now: at(40 * MIN) }).kind], ["awaiting", "started"]);
  // Same meaning as the Sprint 02 match state, for every code the cache can hold.
  const agree = ["PST", "CANC", "ABD", "AWD", "WO", "SUSP", "INT"].every((c) => {
    const state = matchState({ statusShort: c, kickoff: KICK, now: at(6 * 60 * MIN) });
    const kind = row(c).kind;
    return (state === "awarded" ? "awarded" : state) === kind;
  });
  check("status kinds agree with matchState for every end-state code", agree);
  check("matchState is one implementation (re-exported by matchCentre)", matchState === matchStateViaCentre);
}

console.log("saved predictions: unplayed matches:");
{
  const snap = { category: "TODAY", marketType: "BTTS", selection: { value: "YES" }, market: "Both Teams to Score", pick: "Yes", odds: null, confidence: 62, kickoff: at(24 * 60 * MIN) };
  const live = (extra: Record<string, unknown> = {}) => ({ status: "PUBLISHED", marketType: "BTTS", selection: { value: "YES" }, pick: "Yes", outcome: "PENDING", finalHomeScore: null, finalAwayScore: null, kickoff: at(24 * 60 * MIN), ...extra });
  const NOW = KICK;
  const plain = savedPredictionView(snap, live(), true, NOW);
  eq("no status: a future kickoff is upcoming, as before", plain.state, "upcoming");
  const pstFuture = savedPredictionView(snap, live(), true, NOW, "PST");
  eq("postponed before kickoff: unplayed, not upcoming", pstFuture.state, "unplayed");
  const pstPast = savedPredictionView(snap, live({ kickoff: at(-6 * 60 * MIN) }), true, NOW, "PST");
  eq("postponed after the original kickoff: unplayed, not 'awaiting'", pstPast.state, "unplayed");
  const cancelled = savedPredictionView(snap, live(), true, NOW, "CANC");
  eq("cancelled: unplayed", cancelled.state, "unplayed");
  const voided = savedPredictionView(snap, live({ outcome: "VOID" }), true, NOW, "PST");
  eq("an admin void on a postponed match settles it as VOID (settled wins over unplayed)", [voided.state, voided.outcome], ["settled", "VOID"]);
  eq("awarded is not 'unplayed' (a result exists)", savedPredictionView(snap, live({ kickoff: at(-6 * 60 * MIN) }), true, NOW, "AWD").state, "awaiting");
  eq("live code ignored: unchanged state", savedPredictionView(snap, live(), true, NOW, "2H").state, "upcoming");
  const lockedPst = savedPredictionView({ ...snap, category: "VIP" }, live(), false, NOW, "PST");
  eq("locked + postponed: the fact is shown, nothing of the pick", [lockedPst.state, lockedPst.locked, lockedPst.outcome, lockedPst.changedTo], ["unplayed", true, null, null]);
  const views = { plain, pstFuture, pstPast };
  const under = (f: Parameters<typeof matchesSavedFilter>[1]) => Object.entries(views).filter(([, v]) => matchesSavedFilter(v, f)).map(([k]) => k);
  eq("Upcoming lists only the genuinely upcoming one", under("upcoming"), ["plain"]);
  eq("unplayed picks are under All only", [under("settled"), under("won"), under("lost")], [[], [], []]);
  eq("All lists everything", under("all").length, 3);
}

console.log("access contract relied on (reliability-owned, must be unchanged):");
{
  const locked = lockedPredictionView({ id: "p1", category: "VIP", pick: "Arsenal", selection: { value: "HOME" }, market: "Match Winner", confidence: 80, odds: 1.9, reasoning: "secret", analysisJson: { keyFactors: ["x"] }, marketConfirmation: { a: 1 }, kickoff: KICK, homeTeam: "A", awayTeam: "B", outcome: "WON" });
  eq("a locked row keeps the fixture", [locked.id, locked.homeTeam, locked.awayTeam], ["p1", "A", "B"]);
  check("a locked row loses selection, market, analysis, confirmation", !("selection" in locked) && !("market" in locked) && !("analysisJson" in locked) && !("marketConfirmation" in locked));
  eq("a locked row's pick/confidence/odds are blanked", [locked.pick, locked.confidence, locked.odds, locked.locked], ["LOCKED", null, null, true]);
}

console.log("ownership boundary (VIP Reliability):");
{
  // Value imports from these modules are forbidden in this sprint's presentation code.
  const OWNED = /from "@\/lib\/(generation|geniusCuration|vipPremium|paid[A-Za-z]*|reliability[A-Za-z]*|settle[A-Za-z]*|settlement[A-Za-z]*|odds[A-Za-z]*|matchOdds|operations[A-Za-z]*|predictionOperations|jobRuns|jobOutcome|marketConfirmed|marketQuality|predictions|enrichment|football\/api-football)(\/[^"]*)?"/;
  const files = [
    "src/lib/predictionStatus.ts",
    "src/lib/matchState.ts",
    "src/components/LiveScores.tsx",
    "src/components/PredictionsTable.tsx",
    "src/components/MatchScoreClock.tsx",
    "src/components/personal/DashboardParts.tsx",
    "src/components/FollowButton.tsx",
    "src/components/MarketChips.tsx",
    "src/components/PredictionViewSwitch.tsx",
    "src/components/BackButton.tsx",
    "src/components/Nav.tsx",
  ];
  for (const f of files) {
    const bad = src(f).split("\n").filter((l) => OWNED.test(l) && !/^\s*import type\b/.test(l));
    check(`${f}: no value import from a reliability-owned module`, bad.length === 0, bad.join(" | "));
  }
  const pure = ["src/lib/predictionStatus.ts", "src/lib/matchState.ts"];
  for (const f of pure) {
    const imports = [...src(f).matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    check(`${f}: imports only the status utilities`, imports.every((i) => i === "@/lib/matchStatus" || i === "@/lib/matchState"), imports.join(", "));
    check(`${f}: no database, network or React`, !/prisma|fetch\(|from "react"/.test(code(f)));
  }
  // Files this sprint deliberately does not edit.
  const personalData = code("src/lib/personalizationData.ts");
  check("status lookup is one batched, read-only query on the captured record", /FROM "FixtureDetailCache" WHERE "matchKey" = ANY/.test(personalData) && !/INSERT|UPDATE|DELETE/i.test(personalData.slice(personalData.indexOf("loadStatusCodes"), personalData.indexOf("loadStatusCodes") + 900)));
  check("a record counts only for the same provider fixture id", /"detailJson"#>>'\{result,fixtureApiId\}' = "fixtureApiId"::text/.test(personalData));
  check("dashboard looks up status only for rows the viewer can already see", /const codes = await loadStatusCodes\(viewable\)/.test(personalData));
}

console.log("Sprint 01 / Sprint 02 compatibility:");
{
  const btn = src("src/components/SavePredictionButton.tsx");
  for (const prop of ["predictionId", "source", "initiallySaved", "withLabel", "onChange", "className", "size"]) check(`SavePredictionButton still accepts ${prop}`, new RegExp(`\\b${prop}\\b`).test(btn));
  check("save semantics untouched (snapshot save endpoint)", /\/api\/saved-predictions/.test(btn) && /prediction_save/.test(btn));
  const follow = src("src/components/FollowButton.tsx");
  check("FollowButton keeps its aria-pressed toggle and stable accessible name", /aria-pressed=\{following\}/.test(follow) && /"aria-label": `Follow \$\{subject\}`/.test(follow));
  check("FollowButton: only short=\"\" chips with a subject change", /const nameChip = short === "" && !!subject/.test(follow));
  const centre = src("src/lib/matchCentre.ts");
  check("Match Centre still exports matchState (one implementation)", /export \{ matchState, MATCH_STATE_LABEL, type MatchState \} from "@\/lib\/matchState"/.test(centre));
  const table = src("src/components/PredictionsTable.tsx");
  check("table column count and ad colSpan formula unchanged", /const columnCount = 7 \+ \(showOutcome \? 1 : 0\) \+ \(linkRows \? 1 : 0\);/.test(table) && (table.match(/<th /g) ?? []).length === 9);
}

console.log("terminology and copy:");
{
  const all = ["src", "docs"].length; void all;
  // Banker of the Day is not Bet of the Day; the label maps keep them apart.
  check("Banker and Bet of the Day have different labels everywhere", CATEGORY_NAMES.BANKER !== CATEGORY_NAMES.BET_OF_THE_DAY && CATEGORY_CHIP_LABELS.BANKER !== CATEGORY_CHIP_LABELS.BET_OF_THE_DAY);
  eq("Bet of the Day keeps its established name", [CATEGORY_NAMES.BET_OF_THE_DAY, CATEGORY_CHIP_LABELS.BET_OF_THE_DAY], ["Bet of the Day", "Bet of the Day"]);
  const touched = ["src/lib/predictionStatus.ts", "src/lib/matchState.ts", "src/components/personal/DashboardParts.tsx", "src/components/FollowButton.tsx", "src/components/PredictionsTable.tsx", "src/components/LiveScores.tsx", "src/components/MatchScoreClock.tsx", "src/components/Nav.tsx"];
  for (const f of touched) {
    const t = src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    check(`${f}: no "Banker of the Day"`, !/Banker of the Day/i.test(t));
    check(`${f}: no "AI" wording`, !/\bAI\b|AI-powered|AI-assisted|artificial intelligence/i.test(t));
    check(`${f}: no guarantee language`, !/guarantee|sure win|certain to win/i.test(t));
  }
  // No surface may call a clock-derived state "live".
  const labels = ["Kicked off", "Awaiting result", "Postponed", "Cancelled", "Abandoned", "Suspended", "Result awarded", "Void", "FT"];
  const produced = new Set<string>();
  for (const offset of [-1, 10 * MIN, 6 * 60 * MIN]) for (const c of [null, "PST", "CANC", "ABD", "SUSP", "AWD", "FT"]) { const l = rowStatus({ statusCode: c, kickoff: KICK, now: at(offset) }).label; if (l) produced.add(l); }
  check("every status word is from the approved list; none says 'Live'", [...produced].every((l) => labels.includes(l)) && ![...produced].some((l) => /live/i.test(l)));
  check("odds are labelled 'Odds', never confused with confidence", /<OddsFigure value=\{row\.odds\} lead="Odds "/.test(src("src/components/personal/DashboardParts.tsx")) && !/@ \{(row|item)\.odds/.test(src("src/components/personal/DashboardParts.tsx")));
  check("saved predictions reachable from the account menu and the drawer", (src("src/components/Nav.tsx").match(/href="\/dashboard\/saved"/g) ?? []).length === 2);
}


  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
