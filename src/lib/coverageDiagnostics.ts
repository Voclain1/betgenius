import { prisma } from "@/lib/prisma";
import { JOB_GENERATION_DISCOVERY } from "@/lib/jobRuns";
import { MIN_BOOKMAKERS } from "@/lib/odds";
import { LEAGUE_CATALOGUE, generationTierOf } from "@/lib/leagues";
import { PAID_ANY_LEAGUE_IDS } from "@/lib/vipPremiumOverlay";
import { JOB_PAID_SELECTION_SHADOW } from "@/lib/vipPremiumPipeline";
import { auditCoverageFunnel, type CoverageFunnel } from "@/lib/generation/coverageFunnel";
import { COMPETITION_REGISTRY, PROPOSED_RULES, coverageRollout, globalAuditRow, laneCompetitionIds, registryEntry, type CoverageRollout } from "@/lib/generation/competitionEligibility";
import { GLOBAL_AUDIT } from "@/lib/generation/globalCompetitionEvidence";

/**
 * League-coverage and candidate-quality diagnostics for /admin/paid-ops.
 * READ-ONLY and bounded: a fixed kickoff window, `take` limits on every read,
 * and the odds read keyed by the window's ledger rows only.
 */
export type DiscoveryTally = {
  runs: number;
  modes: Record<string, number>;
  sweeps: number;
  skipped: Record<string, number>;
  rejectedByLeague: Record<number, Record<string, number>>;
  shadowSweeps: number;
  shadowAdded: Record<number, number>;
  shadowLifted: Record<number, Record<string, number>>;
  /** Evaluation lane (healthy days): runs, shortlist appearances per competition, fixtures queued. */
  laneRuns: number;
  laneShortlisted: Record<number, number>;
  laneQueued: number;
};

export type CompetitionExplanation = { leagueApiId: number; name: string; lines: string[] };

export type CoverageDiagnostics = {
  days: number;
  rollout: CoverageRollout;
  funnel: CoverageFunnel;
  discovery: DiscoveryTally;
  quality: { runs: number; decisions: Record<string, number>; proposedTiers: Record<string, number>; liveSelectedRejected: number };
  /** Shadow quality decisions per competition (last 24h), for the explorer. */
  qualityByLeague: Record<number, LeagueQuality>;
  wales: CompetitionExplanation[];
};

export type LeagueQuality = { candidates: number; decisions: Record<string, number>; liveSelected: number };

export type ExplorerAnswer = { question: string; answer: string };
export type CompetitionExplorer = { leagueApiId: number; name: string; answers: ExplorerAnswer[] };

/**
 * Pure: the reusable competition coverage explorer. Answers the eight
 * questions for ANY competition id, from configuration, the stored provider
 * audit, the measured funnel, discovery records and the shadow quality log.
 * Every answer states its source; nothing is inferred beyond the records.
 */
