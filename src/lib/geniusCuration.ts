import { prisma } from "@/lib/prisma";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { compareByEditorialRank } from "@/lib/predictionOrdering";
import { matchKey } from "@/lib/slug";
import { VIP_GENERATED_PROVENANCE, PREMIUM_GENERATED_PROVENANCE, isPaidOnlyProvenance } from "@/lib/paidOnly";

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
 * Stamped on rows the dedicated VIP/PREMIUM pass generated AND the market then
 * independently confirmed — see src/lib/vipPremiumPipeline.ts.
 *
 * WHY THESE REPLACED MARKET_CONFIRMED_PROVENANCE. That pipeline was already a
 * dedicated VIP/PREMIUM pass, and it was measured, not assumed, to be broken:
 * 82 jobs across 22 days produced 168 drafts and promoted 3 rows (1.8%). None
 * of the 168 had a fresh quote when the gate read it: drafts are created a
 * median 43.3h before kickoff, while the odds refresh cron was only reaching a
 * fixture a median 1.8h before kickoff, so the gate asked the market a question
 * ~41 hours before anything had asked the books. 60.7% of its drafts fell below
 * the model floor besides, because it took whatever ordinary discovery offered
 * rather than targeting anything.
 *
 * The replacement prices its own candidates and selects on the result, so a
 * fresh quote exists by construction — and the books turned out to be open all
 * along: on demand, fixtures 25-28h from kickoff returned full quotes at five
 * to six bookmakers. Two markers rather than one because PREMIUM is
 * now a strict subset on a HIGHER MARKET BAR, not a higher confidence floor:
 * over 206 settled paid-tier-eligible rows, model confidence >= 80 strikes
 * 78.8% (n=33) against >= 75's 76.2%, while market probability >= 80 strikes
 * 86.5% (n=37) against >= 75's 84.2%. The market separates the tiers; the
 * confidence floor barely does.
 */
// Defined in paidOnly.ts, which has no imports, so pure modules can reason
// about paid-only rows without loading this one (it imports Prisma).
export { VIP_GENERATED_PROVENANCE, PREMIUM_GENERATED_PROVENANCE, PAID_ONLY_PROVENANCES, isPaidOnlyProvenance, NOT_PAID_ONLY } from "@/lib/paidOnly";

/**
 * Every marker that means "a dedicated pass produced this and something
 * independent confirmed it".
 *
 * MARKET_CONFIRMED is retained though its pass no longer runs: three rows
 * carry it, they are published and settled, and rewriting a published track
 * record is the larger trust problem — the same promise VIP_ROUTE_CUTOVER
 * keeps for the pre-cutover cohort.
 */
export const DEDICATED_PAID_PROVENANCES = [
  MARKET_CONFIRMED_PROVENANCE,
  VIP_GENERATED_PROVENANCE,
  PREMIUM_GENERATED_PROVENANCE,
] as const;

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

/**
 * The first Lagos day whose VIP/PREMIUM feeds are held to the paid-tier
 * invariant: every paid pick at or above its tier's floor, no same-game double,
 * and at most one paid pick per fixture.
 *
 * WHAT IT FIXES. Audited 15–28 Sep 2026: since the route rule, VIP reached
 * exactly five picks a day by topping up below its 75 floor, and the doubles
 * route carve-out supplied the padding: 48 of 60 VIP rows (80%) were doubles,
 * and all 35 sub-75 VIP rows were doubles, striking 52% against 75% for VIP
 * singles.
 *
 * WHY A KICKOFF DAY, NOT A CREATION TIME (unlike HIDDEN_LEG_CUTOVER). A paid
 * tag is not written when a row is created. Curation assigns it on the row's
 * kickoff day, so a feed is "old rules" or "new rules" per day. A row kicking
 * off before this instant was curated under the old rules and keeps whatever
 * tag it has; nothing here adds, removes or rewrites it. From this day on,
 * every paid tag is assigned by the new code.
 *
 * A DEPLOYMENT SAFETY BOUNDARY, not a guess at the deploy instant. It is the
 * start of 2026-10-03 in Lagos (UTC+1). Production must be deployed before it;
 * if it cannot be, move it LATER by whole Lagos days, never earlier. The new
 * selection rules apply from deploy regardless; this only decides which
 * already-tagged rows are frozen as legacy, and where the read-only drift check
 * (scripts/check-paid-tier-invariant.ts) starts failing instead of reporting.
 */
export const PAID_TIER_CUTOVER = new Date("2026-10-02T23:00:00.000Z");

