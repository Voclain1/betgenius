import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { isAdmin } from "@/lib/access";
import { authOptions } from "@/lib/auth";
import { runEarlyOddsWarming } from "@/lib/generation/earlyOdds";
import { JOB_EARLY_ODDS, recordRouteRun } from "@/lib/jobRuns";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Query = z.object({ limit: z.coerce.number().int().min(1).max(6).default(4) });

async function handle(req: Request) {
  const scheduler = Boolean(process.env.CRON_SECRET &&
    req.headers.get("authorization") === "Bearer " + process.env.CRON_SECRET);
  const session = await getServerSession(authOptions);
  if (!scheduler && !isAdmin(session?.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    return NextResponse.json(await runEarlyOddsWarming({ limit: parsed.data.limit }));
  } catch (error) {
    console.error("[early-free-odds]", error);
    return NextResponse.json({ ok: false, error: "Early odds warming failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const started = Date.now();
  const response = await handle(req);
  await recordRouteRun(JOB_EARLY_ODDS, response, started,
    p => p?.summary ?? p?.error ?? "status " + response.status);
  return response;
}
