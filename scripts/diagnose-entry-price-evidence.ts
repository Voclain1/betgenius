/**
 * Sprint 11: why dedicated paid picks lack verified publication-price evidence.
 * READ-ONLY.
 *
 * Path traced:
 *   FixtureOddsCache (bookmaker quote, per-selection median and named quotes)
 *   -> applyVipPremiumGate promotion: marketConfirmation = verdict + quoteFetchedAt
 *      + confirmedAt + entryValueRecord (entryPrice, entryPriceBasis, quotes) [#176]
 *   -> publishPaidPredictionAtomically: appends marketConfirmation.publicationQuoteEvidence
 *      (entryValueRecord at publication + quoteFetchedAt + confirmedAt) [#178]
 *   -> audits read verifiedEntryPrice(confirmation, kickoff).
 *
 * For every dedicated row in the window, reports the first failing condition of
 * verifiedEntryPrice for the promotion record (top level) and the publication
 * snapshot (nested), by the code era that wrote it and by settlement state.
 *
 * Run: REQUIRE_READ_ONLY=1 npx tsx scripts/diagnose-entry-price-evidence.ts [days=60]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { DEDICATED_PAID_PROVENANCES } from "../src/lib/geniusCuration";
import { verifiedEntryPrice } from "../src/lib/paidEntryEvidence";
import { entryEvidenceEra, entryEvidenceStatus } from "../src/lib/sprint11Audit";

async function main() {
  if (process.env.REQUIRE_READ_ONLY !== "1") throw new Error("refusing: REQUIRE_READ_ONLY=1 is required");
  const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
  if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
  const days = Math.max(1, Number(process.argv[2]) || 60);
  const now = new Date();
  const rows = await prisma.prediction.findMany({
    where: { provenance: { in: [...DEDICATED_PAID_PROVENANCES] }, kickoff: { gte: new Date(now.getTime() - days * 86_400_000) } },
    select: { id: true, status: true, outcome: true, kickoff: true, createdAt: true, publishedAt: true, marketType: true, marketConfirmation: true },
    orderBy: { kickoff: "asc" },
  });
  console.log(`session verified read-only; dedicated rows with kickoff in the last ${days} days or later: ${rows.length}`);

  const table = new Map<string, number>();
  const bump = (k: string) => table.set(k, (table.get(k) ?? 0) + 1);
  const examples = new Map<string, string>();
  let agree = 0, disagree = 0;
  for (const r of rows) {
    if (!r.kickoff) { bump("no kickoff"); continue; }
    const mc = r.marketConfirmation as Record<string, any> | null;
    const promotedAt = typeof mc?.confirmedAt === "string" ? new Date(mc.confirmedAt) : r.createdAt;
    const era = entryEvidenceEra(promotedAt);
    const settled = r.outcome === "WON" || r.outcome === "LOST" || r.outcome === "VOID" ? "settled" : r.kickoff < now ? "kicked off, unsettled" : "upcoming";
    const top = entryEvidenceStatus(mc, r.kickoff);
    const nested = mc && Object.prototype.hasOwnProperty.call(mc, "publicationQuoteEvidence") ? entryEvidenceStatus(mc.publicationQuoteEvidence, r.kickoff) : "NO_PUBLICATION_SNAPSHOT";
    // The classifier must agree with the production verifier on every row.
    const v = verifiedEntryPrice(mc, r.kickoff) != null;
    if (v === (top === "VERIFIED")) agree++; else disagree++;
    const k = `${era} | ${r.status} | ${settled} | promotion ${top} | publication ${nested}`;
    bump(k);
    if (!examples.has(k)) {
      examples.set(k, `${r.id} kickoff ${r.kickoff.toISOString()} ${r.marketType} keys[${mc ? Object.keys(mc).sort().join(",") : ""}] basis ${mc?.entryPriceBasis ?? "—"} entryPrice ${mc?.entryPrice ?? "—"} quoteFetchedAt ${mc?.quoteFetchedAt ?? "—"} confirmedAt ${mc?.confirmedAt ?? "—"} publishedAt ${r.publishedAt?.toISOString() ?? "—"}`);
    }
  }
  console.log(`classifier agrees with verifiedEntryPrice on ${agree} rows, disagrees on ${disagree} (must be 0)`);
  console.log("\ncount  era | status | settlement | promotion record | publication snapshot");
  for (const [k, n] of [...table.entries()].sort()) console.log(`${String(n).padStart(5)}  ${k}\n         e.g. ${examples.get(k) ?? ""}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
