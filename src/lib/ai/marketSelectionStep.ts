/**
 * The market-selection step of generation, as one pure function so its
 * behaviour is tested directly (scripts/check-market-selection.ts) rather
 * than through source patterns. Called by src/lib/ai/generate.ts after the
 * model output has passed the normal checks and before anything is persisted.
 *
 *  1. Every alternative must pass the SAME gates the primary passed, run on
 *     the alternative's reasoning in the context of the same preview and key
 *     factors: valid structure, football-evidence claims (stripUnsupportedClaims:
 *     unnamed managers, knockout talk off-stage, contradicted H2H and form
 *     figures, internal score conflicts), certainty language and house voice.
 *     It must ALSO pass two stricter checks the primary path does not run
 *     (alternativeOnlyClaimIssues): a named player who is not in the saved
 *     evidence, and a scoreline that no saved meeting or recent result holds.
 *     An alternative with any unsupported sentence is rejected outright,
 *     never edited.
 *  2. Candidates are judged by selectPrimary on the quote loaded for this
 *     decision, with its provider and cache timestamps recorded.
 *  3. Only "on" (and never admin-requested generation) may replace the
 *     primary, and only with a validated, verified candidate.
 *  4. Early publication safety is decided on the draft that will actually be
 *     persisted, not on any draft the model happened to return.
 */
import type { AIPredictionOutput } from "@/lib/ai/analysis";
import type { MatchDigest } from "@/lib/ai/digest";
import { stripUnsupportedClaims } from "@/lib/ai/evidenceClaims";
import { proseViolations } from "@/lib/ai/proseGate";
import { isGeneratableTeamTotal, isValidSelection, type MarketType } from "@/lib/markets";
import type { FixtureOdds } from "@/lib/odds";
import { selectPrimary, selectionRecord, type CandidateInput, type MarketSelectionMode, type SelectionRecord } from "@/lib/marketSelection";

type Draft = AIPredictionOutput["predictions"][number];
type Alternative = NonNullable<AIPredictionOutput["alternatives"]>[number];
const EXCLUDED = new Set(["CORRECT_SCORE", "HT_FT", "SAME_GAME_DOUBLE", "OTHER", "EUROPEAN_HANDICAP"]);

const ROLE = String.raw`(?:striker|forward|centre-forward|winger|midfielder|playmaker|defender|centre-back|full-back|goalkeeper|keeper|captain|top scorer|talisman)`;
const NAME = String.raw`([A-Z][\p{L}'’-]+(?:\s+(?:van|de|der|da|di|dos|[A-Z][\p{L}'’-]+)){0,2})`;
const PLAYER_PATTERNS = [
  new RegExp(String.raw`\b${ROLE}\s+${NAME}`, "gu"),
  new RegExp(String.raw`${NAME}\s+(?:has|have)\s+(?:scored|netted|found the net|provided|assisted)\b`, "gu"),
];
const SCORELINE = /\b(\d{1,2})\s?[-–‑]\s?(\d{1,2})\b/g;

/**
 * Claims an alternative may not make even though the primary path does not
 * check them: a named player absent from the saved evidence (key players and
 * availability lists of both sides) and a scoreline that is in neither the
 * saved head-to-head meetings nor either side's recent results. Deliberately
 * narrow: only named players after a role word or before "has scored", and only
 * explicit N-N scorelines.
 */
export function alternativeOnlyClaimIssues(d: MatchDigest, text: string): string[] {
  const out: string[] = [];
  const teams = [d.fixture?.home, d.fixture?.away].filter(Boolean).map((t) => String(t).toLowerCase());
  const known = [d.teams?.home, d.teams?.away].flatMap((t) => [...(t?.keyPlayers ?? []).map((p) => p.name), ...(t?.availability ?? []).map((a) => a.player)])
    .filter(Boolean).map((n) => n.toLowerCase());
  const isKnown = (name: string) => {
    const lower = name.toLowerCase();
    if (teams.some((t) => t === lower || t.includes(lower) || lower.includes(t))) return true;
    const last = lower.split(/\s+/).pop()!;
    return known.some((k) => k === lower || k.includes(lower) || k.split(/[\s.]+/).includes(last));
  };
  const scores = new Set<string>();
  const add = (a: number | null | undefined, b: number | null | undefined) => { if (a != null && b != null) { scores.add(`${a}-${b}`); scores.add(`${b}-${a}`); } };
  for (const m of d.h2h?.meetings ?? []) add(m.homeGoals, m.awayGoals);
  for (const t of [d.teams?.home, d.teams?.away]) for (const m of t?.last5 ?? []) add(m.goalsFor, m.goalsAgainst);
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    for (const re of PLAYER_PATTERNS) for (const m of sentence.matchAll(re)) {
      if (!isKnown(m[1])) { out.push(`player not in the evidence (${m[1]}): ${sentence}`); break; }
    }
    for (const m of sentence.matchAll(SCORELINE)) {
      if (!scores.has(`${Number(m[1])}-${Number(m[2])}`)) { out.push(`scoreline not in the evidence (${m[0]}): ${sentence}`); break; }
    }
  }
  return [...new Set(out)];
}

