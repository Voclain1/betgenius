import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { generateAndPersistPrediction, type GenerateFixtureInput } from "@/lib/ai/generate";
import { bulkFailureReason } from "@/lib/generation/bulkRun";

// A retry is one full generation: the same budget as the single-match route.
export const maxDuration = 60;

const Body = z.object({ action: z.enum(["retry", "dismiss"]) });

/**
 * Act on a failed generation from /admin/failed-generations.
 *
 * retry: run the stored input again as the admin's own generation (manual, so
 * the short-price rule is off; the admin chose to retry). Success resolves
 * every open failure for the match (generateAndPersistPrediction does that);
 * a new failure is logged like any other.
 * dismiss: close every open failure for the match without generating.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const failure = await prisma.generationFailure.findUnique({ where: { id: params.id } });
  if (!failure) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (parsed.data.action === "dismiss") {
    await prisma.generationFailure.updateMany({
      where: { fixtureKey: failure.fixtureKey, resolvedAt: null, dismissedAt: null },
      data: { dismissedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  const input = failure.input as unknown as GenerateFixtureInput;
  try {
    const result = await generateAndPersistPrediction({ ...input, authorId: session!.user.id, manual: true });
    return NextResponse.json({ ok: true, predictions: result.predictions.length });
  } catch (err) {
    console.error("[api/admin/generation-failures] retry failed", err);
    return NextResponse.json({ error: bulkFailureReason(err) }, { status: 500 });
  }
}
