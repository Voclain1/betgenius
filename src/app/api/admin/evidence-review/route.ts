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
import { applyEvidenceReviewAction, listEvidenceReviewPage, summarizeEvidenceReview, EvidenceReviewError, type ReviewFilters } from "@/lib/evidenceReview";

export const dynamic = "force-dynamic";

const CLASSES = ["EVIDENCE_AVAILABLE", "FRESHNESS_UNCERTAIN", "EVIDENCE_INSUFFICIENT", "SNAPSHOT_UNAVAILABLE"] as const;
const Query = z.object({
  class: z.string().optional(),
  status: z.string().optional(),
  paid: z.enum(["paid", "free", "all"]).default("all"),
  reviewed: z.enum(["unreviewed", "reviewed", "all"]).default("all"),
  timing: z.enum(["upcoming", "past", "all"]).default("all"),
  // Kickoff window (WAT calendar dates, inclusive).
  kickoffFrom: z.string().date().optional(),
  kickoffTo: z.string().date().optional(),
  // Creation scope: `days` matches `npm run diagnose:missing-evidence -- --days=N` exactly;
  // createdFrom/createdTo give an explicit WAT-date window.
  days: z.coerce.number().int().min(1).max(3650).optional(),
  createdFrom: z.string().date().optional(),
  createdTo: z.string().date().optional(),
  cursor: z.string().max(512).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  summary: z.enum(["1"]).optional(),
});
const watStart = (d: string) => new Date(d + "T00:00:00+01:00");
const watEnd = (d: string) => new Date(watStart(d).getTime() + 86_400_000);
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
  const filters: ReviewFilters = {
    classes, statuses, paid: q.data.paid, reviewed: q.data.reviewed, timing: q.data.timing,
    kickoffFrom: q.data.kickoffFrom ? watStart(q.data.kickoffFrom) : undefined,
    kickoffTo: q.data.kickoffTo ? watEnd(q.data.kickoffTo) : undefined,
    lookbackDays: q.data.days,
    createdFrom: q.data.createdFrom ? watStart(q.data.createdFrom) : undefined,
    createdTo: q.data.createdTo ? watEnd(q.data.createdTo) : undefined,
  };
  const result = q.data.summary
    ? await withNoFootballApiCalls(() => summarizeEvidenceReview(filters))
    : await withNoFootballApiCalls(() => listEvidenceReviewPage(filters, { cursor: q.data.cursor, pageSize: q.data.pageSize }));
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
