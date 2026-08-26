import { prisma } from "@/lib/prisma";
import { setPredictionCategories } from "@/lib/predictions";
import { leaguePriorityRank } from "@/lib/leagues";
import { deriveMarketAndPick, isValidSelection, type MarketType, type Selection } from "@/lib/markets";
import {
  checkLegCompatibility,
  comboConfidenceCeiling,
  composeComboOutcome,
  type Leg,
  type IncompatibilityReason,
} from "@/lib/sameGameDouble";
import type { Outcome } from "@/lib/enums";

/**
 * Assembles same-game doubles from predictions that already exist.
 *
 * This creates NO analysis. Both legs are rows the pipeline already generated,
 * a human already reviewed, and readers can already see on their own — the
 * double is a second way of presenting two picks, not a third opinion about
 * the match. That is what keeps it honest: there is no separate model output
 * claiming a joint probability, only the two picks and a stated ceiling.
 *
 * The decision rules live in src/lib/sameGameDouble.ts and are pure. This file
 * is the part that talks to the database: which rows are candidates, which
 * pair wins when several qualify, and what gets written.
 */

/** A double is only assembled from legs a human has already approved. */
const LEG_STATUSES = ["APPROVED", "PUBLISHED"] as const;

export type AssemblyRejection = {
  fixture: string;
  reason: IncompatibilityReason | "NO_PAIR" | "ALREADY_EXISTS" | "TOO_FEW_LEGS";
  detail: string;
};

export type AssembledDouble = {
  predictionId: string;
  fixture: string;
  pick: string;
  ceiling: number;
  legIds: [string, string];
};

export type AssemblyResult = {
  created: AssembledDouble[];
  rejected: AssemblyRejection[];
  fixturesConsidered: number;
};

type CandidateLeg = {
  id: string;
  marketType: string;
  selection: unknown;
  confidence: number;
  reasoning: string;
  market: string;
  pick: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: Date | null;
  leagueApiId: number | null;
  leagueName: string | null;
  authorId: string;
  fixtureId: string | null;
};

/**
 * Same identity the odds cache uses: the two team ids plus the UTC day.
 * Prediction carries no fixture id of its own, so this is what "same fixture"
 * has to mean here.
 */
function fixtureKeyOf(row: CandidateLeg): string | null {
  if (row.homeTeamApiId == null || row.awayTeamApiId == null || row.kickoff == null) return null;
  return `${row.homeTeamApiId}-${row.awayTeamApiId}-${row.kickoff.toISOString().slice(0, 10)}`;
}

function legOf(row: CandidateLeg): Leg | null {
  const marketType = row.marketType as MarketType;
  if (!isValidSelection(marketType, row.selection)) return null;
  return { marketType, selection: row.selection as Selection };
}

/**
 * The pick text for a double, e.g. "Lyon or Draw + Under 2.5 Goals".
 *
 * Built from each leg's own derived text rather than from a separate template,
 * so a double can never describe its legs differently from how the leg rows
 * describe themselves.
 */
export function describeDouble(a: CandidateLeg, b: CandidateLeg): { market: string; pick: string } {
  const pickOf = (r: CandidateLeg) =>
    deriveMarketAndPick(r.marketType as MarketType, r.selection as Selection, r.homeTeam, r.awayTeam, {
      market: r.market,
      pick: r.pick,
    }).pick;
  return { market: "Same-Game Double", pick: `${pickOf(a)} + ${pickOf(b)}` };
}

/**
 * The reasoning shown on a double.
 *
 * Both legs' own reasoning, verbatim and attributed, plus a line naming why
 * the two are compatible. Deliberately NOT a newly written summary: a summary
 * would be unattributable prose about a match that no model actually produced,
 * and it could drift from what the leg rows say.
 */
