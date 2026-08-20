import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { reviewTransition } from "@/lib/predictions";
import { z } from "zod";

/**
 * Apply one review action to several predictions at once.
 *
 * Exists because generation capacity and review capacity are decoupled: the
 * scheduler can produce up to 100 candidates a day and every one of them needs
 * a human decision, so approving them one request at a time is the actual
 * bottleneck. This changes only how many rows an action covers — never who
 * decides, and never the transition itself, which comes from the same
 * reviewTransition() the single-row route uses.
 *
 * Deliberately no auto-publish anywhere in this file: PUBLISH here is still an
 * explicit action a human took on a selection they made.
 */
export const maxDuration = 60;

/** Bounded so one request can't lock a large slice of the table. */
const MAX_BULK = 100;

const Body = z.object({
  ids: z.array(z.string()).min(1).max(MAX_BULK),
  action: z.enum(["APPROVE", "PUBLISH", "ARCHIVE"]),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { ids, action } = parsed.data;

  // Read first: PUBLISH's transition depends on whether each row was already
  // approved, so this cannot be a single updateMany.
  const rows = await prisma.prediction.findMany({
    where: { id: { in: ids } },
    select: { id: true, approvedById: true, status: true },
  });

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const row of rows) {
    try {
      await prisma.prediction.update({
        where: { id: row.id },
        data: reviewTransition(action, session!.user.id, row),
      });
      results.push({ id: row.id, ok: true });
    } catch (err: any) {
      results.push({ id: row.id, ok: false, error: err?.message ?? String(err) });
    }
  }

  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  return NextResponse.json({
    action,
    updated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    missing,
  });
}
