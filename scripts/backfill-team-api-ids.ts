// One-time backfill for Prediction.homeTeamApiId/awayTeamApiId — added
// alongside the team/league enrichment cache (src/lib/enrichment.ts). Only
// predictions generated after that column existed get it populated by
// generate.ts; this script resolves it retroactively for existing PUBLISHED
// rows via the same searchTeam() lookup, so team enrichment can activate for
// current predictions too, not just future ones.
//
// Idempotent and safely re-runnable: only touches rows where homeTeamApiId
// or awayTeamApiId is still null, so a partial/interrupted run just leaves
// remaining rows to pick up next time. Distinct team names are resolved once
// and reused across every row that shares that name, to keep the throttled
// api-football call count down.
//
// Run manually: npx tsx scripts/backfill-team-api-ids.ts
import { PrismaClient } from "@prisma/client";
import { searchTeam } from "../src/lib/football/api-football";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      OR: [
        { homeTeamApiId: null, homeTeam: { not: null } },
        { awayTeamApiId: null, awayTeam: { not: null } },
      ],
    },
    select: { id: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true },
  });

  const names = new Set<string>();
  for (const r of rows) {
    if (r.homeTeamApiId == null && r.homeTeam) names.add(r.homeTeam);
    if (r.awayTeamApiId == null && r.awayTeam) names.add(r.awayTeam);
  }

  console.log(`${rows.length} predictions missing a team id, ${names.size} distinct team names to resolve.`);

  const resolved = new Map<string, number | null>();
  let ok = 0;
  let miss = 0;
  for (const name of names) {
    const match = await searchTeam(name);
    resolved.set(name, match?.id ?? null);
    if (match) ok++;
    else miss++;
    console.log(`${match ? "OK  " : "MISS"} ${name}${match ? ` -> ${match.id} (${match.name})` : ""}`);
  }

  let updated = 0;
  for (const r of rows) {
    const homeTeamApiId = r.homeTeamApiId ?? (r.homeTeam ? resolved.get(r.homeTeam) ?? null : null);
    const awayTeamApiId = r.awayTeamApiId ?? (r.awayTeam ? resolved.get(r.awayTeam) ?? null : null);
    if (homeTeamApiId === r.homeTeamApiId && awayTeamApiId === r.awayTeamApiId) continue; // nothing new resolved
    await prisma.prediction.update({ where: { id: r.id }, data: { homeTeamApiId, awayTeamApiId } });
    updated++;
  }

  console.log(`Done. ${ok} names resolved, ${miss} unresolved (will retry next run). ${updated} prediction rows updated.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
