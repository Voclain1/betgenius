/**
 * Editorial standards for reader-facing football prose (no database, no network).
 *
 *   npx tsx scripts/check-editorial-voice.ts
 *
 * Covers: the shared generation prompt (distinct matchPreview / reasoning
 * rules, uncertainty in football language), reviewer-direction handling
 * (steers, never narrated), the evidence-update rewrite framing, the
 * expanded house-voice scan (catches administrative language, leaves football
 * terminology alone) and the prose gate on every private rewrite path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPredictionRequest, buildSystemPrompt } from "../src/lib/ai/analysis";
import { PROHIBITED_INTERNAL_TERMS, BACKFILL_TERM_LABELS, scanDraftForInternalTerminology, internalTerminologyProhibitionBlock, editorialStandardsBlock } from "../src/lib/houseVoice";
import { proseViolations, describeProseViolations } from "../src/lib/ai/proseGate";
import type { MatchDigest } from "../src/lib/ai/digest";

let passed = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); passed++; };
const src = (p: string) => readFileSync(p, "utf8");
/** Prompt text with line wrapping collapsed, so assertions are about wording, not where a line breaks. */
const norm = (t: string) => t.replace(/\s+/g, " ");
const req = (r: { system: string; user: string; temperature?: number }) => ({ ...r, system: norm(r.system), user: norm(r.user) });

const digest = {
  fixture: { home: "Alpha", away: "Beta", league: "League", kickoff: "2026-11-29T15:00:00Z", competitionType: "LEAGUE", round: "Regular Season - 14" },
  teams: { home: { name: "Alpha", last5: [] }, away: { name: "Beta", last5: [] } }, h2h: null, standings: null,
  coverage: { stats: true, form: true, availability: false, h2h: false, standings: false },
} as unknown as MatchDigest;

// ------------------------------------------------------------------ 1. the shared generation prompt
for (const mode of ["off", "tiered", "margin"] as const) {
  const sys = norm(buildSystemPrompt(["FEATURED"], mode));
  ok(sys.includes("EDITORIAL STANDARDS. Two fields, two different jobs."), `editorial standards present (${mode})`);
  ok(sys.includes('"matchPreview" is MATCH JOURNALISM'), `distinct preview brief (${mode})`);
  ok(sys.includes('"reasoning" is the ANALYTICAL CASE'), `distinct reasoning brief (${mode})`);
}
const sys = norm(buildSystemPrompt(["VIP"], "margin"));
for (const topic of ["recent form", "home and away", "team news", "tactical strengths and weaknesses", "how the match is likely to unfold", "2-4 natural, polished paragraphs"])
  ok(sys.includes(topic), "preview brief covers: " + topic);
ok(/No betting talk in the preview/.test(sys), "preview carries no betting talk");
ok(/specifically for this market/.test(sys) && /Analytical, not technical/.test(sys), "reasoning is market-specific and non-technical");
ok(/UNCERTAINTY, IN FOOTBALL LANGUAGE/.test(sys) && /Never invent injuries, recoveries,\s+confirmed lineups/.test(sys), "uncertainty becomes football language, no invented facts");
ok(/never call a player fit, doubtful or returning/.test(sys), "no invented fitness claims when team news is absent");
ok(/never describe a starting XI as confirmed unless/.test(sys), "no invented confirmed lineups");
ok(sys.includes(norm(internalTerminologyProhibitionBlock())) && sys.includes(norm(editorialStandardsBlock())), "both reader blocks in the system prompt");
// Existing rules preserved (spot checks of the rules this change must not disturb).
for (const rule of ["Do NOT invent players, transfers, or scores", "Be conservative — do not exceed 90", "Never claim a prediction is guaranteed", "Write PLAIN TEXT. No markdown", "CONFIDENCE IS A SECOND, INDEPENDENT TEST"])
  ok(sys.includes(rule), "existing rule preserved: " + rule);

