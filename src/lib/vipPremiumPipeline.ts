import { prisma } from "@/lib/prisma";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { applyReviewAction, setPredictionCategories } from "@/lib/predictions";
import type { FixtureOdds } from "@/lib/odds";
import type { Selection } from "@/lib/markets";
import { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS } from "@/lib/generation/window";
import {
  evaluateMarketConfirmed,
  compareMarketConfirmed,
  type MarketConfirmedVerdict,
} from "@/lib/marketConfirmed";
import {
  DEDICATED_PAID_PROVENANCES,
  PAID_TIER_CATEGORIES,
  PREMIUM_GENERATED_PROVENANCE,
  VIP_GENERATED_PROVENANCE,
  isLegacyPaidTierDay,
  paidFixtureKey,
} from "@/lib/geniusCuration";
import {
  RETRYABLE_GATE_REASONS,
  VIP_PREMIUM_BACKOFF_LOCK_PREFIX,
  VIP_PREMIUM_INTENT,
  VIP_PREMIUM_RETRY_BACKOFF_MS,
  paidAutoPublishVerdict,
  paidPublishFixture,
  paidTierFor,
  planVipPremiumCandidates,
  qualifyVipPremiumTargets,
  readVipPremiumAttempt,
  vipPremiumOddsToWarm,
  type OddsSkipReason,
  type OverlayAttempt,
  type OverlayQuote,
  type OverlaySkipReason,
  type PaidPublishBlock,
  type PaidTier,
  type VipPremiumTarget,
} from "@/lib/vipPremiumOverlay";

export {
  VIP_PREMIUM_INTENT,
  VIP_MARKET_FLOOR,
  PREMIUM_MARKET_FLOOR,
  VIP_PREMIUM_ODDS_WARM_LIMIT,
  VIP_PREMIUM_RUN_LIMIT,
  type PaidTier,
  type VipPremiumTarget,
} from "@/lib/vipPremiumOverlay";

/**
 * The dedicated VIP/PREMIUM pass: market-first targeting, one generation, two
 * bars — database side. The rules are in src/lib/vipPremiumOverlay.ts.
 *
 * WHAT IT REPLACED, AND WHY. marketConfirmedPipeline.ts was already a
 * dedicated VIP/PREMIUM pass, and it was measured rather than assumed to be
 * broken: 82 jobs on 22 days, 168 drafts, 3 promotions (1.8%). Not one draft
 * had a fresh quote when the gate read it, and 60.7% fell below the model floor
 * because it took whatever ordinary discovery offered. This pass inverts both:
 * a fixture is generated for BECAUSE the market already prices it into
 * qualifying territory, so a fresh quote exists by construction.
 *
 * WHAT CHANGED SINCE (2026-09). It targeted PENDING ledger rows and so had to
 * beat ordinary generation to each fixture. It never did: 0 model calls in 871
 * scheduled runs over 19–28 Sep. It is now an OVERLAY on fixtures ordinary generation has
 * already covered, like the Goals pass — see the note at the top of
 * vipPremiumOverlay.ts. It reads the GenerationAttempt ledger but NEVER writes
 * it; its attempt record is the VIP_PREMIUM-intent AIJob, plus an AppLock
 * backoff when a run throws before one is written.
 *
 * WHAT IT DOES NOT DO — deliberately. It does not use a different prompt. The
 * original tier-keyed calibration told VIP/PREMIUM to be "more safer", and on
 * fixtures the book made the favourite 65%+, VIP-tier drafts took the straight
 * winner 35.7% of the time against GENIUS-tier's 72.7% (see the note on
 * tieredCalibrationBlock in ai/analysis.ts). A stricter paid-tier prompt
 * produces over-hedging, and hedges are where this gate fails. The market mix
 * corrects itself through candidate selection instead: margin calibration
 * already routes a lopsided fixture to MATCH_WINNER, and targeting selects
 * lopsided fixtures.
 *
 * ADDITIVE. Ordinary curation keeps filling VIP and PREMIUM, above their floors
 * only. A day on which nothing qualifies is a normal day, not a failure.
 */

