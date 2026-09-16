import { prisma } from "@/lib/prisma";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { compareByEditorialRank } from "@/lib/predictionOrdering";

export const CURATION_MIN = 5;
export const CURATION_MAX = 15;
export const GENIUS_CONFIDENCE_FLOOR = 70;
export const VIP_CONFIDENCE_FLOOR = 75;

/**
 * PREMIUM sits ABOVE VIP, and until now it did not.
 *
 * Both floors were 75, run over the same candidate pool by the same ranking,
 * so the two paid tiers selected byte-identical sets — 148 rows each, same
 * fixtures, same order. A subscriber paying for the higher tier received the
 * lower tier's picks under a different name.
 *
 * 80 is measured, not chosen for feel. Over the 181 published rows actually
 * generated under the VIP calibration route (13 days, 13.9/day):
 *
 *   floor  eligible  rows/day  settled  strike
 *     75      79        6.1      72      81%    <- VIP's floor
 *     78      46        3.5      45      78%
 *     80      29        2.2      28      86%    <- this
 *     82      23        1.8      22      91%
 *     85       6        0.5       6     100%    <- 6 picks is not a strike rate
 *
 * 80 is the last floor with a real sample behind it. 85 and above collapse to
 * under one pick a day and report a 100% strike on six picks, which is the
 * same false comfort BET_OF_DAY_MIN_CALIBRATION_SAMPLE exists to refuse.
 *
 * It is also where this codebase already says the model stops hedging:
 * HEDGE_CONFIDENCE_REVIEW_THRESHOLD is 80, derived from the model's own median
 * MATCH_WINNER confidence over 464 generations. PREMIUM's floor and the point
 * the model itself treats as straight-winner territory are now the same number.
 */
export const PREMIUM_CONFIDENCE_FLOOR = 80;

type Rankable = { id: string; leagueApiId: number | null; confidence: number };

/**
 * A pick this ranking is not allowed to remove.
 *
 * Market-Confirmed picks are produced by a dedicated pipeline and passed an
 * odds-agreement gate; they are not candidates in a popularity contest that
 * reruns every few hours. Curation recalculates from scratch and removes any
 * tagged row it did not itself select, so without this it would strip one the
 * moment its own ranking preferred something else — silently, and with no
 * record that a gated pick had been dropped.
 *
 * Read from the explicit `provenance` column rather than inferred from tags:
 * a Market-Confirmed pick carries the same VIP/PREMIUM tags as a curated one,
 * so the tags cannot distinguish them.
 */
export const MARKET_CONFIRMED_PROVENANCE = "MARKET_CONFIRMED" as const;
export const STANDARD_CURATED_PROVENANCE = "STANDARD_CURATED" as const;

/**
 * Stamped at generation on rows produced under the VIP-tier ("more safer")
 * calibration route — see resolveGenerationRisk.
 *
 * THE MISMATCH THIS CLOSES. Curation selects on a confidence floor, which is
 * league-blind. Calibration routes on league priority, which is
 * confidence-blind. The two criteria are unrelated, so they were free to
 * disagree, and they did: of 148 rows tagged VIP/PREMIUM, 84 (57%) were
 * generated under the GENIUS route — the LESS cautious of the two — and then
 * sold as the more premium tier. Nothing detected it, because a tag records
 * where a row ended up and says nothing about how it was produced.
 *
 * Read from `provenance` rather than inferred, for the same reason
 * MARKET_CONFIRMED_PROVENANCE is: the tags on a route-confirmed row and a
 * merely-confident one are identical, so the tags cannot tell them apart.
 */
export const VIP_ROUTE_PROVENANCE = "VIP_ROUTE_CONFIRMED" as const;

/**
 * Stamped on rows generated with explicit BANKER intent, which routes through
 * the bolder uncalibrated path.
 *
 * Exists to keep "generated as a banker" distinguishable from "relabelled a
 * banker afterwards" — a distinction that had no representation before, and
 * whose absence is why 49 published BANKER rows all turned out to be hedged
 * output that curation had renamed.
 */
export const BANKER_INTENT_PROVENANCE = "BANKER_GENERATED" as const;