export function exploreCompetition(
  leagueApiId: number,
  d: Pick<CoverageDiagnostics, "funnel" | "discovery" | "qualityByLeague" | "rollout">,
): CompetitionExplorer {
  const cat = LEAGUE_CATALOGUE.find((l) => l.id === leagueApiId);
  const reg = registryEntry(leagueApiId);
  const audit = globalAuditRow(leagueApiId);
  const name = cat ? `${cat.name} (${cat.country})` : reg ? `${reg.name} (${reg.country})` : audit ? `${audit.name} (${audit.country})` : `league ${leagueApiId}`;
  const tier = generationTierOf(leagueApiId);
  const proposedTier = PROPOSED_RULES.tierOf(leagueApiId);
  const row = d.funnel.leagues.find((l) => l.leagueApiId === leagueApiId);
  const rej = d.discovery.rejectedByLeague[leagueApiId];
  const q = d.qualityByLeague[leagueApiId];
  const inLane = laneCompetitionIds().includes(leagueApiId);
  const fmt = (o: Record<string, number> | undefined) => (o && Object.keys(o).length ? Object.entries(o).map(([k, n]) => `${k} ${n}`).join(", ") : "none recorded");
  const answers: ExplorerAnswer[] = [];

  answers.push({ question: "Was the fixture available from API-Football?", answer: audit
    ? `Global audit (${GLOBAL_AUDIT.asOf}): season ${audit.season ?? "none"}${audit.current ? " (current)" : ""}, ${audit.upcoming} fixtures in the next 3 days, ${audit.finished} finished in the previous 7 (${audit.finishedWithScore} with a score), provider odds coverage ${audit.coverage.odds ? "on" : "off"}, sampled bookmakers ${audit.sampledBookmakers.join(", ") || "not sampled"}.`
    : reg ? `Registry evidence (${reg.evidence.checkedAt}): season ${reg.evidence.season}, odds coverage ${reg.evidence.oddsCoverage ? "on" : "off"}, sampled bookmakers ${reg.evidence.sampledBookmakers.join(", ") || "none"}.`
    : cat ? "Catalogued competition: discovery fetches its fixtures directly (cursor) or in the by-date sweep." : "No provider evidence is recorded for this id. Re-run scripts/research-global-competitions.ts to audit it." });

  answers.push({ question: "Was the league excluded or outside the active tier?", answer: tier
    ? `Catalogue tier ${tier}. ${tier === "DEEP_FALLBACK" ? `Scanned only when CORE+SECONDARY is very thin: ${d.discovery.modes.DEEP_FALLBACK ?? 0} of the last ${d.discovery.runs} discovery runs.` : tier === "FALLBACK" ? `Scanned only when the slate is thin: ${(d.discovery.modes.FALLBACK ?? 0) + (d.discovery.modes.DEEP_FALLBACK ?? 0)} of the last ${d.discovery.runs} runs.` : "Scanned every cycle."}`
    : proposedTier ? `Not in the catalogue, so the current rules refuse it (unrecognised_competition). The proposed rules give it ${proposedTier}${inLane ? " and the healthy-day evaluation lane" : ""}, active only with COVERAGE_ROLLOUT=on (now ${d.rollout}).`
    : audit ? `Not in the catalogue and excluded by the global audit: ${audit.decision} (${audit.reasons.join(", ")}).` : "Not in the catalogue; no eligibility decision exists for it." });

  answers.push({ question: "Was a fixture evaluated?", answer: row
    ? `${row.discovered} discovered into the ledger, ${row.succeeded} generated, ${row.failed + row.abandoned} failed, ${row.published} published.${d.discovery.laneShortlisted[leagueApiId] ? ` The evaluation lane shortlisted it in ${d.discovery.laneShortlisted[leagueApiId]} of ${d.discovery.laneRuns} lane runs.` : ""}`
    : `No ledger row or prediction in the window.${d.discovery.laneShortlisted[leagueApiId] ? ` The evaluation lane shortlisted it in ${d.discovery.laneShortlisted[leagueApiId]} of ${d.discovery.laneRuns} lane runs.` : ""}` });

  const missing = audit?.reasons.filter((r) => r !== "MEETS_ALL_CRITERIA") ?? [];
  answers.push({ question: "What evidence was missing?", answer: missing.length ? missing.join(", ") : audit ? "None: it meets every audit criterion." : reg ? reg.reason : "Not audited." });

  answers.push({ question: "Why was a candidate rejected?", answer: `Fallback gate: ${fmt(rej)}. Candidate quality (shadow, 24h): ${q ? fmt(q.decisions) : "no candidates"}.` });

  answers.push({ question: "Did the existing policy select it?", answer: row
    ? `${row.vip} VIP / ${row.premium} Premium picks in the window.${PAID_ANY_LEAGUE_IDS.includes(leagueApiId) ? "" : " Outside the VIP/Premium competition scope, so it cannot be selected for a paid feed."}`
    : PAID_ANY_LEAGUE_IDS.includes(leagueApiId) ? "In paid scope; no picks in the window." : "No: outside the VIP/Premium competition scope." });

  const lifted = d.discovery.shadowLifted[leagueApiId];
  answers.push({ question: "What would the proposed policy have done?", answer: [
    lifted || d.discovery.shadowAdded[leagueApiId] ? `Discovery: in recorded shadow sweeps it would have lifted ${fmt(lifted)} and queued it in ${d.discovery.shadowAdded[leagueApiId] ?? 0}.` : "Discovery: no shadow sweep changed its outcome.",
    q ? `Quality layer: ${q.decisions.QUALIFIED ?? 0} of ${q.candidates} candidates qualified (shadow only; the policy failed validation and cannot activate).` : "Quality layer: no candidates from it.",
  ].join(" ") });
  return { leagueApiId, name, answers };
}

const DAY = 86_400_000;