export function describeDoubleReasoning(a: CandidateLeg, b: CandidateLeg): string {
  const aText = deriveMarketAndPick(a.marketType as MarketType, a.selection as Selection, a.homeTeam, a.awayTeam, { market: a.market, pick: a.pick });
  const bText = deriveMarketAndPick(b.marketType as MarketType, b.selection as Selection, b.homeTeam, b.awayTeam, { market: b.market, pick: b.pick });
  return [
    `**Both parts must land for this to win.**`,
    ``,
    `**${aText.pick}** — ${a.confidence}% confidence`,
    a.reasoning,
    ``,
    `**${bText.pick}** — ${b.confidence}% confidence`,
    b.reasoning,
    ``,
    `These two calls are about different parts of the match (${a.market.toLowerCase()} and ${b.market.toLowerCase()}), so neither one determines the other. Confidence shown is the lower of the two — a double can never be more likely than its weaker leg.`,
  ].join("\n");
}

/**
 * Which pair to publish when a fixture offers several valid ones.
 *
 * Highest ceiling first, because the ceiling is the only honest number the
 * double has and picking the pair with the best one is the same rule the rest
 * of the site uses for "lead with the strongest pick". Ties break on league
 * priority and then on id, so the choice is stable across runs — the same
 * jitter-free requirement the display ordering has.
 */
function bestPair<T extends { a: CandidateLeg; b: CandidateLeg; ceiling: number }>(pairs: T[]): T | null {
  if (pairs.length === 0) return null;
  return [...pairs].sort((x, y) =>
    y.ceiling - x.ceiling ||
    leaguePriorityRank(x.a.leagueApiId) - leaguePriorityRank(y.a.leagueApiId) ||
    `${x.a.id}${x.b.id}`.localeCompare(`${y.a.id}${y.b.id}`),
  )[0];
}

/**
 * Assemble the compatible pair emitted by one multi-market generation job.
 *
 * Unlike the editorial backfill assembler below, these legs are deliberately
 * still PENDING_REVIEW. The compound row is also PENDING_REVIEW, so nothing is
 * published or approved by this operation. Source legs remain tagged only as
 * SAME_GAME_DOUBLE internals; the compound row receives the normal generation
 * categories and can later participate in ordinary GENIUS/VIP/PREMIUM
 * curation after a reviewer publishes it.
 */
export async function assembleGeneratedSameGameDouble(
  legIds: string[],
  categories: string[],
): Promise<AssembledDouble | null> {
  const rows = (await prisma.prediction.findMany({
    where: { id: { in: legIds }, status: "PENDING_REVIEW", marketType: { not: "SAME_GAME_DOUBLE" } },
    select: {
      id: true, marketType: true, selection: true, confidence: true, reasoning: true,
      market: true, pick: true, homeTeam: true, awayTeam: true, homeTeamApiId: true,
      awayTeamApiId: true, kickoff: true, leagueApiId: true, leagueName: true,
      authorId: true, fixtureId: true,
    },
  })) as CandidateLeg[];
  if (rows.length < 2) return null;

  const fixtureKey = fixtureKeyOf(rows[0]);
  if (!fixtureKey || rows.some((row) => fixtureKeyOf(row) !== fixtureKey)) return null;

  const viable: Array<{ a: CandidateLeg; b: CandidateLeg; ceiling: number }> = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = legOf(rows[i]);
      const b = legOf(rows[j]);
      if (!a || !b || !checkLegCompatibility(a, b).ok) continue;
      viable.push({ a: rows[i], b: rows[j], ceiling: comboConfidenceCeiling(rows[i].confidence, rows[j].confidence) });
    }
  }
  const winner = bestPair(viable);
  if (!winner) return null;

  const existing = await prisma.prediction.findFirst({
    where: {
      marketType: "SAME_GAME_DOUBLE",
      homeTeamApiId: winner.a.homeTeamApiId,
      awayTeamApiId: winner.a.awayTeamApiId,
      kickoff: winner.a.kickoff,
    },
    select: { id: true },
  });
  if (existing) return null;

  const { a, b } = winner;
  const { market, pick } = describeDouble(a, b);
  const pairIds: [string, string] = [a.id, b.id];
  const normalCategories = categories.filter((category) => category !== "SAME_GAME_DOUBLE");
  if (normalCategories.length === 0) normalCategories.push("FEATURED");
  const row = await prisma.prediction.create({
    data: {
      fixtureId: a.fixtureId,
      category: normalCategories[0],
      leagueApiId: a.leagueApiId,
      leagueName: a.leagueName,
      homeTeam: a.homeTeam,
      awayTeam: a.awayTeam,
      homeTeamApiId: a.homeTeamApiId,
      awayTeamApiId: a.awayTeamApiId,
      kickoff: a.kickoff,
      status: "PENDING_REVIEW",
      marketType: "SAME_GAME_DOUBLE",
      selection: { legIds: pairIds },
      manualSettlementOnly: false,
      market,
      pick,
      confidence: winner.ceiling,
      reasoning: describeDoubleReasoning(a, b),
      contextComplete: true,
      authorId: a.authorId,
    },
  });
  await setPredictionCategories(row.id, [...normalCategories, "SAME_GAME_DOUBLE"]);
  return { predictionId: row.id, fixture: `${a.homeTeam} v ${a.awayTeam}`, pick, ceiling: winner.ceiling, legIds: pairIds };
}

