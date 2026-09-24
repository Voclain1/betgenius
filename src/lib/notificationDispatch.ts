import { prisma } from "@/lib/prisma";
import {
  EDITORIAL_DAILY_CAP,
  claimDeliveries,
  entitled,
  fanOutPendingEvents,
  inQuietHours,
  isEditorialEvent,
  localDayStartUtc,
  preferenceAllows,
  releaseDelivery,
  stillFollowsEvent,
  TOP_PREDICTION,
} from "@/lib/notifications";
import {
  digestAudienceFor,
  digestData,
  isDigestEvent,
  dailyCapAllows,
  dailyCapClass,
  digestDeliverNotBefore,
  personaliseDigest,
  pushCopy,
  shouldPush,
  topPredictionDelivery,
  topPredictionEvidence,
  topPredictionPushLeagueIds,
  TOP_PREDICTION_PUSH_MARKET_CONFIRMED_ONLY,
  type DailyCapClass,
  type RenderedDigest,
} from "@/lib/notificationDigest";
import { pushConfigured, sendPush } from "@/lib/push";
import type { Prisma } from "@prisma/client";

const MAX_ATTEMPTS = 5;

const TOP_PUSH_LEAGUES = topPredictionPushLeagueIds();

/**
 * Top predictions that were push-eligible, for the editorial cap. Mirrors
 * topPredictionPushEligible: a tier-eligible league, or a market-confirmed-only
 * league whose event recorded a MARKET_CONFIRMED prediction.
 */
const ELIGIBLE_TOP_WHERE: Prisma.NotificationEventWhereInput = {
  type: TOP_PREDICTION,
  OR: [
    { leagueApiId: { in: TOP_PUSH_LEAGUES } },
    { leagueApiId: { in: [...TOP_PREDICTION_PUSH_MARKET_CONFIRMED_ONLY] }, data: { path: ["provenance"], equals: "MARKET_CONFIRMED" } },
  ],
};

/**
 * The daily-cap classes (dailyCapClass) as filters, so each class is counted
 * only against itself.
 *
 * HISTORY_WHERE: inbox-only publication and result rows.
 * INBOX_TOP_WHERE: top predictions outside every push-eligible league (a null
 * league included, which `notIn` alone would miss). A top prediction in a
 * market-confirmed-only league is counted with push-class rows whichever way
 * its evidence went: slightly conservative for the push allowance, and it keeps
 * this filter free of JSON-null edge cases.
 * Push class: neither of the above.
 */
const HISTORY_WHERE: Prisma.NotificationEventWhereInput = {
  OR: [{ type: "NEW_PREDICTION" }, { type: { startsWith: "RESULT_" } }],
};
const INBOX_TOP_WHERE: Prisma.NotificationEventWhereInput = {
  type: TOP_PREDICTION,
  OR: [{ leagueApiId: null }, { leagueApiId: { notIn: [...TOP_PUSH_LEAGUES, ...TOP_PREDICTION_PUSH_MARKET_CONFIRMED_ONLY] } }],
};
const CAP_CLASS_WHERE: Record<DailyCapClass, Prisma.NotificationEventWhereInput> = {
  history: HISTORY_WHERE,
  inbox: INBOX_TOP_WHERE,
  push: { NOT: { OR: [HISTORY_WHERE, INBOX_TOP_WHERE] } },
};

/** A reminder is only valid while at least one of its tips is still live at the kickoff it announced. */
async function reminderStillValid(event: { predictionId: string | null; data: unknown }, now: Date) {
  const data = (event.data ?? {}) as { kickoff?: unknown; predictionIds?: unknown };
  const kickoff = typeof data.kickoff === "string" ? new Date(data.kickoff) : null;
  if (!kickoff || Number.isNaN(kickoff.getTime()) || kickoff <= now) return null;
  const ids = Array.isArray(data.predictionIds) ? data.predictionIds.filter((x): x is string => typeof x === "string") : [];
  if (event.predictionId) ids.push(event.predictionId);
  const live = await prisma.prediction.count({ where: { id: { in: ids }, status: "PUBLISHED", outcome: "PENDING", kickoff } });
  return live > 0 ? kickoff : null;
}

