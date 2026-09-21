import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import type { PredictionCategory } from "@/lib/enums";
import { createNotificationEvent } from "@/lib/notifications";
import {
  DIGEST_MORNING,
  DIGEST_NIGHT,
  DIGEST_TIMING,
  buildMorningDigest,
  buildNightDigest,
  digestAudienceFor,
  digestData,
  personaliseDigest,
  lagosDay,
  lagosInstant,
  lagosMinuteOfDay,
  morningDigestKey,
  nightDigestDecision,
  nightDigestKey,
  renderDigest,
  type DigestPick,
  type RenderedDigest,
} from "@/lib/notificationDigest";
import { matchSlug } from "@/lib/slug";

/**
 * Creates the day's morning and night digest events, each at most once.
 *
 * Called from the reminders job, which already runs every few minutes, so no
 * new schedule is needed: the first run inside a window creates the event and
 * every later run finds the event key taken and does nothing. Delivery is the
 * ordinary outbox — fan-out, preferences, quiet hours, entitlement and the
 * daily cap all apply downstream in runNotificationDispatch.
 *
 * The stored title/body is the free-member rendering (paid selections withheld),
 * so anything that reads the raw row is safe by default; push and inbox
 * re-render per viewer from `data`.
 */

// Tag string inlined, not imported from betOfTheDay.ts, which builds a React
// cache() at import time (see topPredictions.ts for the same choice).
const BET_OF_THE_DAY = "BET_OF_THE_DAY";

/** A signed-in reader with no subscription — every digest recipient has at least this. */
const FREE_MEMBER = (category: string) => canViewCategory(category as PredictionCategory, null, null, "USER");

async function todaysPicks(day: string): Promise<DigestPick[]> {
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: lagosInstant(day, 0), lt: lagosInstant(day, 24 * 60) } },
    select: {
      id: true, homeTeam: true, awayTeam: true, leagueApiId: true, leagueName: true, market: true, pick: true,
      odds: true, confidence: true, kickoff: true, outcome: true, category: true, categories: { select: { category: true } },
      homeTeamApiId: true, awayTeamApiId: true,
    },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => {
    const slug = matchSlug({ homeTeam: r.homeTeam, awayTeam: r.awayTeam, kickoff: r.kickoff });
    return { ...r, categories: r.categories.map((c) => c.category), link: slug ? `/predictions/match/${slug}` : "/predictions" };
  });
}

async function taggedBetOfTheDayId() {
  const row = await prisma.prediction.findFirst({
    where: { status: "PUBLISHED", categories: { some: { category: BET_OF_THE_DAY } } },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function exists(eventKey: string) {
  return !!(await prisma.notificationEvent.findUnique({ where: { eventKey }, select: { id: true } }));
}

/**
 * A digest inbox row as this viewer may see it, rendered on every view with
 * their current preferences, follows and entitlement, exactly as dispatch did.
 * If their settings no longer give them anything in it, a neutral line is shown
 * rather than the stored global copy.
 */
export async function digestForViewer(
  userId: string,
  event: { type: string; data: unknown; createdAt: Date },
  canView: (category: string) => boolean,
): Promise<RenderedDigest> {
  const data = digestData(event.data);
  const [pref, follows] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { userId }, select: { editorialAlerts: true, followedAlerts: true, newPredictions: true, results: true } }),
    prisma.userFollow.findMany({ where: { userId, createdAt: { lte: event.createdAt } }, select: { targetType: true, targetKey: true } }),
  ]);
  const rendered = data ? personaliseDigest(data, digestAudienceFor(event.type, pref, follows), canView) : null;
  return rendered ?? { title: event.type === DIGEST_NIGHT ? "Daily results" : "Daily picks", body: "Nothing in this digest matches your current alert settings.", link: "/notifications", links: [] };
}

export type DigestRunResult = { morning: string; night: string };

export async function createDailyDigests(now: Date = new Date()): Promise<DigestRunResult> {
  const day = lagosDay(now);
  const minute = lagosMinuteOfDay(now);
  const result: DigestRunResult = { morning: "outside window", night: "outside window" };

  if (minute >= DIGEST_TIMING.morningFrom && minute < DIGEST_TIMING.morningUntil) {
    const key = morningDigestKey(day);
    if (await exists(key)) result.morning = "already created";
    else {
      const [picks, botd] = await Promise.all([todaysPicks(day), taggedBetOfTheDayId()]);
      const data = buildMorningDigest(picks, botd, now);
      if (!data) result.morning = "nothing usable yet";
      else {
        const safe = renderDigest(data, FREE_MEMBER);
        await createNotificationEvent({
          eventKey: key,
          type: DIGEST_MORNING,
          title: safe.title,
          body: safe.body,
          link: safe.link,
          data,
          availableAt: now,
          expiresAt: lagosInstant(day, DIGEST_TIMING.morningExpires),
        });
        result.morning = "created";
      }
    }
  }

  if (minute >= DIGEST_TIMING.nightFrom) {
    const key = nightDigestKey(day);
    if (await exists(key)) result.night = "already created";
    else {
      const [picks, botd] = await Promise.all([todaysPicks(day), taggedBetOfTheDayId()]);
      const decision = nightDigestDecision(picks, now);
      if (!decision.send) result.night = decision.reason;
      else {
        const data = buildNightDigest(picks, botd, now);
        const safe = renderDigest(data, FREE_MEMBER);
        await createNotificationEvent({
          eventKey: key,
          type: DIGEST_NIGHT,
          title: safe.title,
          body: safe.body,
          link: safe.link,
          data,
          availableAt: now,
          expiresAt: lagosInstant(day, 24 * 60 + DIGEST_TIMING.nightExpiresNextDay),
        });
        result.night = decision.partial ? "created (partial)" : "created";
      }
    }
  }

  return result;
}
