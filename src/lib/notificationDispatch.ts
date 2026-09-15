import { prisma } from "@/lib/prisma";
import { claimDeliveries, entitled, fanOutPendingEvents, inQuietHours, localDayStartUtc, preferenceAllows, releaseDelivery, stillFollowsEvent } from "@/lib/notifications";
import { pushConfigured, sendPush } from "@/lib/push";

const MAX_ATTEMPTS = 5;
const PAID_CATEGORIES = new Set(["VIP", "PREMIUM"]);

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

    const sentToday = await prisma.userNotification.count({ where: { userId: row.userId, createdAt: { gte: localDayStartUtc(now, pref?.timezone ?? "Africa/Lagos") } } });
    if (sentToday >= (pref?.dailyCap ?? 12)) { await skip(row.id, "daily cap"); continue; }

    try {
      await prisma.userNotification.upsert({
        where: { userId_eventId: { userId: row.userId, eventId: row.eventId } },
        update: {},
        create: { userId: row.userId, eventId: row.eventId },
      });
      const canPush = transport !== sendPush || pushConfigured();
      if (canPush && pref?.pushEnabled && !inQuietHours(now, pref.timezone, pref.quietStartMinutes, pref.quietEndMinutes)) {
        // Paid-tier copy stays generic: a lock screen is not an entitlement check.
        const body = row.event.category && PAID_CATEGORIES.has(row.event.category) ? "A followed tip has an update." : row.event.body;
        for (const sub of row.user.pushSubscriptions) {
          await transport(sub, { title: row.event.title, body, url: row.event.link, tag: row.event.eventKey });
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