/**
 * Assembles at most one double per fixture.
 *
 * One, not all valid pairs: a fixture with three markets offers three pairs,
 * and publishing all of them would put the same match in the feed three times
 * over with heavily overlapping content. The best pair is the pick.
 */
export async function assembleSameGameDoubles(
  // `now` is injected rather than read from the clock, matching the convention
  // every scheduled selector in this codebase already follows (see
  // src/lib/betOfTheDay.ts). It is what lets a dry run exercise this against
  // real historical rows instead of only against whatever happens to be
  // upcoming at the moment the check is run.
  options: { limit?: number; dryRun?: boolean; now?: Date } = {},
): Promise<AssemblyResult> {
  const limit = options.limit ?? 5;
  const now = options.now ?? new Date();

  const rows = (await prisma.prediction.findMany({
    where: {
      status: { in: [...LEG_STATUSES] },
      manualSettlementOnly: false,
      // A double is a pick about an upcoming match; assembling one from legs
      // that have already kicked off would publish a pick nobody can act on.
      kickoff: { gt: now },
      homeTeamApiId: { not: null },
      awayTeamApiId: { not: null },
      // Never build a double out of doubles.
      marketType: { not: "SAME_GAME_DOUBLE" },
    },
    select: {
      id: true, marketType: true, selection: true, confidence: true, reasoning: true,
      market: true, pick: true, homeTeam: true, awayTeam: true, homeTeamApiId: true,
      awayTeamApiId: true, kickoff: true, leagueApiId: true, leagueName: true,
      authorId: true, fixtureId: true,
    },
  })) as CandidateLeg[];

  // Fixtures that already carry a double, so a second run is a no-op rather
  // than a duplicate. Keyed the same way as the candidates.
  const existing = (await prisma.prediction.findMany({
    where: { marketType: "SAME_GAME_DOUBLE" },
    select: {
      id: true, marketType: true, selection: true, confidence: true, reasoning: true,
      market: true, pick: true, homeTeam: true, awayTeam: true, homeTeamApiId: true,
      awayTeamApiId: true, kickoff: true, leagueApiId: true, leagueName: true,
      authorId: true, fixtureId: true,
    },
  })) as CandidateLeg[];
  const alreadyDoubled = new Set(existing.map(fixtureKeyOf).filter((k): k is string => k !== null));

  const groups = new Map<string, CandidateLeg[]>();
  for (const row of rows) {
    const key = fixtureKeyOf(row);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const created: AssembledDouble[] = [];
  const rejected: AssemblyRejection[] = [];
  let fixturesConsidered = 0;

  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    fixturesConsidered++;
    const fixture = `${group[0].homeTeam} v ${group[0].awayTeam}`;

    if (alreadyDoubled.has(key)) {
      rejected.push({ fixture, reason: "ALREADY_EXISTS", detail: "this fixture already has a double" });
      continue;
    }

    const viable: Array<{ a: CandidateLeg; b: CandidateLeg; ceiling: number }> = [];
    const reasons: AssemblyRejection[] = [];

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const legA = legOf(group[i]);
        const legB = legOf(group[j]);
        if (!legA || !legB) continue;
        const verdict = checkLegCompatibility(legA, legB);
        if (!verdict.ok) {
          reasons.push({ fixture, reason: verdict.reason, detail: verdict.detail });
          continue;
        }
        viable.push({ a: group[i], b: group[j], ceiling: comboConfidenceCeiling(group[i].confidence, group[j].confidence) });
      }
    }

    const winner = bestPair(viable);
    if (!winner) {
      // Report why nothing qualified, rather than a bare "no pair" — the
      // reasons are the whole point of having a compatibility table.
      rejected.push(...reasons);
      if (reasons.length === 0) rejected.push({ fixture, reason: "NO_PAIR", detail: "no valid leg selections" });
      continue;
    }

    if (created.length >= limit) break;

    const { a, b } = winner;
    const { market, pick } = describeDouble(a, b);
    const legIds: [string, string] = [a.id, b.id];

    if (options.dryRun) {
      created.push({ predictionId: "(dry-run)", fixture, pick, ceiling: winner.ceiling, legIds });
      continue;
    }

    // PENDING_REVIEW, not PUBLISHED: a double is a new editorial object even
    // though its legs were approved, and it goes through the same queue as
    // anything else that appears on the site.
    const row = await prisma.prediction.create({
      data: {
        fixtureId: a.fixtureId,
        category: "SAME_GAME_DOUBLE",
        leagueApiId: a.leagueApiId,
        leagueName: a.leagueName,
        homeTeam: a.homeTeam,
        awayTeam: a.awayTeam,
        homeTeamApiId: a.homeTeamApiId,
        awayTeamApiId: a.awayTeamApiId,
        kickoff: a.kickoff,
        status: "PENDING_REVIEW",
        marketType: "SAME_GAME_DOUBLE",
        selection: { legIds },
        manualSettlementOnly: false,
        market,
        pick,
        // A double makes no separate total-goals call. Its legs may, and those
        // rows still carry their own.
        ouLine: null,
        ouDirection: null,
        overUnder: null,
        odds: null,
        // The CEILING, not a joint estimate. See comboConfidenceCeiling.
        confidence: winner.ceiling,
        reasoning: describeDoubleReasoning(a, b),
        contextComplete: true,
        authorId: a.authorId,
      },
    });
    await setPredictionCategories(row.id, ["SAME_GAME_DOUBLE"]);

    created.push({ predictionId: row.id, fixture, pick, ceiling: winner.ceiling, legIds });
  }

  return { created, rejected, fixturesConsidered };
}

