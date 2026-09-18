import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { resolveSubscription } from "@/lib/entitlement";
import type { PredictionCategory, Role, SubscriptionStatus, SubscriptionTier } from "@/lib/enums";
import { safeNotificationLink } from "@/lib/notificationLinks";
import { matchSlug } from "@/lib/slug";

/**
 * The client or an interactive-transaction client. Derived from the exported
 * `prisma` rather than Prisma.TransactionClient because that client is built
 * with $extends, and an extended client's `tx` is not the base type.
 */
type Db = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type EventInput = {
  eventKey: string;
  type: string;
  predictionId?: string;
  fixtureApiId?: number | null;
  category?: string | null;
  leagueApiId?: number | null;
  teamApiIds?: number[];
  title: string;
  body: string;
  link: string;
  data?: Record<string, unknown>;
  availableAt?: Date;
  expiresAt?: Date | null;
};

/** Idempotent on eventKey: a retried hook or cron request cannot create the same event twice. */
export async function createNotificationEvent(input: EventInput, db: Db = prisma) {
  return db.notificationEvent.upsert({
    where: { eventKey: input.eventKey },
    update: {},
    create: {
      ...input,
      teamApiIds: input.teamApiIds ?? [],
      link: safeNotificationLink(input.link),
      data: input.data as Prisma.InputJsonValue | undefined,
    },
  });
}

export function publicationEventKey(id: string, publishedAt: Date) {
  return `prediction:${id}:published:${publishedAt.toISOString()}`;
}

export function materialSnapshot(p: { market: string; pick: string; odds: number | null; kickoff: Date | null; status: string }) {
  return { market: p.market, pick: p.pick, odds: p.odds, kickoff: p.kickoff?.toISOString() ?? null, status: p.status };
}

export function materialChangeKey(id: string, before: unknown, after: unknown) {
  const digest = createHash("sha256").update(JSON.stringify({ before, after })).digest("hex").slice(0, 20);
  return `prediction:${id}:changed:${digest}`;
}

export function settlementEventKey(id: string, outcome: string, settledAt: Date) {
  return `prediction:${id}:settled:${outcome}:${settledAt.toISOString()}`;
}

export function kickoffReminderKey(fixtureKey: string, kickoff: Date) {
  return `fixture:${fixtureKey}:kickoff:${Math.floor(kickoff.getTime() / 60_000)}`;
}

type PredictionForEvents = {
  id: string;
  status: string;
  outcome: string;
  market: string;
  pick: string;
  odds: number | null;
  kickoff: Date | null;
  publishedAt: Date | null;
  settledAt: Date | null;
  updatedAt: Date;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  fixtureApiId: number | null;
  leagueApiId: number | null;
  category: string;
  categories: { category: string }[];
};

/**
 * The lifecycle events one admin change to a prediction produces. Shared by
 * the single-row PATCH and the bulk review route so the two cannot drift, and
 * run inside the caller's transaction so a failed event rolls the change back.
 */
