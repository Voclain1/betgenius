/**
 * Inbox history is not discarded by the push/noise daily cap.
 *
 * NEW_PREDICTION and RESULT_* are the per-match inbox record behind the digests.
 * They never ring, so the user's dailyCap (default 12), which exists to limit
 * interruptions, must neither be used up by them nor block them. Push-class
 * events (tip changes, reminders, digests...) keep that cap exactly as before.
 *
 * Drives the real runNotificationDispatch against an in-memory outbox: the
 * Prisma methods it reaches are replaced before it runs, and the filter
 * evaluator below throws on any filter shape it does not understand, so the
 * stub cannot silently match everything. No database, no network.
 *
 * Run: npx tsx scripts/check-inbox-history-cap.ts
 */
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { runNotificationDispatch } from "../src/lib/notificationDispatch";
import {
  DEFAULT_DAILY_CAP,
  INBOX_HISTORY_DAILY_CEILING,
  dailyCapAllows,
  buildNightDigest,
  dailyCapClass,
  lagosInstant,
  shouldPush,
} from "../src/lib/notificationDigest";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

type Ev = {
  id: string; type: string; eventKey: string; predictionId: string | null; category: string | null;
  leagueApiId: number | null; teamApiIds: number[]; data: unknown; title: string; body: string; link: string;
  expiresAt: Date | null; createdAt: Date; availableAt: Date;
};
type Delivery = { id: string; userId: string; eventId: string; status: string; attempts: number; leaseToken: string | null; lastError?: string; nextAttemptAt: Date };
type Inbox = { userId: string; eventId: string; createdAt: Date };

// A Prisma NotificationEventWhereInput, evaluated in memory. Only the shapes
// dispatch uses are supported; anything else throws rather than guessing.
function matches(ev: Ev, where: Record<string, any>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") { if (!(value as Record<string, any>[]).some((w) => matches(ev, w))) return false; continue; }
    if (key === "NOT") { if (matches(ev, value)) return false; continue; }
    if (key === "type") {
      if (typeof value === "string") { if (ev.type !== value) return false; }
      else if (typeof value?.startsWith === "string") { if (!ev.type.startsWith(value.startsWith)) return false; }
      else throw new Error(`unsupported type filter ${JSON.stringify(value)}`);
      continue;
    }
    if (key === "leagueApiId") {
      if (value === null) { if (ev.leagueApiId !== null) return false; }
      else if (Array.isArray(value?.in)) { if (ev.leagueApiId == null || !value.in.includes(ev.leagueApiId)) return false; }
      else if (Array.isArray(value?.notIn)) { if (ev.leagueApiId == null || value.notIn.includes(ev.leagueApiId)) return false; }
      else throw new Error(`unsupported leagueApiId filter ${JSON.stringify(value)}`);
      continue;
    }
    if (key === "data") {
      const v = (ev.data ?? {}) as Record<string, unknown>;
      if (v[value.path[0]] !== value.equals) return false;
      continue;
    }
    throw new Error(`unsupported event filter key ${key}`);
  }
  return true;
}

const events = new Map<string, Ev>();
let deliveries: Delivery[] = [];
let inbox: Inbox[] = [];
const pushes: { eventType: string; userId: string }[] = [];
let seq = 0;
// Dispatch's clock. null = real time (the cap scenarios); set for the digest-hold scenario.
let clockMs: number | null = null;
const clock = () => (clockMs == null ? new Date() : new Date(clockMs));

const FREE_USER = {
  id: "u1", role: "USER", subscription: null,
  notificationPreference: {
    pushEnabled: true, timezone: "Africa/Lagos", quietStartMinutes: null, quietEndMinutes: null, dailyCap: DEFAULT_DAILY_CAP,
    followedAlerts: true, editorialAlerts: false, newPredictions: true, results: true, tipChanges: true, kickoffReminders: true, kickoffMinutes: 30,
  },
  pushSubscriptions: [{ id: "s1", endpoint: "https://push.example/1", p256dh: "k", auth: "a" }],
};
const users = new Map<string, typeof FREE_USER>([[FREE_USER.id, FREE_USER]]);

function queue(type: string, overrides: Partial<Ev> = {}, userId = FREE_USER.id) {
  seq++;
  const ev: Ev = {
    id: `e${seq}`, type, eventKey: `${type}:${seq}`, predictionId: `p${seq}`, category: "FEATURED", leagueApiId: 39, teamApiIds: [],
    data: {}, title: `${type} ${seq}`, body: "body", link: "/predictions", expiresAt: null, createdAt: new Date(), availableAt: new Date(),
    ...overrides,
  };
  events.set(ev.id, ev);
  deliveries.push({ id: `d${seq}`, userId, eventId: ev.id, status: "PENDING", attempts: 0, leaseToken: null, nextAttemptAt: new Date(0) });
  return ev;
}

