import { prisma } from "@/lib/prisma";
import { GENIUS_CONFIDENCE_FLOOR } from "@/lib/geniusCuration";
import { leaguePriorityRank } from "@/lib/leagues";
import { lagosDateKey, lagosDayBounds } from "@/lib/lagosDate";

/**
 * The homepage hero's slider: the day's top picks, one slide each.
 *
 * WHICH PICKS. Today's (Lagos day) published FEATURED and GENIUS picks, the
 * categories every visitor can read, at or above GENIUS_CONFIDENCE_FLOOR.
 * Highest confidence first, then the bigger competition. One slide per match:
 * a fixture with two qualifying picks shows its strongest. Up to
 * HERO_MAX_SLIDES; on a thin day, as many as qualify. With none qualifying, the
 * day's single best pick, so the hero is never empty while picks exist.
 *
 * FIXED FOR THE DAY. The first homepage render of a Lagos day stores the chosen
 * ids (an AppLock row keyed by the date, as liveSnapshot stores its copy), and
 * every later render shows those same picks in the same order, through kickoff
 * and result, so a reader who comes back at night finds the slides they saw in
 * the morning. The one exception: while fewer than HERO_MIN_SLIDES are stored,
 * picks published later in the day are appended. Nothing already shown is ever
 * swapped out or reordered. A stored pick that is later unpublished drops out.
 *
 * Pure selection (selectHeroSlides) so the rules are checked without a
 * database: scripts/check-hero-slides.ts.
 */

export const HERO_MAX_SLIDES = 6;
export const HERO_MIN_SLIDES = 3;
export const HERO_MIN_CONFIDENCE = GENIUS_CONFIDENCE_FLOOR;

export type HeroSlideData = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: Date | null;
  leagueName: string | null;
  leagueApiId: number | null;
  market: string;
  pick: string;
  confidence: number;
  outcome: string | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
};

const fixtureOf = (r: HeroSlideData) =>
  r.homeTeamApiId != null && r.awayTeamApiId != null ? `${r.homeTeamApiId}-${r.awayTeamApiId}` : `${r.homeTeam}|${r.awayTeam}`.toLowerCase();

const rank = (a: HeroSlideData, b: HeroSlideData) =>
  b.confidence - a.confidence ||
  leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
  (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0) ||
  a.id.localeCompare(b.id);

/** Best pick per match, best first. */
function bestPerFixture(rows: readonly HeroSlideData[]): HeroSlideData[] {
  const best = new Map<string, HeroSlideData>();
  for (const r of [...rows].sort(rank)) if (!best.has(fixtureOf(r))) best.set(fixtureOf(r), r);
  return [...best.values()];
}

/**
 * The slides for a day. `pinnedIds` is what was stored earlier the same day
 * (null on the first render). Returns the slides and the ids to store. Pure.
 */
export function selectHeroSlides(candidates: readonly HeroSlideData[], pinnedIds: readonly string[] | null): { slides: HeroSlideData[]; ids: string[] } {
  const ranked = bestPerFixture(candidates);
  const qualifying = ranked.filter((r) => r.confidence >= HERO_MIN_CONFIDENCE);

  let slides: HeroSlideData[];
  if (pinnedIds) {
    const byId = new Map(candidates.map((r) => [r.id, r]));
    slides = pinnedIds.map((id) => byId.get(id)).filter((r): r is HeroSlideData => !!r);
    if (slides.length < HERO_MIN_SLIDES) {
      const shown = new Set(slides.map(fixtureOf));
      for (const r of qualifying) {
        if (slides.length >= HERO_MIN_SLIDES) break;
        if (!shown.has(fixtureOf(r))) {
          slides.push(r);
          shown.add(fixtureOf(r));
        }
      }
    }
  } else {
    slides = qualifying.slice(0, HERO_MAX_SLIDES);
  }
  if (slides.length === 0 && ranked.length > 0) slides = [ranked[0]];
  return { slides, ids: slides.map((s) => s.id) };
}

const keyFor = (day: string) => `hero-slides:${day}`;

async function readPinned(day: string): Promise<string[] | null> {
  const row = await prisma.appLock.findUnique({ where: { key: keyFor(day) }, select: { holder: true } });
  if (!row) return null;
  try {
    const ids = JSON.parse(row.holder)?.ids;
    return Array.isArray(ids) ? ids.filter((x: unknown): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/** Today's hero slides. Never throws: a storage error shows today's selection unpinned. */
export async function getHeroSlides(now: Date = new Date()): Promise<HeroSlideData[]> {
  const today = lagosDayBounds(0, now);
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      homeTeam: { not: null },
      awayTeam: { not: null },
      kickoff: { gte: today.start, lt: today.end },
      categories: { some: { category: { in: ["FEATURED", "GENIUS"] } } },
    },
    select: {
      id: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
      leagueName: true, leagueApiId: true, market: true, pick: true, confidence: true,
      outcome: true, finalHomeScore: true, finalAwayScore: true,
    },
  });
  const candidates = rows.map((r) => ({ ...r, homeTeam: r.homeTeam!, awayTeam: r.awayTeam! }));

  const day = lagosDateKey(now);
  let pinned: string[] | null = null;
  try {
    pinned = await readPinned(day);
  } catch (err) {
    console.error("[hero-slides] could not read the stored selection", err);
  }
  const { slides, ids } = selectHeroSlides(candidates, pinned);

  const changed = !pinned || ids.length !== pinned.length || ids.some((id, i) => id !== pinned![i]);
  if (changed && ids.length > 0) {
    const holder = JSON.stringify({ ids });
    // Marked expired two days after the day it describes; nothing reads it after that day.
    const expiresAt = new Date(today.end.getTime() + 2 * 86_400_000);
    await prisma.appLock
      .upsert({ where: { key: keyFor(day) }, create: { key: keyFor(day), holder, expiresAt }, update: { holder } })
      .catch((err) => console.error("[hero-slides] could not store the selection", err));
  }
  return slides;
}
