import { NextResponse } from "next/server";
import {
  JOB_GENERATE,
  JOB_GENERATE_BET_OF_DAY,
  JOB_GENERATE_VIP_PREMIUM,
  recordRouteRun,
} from "@/lib/jobRuns";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { runGeneration } from "@/lib/generation/worker";
import {
  VIP_PREMIUM_INTENT,
  VIP_PREMIUM_DAILY_QUOTA,
  vipPremiumQuotaRemaining,
  selectVipPremiumTargets,
  applyVipPremiumGate,
  VIP_MARKET_FLOOR,
  PREMIUM_MARKET_FLOOR,
} from "@/lib/vipPremiumPipeline";
import {
  DOUBLES_DAILY_QUOTA,
  REGULAR_COMBO_INTENT,
  doublesQuotaRemaining,
} from "@/lib/doublesTargeting";
import {
  selectBetOfTheDayTargets,
  betOfTheDayQuotaRemaining,
  BET_OF_DAY_DAILY_QUOTA,
  BET_OF_DAY_PRICE_BAND,
} from "@/lib/betOfTheDay";
import { z } from "zod";
import { BANKER_INTENT, BANKER_DAILY_QUOTA, bankerQuotaRemaining } from "@/lib/bankerPipeline";

/**
 * Scheduled generation. Same shape and auth as /api/admin/settle and
 * /api/admin/refresh-enrichment — CRON_SECRET bearer for the external
 * scheduler, or an admin session for a manual run from the panel.
 *
 * Driven by cron-job.org rather than Vercel's own cron: this plan's crons are
 * capped at once per day, which is what commit 0d0e10c already worked around
 * for enrichment.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Free-tier categories only — VIP/PREMIUM stay a deliberate manual action, as in the bulk route. */
// SAME_GAME_DOUBLE is generation-targetable like the rest, but it is the only
// one whose job asks the model for SEVERAL markets rather than one — see
// marketBreadthForCategories. That is why it carries a quota of its own below.
const FREE_CATEGORIES = ["FEATURED", "GENIUS", "BANKER", "BET_OF_THE_DAY", "SAME_GAME_DOUBLE"] as const;

const Query = z.object({
  limit: z.coerce.number().min(1).max(25).default(12),
  categories: z.string().optional(),
  leagues: z.string().optional(),
});

async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role);
}

/**
 * The author recorded on scheduled runs.
 *
 * Predictions require an authorId, and a cron has no session. The oldest
 * SUPER_ADMIN/ADMIN is used so the row is attributable to a real account rather
 * than a synthetic one that would need its own user record and access rules.
 */
