import { prisma } from "@/lib/prisma";
import {
  TOP_PREDICTION,
  createNotificationEvent,
  editorialDay,
  topPredictionEventKey,
  type TopPredictionSource,
} from "@/lib/notifications";
import { matchSlug } from "@/lib/slug";

// The tag string, taken from the enum rather than from src/lib/betOfTheDay.ts.
// That module builds a react `cache()` at import time, which pulls a React
// runtime into anything that touches it — including the plain tsx check
// scripts. Nothing here needs its behaviour, only the category name.
const BET_OF_THE_DAY = "BET_OF_THE_DAY";

/**
 * Editorial top-prediction broadcasts.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a prediction becomes a broadcast push
 * only through an EXPLICIT SELECTION DECISION. Generation does not do it.
 * Publication does not do it. Carrying a category tag does not do it. Somebody
 * - an admin pressing the button, or the Bet of the Day pin, or a trend rule
 * that has been written down and can be pointed at - has to have chosen this
 * one prediction, on purpose, out of everything published that day.
 *
 * This is the whole difference between the two audiences. A followed alert is
 * requested by its recipient, one follow at a time, and can therefore be
 * generous. A broadcast is addressed to everyone who opted into editorial
 * alerts and was requested by nobody in particular, so the bar for producing
 * one is a decision rather than a threshold being crossed.
 *
 * It creates an event through createNotificationEvent and stops. Fan-out,
 * per-user preferences, quiet hours, entitlement, the global daily cap and the
 * editorial cap all happen downstream in the existing pipeline. Nothing here
 * touches web-push, and nothing here may: a second delivery path is exactly
 * what this reuses the outbox to avoid.
 */

/** The sources allowed to produce a broadcast. Anything not on this list cannot. */
export const TOP_PREDICTION_SOURCES = ["BET_OF_THE_DAY", "BANKER", "ADMIN_PINNED", "TREND_SELECTED"] as const;

/**
 * The quality rule for the one source with no human in the loop.
 *
 * BET_OF_THE_DAY, BANKER and ADMIN_PINNED all carry a decision already - a pin,
 * a curated slot, a button press. TREND_SELECTED does not, so it is the source
 * that could quietly degrade into "every prediction with a good-looking number".
 * It therefore has to clear an explicit, written-down bar:
 *
 *   - MARKET_CONFIRMED provenance. The pick passed the odds-agreement gate in
 *     marketConfirmed.ts, so a second, independent source agreed with the model
 *     rather than the model agreeing with itself.
 *   - Confidence at or above TREND_MIN_CONFIDENCE.
 *   - Priced. A pick with no odds cannot be represented honestly in a push.
 *   - Still ahead of kickoff, published and unsettled - checked by the caller
 *     against the live row.
 *
 * Deliberately strict enough that most days produce no trend broadcast at all.
 * Silence is the correct output when nothing clears the bar.
 */
export const TREND_MIN_CONFIDENCE = 80;

export type TopPredictionCandidate = {
  status: string;
  outcome: string;
  confidence: number;
  odds: number | null;
  provenance: string;
};

export function qualifiesAsTopPrediction(candidate: TopPredictionCandidate, source: TopPredictionSource): boolean {
  // Common floor for every source: you cannot broadcast a pick that is not
  // live. An unpublished row is not public, and a settled one is history.
  if (candidate.status !== "PUBLISHED" || candidate.outcome !== "PENDING") return false;
  if (source !== "TREND_SELECTED") return true;
  return candidate.provenance === "MARKET_CONFIRMED" && candidate.confidence >= TREND_MIN_CONFIDENCE && candidate.odds != null;
}

export type BroadcastResult =
  | { ok: true; eventId: string; alreadyBroadcast: boolean }
  | { ok: false; reason: "not-found" | "not-eligible" };

/**
 * Creates the editorial event for one prediction, once.
 *
 * IDEMPOTENCY comes from the eventKey, not from a flag on the prediction:
 * topPredictionEventKey is (prediction, local day) and createNotificationEvent
 * upserts on the unique eventKey. A double-clicked button, a retried request
 * and a second admin pressing it an hour later all resolve to the same row, so
 * the fan-out runs once and every recipient gets one NotificationDelivery
 * (itself uniquely keyed on eventId+userId). `alreadyBroadcast` reports which
 * happened so the admin UI can say "already sent" instead of implying a second
 * send just occurred.
 *
 * `fannedOutAt` is what makes that guarantee hold rather than merely look
 * right: once the dispatcher has fanned an event out it never fans it out
 * again, so re-upserting the same key cannot produce a second wave of
 * deliveries.
 */
export async function broadcastTopPrediction(
  predictionId: string,
  source: TopPredictionSource,
  now: Date = new Date(),
): Promise<BroadcastResult> {
  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: {
      id: true,
      status: true,
      outcome: true,
      confidence: true,
      odds: true,
      provenance: true,
      market: true,
      pick: true,
      homeTeam: true,
      awayTeam: true,
      kickoff: true,
      category: true,
      leagueApiId: true,
      homeTeamApiId: true,
      awayTeamApiId: true,
      fixtureApiId: true,
      categories: { select: { category: true } },
    },
  });
  if (!prediction) return { ok: false, reason: "not-found" };
  if (!qualifiesAsTopPrediction(prediction, source)) return { ok: false, reason: "not-eligible" };

  const eventKey = topPredictionEventKey(prediction.id, editorialDay(now));
  const existing = await prisma.notificationEvent.findUnique({ where: { eventKey }, select: { id: true } });

  const slug = matchSlug({ homeTeam: prediction.homeTeam, awayTeam: prediction.awayTeam, kickoff: prediction.kickoff });
  const match = `${prediction.homeTeam} vs ${prediction.awayTeam}`;
  const isBetOfTheDay = source === "BET_OF_THE_DAY" || prediction.categories.some((c) => c.category === BET_OF_THE_DAY);

  const event = await createNotificationEvent({
    eventKey,
    type: TOP_PREDICTION,
    predictionId: prediction.id,
    fixtureApiId: prediction.fixtureApiId,
    // The event's own category, which entitled() checks at dispatch. Carried
    // from the row so a paid-tier pick broadcast to everyone still has its
    // detail withheld from users who cannot view that tier - the broadcast
    // audience is not an entitlement bypass.
    category: prediction.category,
    leagueApiId: prediction.leagueApiId,
    teamApiIds: [prediction.homeTeamApiId, prediction.awayTeamApiId].filter((x): x is number => x != null),
    title: isBetOfTheDay ? "Bet of the Day is live" : "Top prediction",
    body: `${match} — ${prediction.market}: ${prediction.pick}`,
    link: slug ? `/predictions/match/${slug}` : "/predictions",
    // Expires at kickoff: a top pick delivered after the match has started is
    // worse than not delivering it, and the dispatcher already drops expired rows.
    expiresAt: prediction.kickoff,
    // provenance is what dispatch reads for a market-confirmed-only competition
    // (TOP_PREDICTION_PUSH_MARKET_CONFIRMED_ONLY): without MARKET_CONFIRMED here
    // such an event reaches the inbox but never pushes.
    data: { source, categories: prediction.categories.map((c) => c.category), confidence: prediction.confidence, odds: prediction.odds, provenance: prediction.provenance },
  });

  return { ok: true, eventId: event.id, alreadyBroadcast: existing !== null };
}
