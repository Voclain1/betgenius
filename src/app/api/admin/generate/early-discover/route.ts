import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { isAdmin } from "@/lib/access";
import { authOptions } from "@/lib/auth";
import { runEarlyFixtureDiscovery } from "@/lib/generation/earlyFixtureDiscovery";
import { JOB_EARLY_FIXTURE_DISCOVERY, recordRouteRun } from "@/lib/jobRuns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Query = z.object({ batch: z.coerce.number().int().min(1).max(16).default(12) });

async function handle(req: Request) {
  const bearer = req.headers.get("authorization");
  const scheduler = Boolean(process.env.CRON_SECRET && bearer === "Bearer " + process.env.CRON_SECRET);
  if (!scheduler) {
    const session = await getServerSession(authOptions);
    if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const query = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return NextResponse.json({ error: query.error.flatten() }, { status: 400 });

  try {
    return NextResponse.json(await runEarlyFixtureDiscovery({ batchSize: query.data.batch }));
  } catch (error) {
    console.error("[early-fixture-discovery]", error);
    return NextResponse.json({ ok: false, error: "Early fixture discovery failed; see server logs" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const response = await handle(req);
  await recordRouteRun(JOB_EARLY_FIXTURE_DISCOVERY, response, startedAt,
    (p) => p?.summary ?? (p?.error ? String(p.error) : "early fixture capture returned status " + response.status),
  );
  return response;
}
