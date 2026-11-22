/**
 * Admin-only historical evidence review (src/lib/evidenceReview.ts).
 * GET lists flagged generated predictions with their classification; POST
 * records RETAIN or opens a private reassessment review. Both run under the
 * provider-call hard stop: this route can never reach API-Football.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { withNoFootballApiCalls } from "@/lib/football/api-football";
import { applyEvidenceReviewAction, listEvidenceReview, EvidenceReviewError } from "@/lib/evidenceReview";

export const dynamic = "force-dynamic";

const CLASSES = ["EVIDENCE_AVAILABLE", "FRESHNESS_UNCERTAIN", "EVIDENCE_INSUFFICIENT", "SNAPSHOT_UNAVAILABLE"] as const;
const Query = z.object({
  class: z.string().optional(),
  status: z.string().optional(),
  paid: z.enum(["paid", "free", "all"]).default("all"),
  reviewed: z.enum(["unreviewed", "reviewed", "all"]).default("all"),
  timing: z.enum(["upcoming", "past", "all"]).default("all"),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
const Body = z.object({
  predictionId: z.string().min(1).max(128),
  action: z.enum(["RETAIN", "OPEN_PRIVATE_REVIEW"]),
  note: z.string().trim().min(10).max(400),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return NextResponse.json({ error: q.error.flatten() }, { status: 400 });
  const classes = (q.data.class ?? "").split(",").filter((c): c is typeof CLASSES[number] => (CLASSES as readonly string[]).includes(c));
  const statuses = (q.data.status ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => ["PUBLISHED", "PENDING_REVIEW", "DRAFT", "APPROVED", "ARCHIVED"].includes(s));
  const result = await withNoFootballApiCalls(() => listEvidenceReview({
    classes, statuses, paid: q.data.paid, reviewed: q.data.reviewed, timing: q.data.timing,
    from: q.data.from ? new Date(q.data.from + "T00:00:00+01:00") : undefined,
    to: q.data.to ? new Date(new Date(q.data.to + "T00:00:00+01:00").getTime() + 86_400_000) : undefined,
  }));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role) || !session?.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  try {
    return NextResponse.json(await withNoFootballApiCalls(() => applyEvidenceReviewAction(body.data)));
  } catch (error) {
    if (error instanceof EvidenceReviewError) return NextResponse.json({ error: error.code }, { status: 409 });
    console.error("[evidence-review]", error);
    return NextResponse.json({ error: "Evidence review action failed" }, { status: 500 });
  }
}