/**
 * Dedicated generation attempts per day.
 *
 * Counted as ATTEMPTS, not survivors: a draft that then fails the gate has
 * still spent api-football budget, a model call and real money, and counting
 * only successes would let a bad day retry without limit.
 *
 * 6 is sized against the measured candidate supply, not chosen for feel. Over
 * 31 days there were ~6.4 paid-tier-eligible fixtures a day; modelled yield at
 * the VIP bar is 1.65 picks/day and at the PREMIUM bar 1.00/day. The recorded
 * attempt-to-promotion ratio is what should revise it — see
 * scripts/verify-vip-premium-pass.ts.
 */
export const VIP_PREMIUM_DAILY_QUOTA = 6;

/**
 * NOT tightened, on purpose. Agreement is non-monotonic against outcome in the
 * measured data — 0-5pp strikes 72.1% (n=43) while 5-10pp strikes 88.0%
 * (n=25) — so the gap is not the discriminator and narrowing it would trade
 * yield for noise. MC_MAX_GAP_PP stays where it is; this constant exists only
 * to make that decision legible rather than accidental.
 */
export const VIP_PREMIUM_MAX_GAP_PP_UNCHANGED = true;

function intentOf(promptJson: string): string | null {
  try {
    return JSON.parse(promptJson)?.intent ?? null;
  } catch {
    return null;
  }
}

export async function vipPremiumGeneratedToday(now: Date = new Date()): Promise<number> {
  const { start, end } = lagosTodayBounds(now);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { prompt: true },
  });
  return jobs.filter((j) => intentOf(j.prompt) === VIP_PREMIUM_INTENT).length;
}

/**
 * Remaining quota for a KNOWN count, and whether that count exhausts the day.
 *
 * Pure, and separated from the counting query on purpose: the quota rule is
 * fixed arithmetic that must hold for every input, while "how many did we
 * generate today" is whatever production happens to have done since midnight
 * in Lagos. Both call sites go through these, so the stand-down decision is the
 * same comparison everywhere.
 */
export function vipPremiumQuotaFrom(generatedToday: number): number {
  return Math.max(0, VIP_PREMIUM_DAILY_QUOTA - generatedToday);
}

export function vipPremiumQuotaExhausted(generatedToday: number): boolean {
  return vipPremiumQuotaFrom(generatedToday) <= 0;
}

export async function vipPremiumQuotaRemaining(now: Date = new Date()): Promise<number> {
  return vipPremiumQuotaFrom(await vipPremiumGeneratedToday(now));
}

// ── Targeting ────────────────────────────────────────────────────────────────

/** Far enough back to cover every fixture the 48h window can still reach. */
const ATTEMPT_LOOKBACK_MS = 4 * 24 * 3_600_000;

/** VIP_PREMIUM-intent AIJobs in the lookback — the pass's attempt record. */
export async function loadVipPremiumAttempts(now: Date = new Date()): Promise<OverlayAttempt[]> {
  const jobs = await prisma.aIJob.findMany({
    // Narrowed in SQL on the literal JSON.stringify writes; readVipPremiumAttempt
    // then parses properly, so a false match costs nothing but a parse.
    where: { createdAt: { gte: new Date(now.getTime() - ATTEMPT_LOOKBACK_MS) }, prompt: { contains: `"intent":"${VIP_PREMIUM_INTENT}"` } },
    select: { prompt: true, createdAt: true },
  });
  return jobs.map((j) => readVipPremiumAttempt(j.prompt, j.createdAt)).filter((a): a is OverlayAttempt => a !== null);
}

export type TargetSelection = {
  targets: VipPremiumTarget[];
  /** Covered (ledger SUCCEEDED) fixtures inside the paid-generation window. */
  considered: number;
  /** ...of which pass every pre-odds rule: paid scope, live context, no dedicated pick, not yet attempted. */
  inScope: number;
  /** ...of which carry a quote fresh enough for the gate to read. */
  freshlyPriced: number;
  /** ...of which the market already prices at or above the VIP bar, at enough books. */
  qualified: number;
  /** api-football odds calls this run made (one per fixture priced on demand). */
  oddsCalls: number;
  /** ...of which returned a quote. */
  warmed: number;
  /** Why each considered fixture was not targeted. */
  skipped: Partial<Record<OverlaySkipReason | OddsSkipReason, number>>;
};