const db = prisma as unknown as Record<string, Record<string, unknown>>;
db.notificationEvent.findMany = async () => []; // fan-out: nothing new to fan out
db.userFollow.findFirst = async () => ({ id: "follow" }); // still follows every queued event
db.userFollow.findMany = async () => [];
db.notificationDelivery.findMany = async ({ where, take }: { where: Record<string, any>; take?: number }) => {
  if (where.leaseToken) {
    return deliveries
      .filter((d) => d.leaseToken === where.leaseToken)
      .map((d) => ({ ...d, event: events.get(d.eventId)!, user: users.get(d.userId)! }));
  }
  // Honours nextAttemptAt, as claimDeliveries' real filter does, against the dispatch clock.
  return deliveries
    .filter((d) => (d.status === "PENDING" || d.status === "RETRY") && d.nextAttemptAt <= clock())
    .slice(0, take ?? 50)
    .map((d) => ({ id: d.id }));
};
db.notificationDelivery.updateMany = async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
  let count = 0;
  for (const d of deliveries) {
    const hit = where.id?.in
      ? where.id.in.includes(d.id) && (d.status === "PENDING" || d.status === "RETRY") && d.nextAttemptAt <= clock()
      : d.id === where.id && d.leaseToken === where.leaseToken;
    if (!hit) continue;
    count++;
    if ("leaseToken" in data) d.leaseToken = data.leaseToken;
    if (typeof data.status === "string") d.status = data.status;
    if (typeof data.lastError === "string") d.lastError = data.lastError;
    if (data.nextAttemptAt instanceof Date) d.nextAttemptAt = data.nextAttemptAt;
  }
  return { count };
};
db.userNotification.count = async ({ where }: { where: { userId: string; createdAt: { gte: Date }; event: Record<string, any> } }) =>
  inbox.filter((n) => n.userId === where.userId && n.createdAt >= where.createdAt.gte && matches(events.get(n.eventId)!, where.event)).length;
db.userNotification.upsert = async ({ where }: { where: { userId_eventId: { userId: string; eventId: string } } }) => {
  const { userId, eventId } = where.userId_eventId;
  let row = inbox.find((n) => n.userId === userId && n.eventId === eventId);
  if (!row) inbox.push((row = { userId, eventId, createdAt: clock() }));
  return row;
};

const transport = (async (sub: { id: string }, payload: { tag: string }) => {
  const ev = [...events.values()].find((e) => e.eventKey === payload.tag)!;
  pushes.push({ eventType: ev.type, userId: [...users.values()].find((u) => u.pushSubscriptions.some((s) => s.id === sub.id))!.id });
}) as unknown as Parameters<typeof runNotificationDispatch>[0];

async function drain() {
  for (let i = 0; i < 20 && deliveries.some((d) => d.status === "PENDING" || d.status === "RETRY"); i++) await runNotificationDispatch(transport, clock);
}

function reset() {
  events.clear(); deliveries = []; inbox = []; pushes.length = 0; seq = 0; clockMs = null;
}

const isHistory = (t: string) => t === "NEW_PREDICTION" || t.startsWith("RESULT_");
const inboxOf = (pred: (t: string) => boolean) => inbox.filter((n) => pred(events.get(n.eventId)!.type)).length;
const skipped = (reason: string) => deliveries.filter((d) => d.status === "SKIPPED" && d.lastError === reason);

