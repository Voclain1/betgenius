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

/**
 * The editorial broadcast type. ONE type, deliberately, whatever selected the
 * prediction (Bet of the Day, a BANKER/Genius pick, an admin pin): the visitor's
 * preference is about being broadcast to, not about which desk chose the pick,
 * and a type per source would mean a preference per source to keep in step.
 * The source is carried in `data.source` for the inbox and for analytics.
 */
export const TOP_PREDICTION = "TOP_PREDICTION";

/** How a prediction came to be broadcast. An explicit decision is required for every one of them. */
export type TopPredictionSource = "BET_OF_THE_DAY" | "BANKER" | "ADMIN_PINNED" | "TREND_SELECTED";

/**
 * A pre-match Match Insight worth interrupting someone for.
 *
 * Follow-driven, not editorial: it goes to people who follow the match or a
 * team in it, so it is capped and gated as a followed alert.
 */
export const MATCH_INSIGHT = "MATCH_INSIGHT";

/**
 * How strong a cached insight has to be before it is worth a push.
 *
 * MatchInsightCache.strength is 0-1 and exists to ORDER insights on the match
 * page, where a weak one costs nothing because the reader chose to look. A push
 * is not chosen, so the bar is different: at 0.9 an insight is a run that has
 * held in at least nine of the last ten qualifying matches, which is the kind of
 * fact worth telling someone about before a match they follow. Everything below
 * stays on the page, where it belongs.
 */
export const INSIGHT_PUSH_MIN_STRENGTH = 0.9;

/**
 * One announcement per insight, per match.
 *
 * Scoped by the PREDICTION as well as the cache's insightKey, because
 * insightKey alone is `teamApiId:scope:type` — stable across matches by
 * design, so a team on a long run carries the same key from one fixture to the
 * next. Keying on it alone would announce that run once and then stay silent
 * for every later match; including the prediction announces it once per match,
 * which is what a pre-match insight is.
 *
 * The cache rows are deleted and rebuilt on each refresh, so the event key
 * cannot be derived from a row id — it has to be built from the stable parts.
 */
export function matchInsightEventKey(predictionId: string, insightKey: string) {
  return `insight:${predictionId}:${insightKey}`;
}

/**
 * Types that are BROADCASTS rather than fan-out over follows.
 *
 * This is the hinge of the whole targeting model. An editorial event has no
 * UserFollow row behind it, so followClauses() returns nothing for it and it
 * would silently reach zero people; and stillFollowsEvent() would then skip
 * every delivery at dispatch. Both of those consult this predicate instead of
 * assuming every event is a follow fan-out.
 */
export function isEditorialEvent(type: string) {
  return type === TOP_PREDICTION;
}

/**
 * The key for an editorial broadcast of one prediction.
 *
 * Scoped to the prediction and the LOCAL DAY, not to the click. eventKey is
 * unique and createNotificationEvent upserts on it, so this is what makes the
 * admin action idempotent: a double-click, a retried request, or an admin
 * pressing the button again an hour later all resolve to the same row and
 * broadcast exactly once. Including the day rather than nothing at all leaves
 * a deliberate re-feature of the same prediction on a later day possible,
 * which is an editorial decision someone may legitimately make.
 */
export function topPredictionEventKey(predictionId: string, day: string) {
  return `prediction:${predictionId}:top-pick:${day}`;
}

/**
 * THE EDITORIAL CAP. Deliberately far below NotificationPreference.dailyCap.
 *
 * The global cap protects against volume; this protects against a DIFFERENT
 * failure, which the global cap cannot see. Editorial candidates are plentiful
 * - a Bet of the Day, a Genius BANKER, any number of admin pins, and trend
 * selections on top - and every one of them is addressed to the whole opted-in
 * audience rather than to someone who asked for it. Letting all the candidates
 * through would fill a reader's daily allowance with broadcasts and crowd out
 * the alerts for the teams they actually follow.
 *
 * One a day. It is a floor on quality, not a budget to spend: the product
 * promise is that a top-pick push means something, and the second one of the
 * day already weakens it. Tunable without a deploy through EDITORIAL_DAILY_CAP,
 * and an unparseable or non-positive value falls back to 1 rather than to
 * "unlimited", so a typo in an environment variable cannot open the gate.
 *
 * This is a cap ON TOP OF the user's own settings, never instead of them:
 * quiet hours, entitlement, editorialAlerts and dailyCap are all still applied.
 */
