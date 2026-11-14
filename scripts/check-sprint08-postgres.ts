const react = require("react");
react.cache ??= (fn: unknown) => fn;
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { parseDiscovery } from "../src/lib/predictionDiscovery";
const { loadDiscovery } =
  require("../src/lib/predictionDiscoveryData") as typeof import("../src/lib/predictionDiscoveryData");
const { getPersonalization, savedPredictionIds, savePrediction } =
  require("../src/lib/personalizationData") as typeof import("../src/lib/personalizationData");
const { getSearchIndex } =
  require("../src/lib/predictionScope") as typeof import("../src/lib/predictionScope");
import { ANONYMOUS, type Entitlement } from "../src/lib/entitlement";
import { matchKey, matchSlug } from "../src/lib/slug";
let checks = 0;
const eq = (a: unknown, b: unknown) => {
  assert.deepEqual(a, b);
  checks++;
};
const ok = (x: unknown) => {
  assert.ok(x);
  checks++;
};
function stub(path: string, exports: Record<string, unknown>) {
  const key = require.resolve(path);
  require.cache[key] = {
    id: key,
    filename: key,
    loaded: true,
    exports: { __esModule: true, ...exports },
  } as NodeJS.Module;
}
async function main() {
  if (
    process.env.BETGENIUS_DISPOSABLE_PG !== "yes" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:5432/betgenius_paid_ci")
  )
    throw new Error("Disposable PostgreSQL required");
  const prefix = `s08-${Date.now()}`,
    api = 1920000000 + Math.floor(Math.random() * 100000);
  const user = await prisma.user.create({
    data: { email: `${prefix}@example.invalid` },
  });
  const now = new Date(),
    kickoff = new Date(+now + 86400000);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
  }).format(kickoff);
  const f = (extra: Record<string, string> = {}) =>
    parseDiscovery(
      { d_date: date, d_competition: String(api), ...extra },
      undefined,
      now,
    );
  const vip: Entitlement = { role: "USER", tier: "VIP", status: "ACTIVE" },
    premium: Entitlement = { role: "USER", tier: "PREMIUM", status: "ACTIVE" };
  const free: Entitlement = { role: "USER", tier: "FREE", status: "ACTIVE" };
  const keys: string[] = [];
  let serial = 0,
    fixtureId: string | undefined,
    leagueId: string | undefined;
  const teamIds: string[] = [];
  async function create(extra: Record<string, unknown> = {}) {
    serial++;
    const p = await prisma.prediction.create({
      data: {
        authorId: user.id,
        homeTeam: `Synthetic Home ${serial}`,
        awayTeam: `Synthetic Away ${serial}`,
        homeTeamApiId: api + serial,
        awayTeamApiId: api + 500,
        leagueApiId: api,
        leagueName: "Synthetic Test League",
        fixtureApiId: api + 1000 + serial,
        kickoff,
        status: "PUBLISHED",
        publishedAt: now,
        category: "FEATURED",
        categories: { create: [{ category: "FEATURED" }] },
        market: "Total goals",
        marketType: "OVER_UNDER",
        selection: { line: 2.5, direction: "OVER" },
        pick: "Over 2.5",
        confidence: 80,
        reasoning: "Synthetic stored reasoning",
        manualSettlementOnly: false,
        ...extra,
      } as any,
    });
    await prisma.prediction.update({
      where: { id: p.id },
      data: { matchSlugKey: matchSlug(p) },
    });
    return p;
  }
  try {
    const publicPick = await create(),
      savedPick = await create({ homeTeam: "Followed Example" });
    const vipPick = await create({
      category: "VIP",
      categories: { create: [{ category: "VIP" }] },
      provenance: "VIP_GENERATED",
      pick: "PRIVATE_S08_VIP_PICK",
      reasoning: "PRIVATE_S08_VIP_REASON",
    });
    const premiumPick = await create({
      category: "PREMIUM",
      categories: { create: [{ category: "PREMIUM" }] },
      provenance: "PREMIUM_GENERATED",
      pick: "PRIVATE_S08_PREMIUM_PICK",
    });
    const privateOnly = await create({
      homeTeam: "PRIVATE_S08_TEAM",
      category: "VIP",
      categories: { create: [{ category: "VIP" }] },
      provenance: "VIP_GENERATED",
      pick: "PRIVATE_S08_ONLY",
    });
    const done = await create({
      outcome: "WON",
      kickoff: new Date(+kickoff - 3600000),
      settledAt: now,
    });
    const draft = await create({ status: "DRAFT", pick: "PRIVATE_S08_DRAFT" });
    const leg = await create({
      category: "SAME_GAME_DOUBLE",
      categories: { create: [{ category: "SAME_GAME_DOUBLE" }] },
    });
    const banker = await create({
      category: "BANKER",
      categories: { create: [{ category: "BANKER" }] },
      pick: "PRIVATE_S08_REGISTERED",
    });
    const q = await loadDiscovery(f(), ANONYMOUS, undefined, undefined, now);
    ok(q.items.some((p) => p.id === publicPick.id));
    for (const id of [
      vipPick.id,
      premiumPick.id,
      privateOnly.id,
      done.id,
      draft.id,
      leg.id,
      banker.id,
    ])
      ok(!q.items.some((p) => p.id === id));
    ok(!JSON.stringify(q).includes("PRIVATE_S08"));
    eq(
      (await loadDiscovery(f(), ANONYMOUS, "VIP", undefined, now)).locked,
      true,
    );
    eq((await loadDiscovery(f(), vip, "PREMIUM", undefined, now)).locked, true);
    ok(
      (await loadDiscovery(f(), vip, "VIP", undefined, now)).items.some(
        (p) => p.id === vipPick.id,
      ),
    );
    ok(
      (await loadDiscovery(f(), premium, "PREMIUM", undefined, now)).items.some(
        (p) => p.id === premiumPick.id,
      ),
    );
    ok(
      (await loadDiscovery(f(), free, "BANKER", undefined, now)).items.some(
        (p) => p.id === banker.id,
      ),
    );
    eq(
      (
        await loadDiscovery(
          f({ d_team: "Followed Ex" }),
          ANONYMOUS,
          undefined,
          undefined,
          now,
        )
      ).items.map((p) => p.id),
      [savedPick.id],
    );
    eq(
      (
        await loadDiscovery(
          f({ d_market: "BTTS" }),
          ANONYMOUS,
          undefined,
          undefined,
          now,
        )
      ).matched,
      0,
    );
    eq(
      (
        await loadDiscovery(
          f({ d_competition: String(api + 999) }),
          ANONYMOUS,
          undefined,
          undefined,
          now,
        )
      ).matched,
      0,
    );
    const key = matchKey(publicPick)!;
    keys.push(key);
    const odds = {
      bookmakerCount: 1,
      update: now.toISOString(),
      markets: [
        {
          market: "Goals Over/Under",
          selections: [
            {
              value: "Over 2.5",
              best: 1.95,
              median: 1.95,
              bookmakers: 1,
              bestBookmaker: "Synthetic Source",
              quotes: [{ bookmaker: "Synthetic Source", odd: 1.95 }],
            },
          ],
        },
      ],
    };
    await prisma.fixtureOddsCache.create({
      data: {
        matchKey: key,
        fixtureApiId: publicPick.fixtureApiId,
        fetchedAt: now,
        oddsJson: odds,
      },
    });
    eq(
      (
        await loadDiscovery(
          f({ d_odds: "quoted" }),
          ANONYMOUS,
          undefined,
          undefined,
          now,
        )
      ).items.map((p) => p.id),
      [publicPick.id],
    );
    await prisma.fixtureOddsCache.update({
      where: { matchKey: key },
      data: {
        oddsJson: {
          ...odds,
          update: new Date(+now - 121 * 60000).toISOString(),
        },
      },
    });
    eq(
      (
        await loadDiscovery(
          f({ d_odds: "quoted" }),
          ANONYMOUS,
          undefined,
          undefined,
          now,
        )
      ).matched,
      0,
    );
    await prisma.fixtureOddsCache.update({
      where: { matchKey: key },
      data: { oddsJson: odds },
    });
    await prisma.userPreference.create({
      data: {
        userId: user.id,
        timezone: "America/New_York",
        preferredMarkets: ["OVER_UNDER"],
      },
    });
    await prisma.userFollow.create({
      data: {
        userId: user.id,
        targetType: "TEAM",
        targetKey: String(savedPick.homeTeamApiId),
        label: "Followed Example",
      },
    });
    const pref = await getPersonalization(user.id);
    eq(pref.timezone, "America/New_York");
    const interests = {
      teams: pref.teams.map((t) => t.id),
      leagues: [],
      markets: pref.preferredMarkets,
      saved: [] as string[],
    };
    eq(
      (
        await loadDiscovery(
          f({ d_personal: "favourites" }),
          free,
          undefined,
          interests,
          now,
        )
      ).items.map((p) => p.id),
      [savedPick.id],
    );
    ok(
      (
        await loadDiscovery(
          f({ d_personal: "markets" }),
          free,
          undefined,
          interests,
          now,
        )
      ).matched > 0,
    );
    await savePrediction(user.id, savedPick.id, free);
    await savePrediction(user.id, vipPick.id, vip);
    interests.saved = await savedPredictionIds(user.id);
    eq(
      (
        await loadDiscovery(
          f({ d_personal: "saved" }),
          free,
          undefined,
          interests,
          now,
        )
      ).items.map((p) => p.id),
      [savedPick.id],
    );
    await prisma.fixtureDetailCache.create({
      data: {
        matchKey: key,
        fixtureApiId: publicPick.fixtureApiId! + 1,
        homeTeamApiId: publicPick.homeTeamApiId!,
        awayTeamApiId: publicPick.awayTeamApiId!,
        kickoffDay: kickoff.toISOString().slice(0, 10),
        detailJson: {
          result: {
            fixtureApiId: publicPick.fixtureApiId,
            status: "FT",
            capturedAt: now.toISOString(),
          },
        },
      },
    });
    ok(
      (
        await loadDiscovery(f(), ANONYMOUS, undefined, undefined, now)
      ).items.some((p) => p.id === publicPick.id),
    );
    await prisma.fixtureDetailCache.update({
      where: { matchKey: key },
      data: { fixtureApiId: publicPick.fixtureApiId },
    });
    ok(
      !(
        await loadDiscovery(f(), ANONYMOUS, undefined, undefined, now)
      ).items.some((p) => p.id === publicPick.id),
    );
    await prisma.fixtureDetailCache.delete({ where: { matchKey: key } });
    // Native final status beats a future prediction kickoff; mismatched team mapping is never trusted.
    const league = await prisma.league.create({
      data: {
        apiId: api,
        name: "Synthetic Test League",
        country: "Synthetic",
        season: 2026,
      },
    });
    leagueId = league.id;
    const home = await prisma.team.create({
        data: { apiId: publicPick.homeTeamApiId!, name: "Synthetic Home" },
      }),
      away = await prisma.team.create({
        data: { apiId: publicPick.awayTeamApiId!, name: "Synthetic Away" },
      });
    teamIds.push(home.id, away.id);
    const fixture = await prisma.fixture.create({
      data: {
        apiId: publicPick.fixtureApiId!,
        leagueId: league.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoff,
        status: "FT",
        homeScore: 2,
        awayScore: 1,
      },
    });
    fixtureId = fixture.id;
    ok(
      !(
        await loadDiscovery(f(), ANONYMOUS, undefined, undefined, now)
      ).items.some((p) => p.id === publicPick.id),
    );
    ok(
      (
        await loadDiscovery(
          f({ d_state: "finished" }),
          ANONYMOUS,
          undefined,
          undefined,
          now,
        )
      ).items.some((p) => p.id === publicPick.id),
    );
    await prisma.fixture.update({
      where: { id: fixture.id },
      data: { status: "NS", kickoff: new Date(+kickoff + 3600000) },
    });
    ok(
      !(
        await loadDiscovery(f(), ANONYMOUS, undefined, undefined, now)
      ).items.some((p) => p.id === publicPick.id),
    );
    const search = await getSearchIndex();
    ok(!JSON.stringify(search).includes("PRIVATE_S08_TEAM"));
    let viewer = ANONYMOUS;
    stub("../src/lib/viewerEntitlement", {
      getViewerEntitlement: async () => viewer,
    });
    const { GET } = require("../src/app/api/predictions/route");
    for (const v of [ANONYMOUS, free, vip, premium]) {
      viewer = v;
      const response: Response = await GET(
        new Request("http://localhost/api/predictions"),
      );
      eq(response.headers.get("cache-control"), "private, no-store");
      const payload = await response.json();
      for (const [id, readable] of [
        [vipPick.id, v === vip || v === premium],
        [premiumPick.id, v === premium],
      ] as const) {
        const row = payload.find((p: any) => p.id === id);
        ok(row);
        if (!readable) {
          eq(row.pick, "LOCKED");
          for (const field of [
            "selection",
            "market",
            "marketType",
            "analysisJson",
            "marketConfirmation",
            "originalReasoning",
          ])
            eq(row[field], undefined);
        }
      }
    }
    for (let i = 0; i < 65; i++)
      await create({ homeTeam: "Capped Fixture", awayTeam: "Same Opponent" });
    const { getPublishedByMatchSlug, getMatchEditorialEvidence } =
      require("../src/lib/predictionScope") as typeof import("../src/lib/predictionScope");
    const cappedSlug = matchSlug({
      homeTeam: "Capped Fixture",
      awayTeam: "Same Opponent",
      kickoff,
    })!;
    eq((await getPublishedByMatchSlug(cappedSlug)).rows.length, 60);
    eq((await getMatchEditorialEvidence(cappedSlug)).length, 60);
    const before = await prisma.prediction.findMany({
      where: { authorId: user.id },
      orderBy: { id: "asc" },
    });
    for (let i = 0; i < 305; i++)
      await create({ homeTeam: "Pagination Sample", fixtureApiId: null });
    const paged = await loadDiscovery(
      f({ d_team: "Pagination", d_page: "2", d_state: "all" }),
      ANONYMOUS,
      undefined,
      undefined,
      now,
    );
    eq(paged.truncated, true);
    eq(paged.matched, 300);
    eq(paged.page, 2);
    eq(paged.items.length, 12);
    const after = await prisma.prediction.findMany({
      where: { id: { in: before.map((p) => p.id) } },
      orderBy: { id: "asc" },
    });
    eq(after, before);
    console.log(
      `Sprint 08 PostgreSQL: ${checks} assertions passed; query caps, filters, preferences, saves, access/API/search boundaries and immutable publication data`,
    );
  } finally {
    await prisma.savedPrediction.deleteMany({ where: { userId: user.id } });
    await prisma.prediction.deleteMany({ where: { authorId: user.id } });
    await prisma.fixtureDetailCache.deleteMany({
      where: { matchKey: { in: keys } },
    });
    await prisma.fixtureOddsCache.deleteMany({
      where: { matchKey: { in: keys } },
    });
    if (fixtureId) await prisma.fixture.delete({ where: { id: fixtureId } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    if (leagueId) await prisma.league.delete({ where: { id: leagueId } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
