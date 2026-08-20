import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { runGeneration } from "@/lib/generation/worker";
import { z } from "zod";

/**
 * Scheduled generation. Same shape and auth as /api/admin/settle and
 * /api/admin/refresh-enrichment — CRON_SECRET bearer for the external
 * scheduler, or an admin session for a manual run from the panel.
 *
 * Driven by cron-job.org rather than Vercel's own cron: this plan's crons are
 * capped at once per day, which is what commit 0d0e10c already worked around
 * for enrichment.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Free-tier categories only — VIP/PREMIUM stay a deliberate manual action, as in the bulk route. */
const FREE_CATEGORIES = ["FEATURED", "GENIUS", "TODAY", "BANKER"] as const;

const Query = z.object({
  limit: z.coerce.number().min(1).max(25).default(12),
  categories: z.string().optional(),
  leagues: z.string().optional(),
});

async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role);
}

/**
 * The author recorded on scheduled runs.
 *
 * Predictions require an authorId, and a cron has no session. The oldest
 * SUPER_ADMIN/ADMIN is used so the row is attributable to a real account rather
 * than a synthetic one that would need its own user record and access rules.
 */
async function resolveAuthorId(sessionUserId?: string): Promise<string | null> {
  if (sessionUserId) return sessionUserId;
  const admin = await prisma.user.findFirst({
    where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { limit, categories, leagues } = parsed.data;

  const session = await getServerSession(authOptions);
  const authorId = await resolveAuthorId(session?.user.id);
  if (!authorId) return NextResponse.json({ error: "No admin user to attribute generated predictions to" }, { status: 500 });

  const requested = categories?.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) ?? [];
  const valid = requested.filter((c): c is (typeof FREE_CATEGORIES)[number] => FREE_CATEGORIES.includes(c as any));
  const leagueApiIds = leagues?.split(",").map((l) => Number(l.trim())).filter((n) => Number.isFinite(n));

  const report = await runGeneration({
    authorId,
    categories: valid.length ? valid : ["TODAY"],
    leagueApiIds: leagueApiIds?.length ? leagueApiIds : undefined,
    limit,
  });

  // A run that found the lock held is a normal outcome, not a failure — the
  // external scheduler must not treat overlapping pokes as errors and start
  // alerting or backing off.
  return NextResponse.json(report, { status: 200 });
}