// ------------------------------------------------------------------ 2. initial generation: no direction, no revision framing
const first = req(buildPredictionRequest({ digest, tiers: ["FEATURED"] }));
ok(!/PRIVATE EDITORIAL DIRECTION|REVISION of an earlier draft|CURRENT-EVIDENCE REWRITE/.test(first.user), "first-pass generation carries no rewrite blocks");
ok(first.temperature === undefined, "first-pass sampling unchanged");
ok(!/directly and\s+visibly/.test(first.system + first.user), "the old 'address it visibly' instruction is gone");
for (const variant of [{ goalsOnly: true }, { lowerRisk: { avoidPicks: ["Alpha to win"] } }]) {
  const r = req(buildPredictionRequest({ digest, tiers: ["VIP"], ...variant }));
  ok(r.system.includes("EDITORIAL STANDARDS"), "dedicated passes share the editorial standards: " + Object.keys(variant)[0]);
}

// ------------------------------------------------------------------ 3. pending-review rewrite with a reviewer note
const note = "The confidence feels too high given the weak head-to-head; lean more on away form.";
const rw = req(buildPredictionRequest({ digest, tiers: ["FEATURED"], reviewerNote: note,
  previousDraft: { pick: "Alpha", confidence: 78, matchPreview: "Old preview.", reasoning: "Old reasoning." } }));
ok(rw.user.includes("PRIVATE EDITORIAL DIRECTION") && rw.user.includes(`"${note}"`), "the note reaches the model as private direction");
ok(/Act on it silently/.test(rw.user) && /never quote, paraphrase, acknowledge or answer this direction/.test(rw.user), "the note steers but is never narrated");
ok(/never\s+mention an editor, a reviewer, a request, a note or a previous version/.test(rw.user), "no mention of editors, requests or versions");
ok(/If the\s+direction asks for something the data does not support/.test(rw.user), "a note cannot override data grounding");
ok(/The reader never\s+sees the earlier text: do not refer to it/.test(rw.user), "the revision framing forbids referring to the earlier draft");
ok(!rw.user.includes("CURRENT-EVIDENCE REWRITE"), "an ordinary rewrite is not framed as an evidence update");
ok(rw.temperature === 1.0, "rewrite sampling unchanged");

// ------------------------------------------------------------------ 4. evidence-related rewrite (Prediction Updates workspace)
const auditNote = "Explanation updated after new evidence: A new match result is available. Selection, confidence and odds unchanged.";
const ev = req(buildPredictionRequest({ digest, tiers: ["FEATURED"], evidenceUpdate: true, reviewerNote: auditNote,
  previousDraft: { pick: "Alpha", confidence: 74, matchPreview: "Old.", reasoning: "Old." } }));
ok(ev.user.includes("CURRENT-EVIDENCE REWRITE"), "evidence rewrite gets its own framing");
ok(/never\s+say that evidence, data or information has changed/.test(ev.user), "the framing forbids 'new evidence' narration");
ok(/as ordinary football facts/.test(ev.user), "new results are written as football facts");
ok(ev.user.indexOf("CURRENT-EVIDENCE REWRITE") < ev.user.indexOf("PRIVATE EDITORIAL DIRECTION"), "framing precedes the private direction");
ok(!buildPredictionRequest({ digest, tiers: ["FEATURED"], evidenceUpdate: true }).user.includes("CURRENT-EVIDENCE REWRITE"), "framing needs a previous draft");
const route = src("src/app/api/admin/reassessment/rewrite/route.ts");
ok(/evidenceUpdate: true,\s*reviewerNote: note,/.test(route), "the workspace route uses the framing and passes the admin note only as direction");
ok(!/ORIGINAL published pick|originally published selection/.test(route), "internal instructions are no longer smuggled into the reviewer note");

