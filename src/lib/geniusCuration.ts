import { prisma } from "@/lib/prisma";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { compareByEditorialRank } from "@/lib/predictionOrdering";

export const CURATION_MIN = 5;
export const CURATION_MAX = 15;
export const GENIUS_CONFIDENCE_FLOOR = 70;
export const VIP_CONFIDENCE_FLOOR = 75;
export const PREMIUM_CONFIDENCE_FLOOR = 75;

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
type AutoCategory = "GENIUS" | "VIP" | "PREMIUM";

export function selectCuratedIds<T extends Rankable>(rows: readonly T[], floor: number, min = CURATION_MIN, max = CURATION_MAX): string[] {
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
  for (const row of ranked) {
    if (chosen.length >= Math.min(min, ranked.length)) break;
    if (chosenIds.has(row.id)) continue;
    chosen.push(row);
    chosenIds.add(row.id);
  }
  return ranked.filter((row) => chosenIds.has(row.id)).slice(0, max).map((row) => row.id);
}

async function curateCategory(category: AutoCategory, floor: number, now: Date) {
  const { start, end } = lagosTodayBounds(now);
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: start, lt: end } },
    select: { id: true, leagueApiId: true, confidence: true, provenance: true, categories: { select: { category: true } } },
  });

  const tagged = new Set(rows.filter((r) => r.categories.some((c) => c.category === category)).map((r) => r.id));

  // Market-Confirmed picks already IN this feed are fixed points: they keep
  // their place and they consume slots, but they are never re-ranked and never
  // removed. Curation fills whatever is left.
  const protectedIds = new Set(
    rows.filter((r) => r.provenance === MARKET_CONFIRMED_PROVENANCE && tagged.has(r.id)).map((r) => r.id),
  );

  // Both bounds shrink by the protected count, so the feed still lands at the
  // same 5-15 shape overall rather than 15 curated PLUS however many dedicated
  // picks happened to pass. Floor relaxation is unchanged in kind: it still
  // tops the feed up towards CURATION_MIN, just counting protected picks as
  // already-filled slots.
  const remainingMax = Math.max(0, CURATION_MAX - protectedIds.size);
  const remainingMin = Math.max(0, CURATION_MIN - protectedIds.size);
  const curatable = rows.filter((r) => !protectedIds.has(r.id));

  const curatedIds = selectCuratedIds(curatable, floor, remainingMin, remainingMax);
  const selectedIds = [...protectedIds, ...curatedIds];
  const selected = new Set(selectedIds);
  const add = curatedIds.filter((id) => !tagged.has(id));
  const remove = [...tagged].filter((id) => !selected.has(id));
  await prisma.$transaction([
    ...(add.length ? [prisma.predictionCategoryLink.createMany({ data: add.map((predictionId) => ({ predictionId, category })), skipDuplicates: true })] : []),
    ...(remove.length ? [prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: remove }, category } })] : []),
  ]);
  return { category, considered: rows.length, selected: selectedIds.length, selectedIds, added: add, removed: remove, marketConfirmedProtected: protectedIds.size };
}

export const curateGeniusTips = (now: Date = new Date()) => curateCategory("GENIUS", GENIUS_CONFIDENCE_FLOOR, now);
export const curateVipTips = (now: Date = new Date()) => curateCategory("VIP", VIP_CONFIDENCE_FLOOR, now);
export const curatePremiumTips = (now: Date = new Date()) => curateCategory("PREMIUM", PREMIUM_CONFIDENCE_FLOOR, now);

export async function curateAutomaticTips(now: Date = new Date()) {
  const [genius, vip, premium] = await Promise.all([curateGeniusTips(now), curateVipTips(now), curatePremiumTips(now)]);
  return { genius, vip, premium };
}