/** Pure: tally discovery JobRun details. */
export function tallyDiscovery(details: ReadonlyArray<unknown>): DiscoveryTally {
  const t: DiscoveryTally = { runs: 0, modes: {}, sweeps: 0, skipped: {}, rejectedByLeague: {}, shadowSweeps: 0, shadowAdded: {}, shadowLifted: {}, laneRuns: 0, laneShortlisted: {}, laneQueued: 0 };
  for (const d of details) {
    const c = (d as any)?.coverage;
    if (!c) continue;
    t.runs++;
    t.modes[c.mode] = (t.modes[c.mode] ?? 0) + 1;
    const s = c.sweep ?? {};
    if (s.ran) t.sweeps++;
    else if (c.widened && s.skippedReason) {
      const k = String(s.skippedReason).replace(/\d+/g, "N");
      t.skipped[k] = (t.skipped[k] ?? 0) + 1;
    }
    for (const [id, reasons] of Object.entries(s.gateRejectedByLeague ?? {})) {
      const into = (t.rejectedByLeague[Number(id)] ??= {});
      for (const [k, n] of Object.entries(reasons as Record<string, number>)) into[k] = (into[k] ?? 0) + Number(n);
    }
    const lane = c.lane;
    if (lane?.ran) {
      t.laneRuns++;
      t.laneQueued += Number(lane.queued) || 0;
      for (const x of lane.shortlist ?? []) if (x?.leagueApiId != null) t.laneShortlisted[Number(x.leagueApiId)] = (t.laneShortlisted[Number(x.leagueApiId)] ?? 0) + 1;
    }
    if (s.shadow) {
      t.shadowSweeps++;
      for (const id of s.shadow.addedCompetitions ?? []) t.shadowAdded[Number(id)] = (t.shadowAdded[Number(id)] ?? 0) + 1;
      for (const [id, reasons] of Object.entries(s.shadow.liftedRejections ?? {})) {
        const into = (t.shadowLifted[Number(id)] ??= {});
        for (const [k, n] of Object.entries(reasons as Record<string, number>)) into[k] = (into[k] ?? 0) + Number(n);
      }
    }
  }
  return t;
}

/**
 * Pure: plain-language answer to "why did BetGenius not cover this
 * competition?", from configuration and the measured funnel. Each line is a
 * fact with its source; nothing is inferred beyond what the rows show.
 */
export function explainCompetition(leagueApiId: number, funnel: CoverageFunnel, discovery: DiscoveryTally, rollout: CoverageRollout): CompetitionExplanation {
  const cat = LEAGUE_CATALOGUE.find((l) => l.id === leagueApiId);
  const reg = registryEntry(leagueApiId);
  const name = cat ? `${cat.name} (${cat.country})` : reg ? `${reg.name} (${reg.country})` : `league ${leagueApiId}`;
  const tier = generationTierOf(leagueApiId);
  const row = funnel.leagues.find((l) => l.leagueApiId === leagueApiId);
  const lines: string[] = [];
  if (!tier) lines.push("Not in the league catalogue: discovery refuses its fixtures as unrecognised_competition.");
  else if (tier === "DEEP_FALLBACK") {
    const deep = discovery.modes.DEEP_FALLBACK ?? 0;
    lines.push(`Generation tier DEEP_FALLBACK: scanned only when fewer than 12 CORE+SECONDARY fixtures are in the next 48h, and filled only after FALLBACK. ${deep} of the last ${discovery.runs} discovery runs reached that mode.`);
  } else if (tier === "FALLBACK") lines.push("Generation tier FALLBACK: scanned only when the CORE+SECONDARY slate is thin (under 25 fixtures in 48h).");
  else lines.push(`Generation tier ${tier}: scanned by the discovery cursor every cycle.`);
  const rej = discovery.rejectedByLeague[leagueApiId];
  if (rej && Object.keys(rej).length) lines.push(`Fallback gate rejections in recorded sweeps: ${Object.entries(rej).map(([k, n]) => `${k} ${n}`).join(", ")}.`);
  lines.push(row
    ? `Funnel: ${row.discovered} discovered, ${row.succeeded} generated, ${row.published} fixtures published, ${row.vip} VIP / ${row.premium} Premium picks.`
    : "Funnel: no ledger row and no prediction in the window.");
  if (!PAID_ANY_LEAGUE_IDS.includes(leagueApiId)) lines.push("Outside the VIP/Premium competition scope, so no pick from it can enter a paid feed.");
  if (reg) {
    const act = reg.proposal.action;
    lines.push(`Registry (checked ${reg.evidence.checkedAt}): ${act}. ${reg.reason}${act === "ADD" || act === "CUP_ODDS_SUPPORTED" ? ` Takes effect only with COVERAGE_ROLLOUT=on (now ${rollout}).` : ""}`);
  }
  if (discovery.shadowSweeps) {
    const lifted = discovery.shadowLifted[leagueApiId];
    const added = discovery.shadowAdded[leagueApiId] ?? 0;
    if (lifted || added) lines.push(`Shadow: in ${discovery.shadowSweeps} recorded sweeps the proposed rules would have lifted ${lifted ? Object.entries(lifted).map(([k, n]) => `${k} ${n}`).join(", ") : "no rejections"} and queued it in ${added}.`);
  }
  return { leagueApiId, name, lines };
}

