import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { recoverOperation } from "@/lib/operationsRecovery";
import { z } from "zod";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const Input = z
  .object({
    action: z.enum(["REFRESH_ODDS", "RETRY_SETTLEMENT"]),
    predictionId: z.string().min(1).max(200),
    dryRun: z.boolean().default(true),
    reason: z.string().trim().min(8).max(500),
    expectedKey: z.string().max(300).optional(),
    authorizePublishedChange: z.boolean().optional(),
  })
  .strict();
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasValidMutationOrigin(req))
    return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await recoverOperation({
        ...parsed.data,
        role: session!.user.role,
        actorId: session!.user.id,
      }),
    );
  } catch (error) {
    console.error("[prediction-ops] recovery unavailable", error);
    return NextResponse.json(
      {
        error:
          "Recovery unavailable; inspect execution history before retrying",
      },
      { status: 503 },
    );
  }
}
