import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { claimDeliveries, createNotificationEvent, fanOutPendingEvents, recordPredictionEvents, releaseDelivery } from "../src/lib/notifications";
import { reviewTransition } from "../src/lib/predictions";
import { runNotificationDispatch } from "../src/lib/notificationDispatch";
import { sendPush } from "../src/lib/push";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "55432" || !url.pathname.endsWith("/betgenius_feature_test")) throw new Error("Refusing to run outside the disposable BetGenius test database");
const prefix = "verify-notifications-";

async function clear() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
  await prisma.prediction.deleteMany({ where: { authorId: { in: users.map(u => u.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.notificationEvent.deleteMany({ where: { eventKey: { startsWith: prefix } } });
}

async function main() {
  await clear();
  const author = await prisma.user.create({ data: { email: `${prefix}admin@example.test`, role: "ADMIN", subscription: { create: { tier: "PREMIUM", status: "ACTIVE" } } } });
  const free = await prisma.user.create({ data: { email: `${prefix}free@example.test`, role: "USER", subscription: { create: { tier: "FREE", status: "ACTIVE" } }, notificationPreference: { create: { pushEnabled: false } } } });
  const premium = await prisma.user.create({ data: { email: `${prefix}premium@example.test`, role: "USER", subscription: { create: { tier: "PREMIUM", status: "ACTIVE" } }, notificationPreference: { create: { pushEnabled: false } } } });
  const prediction = await prisma.prediction.create({ data: { category: "PREMIUM", leagueApiId: 39, leagueName: "Premier League", homeTeam: "Synthetic Home", awayTeam: "Synthetic Away", homeTeamApiId: 91001, awayTeamApiId: 91002, fixtureApiId: 91999, kickoff: new Date(Date.now() + 3_600_000), status: "PUBLISHED", marketType: "MATCH_WINNER", selection: { side: "HOME" }, manualSettlementOnly: false, market: "Match winner", pick: "Synthetic Home", confidence: 70, reasoning: "Synthetic verification row", outcome: "PENDING", authorId: author.id, publishedAt: new Date(), categories: { create: [{ category: "PREMIUM" }, { category: "FEATURED" }] } } });

  for (const userId of [free.id, premium.id]) await prisma.userFollow.createMany({ data: [
    { userId, targetType: "TEAM", targetKey: "91001", label: "Synthetic Home" }, { userId, targetType: "LEAGUE", targetKey: "39", label: "Premier League" },
    { userId, targetType: "PREDICTION", targetKey: prediction.id, label: "Synthetic tip" }, { userId, targetType: "CATEGORY", targetKey: "PREMIUM", label: "Premium" },
  ] });
  const event = await createNotificationEvent({ eventKey: `${prefix}overlap`, type: "NEW_PREDICTION", predictionId: prediction.id, fixtureApiId: prediction.fixtureApiId, category: prediction.category, leagueApiId: prediction.leagueApiId, teamApiIds: [91001, 91002], title: "Synthetic publication", body: "Synthetic Home vs Synthetic Away", link: "/predictions", data: { categories: ["PREMIUM", "FEATURED"] } });
  await Promise.all([fanOutPendingEvents(), fanOutPendingEvents()]);
  assert.equal(await prisma.notificationDelivery.count({ where: { eventId: event.id } }), 2, "overlapping follows and concurrent fanout create one recipient row per user");
  await runNotificationDispatch(async () => true);
  assert.equal(await prisma.userNotification.count({ where: { userId: premium.id, eventId: event.id } }), 1, "entitled inbox delivery succeeds");
  assert.equal((await prisma.notificationDelivery.findUnique({ where: { eventId_userId: { eventId: event.id, userId: free.id } } }))?.status, "SKIPPED", "free user cannot receive paid event");

  const unfollowEvent = await createNotificationEvent({ eventKey: `${prefix}unfollow`, type: "TIP_CHANGED", predictionId: prediction.id, category: "PREMIUM", leagueApiId: 39, teamApiIds: [91001], title: "Changed", body: "Changed", link: "/predictions" });
  await fanOutPendingEvents();
  await prisma.userFollow.deleteMany({ where: { userId: premium.id } });
  await runNotificationDispatch(async () => true);
  assert.equal((await prisma.notificationDelivery.findUnique({ where: { eventId_userId: { eventId: unfollowEvent.id, userId: premium.id } } }))?.status, "SKIPPED", "unfollow is rechecked at dispatch");

  await prisma.userFollow.create({ data: { userId: premium.id, targetType: "PREDICTION", targetKey: prediction.id } });
  const leaseEvent = await createNotificationEvent({ eventKey: `${prefix}lease`, type: "TIP_CHANGED", predictionId: prediction.id, category: "FEATURED", title: "Lease", body: "Lease", link: "/predictions" });
  await fanOutPendingEvents();
  const [claimA, claimB] = await Promise.all([claimDeliveries(10), claimDeliveries(10)]);
  const overlap = claimA.rows.filter(a => claimB.rows.some(b => b.id === a.id));
  assert.equal(overlap.length, 0, "simultaneous claims do not share a delivery");
  const claimed = [...claimA.rows, ...claimB.rows].find(r => r.eventId === leaseEvent.id && r.userId === premium.id)!;
  await prisma.notificationDelivery.update({ where: { id: claimed.id }, data: { leaseToken: "crashed", leasedUntil: new Date(Date.now() - 1_000), status: "PENDING" } });
  assert.ok((await claimDeliveries(10)).rows.some(r => r.id === claimed.id), "expired lease is recovered after a worker crash");

  await prisma.notificationDelivery.update({ where: { id: claimed.id }, data: { leaseToken: null, leasedUntil: null, status: "PENDING", nextAttemptAt: new Date() } });
  await prisma.notificationPreference.update({ where: { userId: premium.id }, data: { pushEnabled: true } });
  const sub = await prisma.pushSubscription.create({ data: { userId: premium.id, endpointHash: `${prefix}transient`, endpoint: "https://push.example.test/transient", p256dh: "x".repeat(32), auth: "y".repeat(16) } });
  const retryRun = await runNotificationDispatch(async () => { throw new Error("synthetic transient failure"); });
  assert.equal(retryRun.retried, 1, `expected one transient retry, got ${JSON.stringify(retryRun)}`);
  assert.equal((await prisma.notificationDelivery.findUnique({ where: { id: claimed.id } }))?.status, "RETRY", "transient push failure schedules retry");
  await prisma.notificationDelivery.update({ where: { id: claimed.id }, data: { nextAttemptAt: new Date() } });
  await runNotificationDispatch(async () => true);
  assert.equal((await prisma.notificationDelivery.findUnique({ where: { id: claimed.id } }))?.status, "DELIVERED", "retry resumes and completes delivery");

  await sendPush(sub, {}, async () => { const error:any = new Error("gone"); error.statusCode = 410; throw error; });
  assert.equal(await prisma.pushSubscription.count({ where: { id: sub.id } }), 0, "expired push subscription is removed");

  const oldKickoff = new Date(Date.now() + 20 * 60_000), newKickoff = new Date(Date.now() + 80 * 60_000);
  await prisma.prediction.update({ where: { id: prediction.id }, data: { kickoff: newKickoff } });
  const reminder = await createNotificationEvent({ eventKey: `${prefix}reminder`, type: "KICKOFF_REMINDER", predictionId: prediction.id, category: "FEATURED", title: "Reminder", body: "Reminder", link: "/predictions", data: { kickoff: oldKickoff.toISOString() }, expiresAt: oldKickoff });
  await fanOutPendingEvents(); await runNotificationDispatch(async () => true);
  assert.equal((await prisma.notificationDelivery.findUnique({ where: { eventId_userId: { eventId: reminder.id, userId: premium.id } } }))?.status, "SKIPPED", "rescheduled reminder is suppressed");

  // A worker whose lease was taken over cannot overwrite the newer outcome.
  assert.equal(await releaseDelivery(claimed.id, "stale-token", { status: "FAILED" }), false, "release requires the current lease token");
  assert.equal((await prisma.notificationDelivery.findUnique({ where: { id: claimed.id } }))?.status, "DELIVERED");

  // A delivered row is never leased again, even with its lease cleared.
  assert.ok(!(await claimDeliveries(50)).rows.some((r) => r.id === claimed.id), "a delivered row cannot be reclaimed");

  // Kickoff reminders reach tip and team followers only, not league followers.
  const leagueOnly = await prisma.user.create({ data: { email: `${prefix}league@example.test`, role: "USER", subscription: { create: { tier: "FREE", status: "ACTIVE" } } } });
  await prisma.userFollow.create({ data: { userId: leagueOnly.id, targetType: "LEAGUE", targetKey: "39" } });
  const soon = new Date(Date.now() + 90 * 60_000);
  const audience = await createNotificationEvent({ eventKey: `${prefix}reminder-audience`, type: "KICKOFF_REMINDER", predictionId: prediction.id, leagueApiId: 39, teamApiIds: [91001, 91002], title: "Reminder", body: "Reminder", link: "/predictions", data: { kickoff: soon.toISOString(), predictionIds: [prediction.id] }, expiresAt: soon });
  await fanOutPendingEvents();
  const recipients = (await prisma.notificationDelivery.findMany({ where: { eventId: audience.id }, select: { userId: true } })).map((d) => d.userId);
  assert.ok(!recipients.includes(leagueOnly.id), "a league follower is not sent kickoff reminders");
  assert.ok(recipients.includes(free.id), "a team follower is sent the reminder");

  // Publishing through the shared helper (used by the bulk route) creates the event in the same transaction.
  const draft = await prisma.prediction.create({ data: { category: "FEATURED", leagueApiId: 39, leagueName: "Premier League", homeTeam: "Synthetic Home", awayTeam: "Synthetic Away", homeTeamApiId: 91001, awayTeamApiId: 91002, kickoff: new Date(Date.now() + 86_400_000), status: "PENDING_REVIEW", marketType: "MATCH_WINNER", selection: { side: "HOME" }, manualSettlementOnly: false, market: "Match winner", pick: "Synthetic Home", confidence: 65, reasoning: "Synthetic bulk publish row", outcome: "PENDING", authorId: author.id, categories: { create: [{ category: "FEATURED" }] } }, include: { categories: true } });
  await prisma.$transaction(async (tx) => {
    const published = await tx.prediction.update({ where: { id: draft.id }, data: reviewTransition("PUBLISH", author.id, draft), include: { categories: true } });
    await recordPredictionEvents(tx, draft, published, "PUBLISH");
  });
  assert.equal(await prisma.notificationEvent.count({ where: { predictionId: draft.id, type: "NEW_PREDICTION" } }), 1, "a bulk-style publish records one NEW_PREDICTION event");
  await prisma.notificationEvent.deleteMany({ where: { predictionId: draft.id } });

  const before = await prisma.prediction.findUniqueOrThrow({ where: { id: prediction.id } });
  await assert.rejects(prisma.$transaction(async tx => { await tx.prediction.update({ where: { id: prediction.id }, data: { pick: "Must roll back" } }); await tx.notificationEvent.create({ data: { eventKey: `${prefix}invalid`, type: "TIP_CHANGED", title: null as any, body: "x", link: "/predictions", teamApiIds: [] } }); }));
  assert.equal((await prisma.prediction.findUniqueOrThrow({ where: { id: prediction.id } })).pick, before.pick, "event failure rolls prediction mutation back");
  console.log("notification database integration checks passed");
}

main().finally(async()=>{await clear();await prisma.$disconnect()});