/** A row kicking off before PAID_TIER_CUTOVER: its paid tags belong to the old rules and are never touched. */
export function isLegacyPaidTierDay(kickoff: Date | null | undefined): boolean {
  return !!kickoff && kickoff.getTime() < PAID_TIER_CUTOVER.getTime();
}

export const PAID_TIER_CATEGORIES = ["VIP", "PREMIUM"] as const;

/** The tier floor a VIP/PREMIUM tag demands. Hard for both: there is no relaxation. */
export function paidTierFloor(category: (typeof PAID_TIER_CATEGORIES)[number]): number {
  return category === "PREMIUM" ? PREMIUM_CONFIDENCE_FLOOR : VIP_CONFIDENCE_FLOOR;
}

/**
 * One key per fixture, for the one-paid-pick-per-fixture rule.
 *
 * The team/day matchKey first, because every generated row carries team ids
 * and the rows being compared were generated for the same fixture; the
 * provider fixture id only when team ids are missing. A row with neither is its
 * own fixture, so it can never be merged into another by accident.
 */
export function paidFixtureKey(row: {
  id: string;
  fixtureApiId?: number | null;
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  kickoff?: Date | null;
}): string {
  return matchKey(row) ?? (row.fixtureApiId != null ? `f${row.fixtureApiId}` : `row:${row.id}`);
}

type AutoCategory = "GENIUS" | "VIP" | "PREMIUM";

type CurationRule = {
  floor: number;
  /**
   * The floor is eligibility and is NEVER relaxed to reach CURATION_MIN.
   *
   * VIP and PREMIUM. At ~2.2 qualifying picks a day the ordinary top-up would
   * fire on most days and pull in sub-floor rows, silently undoing the very bar
   * that defines the tier. A two-pick paid tier is honest; a five-pick one
   * padded with rows that failed the bar is the thing this exists to stop.
   *
   * VIP took the top-up until PAID_TIER_CUTOVER, and every row it padded with
   * was a same-game double below 75 (see PAID_TIER_CUTOVER).
   */
  hardFloor?: boolean;
  /** Only rows confirmed generated under the VIP calibration route may be newly selected. */
  requireVipRoute?: boolean;
  /**
   * The paid-tier invariant: a same-game double is never eligible, at most one
   * pick per fixture across VIP and PREMIUM together, and a fixture that
   * already carries a dedicated paid-pass row belongs to that row.
   */
  paid?: boolean;
};

const CURATION_RULES: Record<AutoCategory, CurationRule> = {
  // GENIUS is the free tier and takes no route requirement: the genius route is
  // where most fixtures legitimately land, so gating it would empty the feed.
  GENIUS: { floor: GENIUS_CONFIDENCE_FLOOR },
  VIP: { floor: VIP_CONFIDENCE_FLOOR, requireVipRoute: true, hardFloor: true, paid: true },
  PREMIUM: { floor: PREMIUM_CONFIDENCE_FLOOR, requireVipRoute: true, hardFloor: true, paid: true },
};

/** Exposed read-only so checks pin the rules without restating them. */
export function curationRuleFor(category: AutoCategory): Readonly<CurationRule> {
  return CURATION_RULES[category];
}

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

/** A published row curation may rank: today's kickoff, not a hidden combo leg. */
export type CurationRow = {
  id: string;
  leagueApiId: number | null;
  confidence: number;
  provenance: string | null;
  marketType: string;
  createdAt: Date;
  kickoff: Date | null;
  fixtureApiId: number | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  categories: string[];
};

export type CurationPlan = {
  category: AutoCategory;
  considered: number;
  selected: number;
  selectedIds: string[];
  added: string[];
  removed: string[];
  dedicatedProtected: number;
  grandfathered: number;
  routeExcluded: number;
  /** Paid tiers: doubles refused. */
  doublesExcluded: number;
  /** Paid tiers: rows refused because their fixture already has a paid pick (dedicated, frozen legacy, or a better-ranked row). */
  fixtureDuplicatesExcluded: number;
  /** Paid tiers: ordinary rows held back because the dedicated pass may still find a distinct pick for the fixture. */
  awaitingDedicatedExcluded: number;
};

/**
 * What curation selects for one category — pure, so the rules are pinned
 * without a database. curateCategory below only loads its inputs and writes
 * the difference.
 *
 * `paidClaimedFixtures` is the set of paidFixtureKey()s that already carry a
 * PUBLISHED dedicated paid pick, in either tier (see paidClaimsFrom). It is
 * passed separately so a dedicated pick claims its fixture for VIP and PREMIUM
 * together, whichever feed it is tagged into. Ignored by GENIUS.
 */
