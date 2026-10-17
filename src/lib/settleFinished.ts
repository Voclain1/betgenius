import { prisma } from "@/lib/prisma";
import { lookupFinishedScore, prefetchFixturesById } from "@/lib/settlement";
import { resolveMarket, type MarketType, type Selection } from "@/lib/markets";
import { publishedDoubleLegIds } from "@/lib/sameGameDoubleAssembly";
import { createNotificationEvent, settlementEventKey } from "@/lib/notifications";
import { matchSlug } from "@/lib/slug";

/**
 * Settling finished picks: find published picks whose match should be over,
 * look up the final score, and mark each WON, LOST or VOID. Shared by the full
 * 3-hourly settlement run (/api/admin/settle) and the 10-minute results pass
 * (src/lib/resultsPass.ts), so both settle a pick the same way.
 */


// When a pick is first checked: a match takes about 1h55m from kickoff to
// the final whistle (two 45-minute halves, 15-minute break, stoppage time).
// Was 2.5h, which on a 3-hourly schedule meant a median wait of 4 hours from
// kickoff to a result on the site (production, October 2026). A match still
// running at 1h50m comes back "not_finished" and is simply checked again on
// the next run; that path never abandons a row before the 72h backstop.
export const SETTLEMENT_BUFFER_MS = 110 * 60 * 1000;

// Age-out for fixtures auto-settlement can never resolve.
//
// The `not_found` and `not_finished` branches below are both retry-forever
// paths: they leave the row PENDING with manualSettlementOnly still false, so
// it is re-selected on the next run, and lookupFinishedScore ->
// getFixturesByDate is uncached, meaning every retry is a live API call. A row
// the provider simply never returns (a lower-division fixture whose team names
// the feed spells differently) therefore burns one call per row per run,
// indefinitely, while permanently occupying part of the `limit` batch.
//
// Two independent conditions, because they catch different failures:
//   - attempts: the ordinary case, 3 failed lookups, but only once the
//     kickoff is SETTLEMENT_MIN_ABANDON_MS old. The results pass now runs
//     every 10 minutes, so 3 attempts alone could be 30 minutes after the
//     whistle, when the feed may simply not have the result yet.
//   - kickoff age: a backstop for rows that dodge the counter (settled by an
//     admin then reopened, or predating this field and starting at 0).
export const SETTLEMENT_MAX_ATTEMPTS = 3;
const SETTLEMENT_MIN_ABANDON_MS = 9 * 60 * 60 * 1000;
const SETTLEMENT_ABANDON_AFTER_MS = 72 * 60 * 60 * 1000;

/**
 * Whether an unresolvable row has exhausted auto-settlement. Flipping
 * manualSettlementOnly is what removes it from the candidate query above; the
 * note tells the admin why it is sitting in their queue.
 */
export function shouldAbandon(attempts: number, kickoff: Date | null, now: number = Date.now()): boolean {
  const age = kickoff ? now - kickoff.getTime() : Infinity;
  if (attempts >= SETTLEMENT_MAX_ATTEMPTS && age >= SETTLEMENT_MIN_ABANDON_MS) return true;
  return age > SETTLEMENT_ABANDON_AFTER_MS;
}


export type SettleResult = { id: string; match: string; result: string; detail?: string };

