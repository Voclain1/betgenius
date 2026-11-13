import { prisma } from "@/lib/prisma";
import { JOB_GENERATION_DISCOVERY } from "@/lib/jobRuns";
import { MIN_BOOKMAKERS } from "@/lib/odds";
import { LEAGUE_CATALOGUE, generationTierOf } from "@/lib/leagues";
import { PAID_ANY_LEAGUE_IDS } from "@/lib/vipPremiumOverlay";
import { JOB_PAID_SELECTION_SHADOW } from "@/lib/vipPremiumPipeline";
import { auditCoverageFunnel, type CoverageFunnel } from "@/lib/generation/coverageFunnel";
import { COMPETITION_REGISTRY, coverageRollout, registryEntry, type CoverageRollout } from "@/lib/generation/competitionEligibility";

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
};

export type CompetitionExplanation = { leagueApiId: number; name: string; lines: string[] };

export type CoverageDiagnostics = {
  days: number;
  rollout: CoverageRollout;
  funnel: CoverageFunnel;
  discovery: DiscoveryTally;
  quality: { runs: number; decisions: Record<string, number>; proposedTiers: Record<string, number>; liveSelectedRejected: number };
  wales: CompetitionExplanation[];
};

const DAY = 86_400_000;

/** Pure: tally discovery JobRun details. */
export function tallyDiscovery(details: ReadonlyArray<unknown>): DiscoveryTally {
  const t: DiscoveryTally = { runs: 0, modes: {}, sweeps: 0, skipped: {}, rejectedByLeague: {}, shadowSweeps: 0, shadowAdded: {}, shadowLifted: {} };
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
  const rollout = coverageRollout();
  return { days, rollout, funnel, discovery, quality, wales: WELSH_COMPETITION_IDS.map((id) => explainCompetition(id, funnel, discovery, rollout)) };
}
