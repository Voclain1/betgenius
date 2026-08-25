/**
 * Renders the Bet of the Day surfaces against real cached prices and asserts
 * the three figures the spec requires appear: price, bookmaker count, and the
 * staleness age of the quote.
 *
 * Pins a real prediction, reads back what the homepage hero and the dedicated
 * page would receive, and restores the previous slot holder afterwards.
 *
 * This checks the DATA the components render from, plus the components' own
 * output via renderToStaticMarkup, so a card that silently drops the price
 * block fails here rather than in production.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json --env-file=.env scripts/check-bet-of-the-day-render.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "../src/lib/prisma";
import { BetOfTheDayCard } from "../src/components/BetOfTheDayCard";

const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failures.push(label);
    if (got !== undefined) console.log(`        got: ${String(got).slice(0, 400)}`);
  }
};

async function main() {
  const { setBetOfTheDay, getBetOfTheDay, BET_OF_THE_DAY } = await import("../src/lib/betOfTheDay");

  const original = await prisma.prediction.findFirst({
    where: { categories: { some: { category: BET_OF_THE_DAY } } },
    select: { id: true, betOfDayPinnedAt: true, betOfDayPinnedById: true },
  });

  // Pick a published prediction whose fixture actually has cached prices, so
  // the render exercises the populated path rather than the degraded one.
  const priced = await prisma.fixtureOddsCache.findFirst({ where: { fetchedAt: { not: null } }, select: { matchKey: true } });
  if (!priced) {
    console.log("SKIP — no cached odds; run scripts/run-odds-refresh.ts first");
    await prisma.$disconnect();
    return;
  }
  const [homeId, awayId] = priced.matchKey.split("-");
  const target = await prisma.prediction.findFirst({
    where: { status: "PUBLISHED", homeTeamApiId: Number(homeId), awayTeamApiId: Number(awayId) },
    select: { id: true, homeTeam: true, awayTeam: true },
  });
  if (!target) {
    console.log("SKIP — no published prediction matches a priced fixture");
    await prisma.$disconnect();
    return;
  }

  await setBetOfTheDay(target.id, null);
  const data = await getBetOfTheDay();

  console.log(`\nRendering: ${target.homeTeam} v ${target.awayTeam}`);
  check("getBetOfTheDay returns the pinned pick", data?.row.id === target.id);
  check("cached odds are attached", !!data?.odds, JSON.stringify(data?.odds?.bookmakerCount));
  check("oddsFetchedAt is populated (drives the staleness stamp)", !!data?.oddsFetchedAt, String(data?.oddsFetchedAt));
  check("the gate resolved a real price for this exact selection", data?.gate?.price != null, JSON.stringify(data?.gate));
  check("the gate resolved a bookmaker count", data?.gate?.bookmakers != null, JSON.stringify(data?.gate?.bookmakers));

  if (data) {
    console.log(`  price=${data.gate?.price}  books=${data.gate?.bookmakers}  implied=${data.gate?.impliedProbability}%  edge=${data.gate?.edgePP}pp`);

    for (const variant of ["hero", "page"] as const) {
      const html = renderToStaticMarkup(BetOfTheDayCard({ data, variant }) as any);
      console.log(`\n  [${variant}]`);
      check(`${variant}: price is rendered`, html.includes(data.gate!.price!.toFixed(2)), html);
      check(`${variant}: bookmaker count is rendered`, html.includes(`best of ${data.gate!.bookmakers}`), html);
      check(`${variant}: staleness age is rendered`, /·\s*(just now|\d+[mhd] ago)/.test(html), html);
      check(`${variant}: the pick and market are rendered`, html.includes(data.row.pick) && html.includes(data.row.market), html);
      check(`${variant}: confidence is rendered`, html.includes(`${data.row.confidence}% confidence`), html);
      check(`${variant}: no placeholder price is shown`, !html.includes("Price not available yet"), html);
      // The page variant carries the reasoning; the hero deliberately does not.
      const hasReasoning = html.includes(data.row.reasoning.slice(0, 40));
      check(`${variant}: reasoning ${variant === "page" ? "present" : "omitted"}`, variant === "page" ? hasReasoning : !hasReasoning);
    }

    // And the degraded path: a pick with no cached prices must still render.
    const degraded = renderToStaticMarkup(
      BetOfTheDayCard({ data: { ...data, odds: null, oddsFetchedAt: null, gate: { qualifies: false, reasons: [], price: null, bookmakers: null, impliedProbability: null, edgePP: null } }, variant: "hero" }) as any,
    );
    console.log("\n  [no cached price]");
    check("renders the pick without inventing a price", degraded.includes("Price not available yet") && degraded.includes(data.row.pick), degraded);
  }

  // ---------- restore ----------
  await prisma.predictionCategoryLink.deleteMany({ where: { category: BET_OF_THE_DAY } });
  await prisma.prediction.updateMany({ where: { betOfDayPinnedAt: { not: null } }, data: { betOfDayPinnedAt: null, betOfDayPinnedById: null } });
  if (original) {
    await prisma.prediction.update({
      where: { id: original.id },
      data: { categories: { create: { category: BET_OF_THE_DAY } }, betOfDayPinnedAt: original.betOfDayPinnedAt, betOfDayPinnedById: original.betOfDayPinnedById },
    });
  }
  const restored = await prisma.predictionCategoryLink.count({ where: { category: BET_OF_THE_DAY } });
  check("database restored", restored === (original ? 1 : 0));

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length} failed`);
  await prisma.$disconnect();
  if (failures.length) process.exitCode = 1;
}

main();