export const WELSH_COMPETITION_IDS: readonly number[] = [
  ...new Set([...LEAGUE_CATALOGUE.filter((l) => l.country === "Wales").map((l) => l.id), ...COMPETITION_REGISTRY.filter((e) => e.country === "Wales" && e.proposal.action !== "EXCLUDED").map((e) => e.id)]),
];

export async function loadCoverageDiagnostics(days = 14, now: Date = new Date()): Promise<CoverageDiagnostics> {
  const from = new Date(now.getTime() - days * DAY);
  const to = new Date(now.getTime() + 2 * DAY);
  const [ledger, preds, runs, shadow] = await Promise.all([
    prisma.generationAttempt.findMany({ where: { kickoff: { gte: from, lt: to } }, select: { matchKey: true, leagueApiId: true, leagueName: true, kickoff: true, status: true, attempts: true }, take: 20_000 }),
    prisma.prediction.findMany({
      where: { kickoff: { gte: from, lt: to }, status: { in: ["PUBLISHED", "PENDING_REVIEW"] } },
      select: { leagueApiId: true, leagueName: true, kickoff: true, status: true, homeTeamApiId: true, awayTeamApiId: true, categories: { select: { category: true } } },
      take: 20_000,
    }),
    prisma.jobRun.findMany({ where: { job: JOB_GENERATION_DISCOVERY, ranAt: { gte: new Date(now.getTime() - Math.min(days, 7) * DAY) } }, select: { detail: true }, orderBy: { ranAt: "desc" }, take: 700 }),
    prisma.jobRun.findMany({ where: { job: JOB_PAID_SELECTION_SHADOW, ranAt: { gte: new Date(now.getTime() - DAY) } }, select: { detail: true }, take: 200 }),
  ]);
  const keys = [...new Set(ledger.map((l) => l.matchKey))].slice(0, 20_000);
  const odds = [] as Array<{ matchKey: string; bookmakerCount: number | null; fetchedAt: Date | null }>;
  for (let i = 0; i < keys.length; i += 2000) {
    odds.push(...(await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 2000) } }, select: { matchKey: true, bookmakerCount: true, fetchedAt: true } })));
  }
  const funnel = auditCoverageFunnel({ ledger, predictions: preds.map((p) => ({ ...p, categories: p.categories.map((c) => c.category) })), odds, now, minBookmakers: MIN_BOOKMAKERS });
  const discovery = tallyDiscovery(runs.map((r) => r.detail));
  const quality = { runs: 0, decisions: {} as Record<string, number>, proposedTiers: {} as Record<string, number>, liveSelectedRejected: 0 };
  for (const s of shadow) {
    const q = (s.detail as any)?.quality;
    if (!q || typeof q !== "object" || !q.decisions) continue;
    quality.runs++;
    quality.liveSelectedRejected += Number(q.liveSelectedRejected) || 0;
    for (const [k, n] of Object.entries(q.decisions as Record<string, number>)) quality.decisions[k] = (quality.decisions[k] ?? 0) + Number(n);
    for (const [k, n] of Object.entries((q.proposedTiers ?? {}) as Record<string, number>)) quality.proposedTiers[k] = (quality.proposedTiers[k] ?? 0) + Number(n);
  }
  const qualityByLeague: Record<number, LeagueQuality> = {};
  for (const sRun of shadow) {
    for (const v of ((sRun.detail as any)?.quality?.verdicts ?? []) as Array<{ leagueApiId?: number | null; decision?: string; liveSelected?: boolean }>) {
      if (v?.leagueApiId == null || typeof v.decision !== "string") continue;
      const lq = (qualityByLeague[v.leagueApiId] ??= { candidates: 0, decisions: {}, liveSelected: 0 });
      lq.candidates++;
      lq.decisions[v.decision] = (lq.decisions[v.decision] ?? 0) + 1;
      if (v.liveSelected) lq.liveSelected++;
    }
  }
  const rollout = coverageRollout();
  return { days, rollout, funnel, discovery, quality, qualityByLeague, wales: WELSH_COMPETITION_IDS.map((id) => explainCompetition(id, funnel, discovery, rollout)) };
}
