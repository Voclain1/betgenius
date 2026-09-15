import { prisma } from "@/lib/prisma";
import { claimDeliveries, entitled, fanOutPendingEvents, inQuietHours, localDayStartUtc, preferenceAllows, stillFollowsEvent } from "@/lib/notifications";
import { pushConfigured, sendPush } from "@/lib/push";

export async function runNotificationDispatch(transport: typeof sendPush = sendPush) {
  const fanout = await fanOutPendingEvents(25), claim = await claimDeliveries(50);
  let delivered = 0, retried = 0, skipped = 0;
  for (const row of claim.rows) {
    const now = new Date(), pref = row.user.notificationPreference;
    if (!await stillFollowsEvent(row.userId, row.event)) { await prisma.notificationDelivery.update({ where: { id: row.id }, data: { status: "SKIPPED", leasedUntil: null, leaseToken: null, lastError: "no longer followed" } }); skipped++; continue; }
    if (row.event.type === "KICKOFF_REMINDER") {
      const kickoff = new Date((row.event.data as any)?.kickoff), current = await prisma.prediction.findUnique({ where: { id: row.event.predictionId! }, select: { kickoff: true, status: true, outcome: true } });
      if (!current?.kickoff || current.status !== "PUBLISHED" || current.outcome !== "PENDING" || current.kickoff.getTime() !== kickoff.getTime() || kickoff <= now) { await prisma.notificationDelivery.update({ where: { id: row.id }, data: { status: "SKIPPED", leasedUntil: null, leaseToken: null, lastError: "kickoff changed, started, or prediction unavailable" } }); skipped++; continue; }
      const due = new Date(kickoff.getTime() - (pref?.kickoffMinutes ?? 30) * 60_000);
      if (now < due) { await prisma.notificationDelivery.update({ where: { id: row.id }, data: { status: "RETRY", nextAttemptAt: due, leasedUntil: null, leaseToken: null } }); continue; }
    }
    if ((row.event.expiresAt && row.event.expiresAt <= now) || !preferenceAllows(row.event.type, pref) || !entitled(row.event.category, row.user)) { await prisma.notificationDelivery.update({ where: { id: row.id }, data: { status: "SKIPPED", leasedUntil: null, leaseToken: null, lastError: "expired, disabled, or no entitlement" } }); skipped++; continue; }
    const sentToday = await prisma.userNotification.count({ where: { userId: row.userId, createdAt: { gte: localDayStartUtc(now, pref?.timezone ?? "Africa/Lagos") } } });
    if (sentToday >= (pref?.dailyCap ?? 12)) { await prisma.notificationDelivery.update({ where: { id: row.id }, data: { status: "SKIPPED", leasedUntil: null, leaseToken: null, lastError: "daily cap" } }); skipped++; continue; }
    try {
      await prisma.userNotification.upsert({ where: { userId_eventId: { userId: row.userId, eventId: row.eventId } }, update: {}, create: { userId: row.userId, eventId: row.eventId } });
      const canPush = transport !== sendPush || pushConfigured();
      if (canPush && pref?.pushEnabled && !inQuietHours(now, pref.timezone, pref.quietStartMinutes, pref.quietEndMinutes)) for (const sub of row.user.pushSubscriptions) await transport(sub, { title: row.event.title, body: row.event.category && ["VIP", "PREMIUM"].includes(row.event.category) ? "A followed tip has an update." : row.event.body, url: row.event.link, tag: row.event.eventKey });
      await prisma.notificationDelivery.update({ where: { id: row.id }, data: { status: "DELIVERED", deliveredAt: now, leasedUntil: null, leaseToken: null, attempts: { increment: 1 } } }); delivered++;
    } catch (error: any) {
      const attempts = row.attempts + 1;
      await prisma.notificationDelivery.update({ where: { id: row.id }, data: { status: attempts >= 5 ? "FAILED" : "RETRY", attempts, nextAttemptAt: new Date(Date.now() + Math.min(6 * 60 * 60_000, 30_000 * 2 ** attempts)), lastError: String(error?.message ?? error).slice(0, 500), leasedUntil: null, leaseToken: null } }); retried++;
    }
  }
  return { ...fanout, claimed: claim.rows.length, delivered, retried, skipped };
}
