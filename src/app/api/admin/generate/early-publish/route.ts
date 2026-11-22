import { NextResponse } from "next/server";
import { attributeApiJob } from "@/lib/football/usage";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { isAdmin } from "@/lib/access";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runEarlyFreePublication } from "@/lib/generation/earlyPublication";
import { JOB_EARLY_FREE_PUBLICATION, recordRouteRun } from "@/lib/jobRuns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const Query = z.object({ limit: z.coerce.number().int().min(1).max(16).default(16) });

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
  if (!actorId) return NextResponse.json({ error: "No admin attribution account" }, { status: 503 });
  try {
    return NextResponse.json(await runEarlyFreePublication({ limit: query.data.limit, actorId }));
  } catch (error) {
    console.error("[early-free-publish]", error);
    return NextResponse.json({ ok: false, error: "Early publication pass failed" }, { status: 500 });
  }
}

async function getUnattributed(req: Request) {
  const startedAt = Date.now();
  const response = await handle(req);
  await recordRouteRun(JOB_EARLY_FREE_PUBLICATION, response, startedAt,
    (p) => p?.summary ?? p?.error ?? "status " + response.status);
  return response;
}

// API-Football telemetry: requests made by this handler are attributed to this job (src/lib/football/usage.ts).
export const GET = attributeApiJob("early-free-publication", getUnattributed);
