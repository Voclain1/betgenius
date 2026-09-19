import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { ENRICHMENT_WORKLOADS, runEnrichmentWorkload, type EnrichmentWorkload } from "@/lib/enrichmentWorkloads";
import { JOB_REFRESH_ODDS, recordJobRun } from "@/lib/jobRuns";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role);
}

export async function GET(req: Request, { params }: { params: { workload: string } }) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!ENRICHMENT_WORKLOADS.includes(params.workload as EnrichmentWorkload)) {
    return NextResponse.json({ error: "Unknown enrichment workload", workloads: ENRICHMENT_WORKLOADS }, { status: 404 });
  }

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 25));
  const startedAt = Date.now();
  const report = await runEnrichmentWorkload(params.workload as EnrichmentWorkload, { limit });

  // Only the odds workload is recorded. It is the one whose silence starves Bet
  // of the Day and VIP/PREMIUM targeting, and recording all seven would make the
  // job history mostly noise. `eligible` vs `processed` is the figure that shows
  // a backlog the limit is not clearing.
  if (params.workload === "odds") {
    await recordJobRun({
      job: JOB_REFRESH_ODDS,
      ok: true,
      summary: `scoped ${report.scoped}, due ${report.eligible}, priced ${report.okCount}, failed ${report.failedCount}, still due ${report.remaining}`,
      detail: report,
      ms: Date.now() - startedAt,
    });
  }
  return NextResponse.json(report);
}