/**
 * Which covered fixtures deserve a paid-tier attempt now — market first.
 *
 * Reads the ledger (SUCCEEDED rows only), the rows on each fixture, this pass's
 * previous attempts and backoffs, then prices on demand only what the gate
 * could not already read (vipPremiumOddsToWarm), then keeps fixtures the market
 * puts at or above the VIP bar. Writes nothing but FixtureOddsCache, through
 * refreshOddsCache — the odds workload's own writer, with its own back-off.
 */
export async function selectVipPremiumTargets(
  now: Date = new Date(),
  limit = VIP_PREMIUM_DAILY_QUOTA,
  options: {
    warmOdds?: boolean;
    /** VERIFICATION ONLY (scripts/verify-vip-premium-pass.ts): drops the paid-scope restriction. */
    anyLeague?: boolean;
  } = {},
): Promise<TargetSelection> {
  const from = new Date(now.getTime() + GENERATE_FROM_HOURS * 3_600_000);
  const until = new Date(now.getTime() + GENERATE_UNTIL_HOURS * 3_600_000);
  const [ledger, rows, attempts, backoffs] = await Promise.all([
    prisma.generationAttempt.findMany({
      where: { kickoff: { gte: from, lte: until }, status: "SUCCEEDED", fixtureApiId: { not: null } },
      select: { matchKey: true, fixtureApiId: true, leagueApiId: true, leagueName: true, homeTeam: true, awayTeam: true, kickoff: true, round: true, status: true },
    }),
    prisma.prediction.findMany({
      where: { kickoff: { gte: from, lte: until }, status: { not: "ARCHIVED" } },
      select: { id: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, status: true, provenance: true, contextComplete: true },
    }),
    loadVipPremiumAttempts(now),
    prisma.appLock.findMany({ where: { key: { startsWith: VIP_PREMIUM_BACKOFF_LOCK_PREFIX }, expiresAt: { gt: now } }, select: { key: true } }),
  ]);
  const backingOff = new Set(backoffs.map((b) => Number(b.key.slice(VIP_PREMIUM_BACKOFF_LOCK_PREFIX.length))).filter(Number.isFinite));

  const plan = planVipPremiumCandidates({
    ledger: ledger.filter((l) => l.kickoff).map((l) => ({ ...l, kickoff: l.kickoff! })),
    rows,
    attempts,
    backingOff,
    now,
    anyLeague: options.anyLeague,
  });

  const readQuotes = async (keys: string[]) =>
    keys.length
      ? await prisma.fixtureOddsCache.findMany({
          where: { matchKey: { in: keys } },
          select: { matchKey: true, oddsJson: true, fetchedAt: true, lastAttemptAt: true },
        })
      : [];
  const quotes = new Map<string, OverlayQuote>(
    (await readQuotes(plan.candidates.map((c) => c.matchKey))).map((q) => [
      q.matchKey,
      { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt, lastAttemptAt: q.lastAttemptAt },
    ]),
  );

  let oddsCalls = 0;
  let warmed = 0;
  if (options.warmOdds) {
    const due = vipPremiumOddsToWarm(plan.candidates, quotes, now);
    if (due.length) {
      const { refreshOddsCache } = await import("@/lib/enrichment");
      for (const c of due) {
        oddsCalls++;
        try {
          const r = await refreshOddsCache({ matchKey: c.matchKey, fixtureApiId: c.fixtureApiId, kickoff: c.kickoff, kind: "candidate" });
          if (r.result === "ok") warmed++;
        } catch {
          // A fixture the provider will not price is not a failure of the pass;
          // refreshOddsCache records its own lastError, and the target simply
          // does not qualify below.
        }
      }
      for (const q of await readQuotes(due.map((c) => c.matchKey))) {
        quotes.set(q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt, lastAttemptAt: q.lastAttemptAt });
      }
    }
  }

  const odds = qualifyVipPremiumTargets(plan.candidates, quotes, now, limit);
  return {
    targets: odds.targets,
    considered: plan.considered,
    inScope: plan.candidates.length,
    freshlyPriced: odds.freshlyPriced,
    qualified: odds.qualified,
    oddsCalls,
    warmed,
    skipped: { ...plan.skipped, ...odds.skipped },
  };
}

