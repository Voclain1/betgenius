/**
 * Unit and source checks for the admin Prediction Updates workspace (issue #232).
 * No database, no network.
 *
 *   npx tsx scripts/check-prediction-updates.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  adminStatus, decisionRequired, diffEvidence, friendlyReason, possiblyStaleStatements, suggestedAuditNote, DECISION_CONFIDENCE_DROP,
} from "../src/lib/reassessment/evidenceDiff";
import { compareKeys, priorityKey } from "../src/lib/predictionUpdates";
import { REASSESSMENT_CORE_MIN_REMAINING, REASSESSMENT_REFRESH_MIN_REMAINING, MAX_REASSESSMENTS_PER_RUN, materialDecision, shouldRecordReassessmentReceipt } from "../src/lib/reassessment/worker";
import { confirmedLineupSignals, fixtureSignals } from "../src/lib/reassessment/evidence";
import { DECISION_KINDS } from "../src/lib/predictionUpdates";
import { createHash } from "node:crypto";
import { LIVE_POLICY } from "../src/lib/liveSnapshot";
import { EARLY_LANE_MIN_QUOTA_REMAINING, EARLY_BOOST } from "../src/lib/generation/earlyFixturePolicy";
import type { MatchDigest } from "../src/lib/ai/digest";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ---------------------------------------------------------------- evidence diff
const team = (name: string, o: { last5?: Array<[string, string]>; form?: string; rank?: number; played?: number; out?: string[]; coach?: string }) => ({
  name, rank: o.rank ?? null, form: o.form ?? null,
  overall: o.played != null ? { played: o.played, win: o.played - 2, draw: 1, loss: 1, goalsFor: 2 * o.played, goalsAgainst: o.played } : null,
  last5: (o.last5 ?? []).map(([date, result]) => ({ date, opponent: "Opp " + date, venue: "home", result, goalsFor: 2, goalsAgainst: 1, competition: "League" })),
  availability: (o.out ?? []).map((player) => ({ player, kind: "injury" })),
  coach: o.coach ? { name: o.coach } : null,
});
const digest = (h: ReturnType<typeof team>, a: ReturnType<typeof team>, meetings = 0) =>
  ({ teams: { home: h, away: a }, h2h: { meetings: Array.from({ length: meetings }, () => ({})) } }) as unknown as MatchDigest;

const before = digest(team("Arsenal", { last5: [["2026-11-01", "W"], ["2026-11-08", "W"]], form: "WW", rank: 2, played: 11, coach: "M. Arteta" }),
  team("Chelsea", { last5: [["2026-11-02", "L"]], form: "L", rank: 6, played: 11, out: ["Player A"] }), 3);
const same = diffEvidence(before, before);
assert.ok(same && !same.changed, "identical snapshots: no change (duplicate alerts suppressed)");
const after = digest(team("Arsenal", { last5: [["2026-11-08", "W"], ["2026-11-15", "L"]], form: "WL", rank: 3, played: 12, coach: "New Coach" }),
  team("Chelsea", { last5: [["2026-11-02", "L"]], form: "L", rank: 6, played: 11, out: ["Player B"] }), 4);
const d = diffEvidence(before, after)!;
assert.equal(d.changed, true);
const ars = d.teams.find((t) => t.side === "home")!;
assert.deepEqual(ars.newResults.map((r) => r.date), ["2026-11-15"], "only results after the latest one the pick was written from");
assert.deepEqual(ars.form, { before: "WW", after: "WL" });
assert.deepEqual(ars.rank, { before: 2, after: 3 });
assert.deepEqual(ars.coach, { before: "M. Arteta", after: "New Coach" });
const che = d.teams.find((t) => t.side === "away")!;
assert.deepEqual(che.newlyUnavailable, ["Player B (injury)"]);
assert.deepEqual(che.noLongerListed, ["Player A"]);
assert.equal(che.form, null, "unchanged parts are not reported");
assert.equal(d.newHeadToHead, 1);
assert.equal(diffEvidence(null, after), null, "sparse data: no original snapshot means no comparison, not an invented one");
assert.equal(diffEvidence(before, null), null, "failed provider / no monitoring snapshot: no comparison");

// ---------------------------------------------------------------- friendly reasons
assert.equal(friendlyReason("new-result-home"), "A new match result is available");
assert.equal(friendlyReason("confirmed-lineup-key-player-absence"), "Official lineup: a key player is not starting");
assert.equal(friendlyReason("fixture-status-PST"), "Fixture postponed");
assert.equal(friendlyReason("fixture-kickoff-shift"), "Kickoff time changed");
assert.equal(friendlyReason("new-unavailable-away-123"), "New injury or suspension reported");
assert.equal(friendlyReason("something-new"), "Evidence changed");

// ---------------------------------------------------------------- stale statements
const text = "Arsenal are in excellent form with two straight wins. Arsenal sit 2nd in the table. Chelsea will be without Player A. The weather is mild.";
const stale = possiblyStaleStatements(text, d, []);
assert.ok(stale.includes("Arsenal are in excellent form with two straight wins."), "form claim flagged after a new result");
assert.ok(stale.includes("Arsenal sit 2nd in the table."), "table claim flagged after a rank change");
assert.ok(stale.includes("Chelsea will be without Player A."), "availability claim flagged");
assert.ok(!stale.includes("The weather is mild."), "unrelated statements are not flagged");
assert.deepEqual(possiblyStaleStatements(text, same, []), [], "no diff: nothing flagged");

// ---------------------------------------------------------------- decision rules
const moderate = [{ code: "new-result-home", severity: "MODERATE", source: "fixture", message: "x" }];
const critical = [{ code: "confirmed-lineup-key-player-absence", severity: "CRITICAL", source: "lineup", message: "x" }];
assert.equal(decisionRequired({ signals: moderate, originalConfidence: 74 }).required, false, "a new result alone allows an explanation update");
assert.equal(decisionRequired({ signals: critical, originalConfidence: 74 }).required, true, "a critical signal is a decision");
assert.equal(decisionRequired({ signals: moderate, originalConfidence: 74, draft: { sameSelection: false, confidence: 74 } }).required, true, "different selection is a decision");
assert.equal(decisionRequired({ signals: moderate, originalConfidence: 74, draft: { sameSelection: true, confidence: 74 - DECISION_CONFIDENCE_DROP } }).required, false, "drop of exactly the tolerance: prose allowed");
assert.equal(decisionRequired({ signals: moderate, originalConfidence: 74, draft: { sameSelection: true, confidence: 74 - DECISION_CONFIDENCE_DROP - 1 } }).required, true, "larger drop: decision");

// ---------------------------------------------------------------- statuses
const st = (o: Partial<Parameters<typeof adminStatus>[0]>) => adminStatus({ kickoffPassed: false, reassessmentStatus: null, latestDecisionKind: null, draftReady: false, decisionRequired: false, ...o });
assert.equal(st({ kickoffPassed: true, reassessmentStatus: "REVIEW_REQUIRED" }), "Match started (read-only)");
assert.equal(st({ reassessmentStatus: "REVIEW_REQUIRED" }), "New evidence");
assert.equal(st({ reassessmentStatus: "REVIEW_REQUIRED", draftReady: true }), "Draft ready");
assert.equal(st({ reassessmentStatus: "REVIEW_REQUIRED", draftReady: true, decisionRequired: true }), "Awaiting your decision");
assert.equal(st({ reassessmentStatus: "UNKNOWN" }), "Needs more evidence");
assert.equal(st({ reassessmentStatus: "CURRENT", latestDecisionKind: "CONFIRMED" }), "Retained");
assert.equal(st({ reassessmentStatus: "CURRENT", latestDecisionKind: "ADMIN_REWRITE_APPLIED" }), "Updated by admin");
assert.ok(/Selection, confidence and odds unchanged/.test(suggestedAuditNote(moderate, "update")));
assert.ok(/A new match result is available/.test(suggestedAuditNote(moderate, "keep")));

// ---------------------------------------------------------------- priority
const now = new Date("2026-11-22T12:00:00Z");
const p = (id: string, status: string, hours: number, cat: string, provenance = "STANDARD_CURATED") =>
  ({ id, status, kickoff: new Date(now.getTime() + hours * 3_600_000), provenance, categories: [{ category: cat }] });
const order = [p("free-soon", "PUBLISHED", 2, "FEATURED"), p("started", "PUBLISHED", -1, "VIP"), p("vip-later", "PUBLISHED", 30, "VIP"),
  p("pending", "PENDING_REVIEW", 5, "FEATURED"), p("premium-soon", "PUBLISHED", 3, "PREMIUM")]
  .sort((a, b) => compareKeys(priorityKey(a, now), priorityKey(b, now))).map((x) => x.id);
assert.deepEqual(order, ["premium-soon", "vip-later", "pending", "free-soon", "started"], "upcoming first; paid, then unpublished, then free; soonest first; started last");

// ---------------------------------------------------------------- quota order (no starvation)
assert.ok(REASSESSMENT_CORE_MIN_REMAINING >= LIVE_POLICY.GENERATION_RESERVE, "monitoring never runs below the live-score reserve");
assert.ok(REASSESSMENT_CORE_MIN_REMAINING > EARLY_LANE_MIN_QUOTA_REMAINING, "monitoring stops before the early lane's floor (750)");
assert.ok(EARLY_LANE_MIN_QUOTA_REMAINING > 500, "early lane stops before ordinary generation's floor");
assert.ok(REASSESSMENT_REFRESH_MIN_REMAINING > REASSESSMENT_CORE_MIN_REMAINING, "full evidence refresh stops before core monitoring");
assert.ok(EARLY_BOOST.MIN_QUOTA_REMAINING > REASSESSMENT_REFRESH_MIN_REMAINING, "the early boost is unaffected by monitoring");
// Worst case: 1 batched /fixtures + MAX_REASSESSMENTS_PER_RUN lineups per 15-minute run.
assert.ok((1 + MAX_REASSESSMENTS_PER_RUN) * 96 <= 600, "core monitoring is bounded to under 600 calls a day");
const worker = src("src/lib/reassessment/worker.ts");
assert.ok(/budget\.remaining <= REASSESSMENT_CORE_MIN_REMAINING[\s\S]{0,200}return finish\(\)/.test(worker), "the quota check stands down BEFORE any provider call");
assert.ok(worker.indexOf("REASSESSMENT_CORE_MIN_REMAINING)") < worker.indexOf("getFixturesByIds(ids)"), "quota gate precedes the batched fixture call");
assert.ok(/refreshThisRow = !cacheOnlyEvidence && row\.status === "PUBLISHED"/.test(worker) && /cacheOnly: !refreshThisRow/.test(worker), "unpublished picks are monitored from caches only");
assert.ok(/row\.status === "PUBLISHED" && row\.kickoff\.getTime\(\) - now\.getTime\(\) <= 90 \* 60_000/.test(worker), "lineups are fetched for published picks only");

// ---------------------------------------------------------------- repeat-alert suppression is value-sensitive (PR #233 review)
{
  const prior = { teams: {
    home: { apiId: 1, keyPlayers: [{ name: "Ade Bello" }, { name: "Chris Dube" }] },
    away: { apiId: 2, keyPlayers: [] },
  } } as unknown as MatchDigest;
  const xi = (names: string[]) => [
    { teamId: 1, starters: [...names, ...Array.from({ length: 11 - names.length }, (_, i) => "Squad " + i)].map((name, id) => ({ id, name })) },
    { teamId: 2, starters: Array.from({ length: 11 }, (_, i) => ({ id: 100 + i, name: "Away " + i })) },
  ];
  const lineupA = confirmedLineupSignals(xi(["Chris Dube"]), prior);           // Ade Bello absent
  const lineupB = confirmedLineupSignals(xi(["Ade Bello"]), prior);           // Chris Dube absent
  assert.equal(lineupA[0].code, lineupB[0].code, "same generic code for both lineup changes");
  // Run the worker's state machine: flag A, admin keeps A, A again, then B, then B again.
  let state: { hash: string | null; status: string } = { hash: null, status: "CURRENT" };
  let receipts = 0;
  const pass = (signals: typeof lineupA) => {
    const d = materialDecision({ signals, previousHash: state.hash, previousStatus: state.status });
    if (d.retainedUnchanged) return "suppressed";
    if (shouldRecordReassessmentReceipt({ mode: "shadow", sameSignature: d.alreadyRecorded, existingStatus: state.status, publicHold: false })) receipts++;
    state = { hash: d.signature, status: "REVIEW_REQUIRED" };
    return "open";
  };
  assert.equal(pass(lineupA), "open"); assert.equal(receipts, 1);
  state.status = "CURRENT";                                                      // admin: Keep original
  assert.equal(pass(lineupA), "suppressed", "the same lineup change after Keep stays closed");
  assert.equal(pass(lineupB), "open", "a different absent key player reopens the retained case");
  assert.equal(receipts, 2, "...with one new receipt");
  assert.equal(pass(lineupB), "open"); assert.equal(receipts, 2, "the reopened case is reopened exactly once (no duplicate receipt)");

  const ko = new Date("2026-11-25T19:00:00Z"), seen = new Date("2026-11-22T12:00:00Z");
  const shift = (iso: string) => fixtureSignals(ko, { status: "NS", kickoff: new Date(iso), seenAt: seen, fixtureApiId: 1 }, seen);
  state = { hash: null, status: "CURRENT" }; receipts = 0;
  assert.equal(pass(shift("2026-11-25T20:00:00Z")), "open");
  state.status = "CURRENT";
  assert.equal(pass(shift("2026-11-25T20:00:00Z")), "suppressed", "same kickoff move after Keep stays closed");
  assert.equal(pass(shift("2026-11-25T21:30:00Z")), "open", "a further kickoff move of the same kind reopens");
  assert.equal(receipts, 2);

  const legacy = createHash("sha256").update(JSON.stringify(["new-result-home-2026-11-20", "new-unavailable-away-x"])).digest("hex").slice(0, 24);
  assert.equal(materialDecision({ signals: [{ code: "new-unavailable-away-x" }, { code: "new-result-home-2026-11-20" }], previousHash: legacy, previousStatus: "CURRENT" }).retainedUnchanged, true,
    "codes that already carry their value hash exactly as before: existing retained cases are not reopened by the upgrade");
}

// ---------------------------------------------------------------- Reviewed = completed decisions only
assert.ok(!(DECISION_KINDS as readonly string[]).includes("EVIDENCE_REVIEW_OPENED"), "opening a private review is not a decision");

// ---------------------------------------------------------------- per-call quota floor in the worker
{
  const w = src("src/lib/reassessment/worker.ts");
  assert.ok(/withFootballCallFloor\(REASSESSMENT_CORE_MIN_REMAINING, \(\) => getFixturesByIds\(ids\)\)/.test(w), "batched fixture call under the 1,000 floor");
  assert.ok(/withFootballCallFloor\(REASSESSMENT_CORE_MIN_REMAINING, \(\) => getFixtureLineups\(/.test(w), "each lineup call under the 1,000 floor");
  assert.ok(/withFootballCallFloor\(REASSESSMENT_REFRESH_MIN_REMAINING, \(\) => buildGenerationDigest\(/.test(w), "evidence refresh under the 1,500 floor");
  assert.equal((w.match(/await getFixturesByIds\(|await getFixtureLineups\(/g) ?? []).length, 0, "no unguarded provider call in the worker");
  const client = src("src/lib/football/api-football.ts");
  assert.ok(client.indexOf("floorAllowsCall()") < client.indexOf("await recordCall(path)"), "the floor is checked before every dispatch");
}

// ---------------------------------------------------------------- routes: admin-only, CSRF, no provider calls, guards
const api = src("src/app/api/admin/prediction-updates/route.ts");
assert.ok((api.match(/isAdmin\(session\?\.user\.role\)/g) ?? []).length >= 2, "GET and POST are admin-only");
assert.ok(/hasValidMutationOrigin\(req\)/.test(api), "POST checks the mutation origin");
assert.ok((api.match(/withNoFootballApiCalls/g) ?? []).length >= 3, "every read runs under the provider-call hard stop");
assert.ok(/cacheOnly: true/.test(api), "the on-demand comparison uses caches only");
assert.ok(!/prisma\.(prediction|predictionRevision|predictionReassessment)\.(create|update|upsert|delete)/.test(api + src("src/lib/predictionUpdates.ts")), "the workspace service never writes");
const rewrite = src("src/app/api/admin/reassessment/rewrite/route.ts");
assert.equal((rewrite.match(/throw new Error\("ADMIN_AUTHORED_PICK"\)/g) ?? []).length, 2, "admin-authored picks: refused at draft and at apply");
assert.equal((rewrite.match(/severity === "CRITICAL"\)\) throw new Error\("DECISION_REQUIRED"\)/g) ?? []).length, 2, "critical evidence: refused at draft and at apply");
assert.ok(/DECISION_CONFIDENCE_DROP\) throw new Error\("DECISION_REQUIRED"\)/.test(rewrite), "a weaker draft cannot be applied as prose");
assert.ok(/data: \{ reasoning: draft\.reasoning, matchPreview: draft\.matchPreview \}/.test(rewrite), "apply writes prose only");
assert.ok(/action === "WITHDRAW" && before\.kickoff <= new Date\(\)\) throw new Error\("KICKOFF_PASSED"\)/.test(src("src/app/api/admin/reassessment/resolve/route.ts")), "no withdrawal after kickoff");

// ---------------------------------------------------------------- UI: owner design rules, private, no public surface
const ui = src("src/app/admin/updates/page.tsx");
assert.ok(!/border-[lr]-/.test(ui), "no coloured accent edges");
assert.ok(!/bg-[a-z-]+\/\d+[^"]*rounded-full|rounded-full[^"]*bg-[a-z-]+\/\d+/.test(ui), "no tinted pill backgrounds behind status text");
assert.ok(/<details[\s\S]*Advanced options/.test(ui), "technical filters live under Advanced options");
assert.ok(/useState<"upcoming" \| "7" \| "30" \| "90">\("upcoming"\)/.test(ui) && !/days=30/.test(ui), "historical notes default: upcoming picks, any generation date; longer lookback is opt-in");
for (const label of ["New evidence", "Needs review", "Reviewed", "Approve &amp; apply", "Keep original", "Prepare private draft"]) assert.ok(ui.includes(label), "UI offers " + label);
assert.ok(!/\bAI\b/.test(ui), "no 'AI' wording");
assert.ok(/window\.confirm\("Withdraw/.test(ui), "withdrawal needs a separate confirmation");
assert.ok(src("src/app/admin/layout.tsx").includes('"/admin/updates"'), "nav entry");
const publicHits = (() => {
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  return execSync("grep -rl 'predictionUpdates\\|prediction-updates\\|evidenceDiff' src/app src/components || true", { encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => !f.startsWith("src/app/admin/") && !f.startsWith("src/app/api/admin/"));
})();
assert.deepEqual(publicHits, [], "no public page or component reads the workspace");

console.log("PASS: value-sensitive repeat-alert suppression (lineup, kickoff), evidence diff, friendly reasons, stale-statement detection, decision rules, statuses, priority, quota order, admin-only routes, server guards, UI rules");