/**
 * Loads the two leg rows behind a double.
 *
 * Returns null if either is missing — a double whose legs cannot be read must
 * not be settled or rendered from partial data.
 */
export async function loadDoubleLegs(selection: unknown) {
  if (!isValidSelection("SAME_GAME_DOUBLE", selection)) return null;
  const { legIds } = selection as { legIds: [string, string] };
  const legs = await prisma.prediction.findMany({
    where: { id: { in: legIds } },
    select: {
      id: true, marketType: true, selection: true, confidence: true, outcome: true,
      market: true, pick: true, reasoning: true, homeTeam: true, awayTeam: true,
    },
  });
  if (legs.length !== 2) return null;
  // Preserve the stored order so the double reads the same way every time.
  const byId = new Map(legs.map((l) => [l.id, l]));
  const a = byId.get(legIds[0]);
  const b = byId.get(legIds[1]);
  return a && b ? ([a, b] as const) : null;
}

/**
 * Internal single-market rows referenced by doubles a reviewer has published.
 * They remain hidden from public feeds, but settlement must resolve them even
 * when the reviewer publishes only the compound row.
 */
export async function publishedDoubleLegIds(): Promise<string[]> {
  const doubles = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", outcome: "PENDING", marketType: "SAME_GAME_DOUBLE" },
    select: { selection: true },
  });
  return [...new Set(doubles.flatMap((row) => {
    if (!isValidSelection("SAME_GAME_DOUBLE", row.selection)) return [];
    return (row.selection as { legIds: [string, string] }).legIds;
  }))];
}