export async function recordPredictionEvents(
  tx: Db,
  before: PredictionForEvents,
  after: PredictionForEvents,
  action?: string,
) {
  const slug = matchSlug({ homeTeam: after.homeTeam, awayTeam: after.awayTeam, kickoff: after.kickoff });
  const match = `${after.homeTeam} vs ${after.awayTeam}`;
  const common = {
    predictionId: after.id,
    fixtureApiId: after.fixtureApiId,
    category: after.category,
    leagueApiId: after.leagueApiId,
    teamApiIds: [after.homeTeamApiId, after.awayTeamApiId].filter((x): x is number => x != null),
    link: slug ? `/predictions/match/${slug}` : "/predictions",
  };
  const categories = { categories: after.categories.map((c) => c.category) };

  if (before.status !== "PUBLISHED" && after.status === "PUBLISHED" && after.publishedAt) {
    await createNotificationEvent({ ...common, eventKey: publicationEventKey(after.id, after.publishedAt), type: "NEW_PREDICTION", title: "New prediction published", body: match, data: categories }, tx);
  } else if (before.status === "PUBLISHED" && after.status === "PUBLISHED") {
    const oldState = materialSnapshot(before);
    const newState = materialSnapshot(after);
    if (JSON.stringify(oldState) !== JSON.stringify(newState)) {
      await createNotificationEvent({ ...common, eventKey: materialChangeKey(after.id, oldState, newState), type: "TIP_CHANGED", title: "Followed tip changed", body: `${match} has a material update.`, data: { ...categories, before: oldState, after: newState } }, tx);
    }
  }

  if (action === "ARCHIVE" && before.status === "PUBLISHED") {
    await createNotificationEvent({ ...common, eventKey: `prediction:${after.id}:withdrawn:${after.updatedAt.toISOString()}`, type: "WITHDRAWN", title: "Prediction withdrawn", body: `${match} is no longer available.`, data: categories }, tx);
  }

  if (after.status === "PUBLISHED" && after.outcome !== "PENDING" && after.settledAt && before.outcome !== after.outcome) {
    await createNotificationEvent({
      ...common,
      eventKey: settlementEventKey(after.id, after.outcome, after.settledAt),
      type: `RESULT_${after.outcome}`,
      title: before.outcome !== "PENDING" ? "Result corrected" : `Tip ${after.outcome.toLowerCase()}`,
      body: `${match}: ${after.outcome}.`,
      data: { ...categories, before: before.outcome, after: after.outcome },
    }, tx);
  }
}

type EventTargets = {
  type: string;
  predictionId: string | null;
  category: string | null;
  leagueApiId: number | null;
  teamApiIds: number[];
  data: unknown;
};

/**
 * The follow rows that make a user a recipient of this event.
 *
 * A kickoff reminder is for people who follow the tip or one of the two
 * teams. Sending it to every follower of the league or a category would turn
 * a reminder into a stream of them, so those follows are deliberately left out.
 */
function followClauses(event: EventTargets): Prisma.UserFollowWhereInput[] {
  const data = (event.data ?? {}) as { categories?: unknown; predictionIds?: unknown };
  const predictionIds = new Set<string>(event.predictionId ? [event.predictionId] : []);
  if (Array.isArray(data.predictionIds)) for (const id of data.predictionIds) if (typeof id === "string") predictionIds.add(id);

  const clauses: Prisma.UserFollowWhereInput[] = [];
  if (predictionIds.size) clauses.push({ targetType: "PREDICTION", targetKey: { in: [...predictionIds] } });
  if (event.teamApiIds.length) clauses.push({ targetType: "TEAM", targetKey: { in: event.teamApiIds.map(String) } });
  if (event.type === "KICKOFF_REMINDER") return clauses;

  const categories = new Set<string>(event.category ? [event.category] : []);
  if (Array.isArray(data.categories)) for (const c of data.categories) if (typeof c === "string") categories.add(c);
  if (categories.size) clauses.push({ targetType: "CATEGORY", targetKey: { in: [...categories] } });
  if (event.leagueApiId) clauses.push({ targetType: "LEAGUE", targetKey: String(event.leagueApiId) });
  return clauses;
}

async function eligibleFollowers(event: EventTargets & { createdAt: Date }) {
  const clauses = followClauses(event);
  if (!clauses.length) return [];
  const follows = await prisma.userFollow.findMany({ where: { OR: clauses, createdAt: { lte: event.createdAt } }, select: { userId: true } });
  return [...new Set(follows.map((f) => f.userId))];
}

/** Rechecked at dispatch: an unfollow between fan-out and delivery wins. */
export async function stillFollowsEvent(userId: string, event: EventTargets) {
  const clauses = followClauses(event);
  return clauses.length > 0 && !!(await prisma.userFollow.findFirst({ where: { userId, OR: clauses }, select: { id: true } }));
}

