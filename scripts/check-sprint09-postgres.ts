const react = require("react");
react.cache ??= (fn: unknown) => fn;
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  loadPerformance,
  loadPerformanceRecord,
} from "../src/lib/performanceData";
import {
  performanceFilter,
  performanceSummary,
  PERFORMANCE_CAP,
} from "../src/lib/performanceTransparency";
import { ANONYMOUS, entitlementFor } from "../src/lib/entitlement";
import type { Entitlement } from "../src/lib/entitlement";
let checks = 0;
const eq = (a: unknown, b: unknown) => {
  assert.deepEqual(a, b);
  checks++;
};
const ok = (x: unknown) => {
  assert.ok(x);
  checks++;
};
async function main() {
  const urls = [
    process.env.DATABASE_URL,
    process.env.DATABASE_URL_UNPOOLED,
  ].filter((v): v is string => !!v);
  if (
    process.env.BETGENIUS_DISPOSABLE_PG !== "yes" ||
    !urls.length ||
    urls.some((value) => {
      const url = new URL(value);
      return (
        url.hostname !== "127.0.0.1" ||
        url.port !== "5432" ||
        url.pathname !== "/betgenius_paid_ci"
      );
    })
  )
    throw new Error("Explicit disposable localhost database required");

  const prefix = `s09-test-${Date.now()}`,
    user = await prisma.user.create({
      data: { email: `${prefix}@example.invalid` },
    }),
    now = new Date("2025-02-20T12:00:00Z"),
    kickoff = new Date("2025-02-10T12:00:00Z"),
    publishedAt = new Date("2025-02-10T10:00:00Z");
  const ids: string[] = [];
  try {
    for (const [i, category, provenance] of [
      [0, "FEATURED", "STANDARD_CURATED"],
      [1, "VIP", "VIP_GENERATED"],
      [2, "PREMIUM", "PREMIUM_GENERATED"],
      [3, "BANKER", "STANDARD_CURATED"],
    ] as const) {
      const p = await prisma.prediction.create({
        data: {
          authorId: user.id,
          fixtureApiId: 1950000000 + i,
          homeTeam: `Synthetic ${prefix} ${i}`,
          awayTeam: "Synthetic Away",
          kickoff,
          publishedAt,
          settledAt: new Date("2025-02-10T15:00:00Z"),
          status: "PUBLISHED",
          category,
          provenance,
          categories: {
            create: [
              { category },
              ...(category === "PREMIUM" ? [{ category: "FEATURED" }] : []),
            ],
          },
          market: "Both teams to score",
          marketType: "BTTS",
          selection: { value: "YES" },
          pick: i === 0 ? "Public selection" : `PRIVATE_${category}`,
          reasoning: "Synthetic test only",
          confidence: 80,
          outcome: "WON",
          finalHomeScore: 2,
          finalAwayScore: 1,
        },
      });
      ids.push(p.id);
    }
    const vip: Entitlement = { tier: "VIP", status: "ACTIVE", role: "USER" },
      premium: Entitlement = {
        tier: "PREMIUM",
        status: "ACTIVE",
        role: "USER",
      },
      free: Entitlement = { tier: "FREE", status: "ACTIVE", role: "USER" };
    const expired = entitlementFor(
      {
        tier: "PREMIUM",
        status: "ACTIVE",
        currentPeriodEnd: new Date("2024-01-01"),
      },
      "USER",
      now,
    );
    for (const viewer of [ANONYMOUS, free, expired, vip, premium]) {
      const data = await loadPerformance(
          performanceFilter({ months: "1" }),
          viewer,
          now,
        ),
        mine = data.rows.filter((r) => r.homeTeam?.includes(prefix));
      const picks = JSON.stringify(mine);
      ok(mine.some((r) => r.id === ids[0]));
      if (viewer === ANONYMOUS || viewer === free || viewer === expired) {
        ok(!picks.includes("PRIVATE_VIP"));
        ok(!picks.includes("PRIVATE_PREMIUM"));
      }
      if (viewer === ANONYMOUS) ok(!picks.includes("PRIVATE_BANKER"));
      eq(mine.some(r=>r.id===ids[1]),viewer===vip||viewer===premium);
      eq(mine.some(r=>r.id===ids[3]),viewer!==ANONYMOUS);
      eq(
        mine.some((r) => r.id === ids[2]),
        viewer === premium,
      );
      eq(
        (await loadPerformanceRecord(ids[2], viewer)) != null,
        viewer === premium,
      );
    }
    eq(await loadPerformanceRecord("invalid / path", ANONYMOUS), null);
    eq(await loadPerformanceRecord("missing", ANONYMOUS), null);
    const before = await prisma.prediction.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
    });
    const data = await loadPerformance(performanceFilter({}), premium, now);
    performanceSummary(data.rows, now);
    const after = await prisma.prediction.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
    });
    eq(after, before);
    // A real 5,001-row date bucket proves the cap/truncation without relying on a mocked Prisma implementation.
    const large = Array.from({ length: PERFORMANCE_CAP + 1 }, (_, i) => ({
      id: `${prefix}-cap-${i}`,
      authorId: user.id,
      fixtureApiId: 1951000000 + i,
      homeTeam: "Synthetic cap fixture",
      awayTeam: "Synthetic away",
      kickoff,
      publishedAt,
      status: "PUBLISHED",
      category: "FEATURED",
      market: "Both teams to score",
      marketType: "BTTS",
      selection: { value: "YES" },
      pick: "Yes",
      reasoning: "Synthetic cap test",
      confidence: 80,
    }));
    await prisma.prediction.createMany({ data: large });
    await prisma.predictionCategoryLink.createMany({
      data: large.map((p) => ({ predictionId: p.id, category: "FEATURED" })),
    });
    const capped = await loadPerformance(
      performanceFilter({ months: "1" }),
      ANONYMOUS,
      now,
    );
    eq(capped.rows.length, PERFORMANCE_CAP);
    eq(capped.truncated, true);
    eq(
      capped.rows.some((r) => r.id === ids[2]),
      false,
    );
    console.log(
      `Sprint 09 PostgreSQL: ${checks} access, expiry, immutability and real query-cap assertions passed`,
    );
  } finally {
    await prisma.predictionCategoryLink.deleteMany({
      where: { prediction: { authorId: user.id } },
    });
    await prisma.prediction.deleteMany({ where: { authorId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}
main().finally(() => prisma.$disconnect());
