/**
 * Admin-only Prediction Updates workspace API (issue #232).
 * GET  ?tab=new|needs|reviewed  — one page (keyset cursor), exact totals
 * GET  ?counts=1                — header counts
 * POST { predictionId }         — on-demand comparison of the evidence a
 *       pick was written from with the CURRENT caches (cache-only digest).
 * Every handler runs under the provider-call hard stop and writes nothing.
 * Decisions use the existing guarded routes (reassessment rewrite/resolve).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { prisma } from "@/lib/prisma";
import { withNoFootballApiCalls } from "@/lib/football/api-football";
import { parseStoredContext } from "@/lib/ai/context";
import { buildGenerationDigest } from "@/lib/ai/generationContext";
import { compareFootballEvidence } from "@/lib/reassessment/evidence";
import { diffEvidence, friendlyReason, possiblyStaleStatements } from "@/lib/reassessment/evidenceDiff";
import { listCasePage, listReviewedPage, updatesCounts, type UpdatesFilters } from "@/lib/predictionUpdates";

export const dynamic = "force-dynamic";

const Query = z.object({
  tab: z.enum(["new", "needs", "reviewed"]).default("new"),
  counts: z.enum(["1"]).optional(),
  cursor: z.string().max(512).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tier: z.enum(["paid", "free", "all"]).default("all"),
  status: z.string().optional(),
  kickoffFrom: z.string().date().optional(),
  kickoffTo: z.string().date().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return NextResponse.json({ error: q.error.flatten() }, { status: 400 });
  if (q.data.counts) return NextResponse.json(await withNoFootballApiCalls(() => updatesCounts()));
  if (q.data.tab === "reviewed") return NextResponse.json(await withNoFootballApiCalls(() => listReviewedPage({ cursor: q.data.cursor, pageSize: q.data.pageSize })));
  const filters: UpdatesFilters = {
    tier: q.data.tier,
    statuses: (q.data.status ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => ["PUBLISHED", "PENDING_REVIEW", "DRAFT"].includes(s)),
    kickoffFrom: q.data.kickoffFrom ? new Date(q.data.kickoffFrom + "T00:00:00+01:00") : undefined,
    kickoffTo: q.data.kickoffTo ? new Date(new Date(q.data.kickoffTo + "T00:00:00+01:00").getTime() + 86_400_000) : undefined,
  };
  return NextResponse.json(await withNoFootballApiCalls(() => listCasePage(q.data.tab as "new" | "needs", filters, { cursor: q.data.cursor, pageSize: q.data.pageSize })));
}

const Body = z.object({ predictionId: z.string().min(1).max(128) });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  return withNoFootballApiCalls(async () => {
    const row = await prisma.prediction.findUnique({ where: { id: body.data.predictionId },
      select: { homeTeam: true, awayTeam: true, leagueName: true, leagueApiId: true, kickoff: true, homeTeamApiId: true, awayTeamApiId: true,
        reasoning: true, matchPreview: true, aiJob: { select: { context: true, createdAt: true } } } });
    if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const original = parseStoredContext(row.aiJob?.context);
    if (!original || !row.kickoff || !row.leagueName) return NextResponse.json({ error: "NO_SAVED_SNAPSHOT" }, { status: 409 });
    // Cache-only: reads the caches the enrichment crons keep warm. No provider call (and the hard stop above enforces it).
    const { digest } = await buildGenerationDigest({ home: row.homeTeam ?? "", away: row.awayTeam ?? "", league: row.leagueName,
      kickoff: row.kickoff.toISOString(), homeApiId: row.homeTeamApiId, awayApiId: row.awayTeamApiId, leagueApiId: row.leagueApiId,
      round: null, cacheOnly: true });
    const signals = compareFootballEvidence(original, digest).map((s) => ({ ...s, reason: friendlyReason(s.code) }));
    const diff = diffEvidence(original, digest);
    return NextResponse.json({ originalAt: row.aiJob?.createdAt.toISOString() ?? null, comparedAt: new Date().toISOString(), source: "current caches (no provider calls)",
      signals, diff, possiblyStale: possiblyStaleStatements([row.matchPreview, row.reasoning].filter(Boolean).join("\n"), diff, signals) });
  });
}
