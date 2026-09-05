import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { curateAccumulators } from "@/lib/accumulatorPipeline";

export const dynamic = "force-dynamic";

/**
 * Same authorization shape as /api/admin/curate-genius: a cron secret for the
 * scheduled run, an admin session for a manual one.
 */
async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role);
}

/**
 * The daily odds-tier accumulator pass. Costs no API quota — it reads only
 * FixtureOddsCache and Prediction, both filled by workloads that already ran.
 *
 * Idempotent per Lagos day, so a retry or an overlapping cron cannot publish a
 * second card for a tier. `?dryRun=1` assembles and reports without writing.
 */
export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  return NextResponse.json(await curateAccumulators({ dryRun }));
}