export async function fanOutPendingEvents(limit = 25) {
  const events = await prisma.notificationEvent.findMany({
    where: { availableAt: { lte: new Date() }, fannedOutAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let recipients = 0;
  for (const event of events) {
    const ids = await eligibleFollowers(event);
    if (ids.length) {
      await prisma.notificationDelivery.createMany({ data: ids.map((userId) => ({ eventId: event.id, userId })), skipDuplicates: true });
      recipients += ids.length;
    }
    await prisma.notificationEvent.update({ where: { id: event.id }, data: { fannedOutAt: new Date() } });
  }
  return { events: events.length, recipients };
}

export function inQuietHours(now: Date, timezone: string, start: number | null, end: number | null) {
  if (start == null || end == null || start === end) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const minute = Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** The UTC instant of midnight, local to `timezone`, on the local day containing `now`. */
export function localDayStartUtc(now: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = (date: Date) => Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  const here = parts(now);
  const guess = Date.UTC(here.year, here.month - 1, here.day);
  const atGuess = parts(new Date(guess));
  const represented = Date.UTC(atGuess.year, atGuess.month - 1, atGuess.day, atGuess.hour, atGuess.minute, atGuess.second);
  return new Date(guess - (represented - guess));
}

/**
 * Longer than the dispatch route's maxDuration, so a lease can only lapse once
 * the worker holding it is gone. A shorter lease let a slow but live worker's
 * rows be reclaimed and sent a second time.
 */
export const LEASE_MS = 5 * 60_000;

export async function claimDeliveries(limit = 50) {
  const token = randomUUID();
  const now = new Date();
  const claimable: Prisma.NotificationDeliveryWhereInput = {
    status: { in: ["PENDING", "RETRY"] },
    nextAttemptAt: { lte: now },
    OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
  };
  const candidates = await prisma.notificationDelivery.findMany({ where: claimable, orderBy: { createdAt: "asc" }, take: limit, select: { id: true } });
  if (!candidates.length) return { token, rows: [] };
  // The full claimable condition is repeated here, not just the lease check: a
  // row another worker delivered (lease cleared, status DELIVERED) between the
  // read above and this write must not be leased and sent again.
  await prisma.notificationDelivery.updateMany({
    where: { id: { in: candidates.map((c) => c.id) }, ...claimable },
    data: { leaseToken: token, leasedUntil: new Date(now.getTime() + LEASE_MS) },
  });
  const rows = await prisma.notificationDelivery.findMany({
    where: { leaseToken: token },
    include: { event: true, user: { include: { subscription: true, notificationPreference: true, pushSubscriptions: true } } },
  });
  return { token, rows };
}

/** Finalise a claimed delivery. A no-op if the lease was lost, so a stale worker cannot overwrite a newer outcome. */
export async function releaseDelivery(id: string, token: string, data: Prisma.NotificationDeliveryUpdateManyMutationInput) {
  const result = await prisma.notificationDelivery.updateMany({
    where: { id, leaseToken: token },
    data: { ...data, leaseToken: null, leasedUntil: null },
  });
  return result.count === 1;
}

export function preferenceAllows(type: string, p: Partial<Record<"newPredictions" | "kickoffReminders" | "tipChanges" | "results", boolean>> | null | undefined) {
  if (type === "NEW_PREDICTION") return p?.newPredictions ?? true;
  if (type === "KICKOFF_REMINDER") return p?.kickoffReminders ?? true;
  if (type === "TIP_CHANGED" || type === "WITHDRAWN") return p?.tipChanges ?? true;
  if (type.startsWith("RESULT_")) return p?.results ?? true;
  return true;
}

/**
 * Whether a notification's category may be shown to this user.
 *
 * The subscription is already a fresh row here (the dispatcher loads it), but
 * it is still put through resolveSubscription so an ACTIVE row whose paid
 * period has run out does not keep receiving paid picks by email or push —
 * the same rule the pages apply, from the same helper.
 */
export function entitled(
  category: string | null,
  user: {
    role: string;
    subscription: { tier: string; status: string; currentPeriodEnd?: Date | null } | null;
  },
  now: Date = new Date(),
) {
  const resolved = resolveSubscription(
    user.subscription ? { ...user.subscription, currentPeriodEnd: user.subscription.currentPeriodEnd ?? null } : null,
    now,
  );
  return !category || canViewCategory(
    category as PredictionCategory,
    resolved.tier,
    resolved.status,
    user.role as Role,
  );
}