/**
 * When the route requirement below starts applying.
 *
 * HISTORICAL NOTE — read this before changing the date. Every BANKER, VIP and
 * PREMIUM row created before this instant was tagged by CONFIDENCE CURATION
 * ALONE, not generated with that intent. Audited 2026-09-02:
 *
 *   BANKER   49 rows, all PUBLISHED, 48 already settled in the public track
 *            record (39W/9L). Generated under: genius 33, vip 16, bolder
 *            BANKER route 0. Bare BANKER intent had never run in 820 jobs.
 *   VIP      148 rows, PREMIUM 148 rows — the SAME 148 rows, both tiers.
 *            Generated under: genius 84, vip 51, none 13 (assembled doubles).
 *
 * Those rows are deliberately LEFT AS THEY ARE. They are published, most are
 * settled, and editing a published track record after the fact is a larger
 * trust problem than the mislabelling it would correct — particularly here,
 * where the affected cohort OUTPERFORMED the site (BANKER 81% vs 66.8%
 * site-wide), so removing it would quietly improve nothing and look like
 * cherry-picking. This constant is what keeps that promise mechanical rather
 * than remembered: rows older than it are protected from removal below.
 *
 * Set to the start of 2026-09-03 in Lagos (UTC+1), the first day whose
 * generation runs under the new rule.
 */
export const VIP_ROUTE_CUTOVER = new Date("2026-09-02T23:00:00.000Z");

type AutoCategory = "GENIUS" | "VIP" | "PREMIUM";

type CurationRule = {
  floor: number;
  /**
   * The floor is eligibility and is NEVER relaxed to reach CURATION_MIN.
   *
   * PREMIUM only. At ~2.2 qualifying picks a day the ordinary top-up would fire
   * on most days and pull in sub-floor rows, silently undoing the very bar that
   * separates PREMIUM from VIP. A two-pick Premium tier is honest; a five-pick
   * one padded with rows that failed the bar is the thing this exists to stop.
   */
  hardFloor?: boolean;
  /** Only rows confirmed generated under the VIP calibration route may be newly selected. */
  requireVipRoute?: boolean;
};

const CURATION_RULES: Record<AutoCategory, CurationRule> = {
  // GENIUS is the free tier and takes no route requirement: the genius route is
  // where most fixtures legitimately land, so gating it would empty the feed.
  GENIUS: { floor: GENIUS_CONFIDENCE_FLOOR },
  VIP: { floor: VIP_CONFIDENCE_FLOOR, requireVipRoute: true },
  PREMIUM: { floor: PREMIUM_CONFIDENCE_FLOOR, requireVipRoute: true, hardFloor: true },
};

export function selectCuratedIds<T extends Rankable>(
  rows: readonly T[],
  floor: number,
  min = CURATION_MIN,
  max = CURATION_MAX,
  opts: { hardFloor?: boolean } = {},
): string[] {
  // Competition priority first, then confidence — the editorial ranking for
  // CHOOSING which picks get featured. Deliberately not the display order,
  // which leads with confidence; see the note in src/lib/predictionOrdering.ts
  // on why selecting a pick and ordering a list are different questions.
  const ranked = [...rows].sort(compareByEditorialRank);
  const aboveFloor = ranked.filter((r) => r.confidence >= floor);
  const chosen = aboveFloor.slice(0, max);
  const chosenIds = new Set(chosen.map((row) => row.id));
  // The floor is eligibility, not merely a count hint. Relax only when fewer
  // than the minimum qualify, filling from the same league-first ranking.
  //
  // hardFloor turns that top-up off entirely. A tier whose floor is its whole
  // proposition cannot borrow rows that failed it just to look fuller — see the
  // note on CurationRule.hardFloor.
  if (!opts.hardFloor) {
    for (const row of ranked) {
      if (chosen.length >= Math.min(min, ranked.length)) break;
      if (chosenIds.has(row.id)) continue;
      chosen.push(row);
      chosenIds.add(row.id);
    }
  }
  return ranked.filter((row) => chosenIds.has(row.id)).slice(0, max).map((row) => row.id);
}