// ------------------------------------------------------------------ 5. the scan catches administrative language
const leaks: Array<[string, string]> = [
  ["digest", "The evidence digest shows Alpha unbeaten at home."],
  ["evidence snapshot", "The latest evidence snapshot has Beta two points clear."],
  ["availability list", "The availability list for Beta is empty, so they are at full strength."],
  ["coverage (of the data)", "Team-news coverage is incomplete for this fixture."],
  ["coverage flag", "With the coverage flag false, absences are unknown."],
  ["provides coverage", "The double chance provides coverage against a draw."],
  ["data feed", "The team-news feed has nothing on Beta."],
  ["data did not resolve", "The data did not resolve for the away side."],
  ["the supplied data", "Based on the supplied data, Alpha should edge it."],
  ["the data provided", "The evidence provided points to goals at both ends."],
  ["according to the data provided", "According to the data available, Alpha are favourites."],
  ["null field", "Beta's season record is a null field here."],
  ["field name (e.g. keyPlayers)", "None of Beta's keyPlayers are listed as absent."],
  ["JSON", "The JSON shows a strong home record."],
  ["reviewer", "As the reviewer noted, the head-to-head is weak."],
  ["editor's note", "Following the editor's note, we have trimmed the confidence."],
  ["as requested", "As requested, this analysis leans on away form."],
  ["previous draft", "Unlike the previous draft, we now favour Beta."],
  ["this rewrite", "This rewrite reflects Saturday's defeat."],
  ["originally published", "The originally published pick still stands."],
  ["explanation updated", "Explanation updated after Alpha's defeat at Gamma."],
  ["selection, confidence and odds", "Selection, confidence and odds unchanged."],
  ["evidence alert", "A new evidence alert flagged Alpha's defeat."],
  ["monitoring signal", "The monitoring signal for Beta's injury list fired."],
  ["AI", "Our AI rates Alpha as favourites."],
  ["artificial intelligence", "A language model analysis favours the hosts."],
  // The original leaks keep failing.
  ["calibration", "In line with VIP risk calibration, backing Leeds is sensible."],
];
for (const [label, sentence] of leaks) {
  const hits = scanDraftForInternalTerminology({ matchPreview: sentence });
  ok(hits.some((h) => h.label === label), `caught [${label}]: ${sentence}  -> ${hits.map((h) => h.label).join(", ") || "NOT CAUGHT"}`);
}
// Every rule in the list is exercised by at least one sentence somewhere in this suite or the combo suite.
const exercised = new Set([...leaks.map(([l]) => l), "risk-calibrated", "Genius/VIP tier as a system concept", "under the <tier>", "in line with the <tier>/risk",
  "confidence band/threshold", "risk profile/management", "safety calibrations", "market breadth", "hedging guidelines", "per the guidelines", "as instructed",
  "our algorithm/pipeline/prompt", "PENDING_REVIEW", "marketType", "selection schema"]);
ok(PROHIBITED_INTERNAL_TERMS.every((t) => exercised.has(t.label)), "every prohibited term has a test sentence: missing " + PROHIBITED_INTERNAL_TERMS.filter((t) => !exercised.has(t.label)).map((t) => t.label).join(", "));
const BACKSPACE = String.fromCharCode(8);
ok(PROHIBITED_INTERNAL_TERMS.every((t) => !t.pattern.source.includes(BACKSPACE)), "no corrupted (backspace) pattern");
ok(PROHIBITED_INTERNAL_TERMS.every((t) => internalTerminologyProhibitionBlock().includes(t.label)), "prompt and scan come from one list");

