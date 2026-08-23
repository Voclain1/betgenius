import { prisma } from "@/lib/prisma";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { leaguePriorityRank } from "@/lib/leagues";

export const CURATION_MIN = 5;
export const CURATION_MAX = 15;
export const GENIUS_CONFIDENCE_FLOOR = 70;
export const VIP_CONFIDENCE_FLOOR = 75;

type Rankable = { id: string; leagueApiId: number | null; confidence: number };
type AutoCategory = "GENIUS" | "VIP";

export function selectCuratedIds<T extends Rankable>(rows: readonly T[], floor: number, min = CURATION_MIN, max = CURATION_MAX): string[] {
  const ranked = [...rows].sort((a, b) =>
    leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId)
    || b.confidence - a.confidence
    || a.id.localeCompare(b.id),
  );
  const aboveFloor = ranked.filter((r) => r.confidence >= floor);
  const count = Math.min(max, Math.max(Math.min(min, ranked.length), aboveFloor.length));
  return ranked.slice(0, count).map((r) => r.id);
}

async function curateCategory(category: AutoCategory, floor: number, now: Date) {
  const { start, end } = lagosTodayBounds(now);
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: start, lt: end } },
    select: { id: true, leagueApiId: true, confidence: true, categories: { select: { category: true } } },
  });
  const selectedIds = selectCuratedIds(rows, floor);
  const selected = new Set(selectedIds);
  const tagged = new Set(rows.filter((r) => r.categories.some((c) => c.category === category)).map((r) => r.id));
  const add = selectedIds.filter((id) => !tagged.has(id));
  const remove = [...tagged].filter((id) => !selected.has(id));
  await prisma.$transaction([
    ...(add.length ? [prisma.predictionCategoryLink.createMany({ data: add.map((predictionId) => ({ predictionId, category })), skipDuplicates: true })] : []),
    ...(remove.length ? [prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: remove }, category } })] : []),
  ]);
  return { category, considered: rows.length, selected: selectedIds.length, selectedIds, added: add, removed: remove };
}

export const curateGeniusTips = (now: Date = new Date()) => curateCategory("GENIUS", GENIUS_CONFIDENCE_FLOOR, now);
export const curateVipTips = (now: Date = new Date()) => curateCategory("VIP", VIP_CONFIDENCE_FLOOR, now);

export async function curateAutomaticTips(now: Date = new Date()) {
  const [genius, vip] = await Promise.all([curateGeniusTips(now), curateVipTips(now)]);
  return { genius, vip };
}
