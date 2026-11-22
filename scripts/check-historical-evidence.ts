/**
 * Historical evidence classification and admin review — deterministic checks.
 * No database, provider, model or secrets. Run: npm run check:historical-evidence
 *
 * Fixture identities echo real cases (the 22 Nov EFL Trophy incident and
 * ordinary league picks); their evidence is synthetic.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MatchDigest, TeamDigest } from "../src/lib/ai/digest";
import { classifyHistoricalEvidence, CLASS_LABEL, CLASS_MEANING, CLASS_WARNING, FLAGGED_CLASSES, RECENCY_BOUND_DAYS, KICKOFF_CAPTURE_STARTED } from "../src/lib/ai/historicalEvidence";
import { classifyPart, type EvidenceProvenance } from "../src/lib/ai/evidenceFreshness";
import { assessSavedGenerationEvidence } from "../src/lib/ai/evidenceReadiness";

let passed = 0;
const eq = <T,>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); passed++; };
const ok = (c: unknown, m: string) => { assert.ok(c, m); passed++; };
const H = 3_600_000, D = 24 * H;
const gen = new Date("2026-11-21T10:00:00Z");
const ago = (days: number) => new Date(gen.getTime() - days * D).toISOString();

const team = (apiId: number, name: string, days: number[], over: Partial<TeamDigest> = {}): TeamDigest => ({
  apiId, name, rank: null, points: null, overall: { played: 12, win: 7, draw: 3, loss: 2, goalsFor: 20, goalsAgainst: 10 },
  home: null, away: null, goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null, form: "WWDWL",
  streak: null, biggest: null, formations: [], cards: null, penalties: null,
  last5: days.map((d, i) => ({ date: ago(d), opponent: "Opp " + i, opponentApiId: 9000 + i, venue: "home", result: "W", goalsFor: 2, goalsAgainst: 1 })),
  availability: [], availabilityAsOf: null, keyPlayers: [], ...over,
} as TeamDigest);
const digest = (home: TeamDigest, away: TeamDigest, kickoffDaysAfter = 3): MatchDigest => ({
  fixture: { home: home.name, away: away.name, league: "League", kickoff: new Date(gen.getTime() + kickoffDaysAfter * D).toISOString(), competitionType: "LEAGUE", round: null },
  teams: { home, away }, h2h: null, standings: null,
  coverage: { stats: true, form: true, availability: false, h2h: false, standings: false },
} as unknown as MatchDigest);
const empty = (apiId: number, name: string) => team(apiId, name, [], { overall: null, form: null });
const base = { hasAiJob: true, provenance: null, contextComplete: true, generatedAt: gen, known: [] as never[] };
const codes = (r: { reasons: Array<{ code: string }> }) => r.reasons.map((x) => x.code);

// ---------------------------------------------------------------- the four classes
const good = digest(team(1, "Arsenal", [4, 8, 11]), team(2, "Chelsea", [3, 7, 10]));
eq(classifyHistoricalEvidence({ ...base, digest: good }).classification, "EVIDENCE_AVAILABLE", "two-sided recent evidence, complete flag, nothing missed: available");
eq(classifyHistoricalEvidence({ ...base, hasAiJob: false, digest: null }).classification, "NOT_GENERATED", "admin-authored rows carry no evidence disclaimer");
eq(classifyHistoricalEvidence({ ...base, digest: null }).classification, "SNAPSHOT_UNAVAILABLE", "generated but no readable snapshot: unavailable, not 'wrong'");
eq(classifyHistoricalEvidence({ ...base, digest: digest(empty(1, "Oxford United"), empty(2, "Tottenham Hotspur U21")) }).classification, "EVIDENCE_INSUFFICIENT",
  "the 22 Nov incident shape (no sporting evidence for either side): insufficient");
const oneSided = classifyHistoricalEvidence({ ...base, digest: digest(team(1, "Oxford United", [4, 8]), empty(2, "Tottenham Hotspur U21")) });
eq([oneSided.classification, codes(oneSided)], ["EVIDENCE_INSUFFICIENT", ["away-no-evidence"]], "one side with nothing at all: insufficient for that side");

// ------------------------------------------------- freshness uncertain, never 'wrong'
const staleEarly = classifyHistoricalEvidence({ ...base, contextComplete: false, digest: good });
eq([staleEarly.classification, codes(staleEarly)], ["FRESHNESS_UNCERTAIN", ["historical-incomplete-flag"]],
  "BEFORE: 'Generated with no live data'. AFTER: real evidence + old early-lane flag = freshness uncertain");
eq(assessSavedGenerationEvidence(good, false).status, "needs-freshness-review", "consistent with PR #226's detail-page status");
const old = classifyHistoricalEvidence({ ...base, digest: digest(team(1, "A", [30, 34]), team(2, "B", [3, 7])) });
eq([old.classification, codes(old)], ["FRESHNESS_UNCERTAIN", ["home-latest-match-old"]],
  `NEVER verified merely because cached data exists: a latest result ${30} days old (> ${RECENCY_BOUND_DAYS}) is uncertain even with a complete flag`);
const statsOnly = classifyHistoricalEvidence({ ...base, digest: digest(team(1, "A", [], { form: null }), team(2, "B", [3])) });
eq([statsOnly.classification, codes(statsOnly)], ["FRESHNESS_UNCERTAIN", ["home-season-stats-only"]], "season stats without recent results: uncertain");
eq(classifyHistoricalEvidence({ ...base, generatedAt: null, digest: good }).classification, "FRESHNESS_UNCERTAIN", "unknown generation time: uncertain");

// provenance (jobs since 22 Nov) takes precedence over the old flag
const prov = (over: Partial<EvidenceProvenance>): EvidenceProvenance => ({
  v: 1, assessedAt: gen.toISOString(), leadHours: 72, cacheOnly: true,
  homeTeam: classifyPart({ present: true, fetchedAt: new Date(gen.getTime() - 5 * H), toleranceMs: 48 * H, now: gen }),
  awayTeam: classifyPart({ present: true, fetchedAt: new Date(gen.getTime() - 5 * H), toleranceMs: 48 * H, now: gen }),
  standings: classifyPart({ present: false, fetchedAt: null, toleranceMs: 48 * H, now: gen }),
  h2h: classifyPart({ present: true, fetchedAt: new Date(gen.getTime() - 400 * H), toleranceMs: null, now: gen }), ...over,
});
eq(classifyHistoricalEvidence({ ...base, provenance: prov({}), contextComplete: true, digest: good }).classification, "EVIDENCE_AVAILABLE", "fresh provenance: available");
const aged = classifyHistoricalEvidence({ ...base, provenance: prov({ awayTeam: classifyPart({ present: true, fetchedAt: new Date(gen.getTime() - 60 * H), toleranceMs: 48 * H, now: gen }) }), digest: good });
eq([aged.classification, codes(aged)], ["FRESHNESS_UNCERTAIN", ["awayTeam-aged"]], "aged provenance: uncertain, with hours and limit");
ok(aged.reasons[0].detail.includes("60h") && aged.reasons[0].detail.includes("48h"), "reason states the age and the limit");
const sup = classifyHistoricalEvidence({ ...base, provenance: prov({ homeTeam: classifyPart({ present: true, fetchedAt: gen, toleranceMs: 48 * H, now: gen, supersededBy: new Date(ago(2)) }) }), digest: good });
eq(codes(sup), ["homeTeam-superseded"], "superseded provenance: uncertain");

// missed matches at generation, from captured kickoffs (resolved, never assumed)
const genLate = new Date("2026-11-21T10:00:00Z");
ok(genLate >= KICKOFF_CAPTURE_STARTED, "generation after kickoff capture began: checkable");
const missed = (status: string, confirmedPlayed = false) => classifyHistoricalEvidence({ ...base, digest: good,
  known: [{ teamApiId: 2, opponentApiId: 77, kickoff: new Date(gen.getTime() - 1.5 * D), status, confirmedPlayed }] });
eq(codes(missed("FT")), ["away-missed-match"], "a finished match after the saved evidence: missed at generation");
eq(codes(missed("NS", true)), ["away-missed-match"], "stale NS but a current cache lists the result: missed");
eq(codes(missed("NS")), ["away-unconfirmed-match"], "stale NS, unconfirmed: uncertain, not assumed played");
eq(missed("PST").classification, "EVIDENCE_AVAILABLE", "postponed: no result was missed");
const early = new Date("2026-11-10T10:00:00Z");
const pre = classifyHistoricalEvidence({ ...base, generatedAt: early, digest: digest(team(1, "A", [4]), team(2, "B", [3])) });
eq([pre.classification, pre.indicators.supersessionCheckable], ["EVIDENCE_AVAILABLE", false], "before 19 Nov the missed-match check is reported as unavailable, not failed");

// --------------------------------------------------------- copy and labels
eq(FLAGGED_CLASSES, ["FRESHNESS_UNCERTAIN", "EVIDENCE_INSUFFICIENT", "SNAPSHOT_UNAVAILABLE"], "flagged classes");
ok(FLAGGED_CLASSES.every((c) => !!CLASS_WARNING[c]) && CLASS_WARNING.EVIDENCE_AVAILABLE === null && CLASS_WARNING.NOT_GENERATED === null, "each flagged class has its own warning; others none");
ok(!/no live data/i.test(Object.values(CLASS_WARNING).join(" ")), "the misleading 'no live data' wording is gone from the classifier");
ok(Object.values({ ...CLASS_LABEL, ...CLASS_WARNING }).every((t) => !t || !/\bAI\b|artificial intelligence/i.test(t)), "no AI wording");
ok(CLASS_WARNING.SNAPSHOT_UNAVAILABLE!.includes("does not show that the pick is wrong") && CLASS_WARNING.FRESHNESS_UNCERTAIN!.includes("needs verification"),
  "warnings never imply a pick is inaccurate");

ok(/not an independent verification of every statement/.test(CLASS_MEANING.EVIDENCE_AVAILABLE), "'Evidence available' is defined as coverage, not verification of claims");
ok(/It is not an independent check of every statement in the reasoning/.test(readFileSync("src/app/admin/evidence-review/page.tsx", "utf8")),
  "the review page states the same limit");
ok(!/verified/i.test(CLASS_LABEL.EVIDENCE_AVAILABLE + (CLASS_WARNING.EVIDENCE_AVAILABLE ?? "")), "no 'verified' wording on the available class");

// ----------------------------------------------------------- guarantees (source)
const src = (p: string) => readFileSync(p, "utf8");
const review = src("src/lib/evidenceReview.ts");
ok(!/prisma\.prediction\.(update|updateMany|upsert|delete|deleteMany|create)\(|tx\.prediction\.(update|updateMany|upsert|delete|deleteMany|create)\(/.test(review),
  "the review service never writes a prediction row");
ok((review.match(/publiclyVisible: false/g) ?? []).length === 2 && !/publiclyVisible: true/.test(review), "both review revisions are private");
const upsert = review.slice(review.indexOf("tx.predictionReassessment.upsert("), review.indexOf("return tx.predictionRevision.create("));
ok(/create: \{[^}]*publicHold: false/.test(upsert) && /update: \{[^}]*publicHold: false/.test(upsert) && !/publicHold: true/.test(upsert),
  "an opened review writes publicHold: false on create and update, never true");
ok(!/football\/api-football|refresh(Team|League|H2H|Odds)Cache/.test(review.replace(/import type[^\n]*\n/g, "")), "the review service imports no provider client or cache writer");
const route = src("src/app/api/admin/evidence-review/route.ts");
ok((route.match(/isAdmin\(session\?\.user\.role\)/g) ?? []).length === 2 && /hasValidMutationOrigin\(req\)/.test(route), "GET and POST are admin-only; POST checks origin");
ok((route.match(/withNoFootballApiCalls\(/g) ?? []).length === 3, "list, summary and action handlers all run under the provider-call hard stop");
ok(/days: z\.coerce\.number/.test(route) && /createdFrom/.test(route) && /kickoffFrom/.test(route) && /summary: z\.enum/.test(route),
  "API exposes the diagnostic-comparable creation scope, a separate kickoff scope, and full-scope summaries");
ok(/withNoFootballApiCalls\(\(\) => historicalEvidenceFor/.test(src("src/app/api/admin/predictions/[id]/route.ts")), "the detail API's classification also runs under the hard stop");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const publicFiles = [...walk("src/app/(public)"), ...walk("src/components")].filter((f) => /\.tsx?$/.test(f));
ok(publicFiles.every((f) => !/historicalEvidence|evidenceReview|EvidenceReview|CLASS_WARNING/.test(src(f))), "no public page or component reads evidence classifications");
ok(!/Generated with no live data/.test(src("src/app/admin/predictions/page.tsx") + src("src/app/admin/ai/page.tsx") + src("src/app/admin/predictions/[id]/page.tsx")),
  "the misleading 'Generated with no live data' wording is gone from every admin surface");
ok(src("src/app/admin/layout.tsx").includes('{ href: "/admin/evidence-review", label: "Evidence review" }'), "admin navigation entry");
ok(/readOnly|findMany|findUnique/.test(src("scripts/diagnose-missing-evidence.ts")) && !/\.(create|update|upsert|delete)\(/.test(src("scripts/diagnose-missing-evidence.ts")),
  "the production diagnostic only reads");

console.log(`check-historical-evidence: ${passed} assertions passed`);
