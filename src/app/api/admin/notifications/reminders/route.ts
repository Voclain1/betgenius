import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  INSIGHT_PUSH_MIN_STRENGTH,
  MATCH_INSIGHT,
  createNotificationEvent,
  kickoffReminderKey,
  matchInsightEventKey,
} from "@/lib/notifications";
import { INSIGHT_TYPE_LABELS, type InsightType } from "@/lib/insights";
import { JOB_NOTIFICATIONS_REMINDERS, withJobRun } from "@/lib/jobRuns";
import { createDailyDigests } from "@/lib/dailyDigests";
import { matchKey, matchSlug } from "@/lib/slug";

/**
 * Creates one kickoff reminder per followed fixture. Followers of the tip and
 * of either team receive it (see followClauses); the per-user lead time is
 * applied at dispatch, which is why the window here covers the longest
 * allowed preference.
 */
export const dynamic = "force-dynamic";

const LOOKAHEAD_MS = 180 * 60_000;

function authorized(req: NextRequest) {
  return !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

/**
 * Pre-match Match Insight events for followed fixtures.
 *
 * Reads MatchInsightCache and nothing else — the cache is already maintained by
 * the insight refresh job, so this adds no football-API call and no new
 * schedule. It runs here rather than in its own cron because it needs exactly
 * the set this job has already computed: followed fixtures with a kickoff
 * ahead.
 *
 * Only the strongest insights qualify (INSIGHT_PUSH_MIN_STRENGTH) and only the
 * single strongest per match is announced. A match can easily carry six
 * qualifying insights across both teams and three scopes; sending all of them
 * would be six pushes about one fixture, which is the exact "followed team
 * turns into a firehose" failure the follow model is meant to avoid.
 */
async function createInsightEvents(
  predictions: { id: string; homeTeam: string | null; awayTeam: string | null; kickoff: Date | null; fixtureApiId: number | null; homeTeamApiId: number | null; awayTeamApiId: number | null; leagueApiId: number | null }[],
  now: Date,
) {
  if (!predictions.length) return 0;
  const rows = await prisma.matchInsightCache.findMany({
    where: {
      predictionId: { in: predictions.map((p) => p.id) },
      strength: { gte: INSIGHT_PUSH_MIN_STRENGTH },
      expiresAt: { gt: now },
      kickoff: { gt: now },
    },
    orderBy: [{ strength: "desc" }, { insightKey: "asc" }],
  });

  const byPrediction = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!byPrediction.has(row.predictionId)) byPrediction.set(row.predictionId, row);

  let created = 0;
  for (const [predictionId, row] of byPrediction) {
    const p = predictions.find((x) => x.id === predictionId);
    if (!p?.kickoff) continue;
    const evidence = (row.evidence ?? {}) as { teamName?: unknown; count?: unknown; explanation?: unknown };
    const teamName = typeof evidence.teamName === "string" ? evidence.teamName : "A followed team";
    const label = INSIGHT_TYPE_LABELS[row.type as InsightType] ?? "Form insight";
    const explanation = typeof evidence.explanation === "string" ? evidence.explanation : `${teamName}: ${label.toLowerCase()}.`;
    const slug = matchSlug({ homeTeam: p.homeTeam, awayTeam: p.awayTeam, kickoff: p.kickoff });
    await createNotificationEvent({
      eventKey: matchInsightEventKey(predictionId, row.insightKey),
      type: MATCH_INSIGHT,
      predictionId,
      fixtureApiId: p.fixtureApiId,
      leagueApiId: p.leagueApiId,
      teamApiIds: [p.homeTeamApiId, p.awayTeamApiId].filter((x): x is number => x != null),
      title: `${label} — ${p.homeTeam} vs ${p.awayTeam}`,
      body: explanation,
      link: slug ? `/predictions/match/${slug}` : "/predictions",
      availableAt: now,
      // Worthless once the match is under way, and the dispatcher drops
      // expired rows rather than delivering them late.
      expiresAt: p.kickoff,
      data: { insightKey: row.insightKey, insightType: row.type, scope: row.scope, strength: row.strength, count: evidence.count ?? null },
    });
    created++;
  }
  return created;
}

async function run() {
  const now = new Date();
  // The daily digests ride this job's schedule rather than needing one of their
  // own; each is created at most once per Lagos day (see createDailyDigests).
  const digests = await createDailyDigests(now);
  const follows = await prisma.userFollow.findMany({ where: { targetType: { in: ["PREDICTION", "TEAM"] } }, select: { targetType: true, targetKey: true } });
  const predictionIds = [...new Set(follows.filter((f) => f.targetType === "PREDICTION").map((f) => f.targetKey))];
  const teamIds = [...new Set(follows.filter((f) => f.targetType === "TEAM").map((f) => Number(f.targetKey)).filter(Number.isInteger))];
  if (!predictionIds.length && !teamIds.length) return { fixtures: 0, created: 0, insights: 0, digests };

  const predictions = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      outcome: "PENDING",
      kickoff: { gt: now, lte: new Date(now.getTime() + LOOKAHEAD_MS) },
      OR: [
        ...(predictionIds.length ? [{ id: { in: predictionIds } }] : []),
        ...(teamIds.length ? [{ homeTeamApiId: { in: teamIds } }, { awayTeamApiId: { in: teamIds } }] : []),
      ],
    },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
  });

  // Several tips on one fixture are one match to remind someone about.
  const fixtures = new Map<string, typeof predictions>();
  for (const p of predictions) {
    const key = p.fixtureApiId != null ? String(p.fixtureApiId) : matchKey(p) ?? p.id;
    fixtures.set(key, [...(fixtures.get(key) ?? []), p]);
  }

  let created = 0;
  for (const [key, group] of fixtures) {
    const p = group[0];
    const kickoff = p.kickoff!;
    const slug = matchSlug({ homeTeam: p.homeTeam, awayTeam: p.awayTeam, kickoff });
    await createNotificationEvent({
      eventKey: kickoffReminderKey(key, kickoff),
      type: "KICKOFF_REMINDER",
      predictionId: p.id,
      fixtureApiId: p.fixtureApiId,
      teamApiIds: [p.homeTeamApiId, p.awayTeamApiId].filter((x): x is number => x != null),
      title: "Kickoff reminder",
      body: `${p.homeTeam} vs ${p.awayTeam} starts soon.`,
      link: slug ? `/predictions/match/${slug}` : "/predictions",
      availableAt: now,
      expiresAt: kickoff,
      data: { kickoff: kickoff.toISOString(), predictionIds: group.filter((g) => g.kickoff!.getTime() === kickoff.getTime()).map((g) => g.id) },
    });
    created++;
  }
  const insights = await createInsightEvents(predictions, now);
  return { fixtures: fixtures.size, created, insights, digests };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await withJobRun(JOB_NOTIFICATIONS_REMINDERS, run, (r) => `fixtures ${r.fixtures}, reminders ${r.created}, insights ${r.insights}, morning digest: ${r.digests.morning}, night digest: ${r.digests.night}`));
}
