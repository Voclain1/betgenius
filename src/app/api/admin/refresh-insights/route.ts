import { NextRequest, NextResponse } from "next/server";
import { withJobRun } from "@/lib/jobRuns";
import { DEFAULT_FETCH_LIMIT, JOB_REFRESH_INSIGHTS, refreshMatchInsights } from "@/lib/insightRefresh";

/**
 * Scheduled Match Insights refresh. GET with `Authorization: Bearer
 * <CRON_SECRET>`, like every other worker route.
 *
 * `fetchLimit` bounds api-football calls per run (one per team history).
 * Recalculation itself covers every upcoming team on every run — it is cheap,
 * and skipping teams is exactly how stale insights would survive.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: NextRequest) {
  return !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const raw = req.nextUrl.searchParams.get("fetchLimit");
  const requested = raw === null || raw === "" ? NaN : Number(raw);
  const fetchLimit = Number.isFinite(requested) && requested >= 0 ? Math.min(60, Math.floor(requested)) : DEFAULT_FETCH_LIMIT;
  const result = await withJobRun(
    JOB_REFRESH_INSIGHTS,
    () => refreshMatchInsights({ fetchLimit }),
    (r) => `targets ${r.targets}, fetched ${r.fetched} (${r.fetchFailed} failed), stale ${r.staleTeams}, insights ${r.insights}, teams rewritten ${r.teamsWritten}, cleared ${r.cleared}`,
  );
  return NextResponse.json(result);
}