/**
 * Leave a fixture alone for VIP_PREMIUM_RETRY_BACKOFF_MS after its generation
 * threw before an AIJob was written. A draft that was generated needs no
 * backoff: its AIJob already marks the fixture attempted.
 */
export async function backOffVipPremiumFixture(fixtureApiId: number, now: Date = new Date()): Promise<void> {
  const key = `${VIP_PREMIUM_BACKOFF_LOCK_PREFIX}${fixtureApiId}`;
  const expiresAt = new Date(now.getTime() + VIP_PREMIUM_RETRY_BACKOFF_MS);
  await prisma.appLock
    .upsert({ where: { key }, create: { key, holder: "vip-premium", acquiredAt: now, expiresAt }, update: { acquiredAt: now, expiresAt } })
    .catch((error) => console.error("[vip-premium] could not record retry backoff", error));
}

// ── The gate ─────────────────────────────────────────────────────────────────

export type GateOutcome = {
  predictionId: string;
  fixture: string;
  market: string;
  pick: string;
  tier?: PaidTier;
  verdict: MarketConfirmedVerdict;
};

export type GateRunResult = {
  evaluated: number;
  fixtures: number;
  promotedVip: GateOutcome[];
  promotedPremium: GateOutcome[];
  rejected: GateOutcome[];
  /** Passing selections dropped only because another on the same fixture ranked higher. */
  runnersUp: GateOutcome[];
  /** Passing selections not promoted because the fixture already has a live dedicated paid pick. */
  duplicateFixture: GateOutcome[];
  /** This pass's own drafts archived: a final rejection, a runner-up, or a fixture already decided. */
  archived: number;
  /** Drafts left in review because the quote was missing or stale when the gate read it. */
  heldForRequote: number;
  /** Dedicated picks published automatically (this run's promotions and earlier ones retried). */
  published: string[];
  /** Dedicated picks left in review because a publish-time check failed, with why. */
  publishHeld: Array<{ predictionId: string; blocks: PaidPublishBlock[] }>;
  /** Ordinary rows whose VIP/PREMIUM tag was removed because a dedicated pick was published on their fixture. */
  ordinaryPaidTagsRemoved: number;
};

/** PREMIUM is a strict subset: it also carries VIP, so the higher tier is never a narrower feed. */
export function categoriesForTier(tier: PaidTier): string[] {
  return tier === "PREMIUM" ? ["VIP", "PREMIUM"] : ["VIP"];
}

export function provenanceForTier(tier: PaidTier): string {
  return tier === "PREMIUM" ? PREMIUM_GENERATED_PROVENANCE : VIP_GENERATED_PROVENANCE;
}

type FixtureRef = { id: string; fixtureApiId: number | null; homeTeamApiId: number | null; awayTeamApiId: number | null; kickoff: Date | null };

/** Every non-archived row on the same fixture as `ref`, with its paid tags. */
async function liveRowsOnFixture(ref: FixtureRef) {
  const byTeams = ref.homeTeamApiId != null && ref.awayTeamApiId != null && !!ref.kickoff;
  if (!byTeams && ref.fixtureApiId == null) return [];
  const key = paidFixtureKey(ref);
  const dayMs = 36 * 3_600_000;
  const candidates = await prisma.prediction.findMany({
    where: {
      status: { not: "ARCHIVED" },
      OR: [
        ...(ref.fixtureApiId != null ? [{ fixtureApiId: ref.fixtureApiId }] : []),
        ...(ref.homeTeamApiId != null && ref.awayTeamApiId != null && ref.kickoff
          ? [{ homeTeamApiId: ref.homeTeamApiId, awayTeamApiId: ref.awayTeamApiId, kickoff: { gte: new Date(ref.kickoff.getTime() - dayMs), lte: new Date(ref.kickoff.getTime() + dayMs) } }]
          : []),
      ],
    },
    select: {
      id: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, provenance: true, status: true,
      categories: { select: { category: true } },
    },
  });
  return candidates.filter((r) => paidFixtureKey(r) === key || (ref.fixtureApiId != null && r.fixtureApiId === ref.fixtureApiId));
}

