import assert from "node:assert/strict";
import { tipMatchesDateScope } from "../src/components/TipsPicker";
import { comboIsUpcoming, setComboLegs } from "../src/lib/combos";
import { lagosTodayBounds } from "../src/lib/lagosDate";
import { prisma } from "../src/lib/prisma";

async function main() {
  const now = new Date();
  const today = lagosTodayBounds(now);
  const todayKickoff = new Date(today.start.getTime() + 12 * 60 * 60_000);
  const futureKickoff = new Date(today.start.getTime() + 3.5 * 24 * 60 * 60_000);
  const afterLastKickoff = new Date(futureKickoff.getTime() + 1);
  const existing = await prisma.prediction.findFirst({ select: { authorId: true } });
  if (!existing) throw new Error("No existing prediction author is available for the temporary predictions");

  const createdPredictionIds: string[] = [];
  let comboId: string | null = null;
  try {
    for (const [suffix, kickoff] of [["today", todayKickoff], ["future", futureKickoff]] as const) {
      const prediction = await prisma.prediction.create({
        data: {
          category: "FEATURED",
          categories: { create: { category: "FEATURED" } },
          leagueName: "Combo date-gating verification",
          homeTeam: `Temporary ${suffix} home`,
          awayTeam: `Temporary ${suffix} away`,
          kickoff,
          status: "PUBLISHED",
          marketType: "OTHER",
          manualSettlementOnly: true,
          market: "Verification market",
          pick: "Verification pick",
          confidence: 75,
          reasoning: "Temporary verification row; deleted by the same script.",
          authorId: existing.authorId,
          publishedAt: now,
        },
      });
      createdPredictionIds.push(prediction.id);
    }

    const combo = await prisma.combo.create({
      data: { title: `TEMP combo date gate ${Date.now()}`, category: "FEATURED", published: true },
    });
    comboId = combo.id;
    await setComboLegs(combo.id, [
      { matchLabel: "Temporary today leg", market: "Verification", pick: "Today", predictionId: createdPredictionIds[0] },
      { matchLabel: "Temporary future leg", market: "Verification", pick: "Future", predictionId: createdPredictionIds[1] },
    ]);

    const predictions = await prisma.prediction.findMany({
      where: { id: { in: createdPredictionIds }, status: "PUBLISHED" },
      orderBy: { kickoff: "asc" },
      select: { id: true, kickoff: true },
    });
    assert.equal(predictions.length, 2);
    assert.deepEqual(
      predictions.map((prediction) => tipMatchesDateScope(prediction.kickoff?.toISOString() ?? null, "today-and-future", now)),
      [true, true],
    );
    assert.deepEqual(
      predictions.map((prediction) => tipMatchesDateScope(prediction.kickoff?.toISOString() ?? null, "today-only", now)),
      [true, false],
    );

    const kickoffs = predictions.map((prediction) => prediction.kickoff);
    assert.equal(comboIsUpcoming(kickoffs, now), true);
    assert.equal(comboIsUpcoming(kickoffs, new Date(today.end.getTime() + 60 * 60_000)), true);
    assert.equal(comboIsUpcoming(kickoffs, afterLastKickoff), false);

    console.log(JSON.stringify({
      comboId,
      pickerTodayAndFuture: 2,
      pickerTodayOnly: 1,
      visibleNow: true,
      visibleTomorrow: true,
      hiddenAfterLatestKickoff: true,
      todayKickoff: todayKickoff.toISOString(),
      latestKickoff: futureKickoff.toISOString(),
    }, null, 2));
  } finally {
    if (comboId) await prisma.combo.deleteMany({ where: { id: comboId } });
    if (createdPredictionIds.length) await prisma.prediction.deleteMany({ where: { id: { in: createdPredictionIds } } });
  }

  const [remainingCombos, remainingPredictions] = await Promise.all([
    comboId ? prisma.combo.count({ where: { id: comboId } }) : 0,
    prisma.prediction.count({ where: { id: { in: createdPredictionIds } } }),
  ]);
  assert.equal(remainingCombos, 0);
  assert.equal(remainingPredictions, 0);
  console.log("Temporary combo and prediction rows cleaned up.");
}

main().finally(() => prisma.$disconnect());
