import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { isAdmin } from "@/lib/access";
import { authOptions } from "@/lib/auth";
import { discoverGenerationCandidates } from "@/lib/generation/queue";
import { JOB_GENERATION_DISCOVERY, recordRouteRun } from "@/lib/jobRuns";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const Query = z.object({
  batch: z.coerce.number().int().min(1).max(4).default(3),
});

async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role);
}

async function handle(req: Request): Promise<NextResponse> {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(await discoverGenerationCandidates({ batchSize: parsed.data.batch }));
}

/**
 * Recorded as a JobRun so /admin/jobs can show which competition scope
 * discovery chose and why. The run detail is the whole report, including
 * `coverage`. A quiet "no fallback work" run is expected on most days and
 * reads as healthy.
 */
export async function GET(req: Request) {
  const startedAt = Date.now();
  const response = await handle(req);
  await recordRouteRun(JOB_GENERATION_DISCOVERY, response, startedAt, (p) =>
    p?.summary ? `${p.summary}; queued ${p.candidatesQueued ?? 0}` : `status ${response.status}`,
  );
  return response;
}