/** `clock` is injectable for the offline checks, which drive dispatch at chosen Lagos times. */
export async function runNotificationDispatch(transport: typeof sendPush = sendPush, clock: () => Date = () => new Date()) {
  const fanout = await fanOutPendingEvents(25);
  const { token, rows } = await claimDeliveries(50);
  let delivered = 0, retried = 0, skipped = 0, deferred = 0, lost = 0;

  const skip = async (id: string, reason: string) => {
    if (await releaseDelivery(id, token, { status: "SKIPPED", lastError: reason })) skipped++;
    else lost++;
  };

  for (const row of rows) {
    const now = clock();
    const pref = row.user.notificationPreference;

    if (!(await stillFollowsEvent(row.userId, row.event))) { await skip(row.id, "no longer followed"); continue; }

    if (row.event.type === "KICKOFF_REMINDER") {
      const kickoff = await reminderStillValid(row.event, now);
      if (!kickoff) { await skip(row.id, "kickoff changed, started, or tip unavailable"); continue; }
      const due = new Date(kickoff.getTime() - (pref?.kickoffMinutes ?? 30) * 60_000);
      if (now < due) {
        if (await releaseDelivery(row.id, token, { status: "RETRY", nextAttemptAt: due })) deferred++;
        else lost++;
        continue;
      }
    }

    // The night digest is created around 03:10 but held until 07:00 Lagos, so
    // it never wakes anyone. Same deferral path as a kickoff reminder: nothing
    // is written for the user until then, and every check below (preferences,
    // entitlement, cap, quiet hours) runs at delivery time.
    const notBefore = digestDeliverNotBefore(row.event);
    if (notBefore && now < notBefore) {
      if (await releaseDelivery(row.id, token, { status: "RETRY", nextAttemptAt: notBefore })) deferred++;
      else lost++;
      continue;
    }

    if (row.event.expiresAt && row.event.expiresAt <= now) { await skip(row.id, "expired"); continue; }
    if (!preferenceAllows(row.event.type, pref)) { await skip(row.id, "disabled in preferences"); continue; }
    if (!entitled(row.event.category, row.user)) { await skip(row.id, "no entitlement"); continue; }

    // A digest is personalised before anything is written: editorial readers
    // get the global digest, follow-only readers only what their follows cover,
    // both get one combined digest. Nothing relevant means no inbox row and no push.
    let digest: RenderedDigest | null = null;
    if (isDigestEvent(row.event.type)) {
      const data = digestData(row.event.data);
      const follows = await prisma.userFollow.findMany({
        where: { userId: row.userId, createdAt: { lte: row.event.createdAt } },
        select: { targetType: true, targetKey: true },
      });
      digest = data
        ? personaliseDigest(data, digestAudienceFor(row.event.type, pref, follows), (category) => entitled(category, row.user, now))
        : null;
      if (!digest) { await skip(row.id, "nothing in digest for this user"); continue; }
    }

    const dayStart = localDayStartUtc(now, pref?.timezone ?? "Africa/Lagos");
    // The cap is counted per class (dailyCapClass). The user's dailyCap is a
    // push/noise control: it applies to push-class rows, and separately to
    // inbox-only top predictions. Publication and result history never rings,
    // so it is outside dailyCap altogether (neither counted nor blocked) and is
    // bounded only by the INBOX_HISTORY_DAILY_CEILING runaway guard.
    const capClass = dailyCapClass(row.event);
    const sentToday = await prisma.userNotification.count({
      where: { userId: row.userId, createdAt: { gte: dayStart }, event: CAP_CLASS_WHERE[capClass] },
    });
    if (!dailyCapAllows(capClass, sentToday, pref?.dailyCap)) {
      await skip(row.id, capClass === "history" ? "inbox history ceiling" : "daily cap");
      continue;
    }

    // The editorial cap is applied AFTER the global one and never replaces it:
    // a broadcast has to clear both. Counted from the inbox rows already
    // written today, on the same local-day boundary as the global cap, so the
    // two agree about when "today" started for this user.
    //
    // Only push-eligible top predictions count and are capped: one from a
    // FALLBACK/DEEP_FALLBACK (or unknown) competition is inbox-only, so it
    // neither pushes nor uses up an allowance a CORE pick later in the day needs.
    if (isEditorialEvent(row.event.type)) {
      const eligibleToday = await prisma.userNotification.count({
        where: { userId: row.userId, createdAt: { gte: dayStart }, event: ELIGIBLE_TOP_WHERE },
      });
      if (topPredictionDelivery(row.event.leagueApiId, eligibleToday, EDITORIAL_DAILY_CAP, topPredictionEvidence(row.event.data)) === "capped") {
        await skip(row.id, "editorial daily cap");
        continue;
      }
    }

    try {
      await prisma.userNotification.upsert({
        where: { userId_eventId: { userId: row.userId, eventId: row.eventId } },
        update: {},
        create: { userId: row.userId, eventId: row.eventId },
      });
      const canPush = transport !== sendPush || pushConfigured();
      const quiet = !!pref && inQuietHours(now, pref.timezone, pref.quietStartMinutes, pref.quietEndMinutes);
      if (canPush && shouldPush(row.event.type, { pushEnabled: !!pref?.pushEnabled, inQuietHours: quiet, leagueApiId: row.event.leagueApiId, data: row.event.data })) {
        // Rendered for this recipient: paid selections only for the entitled.
        const copy = pushCopy(row.event, digest);
        if (copy) {
          for (const sub of row.user.pushSubscriptions) {
            await transport(sub, { ...copy, tag: row.event.eventKey });
          }
        }
      }
      if (await releaseDelivery(row.id, token, { status: "DELIVERED", deliveredAt: now, attempts: { increment: 1 } })) delivered++;
      else lost++;
    } catch (error: any) {
      const attempts = row.attempts + 1;
      const released = await releaseDelivery(row.id, token, {
        status: attempts >= MAX_ATTEMPTS ? "FAILED" : "RETRY",
        attempts,
        nextAttemptAt: new Date(Date.now() + Math.min(6 * 60 * 60_000, 30_000 * 2 ** attempts)),
        lastError: String(error?.message ?? error).slice(0, 500),
      });
      if (released) retried++;
      else lost++;
    }
  }

  return { ...fanout, claimed: rows.length, delivered, retried, skipped, deferred, lostLeases: lost };
}