async function curateCategory(category: AutoCategory, rule: CurationRule, now: Date) {
  const { start, end } = lagosTodayBounds(now);
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      kickoff: { gte: start, lt: end },
      // Multi-market source legs are settlement inputs, not three separate
      // editorial picks. The assembled double participates in curation; its
      // internally tagged single-market legs do not.
      NOT: {
        marketType: { not: "SAME_GAME_DOUBLE" },
        categories: { some: { category: "SAME_GAME_DOUBLE" } },
      },
    },
    select: {
      id: true, leagueApiId: true, confidence: true, provenance: true, marketType: true, createdAt: true,
      categories: { select: { category: true } },
    },
  });

  const tagged = new Set(rows.filter((r) => r.categories.some((c) => c.category === category)).map((r) => r.id));

  // Market-Confirmed picks already IN this feed are fixed points: they keep
  // their place and they consume slots, but they are never re-ranked and never
  // removed. Curation fills whatever is left.
  const marketConfirmedIds = new Set(
    rows.filter((r) => r.provenance === MARKET_CONFIRMED_PROVENANCE && tagged.has(r.id)).map((r) => r.id),
  );

  /**
   * Rows tagged before the route requirement existed.
   *
   * Without this the cutover would strip the tag from every in-flight row the
   * moment it shipped — rows already published and already visible on the paid
   * feeds, removed mid-day for failing a rule that did not exist when they were
   * generated. Protected exactly the way a Market-Confirmed pick is: kept, and
   * counted against the feed's size, but never re-ranked.
   *
   * This set drains on its own. Curation only ever looks at today, so once the
   * cutover day has passed nothing older can appear here again.
   */
  const grandfatheredIds = new Set(
    rule.requireVipRoute
      ? rows
          .filter((r) => tagged.has(r.id) && !marketConfirmedIds.has(r.id) && r.createdAt < VIP_ROUTE_CUTOVER)
          .map((r) => r.id)
      : [],
  );

  const protectedIds = new Set([...marketConfirmedIds, ...grandfatheredIds]);

  /**
   * May this row be NEWLY selected into a paid feed?
   *
   * Assembled same-game doubles are carved out by design, not by oversight:
   * they are composed from rows that were each generated and routed already, so
   * the double itself has no AIJob and therefore no calibration route of its
   * own. Thirteen such rows sat in the audited VIP/PREMIUM set. Requiring a
   * route marker they can never carry would silently delete the doubles feed.
   */
  const hasRequiredRoute = (r: (typeof rows)[number]) =>
    !rule.requireVipRoute || r.provenance === VIP_ROUTE_PROVENANCE || r.marketType === "SAME_GAME_DOUBLE";

  // Both bounds shrink by the protected count, so the feed still lands at the
  // same 5-15 shape overall rather than 15 curated PLUS however many dedicated
  // picks happened to pass. Floor relaxation is unchanged in kind: it still
  // tops the feed up towards CURATION_MIN, just counting protected picks as
  // already-filled slots.
  const remainingMax = Math.max(0, CURATION_MAX - protectedIds.size);
  const remainingMin = Math.max(0, CURATION_MIN - protectedIds.size);
  const curatable = rows.filter((r) => !protectedIds.has(r.id) && hasRequiredRoute(r));
  const routeExcluded = rows.filter((r) => !protectedIds.has(r.id) && !hasRequiredRoute(r)).length;

  const curatedIds = selectCuratedIds(curatable, rule.floor, remainingMin, remainingMax, { hardFloor: rule.hardFloor });
  const selectedIds = [...protectedIds, ...curatedIds];
  const selected = new Set(selectedIds);
  const add = curatedIds.filter((id) => !tagged.has(id));
  const remove = [...tagged].filter((id) => !selected.has(id));
  await prisma.$transaction([
    ...(add.length ? [prisma.predictionCategoryLink.createMany({ data: add.map((predictionId) => ({ predictionId, category })), skipDuplicates: true })] : []),
    ...(remove.length ? [prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: remove }, category } })] : []),
  ]);
  return {
    category,
    considered: rows.length,
    selected: selectedIds.length,
    selectedIds,
    added: add,
    removed: remove,
    marketConfirmedProtected: marketConfirmedIds.size,
    grandfathered: grandfatheredIds.size,
    routeExcluded,
  };
}

export const curateGeniusTips = (now: Date = new Date()) => curateCategory("GENIUS", CURATION_RULES.GENIUS, now);
export const curateVipTips = (now: Date = new Date()) => curateCategory("VIP", CURATION_RULES.VIP, now);
export const curatePremiumTips = (now: Date = new Date()) => curateCategory("PREMIUM", CURATION_RULES.PREMIUM, now);

export async function curateAutomaticTips(now: Date = new Date()) {
  const [genius, vip, premium] = await Promise.all([curateGeniusTips(now), curateVipTips(now), curatePremiumTips(now)]);
  return { genius, vip, premium };
}