async function resolveAuthorId(sessionUserId?: string): Promise<string | null> {
  if (sessionUserId) return sessionUserId;
  const admin = await prisma.user.findFirst({
    where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

async function handleGenerationRequest(req: Request): Promise<NextResponse> {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { limit, categories, leagues } = parsed.data;

  const session = await getServerSession(authOptions);
  const authorId = await resolveAuthorId(session?.user.id);
  if (!authorId) return NextResponse.json({ error: "No admin user to attribute generated predictions to" }, { status: 500 });

  const requested = categories?.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) ?? [];
  const valid = requested.filter((c): c is (typeof FREE_CATEGORIES)[number] => FREE_CATEGORIES.includes(c as any));
  const leagueApiIds = leagues?.split(",").map((l) => Number(l.trim())).filter((n) => Number.isFinite(n));

  /**
   * Bet of the Day generation is PRICE-FIRST and quota-capped, so it does not
   * take the ordinary "next N candidates" path.
   *
   * Rather than generating bolder picks broadly and discarding those whose
   * price misses the 2.20-4.50 band — ~11 api-football calls plus a model call
   * per discard — only fixtures the market has ALREADY priced into the band are
   * handed to the worker, via its matchKeys allow-list. Same worker, same lock,
   * same ledger; only the candidate set differs.
   */
  const wantsBetOfTheDay = valid.includes("BET_OF_THE_DAY");
  const wantsVipPremium = url.searchParams.get("vipPremium") === "1";
  /**
   * The dedicated BANKER pass.
   *
   * Requested as an ordinary category (?categories=BANKER) rather than a flag,
   * because unlike the VIP/PREMIUM pass its output IS a BANKER pick the moment
   * it is generated — there is no gate standing between the draft and the tag, so
   * nothing is being withheld from a feed while it waits to qualify.
   *
   * resolveGenerationRisk already routes BANKER intent to the bolder
   * uncalibrated path; this branch is only what makes something actually ask.
   */
  const wantsBanker = valid.includes("BANKER");
  let matchKeys: string[] | undefined;
  let targeting: Record<string, unknown> | undefined;

  if (wantsBetOfTheDay) {
    const remaining = await betOfTheDayQuotaRemaining();
    if (remaining <= 0) {
      return NextResponse.json({
        ok: true,
        skipped: "daily Bet of the Day generation quota already spent",
        quota: BET_OF_DAY_DAILY_QUOTA,
        generatedToday: BET_OF_DAY_DAILY_QUOTA,
        claimed: 0, succeeded: 0, failed: 0, abandoned: 0, predictionsCreated: 0,
      });
    }
    const selection = await selectBetOfTheDayTargets(new Date(), Math.min(remaining, limit));
    matchKeys = selection.targets.map((t) => t.matchKey);
    targeting = {
      quota: BET_OF_DAY_DAILY_QUOTA,
      remainingBeforeRun: remaining,
      candidatesConsidered: selection.considered,
      pricedInBand: selection.pricedInBand,
      priceBand: BET_OF_DAY_PRICE_BAND,
      targets: selection.targets.map((t) => ({
        match: `${t.homeTeam} v ${t.awayTeam}`,
        kickoff: t.kickoff.toISOString(),
        market: t.market,
        selection: t.selection,
        price: t.price,
        bookmakers: t.bookmakers,
      })),
    };
  }

  /** Legacy explicit doubles requests share the same measured daily cap as the
   * regular combo mix. The source legs are isolated during persistence and the
   * assembled output is routed to FEATURED when no normal category was supplied.
   */
  const wantsDoubles = valid.includes("SAME_GAME_DOUBLE");
  let doublesTargeting: Record<string, unknown> | undefined;
  let effectiveLimit = limit;

  if (wantsDoubles) {
    const remaining = await doublesQuotaRemaining();
    if (remaining <= 0) {
      return NextResponse.json({
        ok: true,
        skipped: "daily same-game double generation quota already spent",
        quota: DOUBLES_DAILY_QUOTA,
        generatedToday: DOUBLES_DAILY_QUOTA,
        claimed: 0, succeeded: 0, failed: 0, abandoned: 0, predictionsCreated: 0,
      });
    }
    effectiveLimit = Math.min(remaining, limit);
    doublesTargeting = { quota: DOUBLES_DAILY_QUOTA, remainingBeforeRun: remaining, limitApplied: effectiveLimit };
  }

  /**
   * The dedicated VIP/PREMIUM pass.
   *
   * Requested with ?vipPremium=1 rather than a category, because its rows are
   * not VIP/PREMIUM picks until they pass the odds gate — tagging them up front
   * would put ungated picks straight into the paid feeds.
   *
   * MARKET-FIRST, like Bet of the Day and unlike the Market-Confirmed pass this
   * replaces: the pass prices its own candidates, then hands the worker only
   * those the market puts at or above the VIP bar, via its matchKeys allow-list.
   * That is what guarantees a fresh quote exists when the gate runs — the
   * previous pass had none on any of its 168 drafts.
   *
   * SCHEDULE THIS BEFORE THE ORDINARY GENERATION RUN. It is not optional and it
   * is the one thing that will silently reduce this pass to nothing if it is got
   * wrong. Targeting can only select fixtures the worker can still CLAIM, and a
   * fixture stays PENDING for a median of 23 minutes (p10 8, p90 113) before
   * ordinary generation takes it. Run this second and the candidate pool is
   * empty every time — measured: every in-scope fixture in the next 72 hours was
   * already SUCCEEDED. Run it first and it takes the few market-qualified
   * fixtures it wants; ordinary generation then covers the rest as usual.
   */
  let vipPremiumTargeting: Record<string, unknown> | undefined;

  if (wantsVipPremium) {
    const remaining = await vipPremiumQuotaRemaining();
    if (remaining <= 0) {
      return NextResponse.json({
        ok: true,
        skipped: "daily VIP/PREMIUM generation quota already spent",
        quota: VIP_PREMIUM_DAILY_QUOTA,
        generatedToday: VIP_PREMIUM_DAILY_QUOTA,
        claimed: 0, succeeded: 0, failed: 0, abandoned: 0, predictionsCreated: 0,
      });
    }
    const selection = await selectVipPremiumTargets(new Date(), Math.min(remaining, limit), { warmOdds: true });
    matchKeys = selection.targets.map((t) => t.matchKey);
    effectiveLimit = Math.min(remaining, effectiveLimit);
    vipPremiumTargeting = {
      quota: VIP_PREMIUM_DAILY_QUOTA,
      remainingBeforeRun: remaining,
      limitApplied: effectiveLimit,
      vipMarketFloor: VIP_MARKET_FLOOR,
      premiumMarketFloor: PREMIUM_MARKET_FLOOR,
      candidatesConsidered: selection.considered,
      inLeagueScope: selection.inScope,
      oddsWarmed: selection.warmed,
      freshlyPriced: selection.freshlyPriced,
      marketQualified: selection.qualified,
      targets: selection.targets.map((t) => ({
        match: `${t.homeTeam} v ${t.awayTeam}`,
        kickoff: t.kickoff.toISOString(),
        market: t.market,
        selection: t.selection,
        marketProbability: Number(t.marketProbability.toFixed(1)),
        bookmakers: t.bookmakers,
        quoteAgeMinutes: Math.round(t.quoteAgeMs / 60000),
      })),
    };
  }

  /**
   * While the shared multi-market quota has room, ordinary scheduled
   * generation produces an internally isolated set of legs and one compatible
   * compound pick. Only the compound pick receives the requested normal-feed
   * categories; the legs remain available for independent settlement without
   * appearing as duplicate loose picks in FEATURED/TODAY.
   *
   * Once the quota is spent this falls through to the existing single-market
   * path. It never suppresses ordinary generation.
   */
  let bankerTargeting: Record<string, unknown> | undefined;
  if (wantsBanker) {
    const remaining = await bankerQuotaRemaining();
    if (remaining <= 0) {
      return NextResponse.json({
        ok: true,
        skipped: "daily BANKER generation quota already spent",
        quota: BANKER_DAILY_QUOTA,
        generatedToday: BANKER_DAILY_QUOTA,
        claimed: 0, succeeded: 0, failed: 0, abandoned: 0, predictionsCreated: 0,
      });
    }
    effectiveLimit = Math.min(remaining, effectiveLimit);
    bankerTargeting = { quota: BANKER_DAILY_QUOTA, remainingBeforeRun: remaining, limitApplied: effectiveLimit };
  }

  // Excluded from the regular-combo path for the same reason the others are: a
  // banker is a single high-conviction call, and the multi-market breadth that
  // feeds double assembly is the opposite instruction.
  const wantsRegularCombo = !wantsBetOfTheDay && !wantsDoubles && !wantsVipPremium && !wantsBanker;
  let regularComboTargeting: Record<string, unknown> | undefined;
  let generationIntent: string | undefined = wantsVipPremium ? VIP_PREMIUM_INTENT : wantsBanker ? BANKER_INTENT : undefined;
  if (wantsRegularCombo) {
    const remaining = await doublesQuotaRemaining();
    if (remaining > 0) {
      generationIntent = REGULAR_COMBO_INTENT;
      effectiveLimit = Math.min(remaining, effectiveLimit);
      regularComboTargeting = {
        quota: DOUBLES_DAILY_QUOTA,
        remainingBeforeRun: remaining,
        limitApplied: effectiveLimit,
        destinationCategories: valid.length ? valid : ["FEATURED"],
      };
    }
  }

  const report = await runGeneration({
    authorId,
    intent: generationIntent,
    categories: valid.length ? valid : ["FEATURED"],
    leagueApiIds: leagueApiIds?.length ? leagueApiIds : undefined,
    matchKeys,
    limit: effectiveLimit,
  });

  if (targeting) return NextResponse.json({ ...report, betOfTheDay: targeting }, { status: 200 });
  if (vipPremiumTargeting) {
    // The gate runs in the SAME request, immediately after generation, so a
    // passing pick is promoted before anything else can look at the feeds and
    // so the odds quote is still inside its two-hour freshness window.
    const gate = await applyVipPremiumGate();
    const describe = (p: (typeof gate.promotedVip)[number]) => ({
      fixture: p.fixture, pick: p.pick, tier: p.tier,
      model: p.verdict.modelProbability,
      market: p.verdict.marketProbability,
      gapPP: p.verdict.gapPP,
      bookmakers: p.verdict.bookmakers,
    });
    return NextResponse.json({
      ...report,
      vipPremium: {
        ...vipPremiumTargeting,
        evaluated: gate.evaluated,
        fixtures: gate.fixtures,
        promotedVip: gate.promotedVip.map(describe),
        promotedPremium: gate.promotedPremium.map(describe),
        rejectedReasons: gate.rejected.reduce<Record<string, number>>((acc, r) => {
          const k = r.verdict.reason ?? "?";
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
        runnersUp: gate.runnersUp.length,
      },
    }, { status: 200 });
  }
  if (bankerTargeting) return NextResponse.json({ ...report, banker: bankerTargeting }, { status: 200 });
  if (doublesTargeting) return NextResponse.json({ ...report, sameGameDoubles: doublesTargeting }, { status: 200 });
  if (regularComboTargeting) return NextResponse.json({ ...report, regularCombo: regularComboTargeting }, { status: 200 });

  // A run that found the lock held is a normal outcome, not a failure — the
  // external scheduler must not treat overlapping pokes as errors and start
  // alerting or backing off.
  return NextResponse.json(report, { status: 200 });
}

/**
 * The scheduled entry point. Delegates to the handler unchanged and records
 * the run, so a starving pass is diagnosable from /admin/jobs instead of from
 * cron-job.org.
 *
 * The job NAME is derived from the query, because one endpoint serves three
 * different scheduled passes and lumping them into one history would hide
 * exactly the comparison that matters: ordinary generation firing 96 times a day
 * while the paid pass fires 4 times in a fortnight.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const categories = (url.searchParams.get("categories") ?? "").toUpperCase();
  const job =
    url.searchParams.get("vipPremium") === "1"
      ? JOB_GENERATE_VIP_PREMIUM
      : categories.includes("BET_OF_THE_DAY")
        ? JOB_GENERATE_BET_OF_DAY
        : JOB_GENERATE;

  const startedAt = Date.now();
  const response = await handleGenerationRequest(req);
  await recordRouteRun(job, response, startedAt, (p) =>
    p?.skipped
      ? `stood down: ${p.skipped}`
      : `claimed ${p?.claimed ?? 0}, succeeded ${p?.succeeded ?? 0}, failed ${p?.failed ?? 0}, predictions ${p?.predictionsCreated ?? 0}` +
        (p?.reservedForPaidTier ? `, reserved ${p.reservedForPaidTier} for paid tier` : ""),
  );
  return response;
}
