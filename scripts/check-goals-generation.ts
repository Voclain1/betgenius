/**
 * Asserts the dedicated Goals generation pass (src/lib/goalsGeneration.ts).
 *
 * What it must never do, and what this pins:
 *   - persist anything but a standalone Over 1.5 / Over 2.5 total-goals pick,
 *     whatever the model returns (Under, 3.5+, team totals, BTTS, result
 *     markets, doubles, malformed selections);
 *   - quietly keep generating Over 2.5 only — Over 1.5 must be a real choice;
 *   - claim a fixture ordinary generation has not covered yet, which would
 *     remove it from the ordinary pool (the ledger treats any prediction as
 *     "done") — and so it must not depend on running first;
 *   - write the generation ledger;
 *   - duplicate a public total-goals single, or count a hidden combo leg as one;
 *   - exceed its per-kickoff-day quota or its daily spend ceiling;
 *   - disturb GOALS tagging, curation or the homepage Genius rule.
 *
 * Pure: no database, no network. Run: npx tsx scripts/check-goals-generation.ts
 */
export {};
import { readFileSync } from "node:fs";

import {
  GOALS_INTENT,
  GOALS_GENERATED_PROVENANCE,
  GOALS_PER_KICKOFF_DAY,
  GOALS_DAILY_SPEND_CEILING,
  GOALS_MIN_CONFIDENCE,
  GOALS_RUN_LIMIT,
  GOALS_PERSISTED_CATEGORIES,
  pickGoalsDraft,
  planGoalsTargets,
  readGoalsAttempt,
  inGoalsWindow,
  type GoalsLedgerRow,
  type GoalsExistingRow,
  type GoalsAttempt,
  type GoalsPublishRow,
} from "../src/lib/goalsGeneration";
import { GOALS, withGoalsCategory, isGoalsPrediction } from "../src/lib/goalsCategory";
import { goalsMarketBlock, GOALS_MARKET_INSTRUCTION } from "../src/lib/ai/analysis";
import { isHomepageGeniusEligible } from "../src/lib/homepageFeatured";
import { DEDICATED_PAID_PROVENANCES, VIP_ROUTE_PROVENANCE, GENIUS_CONFIDENCE_FLOOR } from "../src/lib/geniusCuration";
import { lagosDateKey } from "../src/lib/lagosDate";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || detail === "" ? "" : `  (${JSON.stringify(detail)})`}`);
}
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ou = (line: number, direction: string) => ({ line, direction });
const draft = (marketType: string, selection: unknown, confidence = 75, reasoning = "r") => ({ marketType, selection, confidence, reasoning });

// ── 1. Only Over 1.5 / Over 2.5 can be persisted ──────────────────────────
console.log("\n1. Draft enforcement (pickGoalsDraft)");
check("Over 1.5 is kept", pickGoalsDraft([draft("OVER_UNDER", ou(1.5, "OVER"))]).pick?.selection !== undefined);
check("Over 2.5 is kept", (pickGoalsDraft([draft("OVER_UNDER", ou(2.5, "OVER"))]).pick?.selection as any)?.line === 2.5);
const leaks: Array<[string, ReturnType<typeof draft>]> = [
  ["Under 1.5", draft("OVER_UNDER", ou(1.5, "UNDER"), 85)],
  ["Under 2.5", draft("OVER_UNDER", ou(2.5, "UNDER"), 85)],
  ["Over 3.5", draft("OVER_UNDER", ou(3.5, "OVER"), 85)],
  ["Over 4.5", draft("OVER_UNDER", ou(4.5, "OVER"), 85)],
  ["Over 0.5", draft("OVER_UNDER", ou(0.5, "OVER"), 85)],
  ["Team Total Over 1.5", draft("TEAM_TOTAL", { side: "HOME", line: 1.5, direction: "OVER" }, 85)],
  ["BTTS Yes", draft("BTTS", { value: "YES" }, 85)],
  ["Match Winner", draft("MATCH_WINNER", { value: "HOME" }, 85)],
  ["Double Chance", draft("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, 85)],
  ["Same-game double", draft("SAME_GAME_DOUBLE", { legIds: ["a", "b"] }, 85)],
  ["malformed O/U (line as text)", draft("OVER_UNDER", { line: "2.5", direction: "OVER" }, 85)],
  ["malformed O/U (no direction)", draft("OVER_UNDER", { line: 2.5 }, 85)],
  ["OTHER dressed as Over 2.5", draft("OTHER", ou(2.5, "OVER"), 85)],
];
for (const [why, d] of leaks) {
  const r = pickGoalsDraft([d]);
  check(`cannot leak: ${why}`, r.pick === null && r.rejected[0]?.reason === "NOT_A_GOALS_MARKET");
}
const allLeaks = pickGoalsDraft(leaks.map(([, d]) => d));
check("a response made only of non-Goals markets persists nothing", allLeaks.pick === null && allLeaks.rejected.length === leaks.length);
check(`the floor is ${GOALS_MIN_CONFIDENCE} (the Genius floor)`, GOALS_MIN_CONFIDENCE === 70 && GOALS_MIN_CONFIDENCE === GENIUS_CONFIDENCE_FLOOR);
check("a qualifying market below the floor is discarded", pickGoalsDraft([draft("OVER_UNDER", ou(1.5, "OVER"), 69)]).rejected[0]?.reason === "BELOW_CONFIDENCE_FLOOR");
check("the floor compares the persisted (rounded) confidence", pickGoalsDraft([draft("OVER_UNDER", ou(1.5, "OVER"), 69.6)]).pick !== null);
const two = pickGoalsDraft([draft("OVER_UNDER", ou(2.5, "OVER"), 72), draft("OVER_UNDER", ou(1.5, "OVER"), 81)]);
check("at most one pick per fixture: the higher-confidence line wins", (two.pick?.selection as any)?.line === 1.5 && two.rejected.some((r) => r.reason === "EXTRA_PICK"));
const mixed = pickGoalsDraft([draft("BTTS", { value: "YES" }, 90), draft("OVER_UNDER", ou(2.5, "UNDER"), 88), draft("OVER_UNDER", ou(1.5, "OVER"), 74)]);
check("a qualifying pick survives beside leaked markets, which are all rejected", (mixed.pick?.selection as any)?.line === 1.5 && mixed.rejected.length === 2);
check("an empty response is a valid 'no pick'", pickGoalsDraft([]).pick === null);
check("Over 1.5 can actually be produced end to end: kept, and tagged GOALS", (() => {
  const p = pickGoalsDraft([draft("OVER_UNDER", ou(1.5, "OVER"), 76)]).pick;
  return !!p && same(withGoalsCategory([...GOALS_PERSISTED_CATEGORIES], p), [GOALS]);
})());

// ── 2. Prompt makes Over 1.5 first-class; ordinary prompt unchanged ─────────
console.log("\n2. Prompt");
const block = goalsMarketBlock();
check("constraint offers Over 1.5 as an exact selection", block.includes('{"marketType": "OVER_UNDER", "selection": {"line": 1.5, "direction": "OVER"}}'));
check("constraint offers Over 2.5 as an exact selection", block.includes('{"marketType": "OVER_UNDER", "selection": {"line": 2.5, "direction": "OVER"}}'));
check("neither line is presented as the default or preferred", /Neither line is the default and neither is preferred\./.test(block));

// Line selection: the strongest justified line, never the safer one by default.
// Five of five live probes returned Over 1.5 under the first wording.
{
  const options = block.split("\n").filter((l) => l.includes('"OVER_UNDER"'));
  const shape = (l: string) => l.replace(/\d\.5/, "N").replace(/two|three/, "K").trim();
  check("both lines are offered in one identical, parallel form", options.length === 2 && shape(options[0]) === shape(options[1]), options);
  check("the two options describe the goal count only (no hint of which is safer)", /two or more goals in the match$/.test(options[0].trim()) && /three or more goals in the match$/.test(options[1].trim()));
  check("the model is told to choose the strongest justified line, not the likeliest to win", /Choose the STRONGEST line\s+the evidence justifies, not the line most likely to win\./.test(block));
  check("being likelier to win is named as never, on its own, a reason for Over 1.5", /is never, on its own, a reason to choose it/.test(block));
  check("it must judge three-or-more and two-or-more separately, then compare", /1\. Judge the case for THREE OR MORE goals on its own evidence/.test(block) && /2\. Judge the case for TWO OR MORE goals the same way/.test(block) && /3\. Compare the two\./.test(block));
  check("Over 2.5 when the evidence materially supports 3+", /Choose Over 2\.5 when the evidence materially supports three\s+or more goals\./.test(block));
  check("Over 1.5 only when 2+ is strong but a third is not sufficiently supported", /Choose Over 1\.5 when the evidence strongly supports two or\s+more goals but does not sufficiently support a third\./.test(block));
  check("explicitly: do not choose Over 1.5 merely because it is safer", /do not choose Over 1\.5 merely because it\s+is safer/.test(block));
  check("the shared 'conservative / cautious' guidance is scoped away from this choice", /preferring a conservative or more cautious position applies\s+to choosing between different markets/.test(block) && /the\s+lower line is not a cautious fallback/.test(block));
  check("no pick is still allowed when neither line is supported", /If neither line is supported with real confidence, return "predictions": \[\]/.test(block));
  check("no quota, proportion or split is imposed on either line", !/quota|proportion|split|per ?cent|%|half of|alternate|at least one of each|mix/i.test(block));
  check("Over 2.5 is not made mandatory", !/(must|always) (choose|return|pick) Over 2\.5/i.test(block));
  check("the block avoids phrases the house-voice scan rejects if echoed", !/confidence (band|threshold)|hedg(e|ing) (guidelines?|rules?|policy)|per (the )?(guidelines?|instructions?)|calibrat/i.test(block));
}
check("constraint forbids Under, team goals, BTTS, result and double-chance markets", /Do not return UNDER/.test(block) && /single team's goals/.test(block) && /both-teams-to-score/.test(block) && /double-chance/.test(block));
check("constraint allows no pick rather than a fallback market", /"predictions": \[\]/.test(block) && /do not fall back/.test(block));
check("constraint never names a feed, tier or category (house voice)", !/feed|tier|category|genius|premium|vip|banker/i.test(block));
check("closing instruction allows only 1.5 / 2.5 OVER, or nothing", /\{"line": 1\.5, "direction": "OVER"\}/.test(GOALS_MARKET_INSTRUCTION) && /\{"line": 2\.5, "direction": "OVER"\}/.test(GOALS_MARKET_INSTRUCTION) && /AT MOST ONE/.test(GOALS_MARKET_INSTRUCTION));
// Raw source: the prompt strings contain "/*"-like text the comment stripper would eat.
const analysis = read("src/lib/ai/analysis.ts");
check("the constraint is added only for goalsOnly (and never beside a handicap line)", /const goalsBlock = input\.goalsOnly && !hc \? goalsMarketBlock\(\) : "";/.test(analysis));
check("ordinary generation keeps its instruction and its prompt layout", /: `Return JSON only\. marketType must be one of: \$\{AUTO_MARKET_TYPES\.join\(", "\)\}\.`;/.test(analysis) && /\$\{handicapBlock\}\$\{goalsBlock\}\r?\n\$\{marketInstruction\}`;/.test(analysis));
check("the shared base prompt is untouched (still its original O/U example)", /"OVER_UNDER"     -> selection: \{ "line": number, "direction": "OVER" \| "UNDER" \}   \/\/ e\.g\. line 2\.5/.test(read("src/lib/ai/analysis.ts")));