export function planCuration(
  category: AutoCategory,
  rows: readonly CurationRow[],
  paidClaimedFixtures: ReadonlySet<string> = new Set(),
  /**
   * paidFixtureKey()s whose paid slot still belongs to the dedicated pass
   * (fixturesAwaitingDedicated in vipPremiumOverlay.ts). Paid tiers only: an
   * ordinary pick there is a pick free readers also see, so it may fill the
   * slot only once the dedicated pass has found nothing distinct to carry.
   */
  awaitingDedicatedFixtures: ReadonlySet<string> = new Set(),
): CurationPlan {
  const rule = CURATION_RULES[category];
  const tagged = new Set(rows.filter((r) => r.categories.includes(category)).map((r) => r.id));

  // Dedicated-pass picks already IN this feed are fixed points: they keep their
  // place and they consume slots, but they are never re-ranked and never
  // removed. Curation fills whatever is left.
  //
  // Scoped by `tagged`, which is per-category — so a VIP_GENERATED row that
  // cleared only the VIP bar is protected in VIP's feed and is simply absent
  // from PREMIUM's, which is exactly what makes PREMIUM a strict subset rather
  // than a relabelling of VIP.
  //
  // Only in the paid feeds for a paid-only pick: one that strayed into a free
  // feed is not a fixed point there, it is removed (see belongsHere below).
  const dedicatedIds = new Set(
    rows
      .filter(
        (r) =>
          (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? "") &&
          tagged.has(r.id) &&
          (rule.paid || !isPaidOnlyProvenance(r.provenance)),
      )
      .map((r) => r.id),
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
  //
  // The same promise for the paid-tier invariant: a row kicking off before
  // PAID_TIER_CUTOVER was curated under the old rules (top-up, doubles, no
  // per-fixture limit) and keeps its tag until its day has passed.
  const grandfatheredIds = new Set(
    rule.requireVipRoute
      ? rows
          .filter(
            (r) =>
              tagged.has(r.id) &&
              !dedicatedIds.has(r.id) &&
              (r.createdAt < VIP_ROUTE_CUTOVER || (rule.paid && isLegacyPaidTierDay(r.kickoff))),
          )
          .map((r) => r.id)
      : [],
  );

  const protectedIds = new Set([...dedicatedIds, ...grandfatheredIds]);

  /**
   * May this row be NEWLY selected into this feed?
   *
   * Assembled same-game doubles used to be carved out of the route rule here,
   * because a double has no AIJob and so no calibration route of its own. That
   * carve-out is what padded VIP: it made every double route-eligible, and the
   * VIP top-up then filled the feed with them below the floor. The paid tiers
   * now refuse doubles outright (see isPaidEligible), so the carve-out is gone.
   * Combo Bets and GENIUS are unaffected.
   */
  const hasRequiredRoute = (r: CurationRow) =>
    !rule.requireVipRoute ||
    r.provenance === VIP_ROUTE_PROVENANCE ||
    // A dedicated-pass row satisfies the route requirement on its own evidence:
    // it was generated FOR this tier and the market independently confirmed the
    // pick, which is a stronger claim than the league-rank proxy the VIP route
    // marker records. It reaches this branch only if something untagged it.
    (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? "");

  /** Paid tiers only: a double is never a paid pick, whatever its confidence. */
  const isPaidEligible = (r: CurationRow) => !rule.paid || r.marketType !== "SAME_GAME_DOUBLE";

  // Fixtures that already have their one paid pick: a published dedicated
  // pick (either tier), or a pick this feed keeps without re-ranking.
  const claimed = new Set<string>(rule.paid ? paidClaimedFixtures : []);
  if (rule.paid) for (const r of rows) if (protectedIds.has(r.id)) claimed.add(paidFixtureKey(r));

  // A paid-only pick belongs to VIP/PREMIUM alone: the free tiers never select
  // it, and if one somehow carries a free tag, it is removed below.
  const belongsHere = (r: CurationRow) => rule.paid || !isPaidOnlyProvenance(r.provenance);
  const open = rows.filter((r) => !protectedIds.has(r.id) && belongsHere(r));
  const doublesExcluded = open.filter((r) => !isPaidEligible(r)).length;
  const routeExcluded = open.filter((r) => isPaidEligible(r) && !hasRequiredRoute(r)).length;
  let curatable = open.filter((r) => hasRequiredRoute(r) && isPaidEligible(r));

  // One paid pick per fixture. The representative is the fixture's best row in
  // the same editorial ranking selection uses, so it is deterministic (ties
  // fall to the id) and it is the same row for VIP and PREMIUM: on one fixture
  // the league is shared, so the ranking reduces to confidence, and PREMIUM's
  // higher floor can only drop the representative, never pick a different one.
  //
  // A fixture claimed by a published dedicated pick blocks ORDINARY rows only:
  // the claim is that pick's own, so an untagged dedicated row on it must stay
  // selectable (a dedicated row that lost its tag is re-selected, not exiled).
  let fixtureDuplicatesExcluded = 0;
  let awaitingDedicatedExcluded = 0;
  if (rule.paid) {
    const protectedKeys = new Set(rows.filter((r) => protectedIds.has(r.id)).map(paidFixtureKey));
    const isDedicatedRow = (r: CurationRow) => (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? "");
    const taken = new Set<string>();
    const kept: CurationRow[] = [];
    for (const r of [...curatable].sort(compareByEditorialRank)) {
      const key = paidFixtureKey(r);
      if (taken.has(key) || protectedKeys.has(key) || (claimed.has(key) && !isDedicatedRow(r))) {
        fixtureDuplicatesExcluded++;
        continue;
      }
      if (awaitingDedicatedFixtures.has(key) && !isDedicatedRow(r)) {
        awaitingDedicatedExcluded++;
        continue;
      }
      taken.add(key);
      kept.push(r);
    }
    curatable = kept;
  }

  // Both bounds shrink by the protected count, so the feed still lands at the
  // same 5-15 shape overall rather than 15 curated PLUS however many dedicated
  // picks happened to pass. GENIUS still tops up towards CURATION_MIN, counting
  // protected picks as already-filled slots; the paid tiers never do.
  const remainingMax = Math.max(0, CURATION_MAX - protectedIds.size);
  const remainingMin = Math.max(0, CURATION_MIN - protectedIds.size);

  const curatedIds = selectCuratedIds(curatable, rule.floor, remainingMin, remainingMax, { hardFloor: rule.hardFloor });
  const selectedIds = [...protectedIds, ...curatedIds];
  const selected = new Set(selectedIds);
  return {
    category,
    considered: rows.length,
    selected: selectedIds.length,
    selectedIds,
    added: curatedIds.filter((id) => !tagged.has(id)),
    removed: [...tagged].filter((id) => !selected.has(id)),
    dedicatedProtected: dedicatedIds.size,
    grandfathered: grandfatheredIds.size,
    routeExcluded,
    doublesExcluded,
    fixtureDuplicatesExcluded,
    awaitingDedicatedExcluded,
  };
}

const CURATION_ROW_SELECT = {
  id: true, leagueApiId: true, confidence: true, provenance: true, marketType: true, createdAt: true,
  kickoff: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true,
  categories: { select: { category: true } },
} as const;

/**
 * The fixtures a dedicated paid pick has claimed: PUBLISHED dedicated rows only.
 *
 * A dedicated row still in review claims nothing. It is either about to be
 * auto-published (the gate publishes a fully qualified pick in the same
 * request) or it failed a publish-time check — a stale quote, say — and may
 * never be published at all. Letting it claim the fixture would suppress a
 * valid ordinary paid pick while showing subscribers nothing.
 */
export function paidClaimsFrom(
  rows: ReadonlyArray<{ id: string; status: string; provenance: string | null; fixtureApiId: number | null; homeTeamApiId: number | null; awayTeamApiId: number | null; kickoff: Date | null }>,
): Set<string> {
  return new Set(
    rows
      .filter((r) => r.status === "PUBLISHED" && (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? ""))
      .map(paidFixtureKey),
  );
}

/** paidFixtureKey()s of today's fixtures that carry a PUBLISHED dedicated paid pick. */
async function loadPaidClaimedFixtures(start: Date, end: Date): Promise<Set<string>> {
  const dedicated = await prisma.prediction.findMany({
    where: {
      provenance: { in: [...DEDICATED_PAID_PROVENANCES] },
      status: "PUBLISHED",
      kickoff: { gte: start, lt: end },
    },
    select: { id: true, status: true, provenance: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
  });
  return paidClaimsFrom(dedicated);
}

async function curateCategory(category: AutoCategory, now: Date) {
  const { start, end } = lagosTodayBounds(now);
  const [raw, paidClaimed] = await Promise.all([
    prisma.prediction.findMany({
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
      select: CURATION_ROW_SELECT,
    }),
    CURATION_RULES[category].paid ? loadPaidClaimedFixtures(start, end) : Promise.resolve(new Set<string>()),
  ]);
  const rows: CurationRow[] = raw.map((r) => ({ ...r, categories: r.categories.map((c) => c.category) }));

  // Deferred import: vipPremiumPipeline imports this module.
  const awaiting = CURATION_RULES[category].paid
    ? await (await import("@/lib/vipPremiumPipeline")).loadFixturesAwaitingDedicated(rows, now)
    : new Set<string>();
  const plan = planCuration(category, rows, paidClaimed, awaiting);
  await prisma.$transaction([
    ...(plan.added.length ? [prisma.predictionCategoryLink.createMany({ data: plan.added.map((predictionId) => ({ predictionId, category })), skipDuplicates: true })] : []),
    ...(plan.removed.length ? [prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: plan.removed }, category } })] : []),
  ]);
  return plan;
}

