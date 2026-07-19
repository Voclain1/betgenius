import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { lookupFinishedScore } from "@/lib/settlement";
import { resolveMarket, type MarketType, type Selection } from "@/lib/markets";

// Bulk settlement runs sequentially through the throttled api-football queue
// (up to 2 calls per prediction) — bound generously since Vercel Cron (and
// this route) invoke via a single request with no retry-on-timeout.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Give a finished match's result time to land in the data source before we
// bother checking — mostly moot on the daily cron cadence, but cheap insurance.
const SETTLEMENT_BUFFER_MS = 2.5 * 60 * 60 * 1000;

async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role);
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get("limit")) || 15));

  const candidates = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      outcome: "PENDING",
      manualSettlementOnly: false,
      leagueApiId: { not: null },
      homeTeam: { not: null },
      awayTeam: { not: null },
      kickoff: { lt: new Date(Date.now() - SETTLEMENT_BUFFER_MS) },
    },
    orderBy: { kickoff: "asc" },
    take: limit,
  });

  const results: Array<{ id: string; match: string; result: string; detail?: string }> = [];

  for (const p of candidates) {
    const match = `${p.homeTeam} vs ${p.awayTeam}`;
    try {
      const lookup = await lookupFinishedScore({
        homeTeam: p.homeTeam!,
        awayTeam: p.awayTeam!,
        kickoff: p.kickoff!,
      });

      if (lookup.status === "not_finished") {
        results.push({ id: p.id, match, result: "not_finished" });
        continue;
      }
      if (lookup.status === "not_found") {
        results.push({ id: p.id, match, result: "not_found", detail: lookup.reason });
        continue;
      }

      const outcome =
        resolveMarket(p.marketType as MarketType, p.selection as Selection, lookup.homeScore, lookup.awayScore) ?? "PENDING";

      await prisma.prediction.update({
        where: { id: p.id },
        data: { finalHomeScore: lookup.homeScore, finalAwayScore: lookup.awayScore, outcome },
      });

      results.push({ id: p.id, match, result: outcome, detail: `${lookup.homeScore}-${lookup.awayScore}` });
    } catch (err: any) {
      results.push({ id: p.id, match, result: "error", detail: err?.message ?? String(err) });
    }
  }

  return NextResponse.json({
    checked: candidates.length,
    settled: results.filter((r) => ["WON", "LOST", "VOID"].includes(r.result)).length,
    results,
  });
}