/** Settle up to `limit` finished picks, oldest kickoff first. */
export async function settleFinishedPredictions(limit: number): Promise<{
  checked: number;
  results: SettleResult[];
  kickoffsReconciled: number;
  fixtureIdsPrefetched: number;
}> {
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
    include: { categories: { select: { category: true } } },
  });

  // ONE batched call set for the whole run, instead of one full-day fixture
  // list per prediction. 40 candidates with ids cost ceil(40/20)=2 calls; the
  // date fallback below still costs one call per legacy row.
  const prefetched = await prefetchFixturesById(
    candidates.map((c) => c.fixtureApiId).filter((id): id is number => id != null),
  );

  const results: SettleResult[] = [];
  let kickoffsReconciled = 0;

  for (const p of candidates) {
    const match = `${p.homeTeam} vs ${p.awayTeam}`;
    try {
      const lookup = await lookupFinishedScore({
        homeTeam: p.homeTeam!,
        awayTeam: p.awayTeam!,
        kickoff: p.kickoff!,
        fixtureApiId: p.fixtureApiId,
        homeTeamApiId: p.homeTeamApiId,
        awayTeamApiId: p.awayTeamApiId,
        prefetched,
      });

      // Reconcile a stale stored kickoff against the provider's current one.
      //
      // Predictions are generated ~42h ahead and the kickoff was previously
      // written once and never revisited, so a rescheduled fixture kept a wrong
      // time on a published pick indefinitely. Only ever done off an id match:
      // the date path found the row BY its stored date, so it can never
      // disagree, while an id match is authoritative about identity.
      if (lookup.matchedBy === "id" && lookup.actualKickoff && p.kickoff
          && Math.abs(lookup.actualKickoff.getTime() - p.kickoff.getTime()) > 60_000) {
        await prisma.prediction.update({ where: { id: p.id }, data: { kickoff: lookup.actualKickoff } });
        kickoffsReconciled++;
      }

      if (lookup.status === "not_finished") {
        const attempts = p.settlementAttempts + 1;
        // Only the kickoff backstop applies here, not the attempt count: a
        // fixture legitimately in progress or awaiting confirmation should keep
        // being retried. 72h past kickoff it is postponed/abandoned, not slow.
        const abandon = !!p.kickoff && Date.now() - p.kickoff.getTime() > SETTLEMENT_ABANDON_AFTER_MS;
        await prisma.prediction.update({
          where: { id: p.id },
          data: {
            settlementAttempts: attempts,
            ...(abandon
              ? {
                  manualSettlementOnly: true,
                  settlementNote: `Manual settlement required — still not confirmed finished ${SETTLEMENT_ABANDON_AFTER_MS / 3600000}h after kickoff (postponed or abandoned?). Auto-settlement gave up after ${attempts} checks.`,
                }
              : { settlementNote: "Not yet confirmed finished — will retry automatically." }),
          },
        });
        results.push({ id: p.id, match, result: abandon ? "abandoned" : "not_finished" });
        continue;
      }
      if (lookup.status === "not_found") {
        const attempts = p.settlementAttempts + 1;
        const abandon = shouldAbandon(attempts, p.kickoff);
        await prisma.prediction.update({
          where: { id: p.id },
          data: {
            settlementAttempts: attempts,
            ...(abandon
              ? {
                  manualSettlementOnly: true,
                  settlementNote: `Manual settlement required — auto-settlement gave up after ${attempts} attempts: ${lookup.reason}`,
                }
              : { settlementNote: `Auto-settlement failed — ${lookup.reason}` }),
          },
        });
        results.push({ id: p.id, match, result: abandon ? "abandoned" : "not_found", detail: lookup.reason });
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

      const settledAt = new Date();
      const slug = matchSlug({ homeTeam: p.homeTeam, awayTeam: p.awayTeam, kickoff: p.kickoff });
      const won = await prisma.$transaction(async (tx) => {
        // Only while still PENDING: the 10-minute results pass and the full
        // run can overlap, and the second to arrive must not settle the pick
        // again or send a second result notification.
        const claimed = await tx.prediction.updateMany({ where: { id: p.id, outcome: "PENDING" }, data: { finalHomeScore: lookup.homeScore, finalAwayScore: lookup.awayScore, outcome, settledAt, settlementNote: null, settlementAttempts: 0 } });
        if (claimed.count === 0) return false;
        // Hidden double legs settle here too, but nobody can follow a row that
        // was never published, so only published tips produce a result event.
        if (p.status === "PUBLISHED") {
          await createNotificationEvent({
            eventKey: settlementEventKey(p.id, outcome, settledAt),
            type: `RESULT_${outcome}`,
            predictionId: p.id,
            fixtureApiId: p.fixtureApiId,
            category: p.category,
            leagueApiId: p.leagueApiId,
            teamApiIds: [p.homeTeamApiId, p.awayTeamApiId].filter((x): x is number => x != null),
            title: `Tip ${outcome.toLowerCase()}`,
            body: `${match}: ${outcome}.`,
            link: slug ? `/predictions/match/${slug}` : "/predictions",
            data: { categories: p.categories.map((c) => c.category) },
          }, tx);
        }
        return true;
      });

      results.push({ id: p.id, match, result: won ? outcome : "already_settled", detail: `${lookup.homeScore}-${lookup.awayScore}` });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      await prisma.prediction.update({ where: { id: p.id }, data: { settlementNote: `Auto-settlement error — ${message}` } }).catch(() => {});
      results.push({ id: p.id, match, result: "error", detail: message });
    }
  }


  return { checked: candidates.length, results, kickoffsReconciled, fixtureIdsPrefetched: prefetched.size };
}