export const curateGeniusTips = (now: Date = new Date()) => curateCategory("GENIUS", now);
export const curateVipTips = (now: Date = new Date()) => curateCategory("VIP", now);
export const curatePremiumTips = (now: Date = new Date()) => curateCategory("PREMIUM", now);

// ── Paid-tier drift (read-only check) ─────────────────────────────────────

export type PaidTierDriftRow = {
  id: string;
  status: string;
  marketType: string;
  confidence: number;
  kickoff: Date | null;
  fixtureApiId: number | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  categories: string[];
};

export type PaidTierDriftIssue = "VIP_BELOW_FLOOR" | "PREMIUM_BELOW_FLOOR" | "SAME_GAME_DOUBLE" | "DUPLICATE_FIXTURE";

export type PaidTierDrift = {
  /** Kickoff on or after PAID_TIER_CUTOVER: a broken invariant. */
  violations: Array<{ row: PaidTierDriftRow; issues: PaidTierDriftIssue[] }>;
  /** Kickoff before it: curated under the old rules, reported and left alone. */
  legacy: Array<{ row: PaidTierDriftRow; issues: PaidTierDriftIssue[] }>;
  clean: number;
};

/**
 * Classify every live VIP/PREMIUM-tagged row against the paid-tier invariant.
 * Pure; scripts/check-paid-tier-invariant.ts feeds it the live database.
 *
 * Archived rows are ignored (they are in no feed), and so are hidden combo
 * legs, which scripts/check-hidden-leg-categories.ts already holds to exactly
 * ["SAME_GAME_DOUBLE"]. Duplicates are counted over VIP and PREMIUM together:
 * a match with one row in VIP and another in PREMIUM is two paid picks.
 */
