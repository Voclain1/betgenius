import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { isAdmin } from "@/lib/access";
import { authOptions } from "@/lib/auth";
import { discoverGenerationCandidates } from "@/lib/generation/queue";

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

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(await discoverGenerationCandidates({ batchSize: parsed.data.batch }));
}
