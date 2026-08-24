import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { rewritePrediction, RewriteError } from "@/lib/ai/rewrite";
import { z } from "zod";

// One Gemini round-trip; no API-Football calls (see src/lib/ai/rewrite.ts).
// Well inside the platform default, but set explicitly since the model call
// dominates the request.
export const maxDuration = 60;

const Body = z.object({
  // Empty/absent means a plain re-roll. Capped so a pasted essay can't crowd
  // out the actual football context in the prompt.
  reviewerNote: z.string().max(1000).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const { prediction, archivedCount } = await rewritePrediction({
      predictionId: params.id,
      reviewerNote: parsed.data.reviewerNote,
      requestedById: session!.user.id,
    });
    return NextResponse.json({ prediction, archivedCount });
  } catch (err: any) {
    if (err instanceof RewriteError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[rewrite]", err);
    return NextResponse.json({ error: "Rewrite failed. Try again shortly." }, { status: 500 });
  }
}