export type DoubleSettlementResult = {
  id: string;
  match: string;
  result: Outcome | "legs_pending" | "manual_required";
  detail?: string;
};

/**
 * Settles published doubles from their legs' outcomes.
 *
 * Lives here rather than inline in the settle route so it can be dry-run
 * against real rows. The route is authenticated, makes live api-football
 * calls and writes settlement for every pending prediction — not something a
 * verification script can invoke to check one behaviour.
 *
 * Makes NO external calls: everything it needs is already in the database by
 * the time it runs. That is why the route can afford to run it on every pass.
 *
 * MUST run after the per-market settlement loop, not alongside it: a double's
 * legs may have been settled seconds earlier in the same request, and a single
 * pass would leave every double a full cron cycle behind its own legs.
 */
export async function settleSameGameDoubles(options: { dryRun?: boolean } = {}): Promise<DoubleSettlementResult[]> {
  const doubles = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      outcome: "PENDING",
      manualSettlementOnly: false,
      marketType: "SAME_GAME_DOUBLE",
    },
    select: { id: true, selection: true, homeTeam: true, awayTeam: true },
  });

  const results: DoubleSettlementResult[] = [];

  for (const d of doubles) {
    const match = `${d.homeTeam} vs ${d.awayTeam}`;

    if (!isValidSelection("SAME_GAME_DOUBLE", d.selection)) {
      if (!options.dryRun) {
        await prisma.prediction.update({
          where: { id: d.id },
          data: { manualSettlementOnly: true, settlementNote: "Malformed double — leg references are unreadable." },
        });
      }
      results.push({ id: d.id, match, result: "manual_required", detail: "malformed legIds" });
      continue;
    }

    const { legIds } = d.selection as unknown as { legIds: [string, string] };
    const legs = await prisma.prediction.findMany({
      where: { id: { in: legIds } },
      select: { id: true, outcome: true },
    });

    // A double whose legs have been deleted can be neither resolved nor safely
    // guessed at, so it goes to a human rather than retrying forever.
    if (legs.length !== 2) {
      if (!options.dryRun) {
        await prisma.prediction.update({
          where: { id: d.id },
          data: { manualSettlementOnly: true, settlementNote: "Manual settlement required — a leg of this double no longer exists." },
        });
      }
      results.push({ id: d.id, match, result: "manual_required", detail: `${legs.length} of 2 legs found` });
      continue;
    }

    const outcome = composeComboOutcome(legs[0].outcome as Outcome, legs[1].outcome as Outcome);

    // null means at least one leg is still pending. Nothing is written; the
    // double is simply picked up again on the next run.
    if (!outcome) {
      results.push({ id: d.id, match, result: "legs_pending", detail: legs.map((l) => l.outcome).join("/") });
      continue;
    }

    if (!options.dryRun) {
      await prisma.prediction.update({
        where: { id: d.id },
        data: { outcome, settledAt: new Date(), settlementNote: null },
      });
    }
    results.push({ id: d.id, match, result: outcome, detail: legs.map((l) => l.outcome).join("/") });
  }

  return results;
}
