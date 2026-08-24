import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { ENRICHMENT_WORKLOADS, runEnrichmentWorkload, type EnrichmentWorkload } from "@/lib/enrichmentWorkloads";

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
  const report = await runEnrichmentWorkload(params.workload as EnrichmentWorkload, { limit });
  return NextResponse.json(report);
}
