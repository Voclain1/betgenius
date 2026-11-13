import { generationTierOf, leaguePriorityRank, type GenerationTier } from "@/lib/leagues";
import { cupSupports, isCupCompetition } from "@/lib/cupConfig";

/**
 * Sprint 05: competition eligibility that is configured, evidenced and rolled
 * out deliberately, instead of living only in the catalogue's tier lists.
 *
 * Each entry records what the PROVIDER said about the competition when it was
 * checked (scripts/research-league-coverage.ts, run from the read-only
 * diagnose-generation workflow), so an id or a capability is never taken from
 * memory. An entry changes discovery only while COVERAGE_ROLLOUT=on. In shadow
 * (the default) discovery runs exactly as before and records what the proposed
 * rules would have done with the same sweep payload; off disables even that.
 *
 * Three separate questions, measured separately:
 *   fixture coverage      is the competition discovered at all (tier / registry)
 *   evaluation coverage   may a discovered fixture be generated (gate, caps)
 *   selection eligibility may a pick from it enter VIP / PREMIUM (unchanged here:
 *                         PAID_ANY_LEAGUE_IDS; no registry entry widens it)
 */
export type CoverageRollout = "off" | "shadow" | "on";

export function coverageRollout(env: Record<string, string | undefined> = process.env): CoverageRollout {
  const v = (env.COVERAGE_ROLLOUT ?? "").trim().toLowerCase();
  return v === "on" || v === "off" ? v : "shadow";
}

export type ProviderEvidence = {
  checkedAt: string;
  source: string;
  season: number;
  seasonStart: string;
  seasonEnd: string;
  /** The provider's own coverage flag. */
  oddsCoverage: boolean;
  standingsCoverage: boolean;
  /** Bookmaker counts seen on sampled upcoming fixtures when checked. */
  sampledBookmakers: number[];
  /** Finished fixtures in the 30 days before the check, and how many had FT and HT scores. */
  finishedSample: { fixtures: number; fullTime: number; halfTime: number };
};

export type CompetitionEntry = {
  id: number;
  name: string;
  country: string;
  kind: "league" | "cup";
  /** What the registry proposes. EXCLUDED documents a competition we deliberately do not take. */
  proposal:
    | { action: "ADD"; tier: GenerationTier }
    | { action: "CUP_ODDS_SUPPORTED" }
    | { action: "KEEP" }
    | { action: "EXCLUDED" };
  reason: string;
  evidence: ProviderEvidence;
};

const PROBE = "api-football /leagues?country=Wales, /fixtures, /odds (diagnose-generation run 40, job league-coverage)";

export const COMPETITION_REGISTRY: readonly CompetitionEntry[] = [
  {
    id: 111, name: "FAW Championship", country: "Wales", kind: "league",
    proposal: { action: "ADD", tier: "DEEP_FALLBACK" },
    reason: "Cymru North and Cymru South. The provider files both as ONE competition (id 111) with \"North - n\" / \"South - n\" rounds. Absent from the catalogue, so every fixture was refused as unrecognised_competition. Both sampled fixtures were quoted by 8 bookmakers.",
    evidence: { checkedAt: "2026-11-13", source: PROBE, season: 2026, seasonStart: "2026-07-31", seasonEnd: "2027-04-17", oddsCoverage: true, standingsCoverage: true, sampledBookmakers: [8, 8], finishedSample: { fixtures: 42, fullTime: 42, halfTime: 42 } },
  },
  {
    id: 112, name: "Welsh Cup", country: "Wales", kind: "cup",
    proposal: { action: "CUP_ODDS_SUPPORTED" },
    reason: "cupConfig records the Welsh Cup as unpriced, so the fallback gate refuses it (unpriced_cup). The provider reports odds coverage and one of two sampled ties had 5 bookmakers. Quotes are thin: the ordinary MIN_BOOKMAKERS checks still apply after generation.",
    evidence: { checkedAt: "2026-11-13", source: PROBE, season: 2026, seasonStart: "2026-10-16", seasonEnd: "2026-11-14", oddsCoverage: true, standingsCoverage: false, sampledBookmakers: [5, 0], finishedSample: { fixtures: 32, fullTime: 32, halfTime: 32 } },
  },
  {
    id: 110, name: "Cymru Premier", country: "Wales", kind: "league",
    proposal: { action: "KEEP" },
    reason: "Already catalogued (DEEP_FALLBACK). Provider odds coverage is on, but both sampled fixtures a week out had 0 bookmakers; no evidence yet to promote its tier.",
    evidence: { checkedAt: "2026-11-13", source: PROBE, season: 2026, seasonStart: "2026-07-31", seasonEnd: "2027-03-26", oddsCoverage: true, standingsCoverage: true, sampledBookmakers: [0, 0], finishedSample: { fixtures: 23, fullTime: 23, halfTime: 23 } },
  },
  {
    id: 738, name: "League Cup", country: "Wales", kind: "cup",
    proposal: { action: "EXCLUDED" },
    reason: "The provider's current season is 2025 (ended 2026-02-28), no fixtures in the 44-day sample and odds coverage off.",
    evidence: { checkedAt: "2026-11-13", source: PROBE, season: 2025, seasonStart: "2025-07-18", seasonEnd: "2026-02-28", oddsCoverage: false, standingsCoverage: false, sampledBookmakers: [], finishedSample: { fixtures: 0, fullTime: 0, halfTime: 0 } },
  },
];