(async () => {
  console.log("\ncap classes:");
  check("NEW_PREDICTION is history", dailyCapClass({ type: "NEW_PREDICTION" }) === "history");
  for (const t of ["RESULT_WON", "RESULT_LOST", "RESULT_VOID"]) check(`${t} is history`, dailyCapClass({ type: t }) === "history");
  for (const t of ["TIP_CHANGED", "WITHDRAWN", "KICKOFF_REMINDER", "MATCH_INSIGHT", "DIGEST_MORNING", "DIGEST_NIGHT"]) check(`${t} is push-class`, dailyCapClass({ type: t }) === "push");
  check("history is never pushed individually", ["NEW_PREDICTION", "RESULT_WON", "RESULT_LOST", "RESULT_VOID"].every((t) => !shouldPush(t, { pushEnabled: true, inQuietHours: false, leagueApiId: 39 })));
  check("history is not limited by dailyCap", dailyCapAllows("history", 12, 12) && dailyCapAllows("history", 200, 1));
  check("...only by the runaway ceiling", !dailyCapAllows("history", INBOX_HISTORY_DAILY_CEILING, 12) && INBOX_HISTORY_DAILY_CEILING >= 200);
  check("push-class keeps dailyCap exactly", dailyCapAllows("push", 11, 12) && !dailyCapAllows("push", 12, 12) && !dailyCapAllows("push", 3, 3));
  check("push-class default cap is still 12", DEFAULT_DAILY_CAP === 12 && !dailyCapAllows("push", 12, null) && dailyCapAllows("push", 11, undefined));
  check("an inbox-only top prediction keeps its own dailyCap allowance", !dailyCapAllows("inbox", 12, 12) && dailyCapAllows("inbox", 11, 12));

  console.log("\n40 history rows first, then 20 tip changes (dailyCap 12):");
  reset();
  for (let i = 0; i < 20; i++) { queue("NEW_PREDICTION"); queue(i % 3 ? "RESULT_WON" : "RESULT_LOST"); }
  for (let i = 0; i < 20; i++) queue("TIP_CHANGED");
  await drain();
  check("all 40 history rows reach the inbox (more than 12)", inboxOf(isHistory) === 40, inboxOf(isHistory));
  check("history does not use up the push allowance: 12 tip changes delivered", inboxOf((t) => t === "TIP_CHANGED") === 12, inboxOf((t) => t === "TIP_CHANGED"));
  check("the other 8 tip changes are skipped by the daily cap", skipped("daily cap").length === 8 && skipped("daily cap").every((d) => events.get(d.eventId)!.type === "TIP_CHANGED"));
  check("exactly 12 pushes, all tip changes", pushes.length === 12 && pushes.every((p) => p.eventType === "TIP_CHANGED"), pushes.length);
  check("no history row is ever skipped for the cap", !deliveries.some((d) => isHistory(events.get(d.eventId)!.type) && d.status === "SKIPPED"));

  console.log("\n20 tip changes first, then 60 history rows:");
  reset();
  for (let i = 0; i < 20; i++) queue("TIP_CHANGED");
  for (let i = 0; i < 30; i++) { queue("NEW_PREDICTION"); queue("RESULT_WON"); }
  await drain();
  check("a full push allowance does not block history: all 60 reach the inbox", inboxOf(isHistory) === 60, inboxOf(isHistory));
  check("push-class is still capped at 12", inboxOf((t) => t === "TIP_CHANGED") === 12 && pushes.length === 12);
  check("history produced no push", pushes.every((p) => !isHistory(p.eventType)));

  console.log("\nentitlement and idempotency are unchanged:");
  reset();
  const vip = queue("RESULT_WON", { category: "VIP" });
  queue("NEW_PREDICTION", { category: "PREMIUM" });
  for (let i = 0; i < 15; i++) queue("RESULT_LOST");
  await drain();
  check("a paid-category history row is skipped for a free user", skipped("no entitlement").length === 2 && !inbox.some((n) => n.eventId === vip.id));
  check("...while 15 free rows are delivered", inboxOf(isHistory) === 15);
  const before = inbox.length;
  const again = deliveries.find((d) => d.status === "DELIVERED")!;
  again.status = "RETRY"; // a delivery re-claimed after its inbox row was already written
  await drain();
  check("re-delivering an event writes no second inbox row (userId_eventId upsert)", inbox.length === before);
  const dispatch = readFileSync("src/lib/notificationDispatch.ts", "utf8");
  check("the inbox write is still the userId_eventId upsert", /userNotification\.upsert\(\{\s*where: \{ userId_eventId:/.test(dispatch));
  check("entitlement is still checked before the cap", dispatch.indexOf('"no entitlement"') < dispatch.indexOf("dailyCapAllows("));

  console.log("\nthe runaway ceiling still bounds history:");
  reset();
  for (let i = 0; i < INBOX_HISTORY_DAILY_CEILING + 3; i++) queue("NEW_PREDICTION");
  await drain();
  check(`at most ${INBOX_HISTORY_DAILY_CEILING} history rows a day`, inboxOf(isHistory) === INBOX_HISTORY_DAILY_CEILING, inboxOf(isHistory));
  check("...the rest skipped with their own reason, not 'daily cap'", skipped("inbox history ceiling").length === 3 && skipped("daily cap").length === 0);

  console.log("\nthe night digest is created around 03:10 but held until 07:00 (Lagos):");
  reset();
  // Two editorial readers: one with no quiet hours, one whose quiet hours (06:00-08:00) cover 07:00.
  const pref = FREE_USER.notificationPreference;
  const EARLY = { ...FREE_USER, id: "u-early", notificationPreference: { ...pref, editorialAlerts: true }, pushSubscriptions: [{ ...FREE_USER.pushSubscriptions[0], id: "s-early" }] };
  const QUIET = { ...FREE_USER, id: "u-quiet", notificationPreference: { ...pref, editorialAlerts: true, quietStartMinutes: 6 * 60, quietEndMinutes: 8 * 60 }, pushSubscriptions: [{ ...FREE_USER.pushSubscriptions[0], id: "s-quiet" }] };
  users.set(EARLY.id, EARLY as unknown as typeof FREE_USER);
  users.set(QUIET.id, QUIET as unknown as typeof FREE_USER);
  const SEP22 = "2026-09-22", SEP23 = "2026-09-23";
  const nightData = buildNightDigest(
    [{ id: "n1", homeTeam: "A", awayTeam: "B", leagueApiId: 39, market: "1X2", pick: "Home", odds: 1.9, confidence: 70, kickoff: lagosInstant(SEP22, 20 * 60), outcome: "WON", category: "FEATURED", categories: [], link: "/m" }],
    null,
    SEP22,
  );
  const nightFields = { predictionId: null, category: null, leagueApiId: null, data: nightData, eventKey: "digest:night:2026-09-22", createdAt: lagosInstant(SEP23, 3 * 60 + 10), expiresAt: lagosInstant(SEP23, 12 * 60) };
  const nightEarly = queue("DIGEST_NIGHT", { ...nightFields, id: "night-early" }, EARLY.id);
  const nightQuiet = queue("DIGEST_NIGHT", { ...nightFields, id: "night-quiet" }, QUIET.id);
  const tipAt0315 = queue("TIP_CHANGED", {}, EARLY.id);
  const at = (minutes: number) => lagosInstant(SEP23, minutes).getTime();

  clockMs = at(3 * 60 + 15);
  await runNotificationDispatch(transport, clock);
  const heldEarly = deliveries.find((d) => d.eventId === nightEarly.id)!;
  check("dispatch at 03:15: the night digest is deferred, not delivered or skipped", heldEarly.status === "RETRY" && deliveries.find((d) => d.eventId === nightQuiet.id)!.status === "RETRY");
  check("...to 07:00 Lagos, through the ordinary nextAttemptAt path", heldEarly.nextAttemptAt.getTime() === at(7 * 60), heldEarly.nextAttemptAt);
  check("...with no push and no inbox row yet", !pushes.some((p) => p.eventType === "DIGEST_NIGHT") && !inbox.some((n) => n.eventId === nightEarly.id || n.eventId === nightQuiet.id));
  check("...and without using up a retry attempt", heldEarly.attempts === 0);
  check("other events are not held: a tip change at 03:15 is delivered and pushed", inbox.some((n) => n.eventId === tipAt0315.id) && pushes.some((p) => p.eventType === "TIP_CHANGED"));

  clockMs = at(6 * 60 + 58);
  await runNotificationDispatch(transport, clock);
  check("06:58: still held", deliveries.filter((d) => events.get(d.eventId)!.type === "DIGEST_NIGHT").every((d) => d.status === "RETRY") && !pushes.some((p) => p.eventType === "DIGEST_NIGHT"));

  clockMs = at(7 * 60);
  await runNotificationDispatch(transport, clock);
  check("07:00: delivered to the inbox", inbox.some((n) => n.eventId === nightEarly.id && n.userId === EARLY.id) && deliveries.find((d) => d.eventId === nightEarly.id)!.status === "DELIVERED");
  check("...and the browser push goes out for a reader without quiet hours", pushes.filter((p) => p.eventType === "DIGEST_NIGHT").map((p) => p.userId).join() === EARLY.id);
  check(
    "quiet hours covering 07:00 still apply: inbox row written, no push",
    inbox.some((n) => n.eventId === nightQuiet.id && n.userId === QUIET.id) && !pushes.some((p) => p.userId === QUIET.id),
  );
  check("exactly one night-digest push in total", pushes.filter((p) => p.eventType === "DIGEST_NIGHT").length === 1);

  reset();
  const morningEvent = queue("DIGEST_MORNING", { predictionId: null, category: null, leagueApiId: null, data: { kind: "MORNING", day: SEP23, categories: [], betOfTheDay: null, highlights: [], items: [] } }, EARLY.id);
  clockMs = at(9 * 60 + 5);
  await runNotificationDispatch(transport, clock);
  check("the morning digest is not held", deliveries.find((d) => d.eventId === morningEvent.id)!.status !== "RETRY");

  if (failures) {
    console.error(`\n${failures} inbox history cap check(s) failed`);
    process.exit(1);
  }
  console.log("\ninbox history cap checks passed");
})();