export const EDITORIAL_DAILY_CAP = (() => {
  const configured = Number(process.env.EDITORIAL_DAILY_CAP);
  return Number.isInteger(configured) && configured > 0 ? configured : 1;
})();

/** The Lagos calendar day of `now`, as YYYY-MM-DD — the day boundary the rest of the product uses. */
export function editorialDay(now: Date = new Date(), timezone = "Africa/Lagos") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
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
/** One follow target an event reaches: a target type and the keys of that type it matches. */
export type FollowTarget = { targetType: "PREDICTION" | "TEAM" | "CATEGORY" | "LEAGUE"; targetKeys: string[] };

/**
 * WHICH FOLLOWS RECEIVE THIS EVENT — the single source of truth for targeting.
 *
 * Pure, and returns plain data rather than a Prisma clause, so every targeting
 * rule can be asserted directly (scripts/check-notification-targeting.ts)
 * instead of only being observable by seeding a database and watching who got
 * mail. followClauses() below is a mechanical translation of this, and
 * receivesEvent() answers the same question for one follow row, so a rule
 * cannot be right in the fan-out and wrong in the dispatch recheck.
 *
 * Returns an EMPTY list for a broadcast. That is not "nobody": it means this
 * event does not use the follow model at all, and its audience comes from
 * editorialAudience() instead. Callers must branch on isEditorialEvent rather
 * than reading emptiness here as "no recipients".
 */
export function followTargets(event: EventTargets): FollowTarget[] {
  // Returning nothing here, rather than falling through to the category and
  // league targets below, is deliberate: a Bet of the Day carries category
  // BET_OF_THE_DAY and a leagueApiId, so without this it would ALSO reach
  // league and category followers — under their FOLLOWED-alert preference and
  // outside the editorial cap. One event must have exactly one audience.
  if (isEditorialEvent(event.type)) return [];

  const data = (event.data ?? {}) as { categories?: unknown; predictionIds?: unknown };
  const predictionIds = new Set<string>(event.predictionId ? [event.predictionId] : []);
  if (Array.isArray(data.predictionIds)) for (const id of data.predictionIds) if (typeof id === "string") predictionIds.add(id);

  const targets: FollowTarget[] = [];
  if (predictionIds.size) targets.push({ targetType: "PREDICTION", targetKeys: [...predictionIds] });
  if (event.teamApiIds.length) targets.push({ targetType: "TEAM", targetKeys: event.teamApiIds.map(String) });
  // MATCH-SCOPED types stop here: they reach people who follow the tip or one
  // of the two teams, and nobody else.
  //
  // A kickoff reminder sent to every follower of the league or a category would
  // turn a reminder into a stream of them. A pre-match insight is the same
  // shape of mistake — it is a fact about THIS match, interesting to someone
  // tracking this match or one of its teams, and noise to someone who followed
  // a whole competition.
  if (event.type === "KICKOFF_REMINDER" || event.type === MATCH_INSIGHT) return targets;

  const categories = new Set<string>(event.category ? [event.category] : []);
  if (Array.isArray(data.categories)) for (const c of data.categories) if (typeof c === "string") categories.add(c);
  if (categories.size) targets.push({ targetType: "CATEGORY", targetKeys: [...categories] });
  if (event.leagueApiId) targets.push({ targetType: "LEAGUE", targetKeys: [String(event.leagueApiId)] });
  return targets;
}

/** Whether one follow row is in this event's audience. The same rules as followTargets, by construction. */
export function receivesEvent(follow: { targetType: string; targetKey: string }, event: EventTargets): boolean {
  return followTargets(event).some((t) => t.targetType === follow.targetType && t.targetKeys.includes(follow.targetKey));
}

function followClauses(event: EventTargets): Prisma.UserFollowWhereInput[] {
  return followTargets(event).map((t) => ({ targetType: t.targetType, targetKey: { in: t.targetKeys } }));
}

