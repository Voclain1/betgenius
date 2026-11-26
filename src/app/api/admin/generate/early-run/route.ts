import { NextResponse } from "next/server";
import { attributeApiJob } from "@/lib/football/usage";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { isAdmin } from "@/lib/access";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runEarlyFreeGeneration } from "@/lib/generation/earlyGeneration";
import { JOB_EARLY_GENERATION, recordRouteRun } from "@/lib/jobRuns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const Query = z.object({ limit: z.coerce.number().int().min(1).max(4).default(3) });

async function handle(req: Request) {
  const scheduler = Boolean(process.env.CRON_SECRET && req.headers.get("authorization") === "Bearer " + process.env.CRON_SECRET);
  const session = await getServerSession(authOptions);
  if (!scheduler && !isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const query = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return NextResponse.json({ error: query.error.flatten() }, { status: 400 });
  const actorId = session?.user.id ?? (await prisma.user.findFirst({
    where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  }))?.id;
  if (!actorId) return NextResponse.json({ error: "Missing admin author" }, { status: 503 });
  try {
    return NextResponse.json(await runEarlyFreeGeneration({ actorId, limit: query.data.limit }));
  } catch (error) {
    console.error("[early-free-generation]", error);
    return NextResponse.json({ error: "Early generation failed" }, { status: 500 });
  }
}

async function getUnattributed(req: Request) {
  const started = Date.now();
  const response = await handle(req);
  await recordRouteRun(JOB_EARLY_GENERATION, response, started, p => p?.summary ?? p?.error ?? "status " + response.status);
  return response;
}

const OverrideBody = z.object({ matchKeys: z.array(z.string().min(3).max(64)).min(1).max(3) });

/**
 * Deliberate administrator request for early analysis of specific fixtures
 * beyond the five-day horizon. Session-authenticated admins only: the cron
 * secret cannot use it, so there is no automatic 10–14 day loophole.
 */
async function postOverride(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = OverrideBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  try {
    const result = await runEarlyFreeGeneration({ actorId: session!.user.id, limit: body.data.matchKeys.length,
      override: { matchKeys: body.data.matchKeys, requestedBy: session!.user.id } });
    console.info("[early-free-generation] admin early override", { matchKeys: body.data.matchKeys, selected: result.selected, generated: result.generated });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[early-free-generation override]", error);
    return NextResponse.json({ error: "Early generation failed" }, { status: 500 });
  }
}

// API-Football telemetry: requests made by this handler are attributed to this job (src/lib/football/usage.ts).
export const POST = attributeApiJob("early-free-generation", postOverride);
export const GET = attributeApiJob("early-free-generation", getUnattributed);