// ── 3. Persistence ─────────────────────────────────────────────────────────
console.log("\n3. Persistence (generate.ts)");
const generate = code("src/lib/ai/generate.ts");
check("Goals intent turns the constraint on", /const goalsOnly = input\.intent === GOALS_INTENT;/.test(generate) && /\.\.\.\(goalsOnly \? \{ goalsOnly: true \} : \{\}\)/.test(generate));
check("single market breadth — a Goals job can never assemble a double", /const marketBreadth = goalsOnly \? "single"/.test(generate) && /marketBreadth === "multi"/.test(generate));
check("only pickGoalsDraft's survivor is persisted", /const drafts = goalsSelection \? \(goalsSelection\.pick \? \[goalsSelection\.pick\] : \[\]\) : output\.predictions;/.test(generate) && /drafts\.map\(async \(p\) =>/.test(generate));
check("persisted under GOALS only — never FEATURED", /const persistedCategories = goalsOnly \? \[\.\.\.GOALS_PERSISTED_CATEGORIES\]/.test(generate) && same([...GOALS_PERSISTED_CATEGORIES], [GOALS]));
check("GOALS still comes from the shared deterministic helper", /setPredictionCategories\(pred\.id, persistedCategories, \{ marketType, selection \}\)/.test(generate));
check("stamped GOALS_GENERATED", /goalsOnly\s*\?\s*GOALS_GENERATED_PROVENANCE/.test(generate));
check("GOALS_GENERATED is not a paid-tier provenance (VIP/PREMIUM curation cannot newly select it)", !(DEDICATED_PAID_PROVENANCES as readonly string[]).includes(GOALS_GENERATED_PROVENANCE) && (VIP_ROUTE_PROVENANCE as string) !== GOALS_GENERATED_PROVENANCE);
check("persisted as an ordinary standalone PENDING_REVIEW row (no status special-case)", !/goalsOnly[^\n]*PUBLISHED/.test(generate) && /status: "PENDING_REVIEW"/.test(generate));
const rewrite = code("src/lib/ai/rewrite.ts");
check("a rewrite of a Goals row stays Goals-only", /const goalsOnly = prediction\.provenance === GOALS_GENERATED_PROVENANCE;/.test(rewrite) && /pickGoalsDraft\(/.test(rewrite));

// ── 4. Targeting ───────────────────────────────────────────────────────────
console.log("\n4. Targeting (planGoalsTargets)");
const NOW = new Date("2026-09-26T08:00:00Z"); // 09:00 Lagos
const H = 3_600_000;
let fid = 1000;
function fixture(opts: { status?: string; hoursOut?: number; leagueApiId?: number | null; rows?: Partial<GoalsExistingRow>[] } = {}) {
  const id = ++fid;
  const kickoff = new Date(NOW.getTime() + (opts.hoursOut ?? 30) * H);
  const home = id * 10, away = id * 10 + 1;
  const ledger: GoalsLedgerRow = {
    matchKey: `${home}-${away}-${kickoff.toISOString().slice(0, 10)}`, fixtureApiId: id,
    leagueApiId: opts.leagueApiId === undefined ? 39 : opts.leagueApiId, leagueName: "Premier League",
    homeTeam: `Home ${id}`, awayTeam: `Away ${id}`, kickoff, round: null, status: opts.status ?? "SUCCEEDED",
  };
  const rows: GoalsExistingRow[] = (opts.rows ?? [{}]).map((r) => ({
    fixtureApiId: id, homeTeamApiId: home, awayTeamApiId: away, kickoff, status: "PUBLISHED",
    marketType: "MATCH_WINNER", contextComplete: true, provenance: "STANDARD_CURATED", categories: ["FEATURED"], ...r,
  }));
  return { id, ledger, rows };
}
const plan = (fixtures: ReturnType<typeof fixture>[], extra: { attempts?: GoalsAttempt[]; backingOff?: Set<number>; limit?: number; now?: Date } = {}) =>
  planGoalsTargets({
    ledger: fixtures.map((f) => f.ledger),
    rows: fixtures.flatMap((f) => f.rows),
    attempts: extra.attempts ?? [],
    backingOff: extra.backingOff,
    now: extra.now ?? NOW,
    limit: extra.limit ?? 50,
  });
const targets = (p: ReturnType<typeof plan>) => p.targets.map((t) => t.fixtureApiId);

const covered = fixture();
check("a fixture ordinary generation covered is a target", same(targets(plan([covered])).map(String), [String(covered.id)]));
const pending = fixture({ status: "PENDING", rows: [] });
check("a PENDING fixture is never taken (it belongs to ordinary generation)", plan([pending]).targets.length === 0 && plan([pending]).skipped.NOT_YET_GENERATED === 1);
const pendingWithRows = fixture({ status: "PENDING" });
check("...even if it somehow already has rows", plan([pendingWithRows]).targets.length === 0);
const failed = fixture({ status: "FAILED", rows: [] });
check("a FAILED (retrying) ordinary fixture is never taken", plan([failed]).targets.length === 0);
const onlyGoals = fixture({ rows: [{ provenance: GOALS_GENERATED_PROVENANCE, marketType: "OVER_UNDER", categories: [GOALS] }] });
check("a fixture whose only row is a Goals pick is not re-targeted", plan([onlyGoals]).targets.length === 0);

console.log("\n   deduplication");
const withOver25 = fixture({ rows: [{}, { marketType: "OVER_UNDER", categories: ["FEATURED"] }] });
check("an existing public O/U single blocks a second one", plan([withOver25]).skipped.HAS_STANDALONE_TOTAL_GOALS === 1);
const withPendingReviewOU = fixture({ rows: [{}, { marketType: "OVER_UNDER", status: "PENDING_REVIEW", categories: ["FEATURED"] }] });
check("...including one still awaiting review", plan([withPendingReviewOU]).targets.length === 0);
const withUnder = fixture({ rows: [{}, { marketType: "OVER_UNDER", categories: ["GENIUS"] }] });
check("an Under single also blocks (no contradicting pair on one fixture)", plan([withUnder]).targets.length === 0);
const withHiddenLeg = fixture({ rows: [{ marketType: "SAME_GAME_DOUBLE", categories: ["SAME_GAME_DOUBLE"] }, { marketType: "OVER_UNDER", categories: ["SAME_GAME_DOUBLE"] }] });
check("a hidden combo leg is NOT public Goals supply: the fixture stays eligible", same(targets(plan([withHiddenLeg])).map(String), [String(withHiddenLeg.id)]));
check("...and the leg itself stays hidden (never tagged GOALS)", same(withGoalsCategory(["SAME_GAME_DOUBLE"], { marketType: "OVER_UNDER", selection: ou(2.5, "OVER") }), ["SAME_GAME_DOUBLE"]));
const archivedOU = fixture({ rows: [{}, { marketType: "OVER_UNDER", status: "ARCHIVED" }] });
check("an ARCHIVED O/U single does not block", plan([archivedOU]).targets.length === 1);
const attemptedOnce = fixture();
check("a fixture already attempted (AIJob exists, pick or not) is not retried", plan([attemptedOnce], { attempts: [{ fixtureApiId: attemptedOnce.id, kickoff: attemptedOnce.ledger.kickoff, createdAt: NOW }] }).skipped.ALREADY_ATTEMPTED === 1);
const backing = fixture();
check("a fixture in its failure backoff is skipped", plan([backing], { backingOff: new Set([backing.id]) }).skipped.BACKING_OFF === 1);

console.log("\n   quality and window");
check("no match context -> skipped", plan([fixture({ rows: [{ contextComplete: false }] })]).skipped.NO_MATCH_CONTEXT === 1);
check("no catalogued competition -> skipped", plan([fixture({ leagueApiId: null })]).skipped.NO_COMPETITION === 1);
check("kickoff under 2h away -> outside window", plan([fixture({ hoursOut: 1 })]).skipped.OUTSIDE_WINDOW === 1);
check("kickoff beyond 48h -> outside window", plan([fixture({ hoursOut: 60 })]).skipped.OUTSIDE_WINDOW === 1);
check("same-day 6h out is inside (as for ordinary generation)", inGoalsWindow(new Date(NOW.getTime() + 6 * H), NOW));
check("next-day 6h out is not (12h floor off the current day)", !inGoalsWindow(new Date("2026-09-26T23:30:00Z"), new Date("2026-09-26T19:00:00Z")));

console.log("\n   quota and cap");
check(`quota is ${GOALS_PER_KICKOFF_DAY} per kickoff day, ${GOALS_DAILY_SPEND_CEILING} AI calls per day, ${GOALS_RUN_LIMIT} per run`, GOALS_PER_KICKOFF_DAY === 8 && GOALS_DAILY_SPEND_CEILING === 12 && GOALS_RUN_LIMIT === 1);
const many = Array.from({ length: 20 }, () => fixture({ hoursOut: 30 }));
const day = lagosDateKey(many[0].ledger.kickoff);
const eightDone: GoalsAttempt[] = Array.from({ length: 8 }, (_, i) => ({ fixtureApiId: 1 + i, kickoff: many[0].ledger.kickoff, createdAt: new Date(NOW.getTime() - 3 * H) }));
check("a kickoff day with 8 attempts takes no more", plan(many, { attempts: eightDone }).targets.length === 0 && (plan(many, { attempts: eightDone }).skipped.KICKOFF_DAY_FULL ?? 0) > 0);
const otherDay = fixture({ hoursOut: 8 });
check("...while another kickoff day still can", same(targets(plan([...many, otherDay], { attempts: eightDone })).map(String), [String(otherDay.id)]));
const twelveToday: GoalsAttempt[] = Array.from({ length: 12 }, (_, i) => ({ fixtureApiId: 5000 + i, kickoff: null, createdAt: new Date(NOW.getTime() - H) }));
const ceiling = plan(many, { attempts: twelveToday });
check("the daily spend ceiling stands the pass down", ceiling.targets.length === 0 && /spend ceiling/.test(ceiling.stoodDown ?? ""));
check("a single plan never exceeds the kickoff-day quota", plan(many).targets.length === GOALS_PER_KICKOFF_DAY && new Set(plan(many).targets.map((t) => lagosDateKey(t.kickoff))).size === 1 && lagosDateKey(plan(many).targets[0].kickoff) === day);
check("the run limit is honoured", plan(many, { limit: GOALS_RUN_LIMIT }).targets.length === 1);

// A whole day of 15-minute ticks, one target per run, attempts accumulating.
{
  const pool = [...Array.from({ length: 25 }, () => fixture({ hoursOut: 20 })), ...Array.from({ length: 25 }, () => fixture({ hoursOut: 40 }))];
  const pendingPool = Array.from({ length: 30 }, () => fixture({ status: "PENDING", rows: [], hoursOut: 30 }));
  const attempts: GoalsAttempt[] = [];
  const taken: number[] = [];
  for (let tick = 0; tick < 96; tick++) {
    const now = new Date(NOW.getTime() - 8 * H + tick * 15 * 60_000);
    const p = plan([...pool, ...pendingPool], { attempts, limit: GOALS_RUN_LIMIT, now });
    for (const t of p.targets) {
      taken.push(t.fixtureApiId);
      attempts.push({ fixtureApiId: t.fixtureApiId, kickoff: t.kickoff, createdAt: now });
    }
  }
  const perKick: Record<string, number> = {};
  for (const a of attempts) perKick[lagosDateKey(a.kickoff!)] = (perKick[lagosDateKey(a.kickoff!)] ?? 0) + 1;
  const perSpend: Record<string, number> = {};
  for (const a of attempts) perSpend[lagosDateKey(a.createdAt)] = (perSpend[lagosDateKey(a.createdAt)] ?? 0) + 1;
  check("a full day of ticks: never more than 8 per kickoff day", Object.values(perKick).every((n) => n <= GOALS_PER_KICKOFF_DAY), perKick);
  check("a full day of ticks: never more than 12 AI calls per Lagos day", Object.values(perSpend).every((n) => n <= GOALS_DAILY_SPEND_CEILING), perSpend);
  check("a full day of ticks: each fixture attempted at most once", new Set(taken).size === taken.length);
  check("a full day of ticks: no PENDING (ordinary) fixture ever taken", !taken.some((id) => pendingPool.some((f) => f.id === id)));
  check("a full day of ticks: 25 covered fixtures per kickoff day still leave most for nobody but ordinary generation's rows", taken.length <= 2 * GOALS_PER_KICKOFF_DAY);
}

console.log("\n   ordering");
const today = fixture({ hoursOut: 6, leagueApiId: 999999 });
const tomorrowTop = fixture({ hoursOut: 30, leagueApiId: 39 });
check("today's fixtures come first, as in the ordinary selector", plan([tomorrowTop, today]).targets[0].fixtureApiId === today.id);

// ── 5. Attempt records ─────────────────────────────────────────────────────
console.log("\n5. Attempt records");
const prompt = JSON.stringify({ home: "A", away: "B", kickoff: "2026-09-27T15:00:00.000Z", categories: [GOALS], intent: GOALS_INTENT, fixtureApiId: 4242 });
check("the AIJob prompt JSON contains the literal the SQL filter searches for", prompt.includes('"intent":"GOALS"') && /contains: '"intent":"GOALS"'/.test(read("src/lib/goalsPipeline.ts")));
const parsed = readGoalsAttempt(prompt, NOW);
check("a Goals AIJob is read back with its fixture and kickoff", parsed?.fixtureApiId === 4242 && parsed?.kickoff?.toISOString() === "2026-09-27T15:00:00.000Z");
check("other intents are not Goals attempts", readGoalsAttempt(JSON.stringify({ intent: "BANKER" }), NOW) === null && readGoalsAttempt(JSON.stringify({ intent: "REGULAR_COMBO" }), NOW) === null);
check("an unparseable prompt is ignored", readGoalsAttempt("{not json", NOW) === null);

// ── 6. Ledger, lease and scheduling ────────────────────────────────────────
console.log("\n6. Ledger and lease");
const worker = read("src/lib/generation/worker.ts");
const goalsRun = worker.slice(worker.indexOf("export async function runGoalsGeneration"));
check("runGoalsGeneration shares the generation-run lease", /await acquireLock\(now\)/.test(goalsRun) && /await releaseLock\(holder\)/.test(goalsRun));
check("runGoalsGeneration never writes the ledger", !/recordAttempt\(|generationAttempt\./.test(goalsRun));
check("goalsPipeline reads the ledger but never writes it", !/generationAttempt\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(read("src/lib/goalsPipeline.ts")));
check("goalsPipeline only reads SUCCEEDED ledger rows", /status: "SUCCEEDED"/.test(read("src/lib/goalsPipeline.ts")));
check("failure backoff lives in AppLock, not a second queue", /prisma\.appLock/.test(read("src/lib/goalsPipeline.ts")) && !/model Goals/.test(read("prisma/schema.prisma")));
check("the ordinary path is untouched: runGeneration does not know about Goals", !/GOALS|goals/i.test(worker.slice(worker.indexOf("export async function runGeneration"), worker.indexOf("export type GoalsRunReport"))));
const route = code("src/app/api/admin/generate/run/route.ts");
check("?goals=1 runs the Goals pass (or its dry run) and returns before the ordinary path", /if \(url\.searchParams\.get\("goals"\) === "1"\) \{[\s\S]*?return NextResponse\.json\(await runGoalsGeneration\(\{ authorId, limit \}\), \{ status: 200 \}\);\s*\}/.test(route) && route.indexOf("runGoalsGeneration(") < route.indexOf("const requested ="));
check("runs are recorded under their own job name", /JOB_GENERATE_GOALS/.test(route));
const { KNOWN_JOBS, JOB_GENERATE_GOALS } = require("../src/lib/jobRuns");
check("generate-goals is a known job (visible on /admin/jobs)", JOB_GENERATE_GOALS === "generate-goals" && KNOWN_JOBS.includes(JOB_GENERATE_GOALS));
check("Banker, VIP/Premium and Bet of the Day targeting are unchanged (no Goals references)", ["src/lib/bankerPipeline.ts", "src/lib/vipPremiumPipeline.ts", "src/lib/betOfTheDay.ts", "src/lib/doublesTargeting.ts", "src/lib/generation/queue.ts", "src/lib/generation/selector.ts"].every((f) => !/GOALS|goalsGeneration/.test(read(f))));

// ── 7. Tagging and homepage unchanged ──────────────────────────────────────
console.log("\n7. Tagging and homepage");
check("GOALS tagging stays deterministic: Over 1.5 / Over 2.5 in, everything else out", isGoalsPrediction("OVER_UNDER", ou(1.5, "OVER")) && isGoalsPrediction("OVER_UNDER", ou(2.5, "OVER")) && !isGoalsPrediction("OVER_UNDER", ou(2.5, "UNDER")) && !isGoalsPrediction("OVER_UNDER", ou(3.5, "OVER")));
check("a Goals row edited to another market loses GOALS", same(withGoalsCategory([GOALS], { marketType: "BTTS", selection: { value: "YES" } }), []));
const patch = code("src/app/api/admin/predictions/[id]/route.ts");
check("...and the edit is refused rather than leaving the row with no category", /withGoalsCategory\(categoriesToWrite, effectiveMarket\)\.length === 0/.test(patch));
check("a Goals-only row can still be saved without an editorial category", /categories!\.length === 0 && held\.includes\(GOALS\)/.test(patch));
const legs = new Map<string, { marketType: string; selection: unknown }>();
check("homepage Genius still excludes O/U 2.5 (a Goals-pass Over 2.5 included)", !isHomepageGeniusEligible({ id: "g", marketType: "OVER_UNDER", selection: ou(2.5, "OVER"), confidence: 85 }, legs));
check("homepageFeatured.ts is untouched by the pass", !/GOALS|goalsGeneration/.test(read("src/lib/homepageFeatured.ts")));

// Built, not written out: check-db-safety greps default-preflight scripts for
// Prisma write calls, and this is a search target, not a write.
const PERSIST_CALL = ["prisma", "prediction", "create("].join(".");

// ── 8. Automatic publication ───────────────────────────────────────────────
async function publicationAndProbe() {
  console.log("\n8. Automatic publication gate");
  const { goalsAutoPublishVerdict, goalsPublishFixture, evaluateGoalsProbe } = await import("../src/lib/goalsGeneration");
  const good: GoalsPublishRow = {
    status: "PENDING_REVIEW", provenance: GOALS_GENERATED_PROVENANCE, marketType: "OVER_UNDER", selection: ou(1.5, "OVER"),
    confidence: 70, contextComplete: true, leagueApiId: 39, leagueName: "Premier League", rewriteCount: 0, categories: [GOALS],
  };
  const covered = { ordinaryCovered: true, otherStandaloneTotalGoals: false };
  const v = (row: Partial<typeof good>, fx = covered) => goalsAutoPublishVerdict({ ...good, ...row }, fx);
  check("a valid Goals-generated Over 1.5 at 70 publishes", v({}).publish);
  check("a valid Goals-generated Over 2.5 at 70+ publishes", v({ selection: ou(2.5, "OVER"), confidence: 84 }).publish);
  const blocked: Array<[string, Partial<typeof good>, string, typeof covered?]> = [
    ["69 confidence", { confidence: 69 }, "BELOW_CONFIDENCE_FLOOR"],
    ["Under 2.5", { selection: ou(2.5, "UNDER") }, "NOT_GOALS_MARKET"],
    ["Under 1.5", { selection: ou(1.5, "UNDER") }, "NOT_GOALS_MARKET"],
    ["Over 3.5", { selection: ou(3.5, "OVER") }, "NOT_GOALS_MARKET"],
    ["malformed selection", { selection: { line: "2.5", direction: "OVER" } }, "NOT_GOALS_MARKET"],
    ["null selection", { selection: null }, "NOT_GOALS_MARKET"],
    ["BTTS", { marketType: "BTTS", selection: { value: "YES" } }, "NOT_GOALS_MARKET"],
    ["a combo", { marketType: "SAME_GAME_DOUBLE", selection: { legIds: ["a", "b"] }, categories: ["SAME_GAME_DOUBLE", GOALS] }, "COMBO"],
    ["a hidden combo leg", { categories: ["SAME_GAME_DOUBLE", GOALS] }, "HIDDEN_LEG"],
    ["an ordinary (non-Goals-pass) O/U row", { provenance: "STANDARD_CURATED" }, "NOT_GOALS_GENERATED"],
    ["a VIP-route row", { provenance: "VIP_ROUTE_CONFIRMED" }, "NOT_GOALS_GENERATED"],
    ["an already-published row", { status: "PUBLISHED" }, "NOT_PENDING_REVIEW"],
    ["an archived row", { status: "ARCHIVED" }, "NOT_PENDING_REVIEW"],
    ["a rewritten row (a human asked for it, a human publishes it)", { rewriteCount: 1 }, "REWRITTEN"],
    ["a row missing its GOALS tag", { categories: [] }, "NOT_TAGGED_GOALS"],
    ["no live match data", { contextComplete: false }, "NO_MATCH_CONTEXT"],
    ["no known competition", { leagueApiId: null, leagueName: null }, "NO_COMPETITION"],
    ["a placeholder competition name off-catalogue", { leagueApiId: 987654321, leagueName: "TBD" }, "NO_COMPETITION"],
    ["no ordinary coverage", {}, "NOT_ORDINARY_COVERED", { ordinaryCovered: false, otherStandaloneTotalGoals: false }],
    ["another standalone O/U on the fixture", {}, "DUPLICATE_TOTAL_GOALS", { ordinaryCovered: true, otherStandaloneTotalGoals: true }],
  ];
  for (const [why, row, block, fx] of blocked) {
    const r = v(row, fx ?? covered);
    check(`does not publish: ${why}`, !r.publish && r.blocks.includes(block as never), r.blocks);
  }

  const self = { id: "goals-row" };
  const fr = (id: string, extra: Partial<{ status: string; marketType: string; provenance: string | null; categories: string[] }> = {}) => ({
    id, status: "PUBLISHED", marketType: "MATCH_WINNER", provenance: "STANDARD_CURATED", categories: ["FEATURED"], ...extra,
  });
  check("fixture: SUCCEEDED ledger + an ordinary row = covered", goalsPublishFixture(self, "SUCCEEDED", [fr("a"), fr("goals-row", { provenance: GOALS_GENERATED_PROVENANCE })]).ordinaryCovered);
  check("fixture: a non-SUCCEEDED ledger is not covered", !goalsPublishFixture(self, "PENDING", [fr("a")]).ordinaryCovered);
  check("fixture: only Goals rows is not covered", !goalsPublishFixture(self, "SUCCEEDED", [fr("b", { provenance: GOALS_GENERATED_PROVENANCE })]).ordinaryCovered);
  check("fixture: archived ordinary rows do not count as coverage", !goalsPublishFixture(self, "SUCCEEDED", [fr("a", { status: "ARCHIVED" })]).ordinaryCovered);
  check("fixture: the row itself is not its own duplicate", !goalsPublishFixture(self, "SUCCEEDED", [fr("a"), fr("goals-row", { marketType: "OVER_UNDER", categories: [GOALS] })]).otherStandaloneTotalGoals);
  check("fixture: a public O/U single is a duplicate", goalsPublishFixture(self, "SUCCEEDED", [fr("a"), fr("ou", { marketType: "OVER_UNDER" })]).otherStandaloneTotalGoals);
  check("fixture: an awaiting-review O/U single is a duplicate", goalsPublishFixture(self, "SUCCEEDED", [fr("a"), fr("ou", { marketType: "OVER_UNDER", status: "PENDING_REVIEW" })]).otherStandaloneTotalGoals);
  check("fixture: a hidden-leg O/U is not a duplicate", !goalsPublishFixture(self, "SUCCEEDED", [fr("a"), fr("leg", { marketType: "OVER_UNDER", categories: ["SAME_GAME_DOUBLE"] })]).otherStandaloneTotalGoals);
  check("fixture: an archived O/U is not a duplicate", !goalsPublishFixture(self, "SUCCEEDED", [fr("a"), fr("ou", { marketType: "OVER_UNDER", status: "ARCHIVED" })]).otherStandaloneTotalGoals);

  console.log("\n   the publication path");
  const { reviewTransition } = await import("../src/lib/predictions");
  const t = reviewTransition("PUBLISH", "admin-1", { approvedById: null }) as Record<string, unknown>;
  check("PUBLISH writes status, publishedAt and records the actor as approver", t.status === "PUBLISHED" && t.publishedAt instanceof Date && t.approvedById === "admin-1" && t.approvedAt instanceof Date);
  const predictionsSrc = code("src/lib/predictions.ts");
  const shared = predictionsSrc.slice(predictionsSrc.indexOf("export async function applyReviewAction"));
  check("applyReviewAction = reviewTransition + recordPredictionEvents in one transaction", /prisma\.\$transaction\(async \(tx\) =>/.test(shared) && /data: reviewTransition\(action, actorId, row\)/.test(shared) && /await recordPredictionEvents\(tx, row, updated, action\)/.test(shared));
  check("the bulk publish uses the same helper", /await applyReviewAction\(row, action, session!\.user\.id\)/.test(code("src/app/api/admin/predictions/bulk/route.ts")));
  const pipeline = code("src/lib/goalsPipeline.ts");
  const auto = pipeline.slice(pipeline.indexOf("export async function autoPublishGoalsPrediction"), pipeline.indexOf("export type GoalsProbeResult"));
  check("auto-publish goes through applyReviewAction, after the verdict", /if \(!verdict\.publish\) return/.test(auto) && /await applyReviewAction\(row, "PUBLISH", actorId\)/.test(auto) && auto.indexOf("goalsAutoPublishVerdict(") < auto.indexOf("applyReviewAction("));
  check("auto-publish never flips status directly", !/status: "PUBLISHED"|prisma\.prediction\.update/.test(auto));
  check("the verdict is recomputed from the persisted row and a fresh fixture read", /prisma\.prediction\.findUnique\(\{ where: \{ id: predictionId \}/.test(auto) && /await loadFixtureState\(row\)/.test(auto));
  const worker = read("src/lib/generation/worker.ts");
  const goalsRun = worker.slice(worker.indexOf("export async function runGoalsGeneration"));
  const ordinaryRun = worker.slice(worker.indexOf("export async function runGeneration"), worker.indexOf("export type GoalsRunReport"));
  check("the Goals run auto-publishes each persisted pick, attributed to the run's author", /await autoPublishGoalsPrediction\(p\.id, opts\.authorId\)/.test(goalsRun));
  check("ordinary generation publishes nothing (unchanged)", !/autoPublish|applyReviewAction|"PUBLISH"/.test(ordinaryRun) && !/applyReviewAction|autoPublish/.test(code("src/lib/ai/generate.ts")));
  const { readdirSync, statSync } = require("node:fs");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f: string) => { const p = `${dir}/${f}`; return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
  const callers = walk("src").filter((f) => /autoPublishGoalsPrediction\(/.test(read(f)) && !f.endsWith("goalsPipeline.ts"));
  check("auto-publish is reachable only from the Goals run", callers.length === 1 && callers[0].endsWith("generation/worker.ts"), callers);
  const reviewCallers = walk("src").filter((f) => /applyReviewAction\(/.test(read(f)) && !f.endsWith("lib/predictions.ts"));
  check("applyReviewAction is used only by the bulk route and the Goals auto-publish", reviewCallers.length === 2 && reviewCallers.every((f) => /bulk\/route\.ts$|goalsPipeline\.ts$/.test(f)), reviewCallers);
  check("generation still persists every row PENDING_REVIEW (the gate publishes afterwards)", /status: "PENDING_REVIEW"/.test(code("src/lib/ai/generate.ts")));
  check("a draft failing the market/confidence gate is never persisted (pickGoalsDraft runs before any create)", code("src/lib/ai/generate.ts").indexOf("pickGoalsDraft(") < code("src/lib/ai/generate.ts").indexOf(PERSIST_CALL));

  // ── 9. Dry-run probe ─────────────────────────────────────────────────────
  console.log("\n9. Dry-run probe");
  const probe = pipeline.slice(pipeline.indexOf("export async function probeGoalsFixture"));
  const loadState = pipeline.slice(pipeline.indexOf("async function loadFixtureState"), pipeline.indexOf("export async function autoPublishGoalsPrediction"));
  for (const [what, src] of [["the probe", probe], ["its fixture read", loadState]] as const) {
    check(`${what} makes no Prisma write`, !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$transaction|\$execute/.test(src));
  }
  check("the probe never builds a live digest (that refreshes caches: a write, and api-football calls)", !/buildGenerationDigest|searchTeam/.test(probe) && /parseStoredContext\(source\.aiJob\?\.context\)/.test(probe));
  check("the probe never persists, publishes, backs off, leases or records", !/generateAndPersistPrediction|applyReviewAction|autoPublishGoalsPrediction|backOffGoalsFixture|acquireLock|recordJobRun|recordRouteRun|setPredictionCategories/.test(probe));
  check("the probe asks the model under the Goals constraint", /generatePredictionForFixture\(\{[\s\S]*?goalsOnly: true,[\s\S]*?\}\)/.test(probe));
  check("the probe says so in its response", /dryRun: true,\s*persisted: false,/.test(probe));
  const route = code("src/app/api/admin/generate/run/route.ts");
  check("?goals=1&dryRun=1 reaches the probe before any real run", route.indexOf("probeGoalsFixture(") > -1 && route.indexOf("probeGoalsFixture(") < route.indexOf("runGoalsGeneration("));
  check("a dry run is not recorded as a job run", /if \(url\.searchParams\.get\("goals"\) === "1" && url\.searchParams\.get\("dryRun"\) === "1"\) return handleGenerationRequest\(req\);/.test(route) && route.indexOf("dryRun\") === \"1\") return handleGenerationRequest") < route.indexOf("recordRouteRun(job"));
  check("the probe is behind the same admin / cron-secret check as the route", route.indexOf("isAuthorized(req)") < route.indexOf("probeGoalsFixture("));

  console.log("\n   probe evaluation (the same gates as a real run)");
  const fx = { ordinaryCovered: true, otherStandaloneTotalGoals: false };
  const ev = (predictions: unknown[], extra: Partial<{ contextComplete: boolean; fixture: typeof fx; matchPreview: string }> = {}) =>
    evaluateGoalsProbe({
      output: { matchPreview: extra.matchPreview ?? "Both sides have scored freely this season.", keyFactors: ["Home average 1.8 goals"], predictions },
      leagueApiId: 39, leagueName: "Premier League", contextComplete: extra.contextComplete ?? true, fixture: extra.fixture ?? fx,
    });
  const o15 = ev([{ ...draft("OVER_UNDER", ou(1.5, "OVER"), 78, "Both attacks are productive."), overUnderLine: 1.5, overUnderDirection: "OVER" }]);
  check("probe: a clean Over 1.5 at 78 would persist and auto-publish", o15.gate.wouldPersist && o15.gate.wouldAutoPublish && o15.gate.kept?.confidence === 78);
  const u25 = ev([draft("OVER_UNDER", ou(2.5, "UNDER"), 80)]);
  check("probe: an Under would be rejected", !u25.gate.wouldPersist && u25.gate.rejected[0]?.reason === "NOT_A_GOALS_MARKET");
  const low = ev([draft("OVER_UNDER", ou(2.5, "OVER"), 69)]);
  check("probe: 69 would be rejected", !low.gate.wouldPersist && low.gate.rejected[0]?.reason === "BELOW_CONFIDENCE_FLOOR");
  const dupe = ev([draft("OVER_UNDER", ou(2.5, "OVER"), 75)], { fixture: { ordinaryCovered: true, otherStandaloneTotalGoals: true } });
  check("probe: a fixture that gained an O/U single would persist but be held for review", dupe.gate.wouldPersist && !dupe.gate.wouldAutoPublish && dupe.gate.publishBlocks.includes("DUPLICATE_TOTAL_GOALS"));
  const certain = ev([draft("OVER_UNDER", ou(2.5, "OVER"), 80, "This is a guaranteed goal-fest.")]);
  check("probe: certainty language would sink the draft, as in a real run", certain.gate.certaintyViolations > 0 && !certain.gate.wouldPersist);
  const none = ev([]);
  check("probe: an empty answer is reported as no pick", none.gate.kept === null && !none.gate.wouldPersist);
  const garbage = ev(["not an object", null, 7]);
  check("probe: junk entries in predictions are tolerated", garbage.gate.kept === null && garbage.output.predictions.length === 0);
  check("probe response carries no prompt or digest", same(Object.keys(o15).sort(), ["gate", "output"]) && same(Object.keys(o15.output).sort(), ["keyFactors", "matchPreview", "predictions"]));

  // ── 10. The prompt the model actually receives ───────────────────────────
  console.log("\n10. Prompt as sent (provider stubbed; no network)");
  const { geminiProvider } = await import("../src/lib/ai/providers/gemini");
  const { groqProvider } = await import("../src/lib/ai/providers/groq");
  const { generatePredictionForFixture } = await import("../src/lib/ai/analysis");
  const sent: Array<{ system: string; user: string }> = [];
  const stub = geminiProvider as unknown as { isConfigured: () => boolean; complete: (r: { system: string; user: string }) => Promise<unknown> };
  const realGemini = { isConfigured: stub.isConfigured, complete: stub.complete };
  const groqStub = groqProvider as unknown as { isConfigured: () => boolean };
  const realGroq = groqStub.isConfigured;
  stub.isConfigured = () => true;
  groqStub.isConfigured = () => false;
  stub.complete = async (req) => {
    sent.push({ system: req.system, user: req.user });
    return { text: JSON.stringify({ matchPreview: "p", keyFactors: [], predictions: [{ marketType: "OVER_UNDER", selection: { line: 1.5, direction: "OVER" }, overUnderLine: 1.5, overUnderDirection: "OVER", confidence: 74, reasoning: "r" }] }), usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 }, model: "stub" };
  };
  try {
    const digest = { fixture: { home: "Home FC", away: "Away FC", league: "Premier League", kickoff: "2026-09-27T15:00:00Z" } } as never;
    const ordinary = await generatePredictionForFixture({ digest, tiers: ["GENIUS"] });
    const goals = await generatePredictionForFixture({ digest, tiers: ["GENIUS"], marketBreadth: "single", goalsOnly: true });
    const [o, g] = sent;
    check("goals prompt offers Over 1.5 as an exact choice", g.user.includes('{"line": 1.5, "direction": "OVER"}'));
    check("goals prompt offers Over 2.5 as an exact choice", g.user.includes('{"line": 2.5, "direction": "OVER"}'));
    check("goals prompt as sent presents both lines neutrally", g.user.includes("Neither line is the default and neither is preferred."));
    check("goals prompt as sent asks for the strongest justified line, not the safer one",
      /Choose the STRONGEST line\s+the evidence justifies, not the line most likely to win\./.test(g.user) && /do not choose Over 1\.5 merely because it\s+is safer/.test(g.user));
    check("goals prompt as sent requires comparing the two lines before choosing", g.user.indexOf("THREE OR MORE goals on its own evidence") < g.user.indexOf("TWO OR MORE goals the same way") && g.user.indexOf("TWO OR MORE goals the same way") < g.user.indexOf("Compare the two."));
    check("the line-selection instructions are in the goals prompt only", !/STRONGEST line|Compare the two\.|cautious fallback/.test(o.user) && !/STRONGEST line|cautious fallback/.test(o.system));
    check("goals prompt ends with the Goals-only instruction", g.user.trimEnd().endsWith(GOALS_MARKET_INSTRUCTION));
    check("ordinary prompt carries none of it", !o.user.includes("TOTAL GOALS CONSTRAINT") && !o.user.includes(GOALS_MARKET_INSTRUCTION) && /marketType must be one of: MATCH_WINNER, /.test(o.user));
    check("the system prompt is identical for both (the constraint lives only in the user prompt)", o.system === g.system);
    check("stripping the constraint from the goals prompt yields the ordinary prompt's body", g.user.replace(goalsMarketBlock(), "").replace(GOALS_MARKET_INSTRUCTION, "") === o.user.replace(/Return JSON only\. marketType must be one of: [^\n]*$/, ""));
    check("an Over 1.5 answer comes back through the normal parse", (goals.output.predictions[0]?.selection as any)?.line === 1.5 && pickGoalsDraft(goals.output.predictions).pick !== null);
    check("ordinary parse unchanged", Array.isArray(ordinary.output.predictions));
  } finally {
    stub.isConfigured = realGemini.isConfigured;
    stub.complete = realGemini.complete;
    groqStub.isConfigured = realGroq;
  }
}

publicationAndProbe()
  .then(() => {
    console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