const isDedicated = (provenance: string | null) => (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(provenance ?? "");

/**
 * Publish a dedicated paid pick with no reviewer, if and only if it clears
 * paidAutoPublishVerdict — re-checked here against the row as persisted, the
 * fixture as it stands and the quote in the cache NOW. Otherwise it stays
 * PENDING_REVIEW, untouched; it claims no fixture while it waits (curation
 * reads only PUBLISHED dedicated picks), so a valid ordinary paid pick is
 * never suppressed by a draft nobody can see.
 *
 * Publication goes through applyReviewAction: the same transition, audit
 * fields and NEW_PREDICTION event a human publish writes, attributed to
 * `actorId`. Only once it has published does the pick take its fixture: any
 * VIP/PREMIUM tag on an ordinary row there is removed (from PAID_TIER_CUTOVER's
 * day on; earlier days are left alone). Every other category on those rows is
 * kept.
 */
export async function autoPublishVipPremiumPrediction(
  predictionId: string,
  actorId: string,
  now: Date = new Date(),
): Promise<{ published: boolean; blocks: PaidPublishBlock[]; ordinaryPaidTagsRemoved: number }> {
  const row = await prisma.prediction.findUnique({
    where: { id: predictionId },
    include: { categories: true, aiJob: { select: { prompt: true, createdAt: true } } },
  });
  if (!row) return { published: false, blocks: ["NOT_DEDICATED_PAID"], ordinaryPaidTagsRemoved: 0 };

  const key = paidFixtureKey(row);
  const [onFixture, ledger, quote, sameDayAttempts] = await Promise.all([
    liveRowsOnFixture(row),
    row.fixtureApiId != null
      ? prisma.generationAttempt.findFirst({ where: { fixtureApiId: row.fixtureApiId }, orderBy: { lastAttemptAt: "desc" }, select: { status: true } })
      : Promise.resolve(null),
    prisma.fixtureOddsCache.findFirst({ where: { matchKey: key }, select: { oddsJson: true, fetchedAt: true } }),
    row.aiJob ? loadVipPremiumAttempts(row.aiJob.createdAt) : Promise.resolve([]),
  ]);
  const jobDay = row.aiJob ? lagosTodayBounds(row.aiJob.createdAt) : null;
  const attemptNumber = jobDay
    ? sameDayAttempts.filter((a) => a.createdAt >= jobDay.start && a.createdAt <= row.aiJob!.createdAt).length
    : Infinity;
  const others = onFixture.filter((r) => r.id !== row.id);

  const verdict = evaluateMarketConfirmed({
    marketType: row.marketType,
    selection: row.selection as Selection,
    confidence: row.confidence,
    odds: (quote?.oddsJson as unknown as FixtureOdds | null) ?? null,
    fetchedAt: quote?.fetchedAt ?? null,
    now,
  });
  const { publish, blocks } = paidAutoPublishVerdict(
    {
      provenance: row.provenance,
      intent: row.aiJob ? intentOf(row.aiJob.prompt) : null,
      status: row.status,
      rewriteCount: row.rewriteCount,
      marketType: row.marketType,
      confidence: row.confidence,
      contextComplete: row.contextComplete,
      leagueApiId: row.leagueApiId,
      categories: row.categories.map((c) => c.category),
    },
    verdict,
    paidPublishFixture(row, ledger?.status ?? null, onFixture, attemptNumber <= VIP_PREMIUM_DAILY_QUOTA),
  );
  if (!publish) return { published: false, blocks, ordinaryPaidTagsRemoved: 0 };

  await applyReviewAction(row, "PUBLISH", actorId);

  // The fixture's one paid pick is now this one.
  const ordinaryPaid = isLegacyPaidTierDay(row.kickoff)
    ? []
    : others.filter((r) => !isDedicated(r.provenance) && r.categories.some((c) => (PAID_TIER_CATEGORIES as readonly string[]).includes(c.category)));
  if (ordinaryPaid.length) {
    await prisma.predictionCategoryLink.deleteMany({
      where: { predictionId: { in: ordinaryPaid.map((r) => r.id) }, category: { in: [...PAID_TIER_CATEGORIES] } },
    });
  }
  return { published: true, blocks: [], ordinaryPaidTagsRemoved: ordinaryPaid.length };
}

/**
 * Applies the odds-agreement gate to drafts this pass produced, and promotes at
 * most one per fixture to the tier it earns (paidTierFor).
 *
 * Runs AFTER generation rather than inside it, so the model is never told what
 * the market thinks — being shown the price would let it anchor to it, and the
 * agreement being measured would stop being independent.
 *
 * Only rows whose own AIJob carried this pass's intent are considered. An
 * ordinary prediction that happens to agree with the market is not a paid-tier
 * pick; it was not generated for that purpose and was never held to this bar.
 *
 * ONE PAID PICK PER FIXTURE. A fixture that already carries a live dedicated
 * paid row keeps it; this pass does not promote a second.
 *
 * PUBLICATION. With an `actorId`, a promoted pick is published at once if it
 * clears the full publish-time gate (autoPublishVipPremiumPrediction), and so
 * are earlier promotions still waiting in review whose quote has since become
 * readable. Only a PUBLISHED dedicated pick takes its fixture from ordinary
 * paid picks; one left in review claims nothing.
 *
 * NO DUPLICATES LEFT IN REVIEW. The fixture already has ordinary coverage, so
 * this pass's other drafts on it — final rejections, runners-up, or everything
 * once the fixture is decided — are archived rather than left for a reviewer to
 * publish beside the ordinary picks. Drafts rejected only for a missing or
 * stale quote stay in review and are re-judged next run.
 *
 * Without an `actorId` (or on a dry run) nothing is published, and a promoted
 * pick waits for a reviewer like any other row.
 */
export async function applyVipPremiumGate(options: { now?: Date; dryRun?: boolean; actorId?: string } = {}): Promise<GateRunResult> {
  const now = options.now ?? new Date();

  const drafts = await prisma.prediction.findMany({
    where: {
      status: "PENDING_REVIEW",
      provenance: { notIn: [VIP_GENERATED_PROVENANCE, PREMIUM_GENERATED_PROVENANCE] },
      kickoff: { gt: now },
      aiJobId: { not: null },
    },
    select: {
      id: true, marketType: true, selection: true, confidence: true, market: true, pick: true,
      homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, fixtureApiId: true,
      aiJob: { select: { prompt: true } },
    },
  });

  const mine = drafts.filter((d) => d.aiJob && intentOf(d.aiJob.prompt) === VIP_PREMIUM_INTENT);

  // One odds read per fixture, not per draft: a multi-market job produces
  // several rows on one fixture and they all price against the same quote.
  const byFixture = new Map<string, typeof mine>();
  for (const d of mine) {
    const key = paidFixtureKey(d);
    if (!byFixture.has(key)) byFixture.set(key, []);
    byFixture.get(key)!.push(d);
  }
  const cached = byFixture.size
    ? await prisma.fixtureOddsCache.findMany({
        where: { matchKey: { in: [...byFixture.keys()] } },
        select: { matchKey: true, oddsJson: true, fetchedAt: true },
      })
    : [];
  const oddsByKey = new Map(cached.map((c) => [c.matchKey, c]));

  const result: GateRunResult = {
    evaluated: mine.length, fixtures: byFixture.size,
    promotedVip: [], promotedPremium: [], rejected: [], runnersUp: [], duplicateFixture: [],
    archived: 0, heldForRequote: 0, published: [], publishHeld: [], ordinaryPaidTagsRemoved: 0,
  };

  const archive = async (ids: string[]) => {
    if (ids.length === 0) return;
    result.archived += ids.length;
    if (options.dryRun) return;
    // A plain status change on rows that were never published: no review
    // action, so no notification event — nobody has seen these drafts.
    await prisma.prediction.updateMany({ where: { id: { in: ids }, status: "PENDING_REVIEW" }, data: { status: "ARCHIVED" } });
  };

  for (const [key, group] of byFixture) {
    const entry = oddsByKey.get(key) ?? null;
    const odds = (entry?.oddsJson as unknown as FixtureOdds | null) ?? null;

    const scored = group.map((d) => ({
      id: d.id,
      row: d,
      verdict: evaluateMarketConfirmed({
        marketType: d.marketType,
        selection: d.selection as Selection,
        confidence: d.confidence,
        odds,
        fetchedAt: entry?.fetchedAt ?? null,
        now,
      }),
    }));

    const describe = (s: (typeof scored)[number], tier?: PaidTier): GateOutcome => ({
      predictionId: s.id,
      fixture: `${s.row.homeTeam} v ${s.row.awayTeam}`,
      market: s.row.market,
      pick: s.row.pick,
      tier,
      verdict: s.verdict,
    });

    const tierOf = (s: (typeof scored)[number]) => paidTierFor(s.verdict, s.row.confidence);
    for (const s of scored) if (!tierOf(s)) result.rejected.push(describe(s));

    // At most ONE passing selection per fixture. Two picks on one match, both
    // sold as market-confirmed, would read as two independent confirmations of
    // the same thing.
    const passing = scored.filter((s) => tierOf(s)).sort(compareMarketConfirmed);
    if (passing.length === 0) {
      const retryable = scored.filter((s) => (RETRYABLE_GATE_REASONS as readonly string[]).includes(s.verdict.reason ?? ""));
      result.heldForRequote += retryable.length;
      await archive(scored.filter((s) => !retryable.includes(s)).map((s) => s.id));
      continue;
    }

    const winner = passing[0];
    const tier = tierOf(winner)!;
    const onFixture = await liveRowsOnFixture(winner.row);
    const groupIds = new Set(group.map((d) => d.id));
    const existingDedicated = onFixture.find(
      (r) => !groupIds.has(r.id) && (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? ""),
    );
    if (existingDedicated) {
      for (const s of passing) result.duplicateFixture.push(describe(s, tierOf(s)!));
      await archive(scored.map((s) => s.id));
      continue;
    }

    for (const s of passing.slice(1)) result.runnersUp.push(describe(s));
    (tier === "PREMIUM" ? result.promotedPremium : result.promotedVip).push(describe(winner, tier));

    if (!options.dryRun) {
      await prisma.prediction.update({
        where: { id: winner.id },
        data: {
          provenance: provenanceForTier(tier),
          // Frozen at promotion time — see the note on the column. The badge
          // reports what the market said when the pick was made, not now.
          marketConfirmation: {
            modelProbability: winner.verdict.modelProbability,
            marketProbability: winner.verdict.marketProbability,
            gapPP: winner.verdict.gapPP,
            bookmakers: winner.verdict.bookmakers,
            market: winner.verdict.market,
            value: winner.verdict.value,
            tier,
            quoteFetchedAt: entry?.fetchedAt?.toISOString() ?? null,
            confirmedAt: now.toISOString(),
          },
        },
      });
      await setPredictionCategories(winner.id, categoriesForTier(tier));
    }
    await archive(scored.filter((s) => s.id !== winner.id).map((s) => s.id));
  }

  // Publish every promoted pick still in review that now clears the full gate:
  // this run's promotions, and earlier ones whose quote was stale at the time.
  if (options.actorId && !options.dryRun) {
    const pending = await prisma.prediction.findMany({
      where: { status: "PENDING_REVIEW", provenance: { in: [VIP_GENERATED_PROVENANCE, PREMIUM_GENERATED_PROVENANCE] }, kickoff: { gt: now } },
      select: { id: true },
    });
    for (const { id } of pending) {
      const r = await autoPublishVipPremiumPrediction(id, options.actorId, now);
      if (r.published) result.published.push(id);
      else result.publishHeld.push({ predictionId: id, blocks: r.blocks });
      result.ordinaryPaidTagsRemoved += r.ordinaryPaidTagsRemoved;
    }
  }

  return result;
}