/**
 * The audience for an editorial broadcast: users who have OPTED IN.
 *
 * "Opted in" is literal here, not inferred. The column defaults to FALSE, so a
 * row only reads true because that user accepted the onboarding prompt (which
 * names Bet of the Day and top-prediction alerts) or ticked the box in their
 * settings. Nobody is in this set by default, by migration, or by having once
 * opened a settings page. Re-checked at dispatch by preferenceAllows in case
 * the preference changed between fan-out and delivery.
 *
 * DELIBERATELY INDEPENDENT OF pushEnabled AND OF HAVING A LIVE SUBSCRIPTION.
 * This selects who the event is FOR, not who can be reached by web push. A
 * user who opted in and later lost their browser subscription — a new device, a
 * 410 that pruned the row, permission revoked — still gets the broadcast in
 * their inbox, which works without push and is the surface /notifications
 * exists to serve. Whether a push is also SENT is decided much later, per
 * device, by pushEnabled, quiet hours and the subscriptions actually on file.
 * Filtering here on push-reachability would silently turn the inbox into a
 * mirror of the push channel and lose notifications for exactly the people
 * whose subscription had just expired.
 */
async function editorialAudience() {
  const rows = await prisma.notificationPreference.findMany({ where: { editorialAlerts: true }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

async function eligibleRecipients(event: EventTargets & { createdAt: Date }) {
  if (isEditorialEvent(event.type)) return editorialAudience();
  const clauses = followClauses(event);
  if (!clauses.length) return [];
  const follows = await prisma.userFollow.findMany({ where: { OR: clauses, createdAt: { lte: event.createdAt } }, select: { userId: true } });
  return [...new Set(follows.map((f) => f.userId))];
}

/**
 * Rechecked at dispatch: an unfollow between fan-out and delivery wins.
 *
 * An editorial broadcast has no follow to lose, so it passes here
 * unconditionally - without this it would be skipped as "no longer followed"
 * for every recipient, which is precisely the bug of treating one audience
 * model as if it were the other. Its own opt-out is enforced immediately
 * afterwards by preferenceAllows(editorialAlerts).
 */
export async function stillFollowsEvent(userId: string, event: EventTargets) {
  if (isEditorialEvent(event.type)) return true;
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
    const ids = await eligibleRecipients(event);
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

/** The preference fields this decision reads. Named so callers can pass a partial row in tests. */
export type PreferenceFlags = Partial<
  Record<"newPredictions" | "kickoffReminders" | "tipChanges" | "results" | "followedAlerts" | "editorialAlerts", boolean>
>;

/**
 * Whether this user's preferences allow a notification of this type.
 *
 * THREE INDEPENDENT CONTROLS, which is the point of the followedAlerts /
 * editorialAlerts split:
 *
 *   1. followedAlerts  - everything driven by a UserFollow row. A master switch
 *                        over the existing per-kind flags, so turning it off
 *                        silences follow-driven alerts WITHOUT touching the
 *                        editorial broadcasts, and the finer newPredictions /
 *                        tipChanges / results flags keep working underneath it.
 *   2. editorialAlerts - broadcasts nobody followed. Governs TOP_PREDICTION and
 *                        nothing else, so switching it off costs the user none
 *                        of their own follows.
 *   3. kickoffReminders - deliberately NOT under followedAlerts. A reminder is
 *                        a clock, not a content update, and someone who wants
 *                        only "tell me when my match starts" must be able to
 *                        have exactly that.
 *
 * ABSENT FLAGS FALL BACK ASYMMETRICALLY, matching the column defaults:
 *
 *   - Everything follow-driven defaults TRUE, so a user with no preference row
 *     behaves exactly as they did before these columns existed.
 *   - editorialAlerts defaults FALSE. A broadcast is a new category of
 *     notification nobody has consented to, and a missing row is not consent.
 *     This is the same rule as the column default, repeated here because the
 *     two are reached by different paths: the column covers rows created from
 *     now on, this covers users who have no row at all.
 */
export function preferenceAllows(type: string, p: PreferenceFlags | null | undefined) {
  // NOT `?? true`. See the note above — silence is the correct default for a
  // broadcast, and a user who has never been asked has not agreed.
  if (type === TOP_PREDICTION) return p?.editorialAlerts ?? false;
  // Independent of followedAlerts - see 3 above.
  if (type === "KICKOFF_REMINDER") return p?.kickoffReminders ?? true;

  const followed = p?.followedAlerts ?? true;
  if (!followed) return false;
  if (type === "NEW_PREDICTION") return p?.newPredictions ?? true;
  if (type === "TIP_CHANGED" || type === "WITHDRAWN") return p?.tipChanges ?? true;
  if (type === MATCH_INSIGHT) return true;
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
