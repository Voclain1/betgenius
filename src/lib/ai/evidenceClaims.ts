import type { MatchDigest } from "@/lib/ai/digest";
import { computeH2HStats } from "@/lib/h2h";
import { removeSentences, unsupportedStaffSentences, type StaffContext } from "@/lib/ai/staffClaims";
import { competitionStage, KNOCKOUT_TIE } from "@/lib/ai/competitionStage";

const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (s: string) => /^\d+$/.test(s) ? Number(s) : words.indexOf(s.toLowerCase());
const number = "(\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)";
export type ClaimIssue = { code: string; claim: string; evidence: string };

/** Narrow, deterministic checks, not a general factual accuracy score.
 * Only compare an explicit last-N H2H claim with that exact supplied sample.
 * Never use today's cache to judge what was known at publication time.
 */
export function evidenceClaimIssues(d: MatchDigest, text: string): ClaimIssue[] {
  const issues: ClaimIssue[] = [];
  const meetings = d.h2h?.meetings;
  const homeId = d.teams?.home?.apiId, awayId = d.teams?.away?.apiId;
  if (!meetings?.length || homeId == null || awayId == null) return issues;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    const scope = sentence.match(new RegExp(`(?:last|previous) ${number} (?:(?:head[- ]to[- ]head |h2h )(?:meetings|encounters|clashes|fixtures|matches)|(?:meetings|encounters|clashes))`, "i"));
    if (!scope) continue;
    const n = count(scope[1]);
    if (n < 1 || meetings.length < n) continue;
    const sample = [...meetings].sort((a,b) => b.date.localeCompare(a.date)).slice(0,n);
    const stats = computeH2HStats(sample, homeId, awayId);
    for (const [team, actual] of [[d.fixture.home, stats.overall.teamAWins], [d.fixture.away, stats.overall.teamBWins]] as const) {
      const escaped = team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const claim = sentence.match(new RegExp(`${escaped} (?:have |has )?(?:won|secured|recorded|claimed) ${number} (?:wins |victories )?(?:from|of|in) (?:their |the )?(?:last|previous)`, "i"));
      if (claim && count(claim[1]) !== actual) issues.push({ code: "h2h-wins", claim: sentence, evidence: `${team}: ${actual} wins in the supplied last ${n} meetings.` });
    }
    const avg = sentence.match(/averag(?:ed|ing|e of) (\d+(?:\.\d+)?) (?:total )?goals/i);
    if (avg && Math.abs(Number(avg[1]) - Number(stats.avgGoals!.toFixed(1))) > 0.051)
      issues.push({ code: "h2h-goal-average", claim: sentence, evidence: `Supplied last ${n} meetings: ${stats.avgGoals!.toFixed(1)} total goals per game.` });
    if (/all (?:\d+|ten|nine|eight|seven|six|five|four|three|two|one|of them) (?:meetings |matches |fixtures )?(?:featur(?:ed|ing)|finish(?:ed|ing)|had|were|went|exceed(?:ed|ing)) (?:over |above )?2[.]5/i.test(sentence) && stats.over25Pct !== 100)
      issues.push({ code: "h2h-over25", claim: sentence, evidence: `Only ${sample.filter(m => m.homeGoals+m.awayGoals>2.5).length} of the supplied ${n} meetings had over 2.5 goals.` });
  }
  return issues;
}

export function assertEvidenceClaims(d: MatchDigest, output: { matchPreview?: string; keyFactors?: string[]; predictions?: { reasoning?: string }[] }) {
  const text = [output.matchPreview, ...(output.keyFactors ?? []), ...(output.predictions ?? []).map(p => p.reasoning)].filter(Boolean).join("\n");
  const issues = evidenceClaimIssues(d, text);
  for (const claim of unsupportedStaffSentences(text, staffContext(d)))
    issues.push({ code: "unsupported-manager", claim, evidence: "Named manager is not the coach supplied in the digest." });
  if (issues.length) throw Object.assign(new Error(`Unsupported claim: ${issues.map(i => i.evidence).join(" ")}`), { name: "EvidenceClaimError" });
}

/** Coaches and every club name the digest carries, for the manager check. */
export function staffContext(d: MatchDigest, extraCoaches: Array<string | null | undefined> = []): StaffContext {
  // Optional chaining throughout: stored contexts and test stubs can carry a
  // fixture with no team digests, and the check must not crash generation.
  const home = d.teams?.home;
  const away = d.teams?.away;
  return {
    coaches: [home?.coach?.name, away?.coach?.name, ...extraCoaches],
    teams: [d.fixture?.home, d.fixture?.away, home?.name, away?.name, ...(home?.last5 ?? []).map((f) => f.opponent), ...(away?.last5 ?? []).map((f) => f.opponent)],
  };
}

type DraftProse = { matchPreview?: string; keyFactors?: string[]; predictions?: Array<{ reasoning?: string }> };

/**
 * The draft with every unsupported sentence removed: an H2H figure the stored
 * meetings contradict, a manager the digest does not name, knockout-tie
 * wording for a fixture that is not a knockout. Used at generation in place of
 * rejecting the whole draft. A rejection threw away a model call that had
 * already been paid for, and the fixture was then retried (paid again) up to
 * three times; the sentence is the error, not the pick. The match page applies
 * the same removal to rows published before this, so the two never disagree.
 *
 * Returns the cleaned copy and what was removed. A prediction whose reasoning
 * is removed entirely keeps no argument at all, so that one case is reported
 * back for the caller to reject.
 */
export function stripUnsupportedClaims<T extends DraftProse>(d: MatchDigest, output: T): { output: T; removed: string[]; emptied: boolean } {
  const ctx = staffContext(d);
  const nonKnockout = competitionStage(d.fixture) !== "knockout";
  const removed: string[] = [];
  const clean = (text: string | undefined): string | undefined => {
    if (typeof text !== "string" || !text) return text;
    const bad = new Set<string>(unsupportedStaffSentences(text, ctx));
    for (const issue of evidenceClaimIssues(d, text)) bad.add(issue.claim);
    if (nonKnockout) for (const s of text.split(/(?<=[.!?])\s+|\n+/)) if (KNOCKOUT_TIE.test(s)) bad.add(s);
    removed.push(...bad);
    return removeSentences(text, bad);
  };
  const predictions = output.predictions?.map((p) => ({ ...p, reasoning: clean(p.reasoning) }));
  const cleaned = {
    ...output,
    ...(output.matchPreview !== undefined ? { matchPreview: clean(output.matchPreview) } : {}),
    ...(output.keyFactors ? { keyFactors: output.keyFactors.map((f) => clean(f) ?? "").filter((f) => f.trim()) } : {}),
    ...(predictions ? { predictions } : {}),
  } as T;
  const emptied = !!output.predictions?.some((p, i) => !!p.reasoning?.trim() && !predictions![i].reasoning?.trim());
  return { output: cleaned, removed, emptied };
}
