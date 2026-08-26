import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { lookupFinishedScore } from "@/lib/settlement";
import { resolveMarket, type MarketType, type Selection } from "@/lib/markets";
import { curateAutomaticTips } from "@/lib/geniusCuration";
import { publishedDoubleLegIds, settleSameGameDoubles } from "@/lib/sameGameDoubleAssembly";

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
  const curation = await curateAutomaticTips();
  // Raised from 15/30. Settlement has to keep pace with whatever publication
  // rate the reviewer sustains, and at up to 100 predictions a day a daily run
  // of 15 would fall permanently and increasingly behind.
  //
  // Sized for 8 runs a day (3-hourly, via cron-job.org — this plan's own crons
  // are capped at once daily): 8 x 40 = 320/day against a 100/day ceiling, so a
  // missed run self-heals rather than compounding. 40 predictions costs ~80
  // throttled calls, roughly 60-90s, well inside maxDuration=300.
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit")) || 40));

  const internalDoubleLegIds = await publishedDoubleLegIds();
  const candidates = await prisma.prediction.findMany({
    where: {
      // Normal picks must be published. Internally hidden legs become
      // settlement-eligible once their compound pick is published, so the
      // reviewer does not have to publish three public-looking rows merely to
      // make one reviewed double settle correctly.
      OR: [
        { status: "PUBLISHED" },
        { id: { in: internalDoubleLegIds } },
      ],
      outcome: "PENDING",
      manualSettlementOnly: false,
      leagueApiId: { not: null },
      homeTeam: { not: null },
      awayTeam: { not: null },
      kickoff: { lt: new Date(Date.now() - SETTLEMENT_BUFFER_MS) },
      // Doubles are settled in the second pass below, from their legs. They
      // must not come through here: there is no scoreline that resolves one,
      // so each would burn two api-football calls only to be filed as
      // unresolvable.
      marketType: { not: "SAME_GAME_DOUBLE" },
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
        await prisma.prediction.update({
          where: { id: p.id },
          data: { settlementNote: "Not yet confirmed finished — will retry automatically." },
        });
        results.push({ id: p.id, match, result: "not_finished" });
        continue;
      }
      if (lookup.status === "not_found") {
        await prisma.prediction.update({
          where: { id: p.id },
          data: { settlementNote: `Auto-settlement failed — ${lookup.reason}` },
        });
        results.push({ id: p.id, match, result: "not_found", detail: lookup.reason });
        continue;
      }
      if (lookup.status === "manual_required") {
        await prisma.prediction.update({
          where: { id: p.id },
          data: {
            manualSettlementOnly: true,
            settlementNote: `Manual settlement required — ${lookup.reason}`,
          },
        });
        results.push({ id: p.id, match, result: "manual_required", detail: lookup.reason });
        continue;
      }

      // Halftime is passed through for WIN_EITHER_HALF; every other market
      // ignores it. A null here makes that market unresolvable rather than
      // wrong — it falls into the `!outcome` branch below and is flagged.
      const outcome = resolveMarket(p.marketType as MarketType, p.selection as Selection, lookup.homeScore, lookup.awayScore, lookup.halftime);

      if (!outcome) {
        // Score found, but the market couldn't be resolved from it (shouldn't
        // happen for a valid marketType/selection — flag for manual review).
        await prisma.prediction.update({
          where: { id: p.id },
          data: {
            finalHomeScore: lookup.homeScore,
            finalAwayScore: lookup.awayScore,
            settlementNote: "Auto-settlement failed — score found but the market selection couldn't be resolved from it.",
          },
        });
        results.push({ id: p.id, match, result: "unresolvable", detail: `${lookup.homeScore}-${lookup.awayScore}` });
        continue;
      }

      await prisma.prediction.update({
        where: { id: p.id },
        data: { finalHomeScore: lookup.homeScore, finalAwayScore: lookup.awayScore, outcome, settledAt: new Date(), settlementNote: null },
      });

      results.push({ id: p.id, match, result: outcome, detail: `${lookup.homeScore}-${lookup.awayScore}` });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      await prisma.prediction.update({ where: { id: p.id }, data: { settlementNote: `Auto-settlement error — ${message}` } }).catch(() => {});
      results.push({ id: p.id, match, result: "error", detail: message });
    }
  }

  // SECOND PASS — same-game doubles, settled from their legs rather than from
  // a scoreline. Runs after the loop above because those legs may have been
  // settled seconds ago in this very request. See settleSameGameDoubles.
  const doubleResults = await settleSameGameDoubles();

  return NextResponse.json({
    curation,
    checked: candidates.length,
    settled: results.filter((r) => ["WON", "LOST", "VOID"].includes(r.result)).length,
    results,
    doublesChecked: doubleResults.length,
    doublesSettled: doubleResults.filter((r) => ["WON", "LOST", "VOID"].includes(r.result)).length,
    doubleResults,
  });
}