/**
 * Why an alternative cannot be a candidate; empty when it passes every gate.
 * `context` is the draft's own preview and key factors, so cross-sentence
 * conflicts are judged exactly as they are for the primary.
 */
export function alternativeProblems(digest: MatchDigest, alt: Partial<Alternative> | null | undefined,
  context: { matchPreview?: string; keyFactors?: string[] } = {}): string[] {
  const out: string[] = [];
  if (!alt || typeof alt.marketType !== "string") return ["missing marketType"];
  if (EXCLUDED.has(alt.marketType)) out.push(`${alt.marketType} is not a selectable alternative`);
  if (!isValidSelection(alt.marketType as MarketType, alt.selection)) out.push("invalid selection for its market");
  if (alt.marketType === "TEAM_TOTAL" && !isGeneratableTeamTotal(alt.selection)) out.push("team-total line generation may not use");
  const conf = Number(alt.confidence);
  if (!Number.isFinite(conf) || conf < 0 || conf > 100) out.push("confidence out of range");
  if (typeof alt.reasoning !== "string" || alt.reasoning.trim().length < 20) out.push("reasoning missing or too short");
  if (out.length) return out;
  const reasoning = alt.reasoning as string;
  const claims = stripUnsupportedClaims(digest, { matchPreview: context.matchPreview, keyFactors: context.keyFactors, predictions: [{ reasoning }] });
  const own = claims.output.predictions?.[0]?.reasoning ?? "";
  if (own.trim() !== reasoning.trim()) out.push(...claims.removed.filter((s) => reasoning.includes(s)).map((s) => `unsupported claim: ${s.slice(0, 120)}`), ...(claims.removed.some((s) => reasoning.includes(s)) ? [] : ["unsupported claim removed"]));
  out.push(...alternativeOnlyClaimIssues(digest, reasoning).map((s) => s.slice(0, 160)));
  for (const v of proseViolations({ reasoning: alt.reasoning })) out.push(`${v.kind}: ${v.label}`);
  return out;
}

export type MarketSelectionStepResult = {
  output: AIPredictionOutput;
  record: SelectionRecord;
  /** The draft that will be persisted (index 0 of output.predictions). */
  persisted: Draft | null;
  /** For the early lane: block automatic publication of the persisted draft. */
  earlyPriceUnsafe: boolean;
  switched: boolean;
};

export function applyMarketSelection(input: {
  output: AIPredictionOutput;
  digest: MatchDigest;
  odds: FixtureOdds | null;
  quoteFetchedAt: Date | null;
  contextComplete: boolean;
  mode: Exclude<MarketSelectionMode, "off">;
  manual: boolean;
  earlyFree: boolean;
  /** The generation's own price checks (floor, unpriced team total, far above market) for a draft. */
  failsPriceChecks: (d: Draft) => boolean;
  now?: Date;
}): MarketSelectionStepResult {
  const now = input.now ?? new Date();
  const primary = input.output.predictions[0];
  const rejectedAlternatives: Array<{ marketType: string; reasons: string[] }> = [];
  const valid: Alternative[] = [];
  for (const a of Array.isArray(input.output.alternatives) ? input.output.alternatives : []) {
    const problems = alternativeProblems(input.digest, a, { matchPreview: input.output.matchPreview, keyFactors: input.output.keyFactors });
    if (problems.length) rejectedAlternatives.push({ marketType: String(a?.marketType ?? "?"), reasons: problems });
    else valid.push(a);
  }
  const candidates: CandidateInput[] = [
    { marketType: primary.marketType, selection: primary.selection, confidence: Number(primary.confidence), source: "primary" },
    ...valid.map((a) => ({ marketType: a.marketType, selection: a.selection, confidence: Number(a.confidence), source: "alternative" as const })),
  ];
  const result = selectPrimary(candidates, input.odds, { evidenceComplete: input.contextComplete, now, quoteFetchedAt: input.quoteFetchedAt });
  const record = selectionRecord(result, input.mode, input.quoteFetchedAt, { providerQuoteAt: input.odds?.update ?? null, decidedAt: now, rejectedAlternatives });

  let output = input.output;
  let switched = false;
  if (input.mode === "on" && !input.manual && result.decision === "SWITCH" && result.chosen) {
    const chosen = valid.find((a) => a.marketType === result.chosen!.marketType && JSON.stringify(a.selection) === JSON.stringify(result.chosen!.selection));
    if (chosen) {
      output = { ...output, predictions: [{ ...chosen, confidence: Number(chosen.confidence) }] };
      switched = true;
    }
  }
  const persisted = output.predictions[0] ?? null;
  const earlyPriceUnsafe = input.earlyFree && (!persisted || input.failsPriceChecks(persisted)
    || (input.mode === "on" && result.decision === "HOLD"));
  return { output, record, persisted, earlyPriceUnsafe, switched };
}
