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
} from "@/lib/notifications";
import {
  digestAudienceFor,
  digestData,
  isDigestEvent,
  isInboxOnlyType,
  personaliseDigest,
  pushCopy,
  shouldPush,
  type RenderedDigest,
} from "@/lib/notificationDigest";
import { pushConfigured, sendPush } from "@/lib/push";
import type { Prisma } from "@prisma/client";

const MAX_ATTEMPTS = 5;

/** Inbox-only event types, as a filter. Mirrors isInboxOnlyType. */
const INBOX_ONLY_WHERE: Prisma.NotificationEventWhereInput = { OR: [{ type: "NEW_PREDICTION" }, { type: { startsWith: "RESULT_" } }] };

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

export async function runNotificationDispatch(transport: typeof sendPush = sendPush) {
  const fanout = await fanOutPendingEvents(25);
  const { token, rows } = await claimDeliveries(50);
  let delivered = 0, retried = 0, skipped = 0, deferred = 0, lost = 0;

  const skip = async (id: string, reason: string) => {
    if (await releaseDelivery(id, token, { status: "SKIPPED", lastError: reason })) skipped++;
    else lost++;
  };

  for (const row of rows) {
    const now = new Date();
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
    // The cap is counted per class. Inbox-only rows (publications, results)
    // never ring, so letting them use up the allowance would crowd out the
    // kickoff reminders and tip changes that do; they get the same cap as a
    // separate allowance, so inbox volume stays bounded as before.
    const inboxOnly = isInboxOnlyType(row.event.type);
    const sentToday = await prisma.userNotification.count({
      where: { userId: row.userId, createdAt: { gte: dayStart }, event: inboxOnly ? INBOX_ONLY_WHERE : { NOT: INBOX_ONLY_WHERE } },
    });
    if (sentToday >= (pref?.dailyCap ?? 12)) { await skip(row.id, "daily cap"); continue; }

    // The editorial cap is applied AFTER the global one and never replaces it:
    // a broadcast has to clear both. Counted from the inbox rows already
    // written today, on the same local-day boundary as the global cap, so the
    // two agree about when "today" started for this user.
    if (isEditorialEvent(row.event.type)) {
      const editorialToday = await prisma.userNotification.count({
        where: { userId: row.userId, createdAt: { gte: dayStart }, event: { type: row.event.type } },
      });
      if (editorialToday >= EDITORIAL_DAILY_CAP) { await skip(row.id, "editorial daily cap"); continue; }
    }

    try {
      await prisma.userNotification.upsert({
        where: { userId_eventId: { userId: row.userId, eventId: row.eventId } },
        update: {},
        create: { userId: row.userId, eventId: row.eventId },
      });
      const canPush = transport !== sendPush || pushConfigured();
      const quiet = !!pref && inQuietHours(now, pref.timezone, pref.quietStartMinutes, pref.quietEndMinutes);
      if (canPush && shouldPush(row.event.type, { pushEnabled: !!pref?.pushEnabled, inQuietHours: quiet })) {
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