// ------------------------------------------------------------------ 6. ...and leaves football writing alone
const football = [
  "Arteta names an unchanged XI for the third match running.",
  "Arteta's selection was unchanged from the derby.",
  "The goal stood after a lengthy VAR review.",
  "It was a snapshot of their season: bright for an hour, then undone late.",
  "Sky's live coverage starts at 4pm.",
  "Saka fed the striker for the opener.",
  "Two academy graduates were drafted in for the cup tie.",
  "The data shows Alpha press higher than anyone in the division.",
  "Information provided by the club suggests the captain trained on Friday.",
  "This version of Liverpool is more patient in possession.",
  "A moment of genius from the winger settled it.",
  "Leeds are a second-tier side adapting to a new system.",
  "He is a premium finisher inside the box.",
  "The draft-day signing has started every game since August.",
  "Their review of the defeat focused on set pieces.",
  "Aidan scored twice in the first half.",
  "Confidence is high in the camp after three straight wins.",
  "The manager's selection dilemma is at left-back.",
  "The hosts' defensive cover was stretched on the counter.",
  "Beta's form guide reads three wins and two draws.",
  "The original fixture was postponed in October.",
  "Alpha have not lost at home since the opening weekend; Beta, by contrast, have collected a single point on the road.",
];
for (const sentence of football) {
  const hits = scanDraftForInternalTerminology({ matchPreview: sentence });
  ok(hits.length === 0, `football writing allowed: "${sentence}" -> ${hits.map((h) => h.label).join(", ")}`);
}
// A full, realistic preview and reasoning in the house style pass both scans.
const preview = `Alpha return to their own ground on the back of a bruising weekend. Saturday's 2-0 defeat at Gamma ended a run of four straight wins, but at home they have been formidable, unbeaten in seven league matches and conceding only four goals in that run.

Beta arrive in better shape than their position suggests. They have scored in each of their last five away games, and their full-backs push high, which has left space in behind that quick sides have exploited.

There is no fresh word on either squad, so the shape of the game should follow recent patterns: Alpha controlling possession, Beta looking to break quickly and finding the target often enough to make this a contest.`;
const reasoning = "Alpha have scored in all seven home league games and Beta have found the net in five straight away matches, so both teams to score is the most likely outcome. The main risk is Alpha's defence, which has kept three home clean sheets, shutting out a Beta side that relies heavily on counter-attacks.";
ok(proseViolations({ matchPreview: preview, reasoning }).length === 0, "a polished preview and reasoning pass the full gate: " + describeProseViolations(proseViolations({ matchPreview: preview, reasoning })));

// ------------------------------------------------------------------ 7. the prose gate guards every private rewrite path, before anything is saved
const g = proseViolations({ matchPreview: "As requested, Alpha are a guaranteed win.", reasoning: "The digest says so." });
ok(g.some((v) => v.kind === "certainty") && g.some((v) => v.kind === "house-voice"), "the gate combines certainty and house-voice checks");
ok(/"As requested" \(matchPreview\)/.test(describeProseViolations(g)), "violations are described for the administrator");
const rewrite = src("src/lib/ai/rewrite.ts");
ok(rewrite.indexOf("proseViolations(") > 0 && rewrite.indexOf("proseViolations(") < rewrite.indexOf("prisma.aIJob.create") && rewrite.indexOf("proseViolations(") < rewrite.indexOf("prisma.prediction.update"),
  "pending-review rewrite: gate runs before any write");
ok(route.indexOf("proseViolations(") > 0 && route.indexOf("proseViolations(") < route.indexOf('kind: "ADMIN_REWRITE_DRAFT"'), "workspace rewrite: gate runs before the private draft is saved");
const resolve = src("src/app/api/admin/reassessment/resolve/route.ts");
ok(/proseViolations\(\{ reasoning: proposal\.reasoning \}\)/.test(resolve) && !/Updated assessment based on newer match information/.test(resolve), "replacement: gated reasoning, no administrative preview line");
ok(src("src/lib/ai/generate.ts").includes("scanDraftForInternalTerminology({"), "first-pass generation keeps its scan (now with the expanded list)");

// ------------------------------------------------------------------ 8. nothing published is touched automatically
ok(!/prisma\.prediction\.(update|updateMany)\(/.test(src("src/lib/houseVoice.ts") + src("src/lib/ai/proseGate.ts")), "the voice rules never write a prediction");
ok(/status !== "PENDING_REVIEW"/.test(rewrite), "the rewrite tool still only touches PENDING_REVIEW rows");
const backfill = src("scripts/backfill-house-voice.ts");
ok(/BACKFILL_TERM_LABELS\.has\(v\.label\)/.test(backfill), "the published-row backfill is pinned to the original term list");
ok(BACKFILL_TERM_LABELS.size === 16 && [...BACKFILL_TERM_LABELS].every((l) => PROHIBITED_INTERNAL_TERMS.some((t) => t.label === l)), "the pinned list is exactly the 16 pre-existing terms");
ok(!BACKFILL_TERM_LABELS.has("reviewer") && !BACKFILL_TERM_LABELS.has("digest"), "new editorial terms never trigger an automatic published edit");

console.log(`PASS: editorial voice — ${passed} assertions (prompt briefs, uncertainty language, reviewer direction, evidence rewrites, expanded scan, football false positives, rewrite gates)`);
