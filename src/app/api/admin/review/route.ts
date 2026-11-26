import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { loadReviewQueue } from "@/lib/reviewQueue";
import { updatesCounts } from "@/lib/predictionUpdates";

/** The review queue: picks waiting for a decision, split into ready and needs-attention. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const now = new Date();
  const [queue, updates] = await Promise.all([loadReviewQueue(now), updatesCounts(now)]);
  return NextResponse.json({ ...queue, updatesAwaitingDecision: updates.awaitingDecision });
}
