import { curateAutomaticTips } from "../src/lib/geniusCuration";
import { lagosTodayBounds } from "../src/lib/lagosDate";
import { prisma } from "../src/lib/prisma";

async function main() {
  const now = new Date();
  const first = await curateAutomaticTips(now);
  const second = await curateAutomaticTips(now);
  const { start, end } = lagosTodayBounds(now);
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      kickoff: { gte: start, lt: end },
      categories: { some: { category: { in: ["GENIUS", "VIP", "PREMIUM"] } } },
    },
    select: {
      id: true,
      homeTeam: true,
      awayTeam: true,
      leagueName: true,
      leagueApiId: true,
      confidence: true,
      categories: { where: { category: { in: ["GENIUS", "VIP", "PREMIUM"] } }, select: { category: true } },
    },
  });
  const categoryIds = (category: "GENIUS" | "VIP" | "PREMIUM") =>
    rows.filter((row) => row.categories.some((link) => link.category === category)).map((row) => row.id);
  const genius = new Set(categoryIds("GENIUS"));
  const vip = new Set(categoryIds("VIP"));
  const premium = new Set(categoryIds("PREMIUM"));

  console.log(JSON.stringify({
    now: now.toISOString(),
    first,
    second,
    secondRunIdempotent: [second.genius, second.vip, second.premium].every((result) => result.added.length === 0 && result.removed.length === 0),
    counts: { genius: genius.size, vip: vip.size, premium: premium.size },
    overlapAllThree: [...premium].filter((id) => genius.has(id) && vip.has(id)),
    premiumPredictions: rows
      .filter((row) => premium.has(row.id))
      .map((row) => ({
        id: row.id,
        match: `${row.homeTeam} vs ${row.awayTeam}`,
        league: row.leagueName,
        leagueApiId: row.leagueApiId,
        confidence: row.confidence,
        categories: row.categories.map((link) => link.category).sort(),
      })),
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
