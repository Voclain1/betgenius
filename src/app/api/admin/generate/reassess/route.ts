import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { isAdmin } from "@/lib/access";
import { authOptions } from "@/lib/auth";
import { runPublishedReassessment } from "@/lib/reassessment/worker";
import { JOB_PREDICTION_REASSESSMENT, recordRouteRun } from "@/lib/jobRuns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const Query = z.object({ limit: z.coerce.number().int().min(1).max(5).default(3) });

async function handle(req: Request) {
  const scheduler = Boolean(process.env.CRON_SECRET && req.headers.get("authorization") === "Bearer " + process.env.CRON_SECRET);
  if (!scheduler) {
    const session = await getServerSession(authOptions);
    if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const query = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return NextResponse.json({ error: query.error.flatten() }, { status: 400 });
  try {
    return NextResponse.json(await runPublishedReassessment({ limit: query.data.limit }));
  } catch (error) {
    console.error("[prediction-reassessment]", error);
    return NextResponse.json({ ok: false, error: "Prediction reassessment failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const response = await handle(req);
  await recordRouteRun(JOB_PREDICTION_REASSESSMENT, response, startedAt,
    p => p?.summary ?? p?.error ?? "status " + response.status);
  return response;
}
