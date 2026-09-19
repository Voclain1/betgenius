import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createNotificationEvent, kickoffReminderKey } from "@/lib/notifications";
import { JOB_NOTIFICATIONS_REMINDERS, withJobRun } from "@/lib/jobRuns";
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

async function run() {
  const now = new Date();
  const follows = await prisma.userFollow.findMany({ where: { targetType: { in: ["PREDICTION", "TEAM"] } }, select: { targetType: true, targetKey: true } });
  const predictionIds = [...new Set(follows.filter((f) => f.targetType === "PREDICTION").map((f) => f.targetKey))];
  const teamIds = [...new Set(follows.filter((f) => f.targetType === "TEAM").map((f) => Number(f.targetKey)).filter(Number.isInteger))];
  if (!predictionIds.length && !teamIds.length) return { fixtures: 0, created: 0 };

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
  return { fixtures: fixtures.size, created };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await withJobRun(JOB_NOTIFICATIONS_REMINDERS, run, (r) => `fixtures ${r.fixtures}, reminders ${r.created}`));
}