export function classifyPaidTierDrift(rows: readonly PaidTierDriftRow[]): PaidTierDrift {
  const live = rows.filter(
    (r) =>
      r.status !== "ARCHIVED" &&
      r.categories.some((c) => (PAID_TIER_CATEGORIES as readonly string[]).includes(c)) &&
      !(r.marketType !== "SAME_GAME_DOUBLE" && r.categories.includes("SAME_GAME_DOUBLE")),
  );
  const perFixture = new Map<string, number>();
  for (const r of live) perFixture.set(paidFixtureKey(r), (perFixture.get(paidFixtureKey(r)) ?? 0) + 1);

  const out: PaidTierDrift = { violations: [], legacy: [], clean: 0 };
  for (const r of live) {
    const issues: PaidTierDriftIssue[] = [];
    if (r.categories.includes("VIP") && r.confidence < paidTierFloor("VIP")) issues.push("VIP_BELOW_FLOOR");
    if (r.categories.includes("PREMIUM") && r.confidence < paidTierFloor("PREMIUM")) issues.push("PREMIUM_BELOW_FLOOR");
    if (r.marketType === "SAME_GAME_DOUBLE") issues.push("SAME_GAME_DOUBLE");
    if ((perFixture.get(paidFixtureKey(r)) ?? 0) > 1) issues.push("DUPLICATE_FIXTURE");
    if (issues.length === 0) out.clean++;
    else (isLegacyPaidTierDay(r.kickoff) ? out.legacy : out.violations).push({ row: r, issues });
  }
  return out;
}

export async function curateAutomaticTips(now: Date = new Date()) {
  const [genius, vip, premium] = await Promise.all([curateGeniusTips(now), curateVipTips(now), curatePremiumTips(now)]);
  return { genius, vip, premium };
}