const byId = new Map(COMPETITION_REGISTRY.map((e) => [e.id, e]));
export const registryEntry = (id: number | null | undefined) => (id == null ? undefined : byId.get(id));

/** The rule set discovery applies. "current" is the catalogue exactly as before Sprint 05. */
export type EligibilityRules = {
  name: "current" | "proposed";
  tierOf: (leagueApiId: number | null | undefined) => GenerationTier | null;
  /** Whether a configured cup is treated as priced by the fallback gate. */
  cupPriced: (leagueApiId: number) => boolean;
  /** Fixtures from one competition a single sweep may queue (null = unlimited, the current behaviour). */
  perCompetitionCap: number | null;
  /** Order eligible rows within a tier. */
  order: "priority" | "fair";
};

export const CURRENT_RULES: EligibilityRules = {
  name: "current",
  tierOf: generationTierOf,
  cupPriced: (id) => !isCupCompetition(id) || cupSupports(id, "odds"),
  perCompetitionCap: null,
  order: "priority",
};

/** Per-competition cap for one sweep. Small on purpose: no single competition can take a thin day's whole top-up. */
export const FAIR_PER_COMPETITION_CAP = 4;

export const PROPOSED_RULES: EligibilityRules = {
  name: "proposed",
  tierOf: (id) => {
    const live = generationTierOf(id);
    if (live) return live;
    const e = registryEntry(id);
    return e?.proposal.action === "ADD" ? e.proposal.tier : null;
  },
  cupPriced: (id) => registryEntry(id)?.proposal.action === "CUP_ODDS_SUPPORTED" || CURRENT_RULES.cupPriced(id),
  perCompetitionCap: FAIR_PER_COMPETITION_CAP,
  order: "fair",
};

/** The rules discovery acts on under a rollout setting. Shadow and off act on the current rules. */
export function liveRules(rollout: CoverageRollout = coverageRollout()): EligibilityRules {
  return rollout === "on" ? PROPOSED_RULES : CURRENT_RULES;
}

/** Rank for ordering inside a tier: catalogue rank, then registry additions after every catalogued league. */
export function eligibilityRank(id: number | null | undefined): number {
  const r = leaguePriorityRank(id);
  return Number.isFinite(r) && generationTierOf(id) ? r : 10_000 + (id ?? 0);
}

/**
 * Fair order: competitions take turns. Round k holds each competition's k-th
 * fixture (by kickoff); a round is ordered by kickoff, then catalogue rank.
 * Priority still breaks ties, but a lower-ranked competition is never queued
 * only after every fixture of every higher-ranked one.
 */
export function fairOrder<T>(rows: readonly T[], leagueOf: (r: T) => number, kickoffOf: (r: T) => number, idOf: (r: T) => number): T[] {
  const groups = new Map<number, T[]>();
  for (const r of rows) groups.set(leagueOf(r), [...(groups.get(leagueOf(r)) ?? []), r]);
  for (const g of groups.values()) g.sort((a, b) => kickoffOf(a) - kickoffOf(b) || idOf(a) - idOf(b));
  const out: T[] = [];
  for (let k = 0; ; k++) {
    const round = [...groups.values()].map((g) => g[k]).filter((x): x is T => x !== undefined);
    if (!round.length) break;
    round.sort((a, b) => kickoffOf(a) - kickoffOf(b) || eligibilityRank(leagueOf(a)) - eligibilityRank(leagueOf(b)) || idOf(a) - idOf(b));
    out.push(...round);
  }
  return out;
}
