/**
 * Proves the dedicated VIP/PREMIUM gate promotes to the RIGHT TIER, on real
 * rows, through the real code path.
 *
 * WHY THIS IS SEEDED RATHER THAN A LIVE RUN. Verifying the gate against live
 * generation needs a fixture that is still claimable AND in the paid-tier
 * leagues AND priced — and a fixture stays claimable for a median of 23 minutes
 * before ordinary generation takes it, so that conjunction is not available on
 * demand. scripts/verify-vip-premium-pass.ts covers the live half (targeting
 * and real generation); this covers the half that must be right EVERY time and
 * must not wait on a scheduling coincidence to be checked.
 *
 * The properties under test are the ones no amount of reading can settle:
 *   - a pick the market backs at 77 becomes VIP and NOT PREMIUM;
 *   - a pick the market backs at 86 becomes PREMIUM, and carries VIP too,
 *     because PREMIUM is a strict subset rather than a separate feed;
 *   - the model floor, the bookmaker floor and quote staleness each still
 *     reject, so targeting has not quietly loosened the gate;
 *   - a draft from an ordinary job is NEVER evaluated, however well it would
 *     have scored — a pick is paid-tier because it was generated for the tier,
 *     not because it happens to agree with the market.
 *
 * Rows sit on a far-future day and are deleted in `finally` with a
 * zero-remaining assertion, the same isolation check-tier-provenance.ts uses.
 *
 * Run: npx tsx --env-file=.env scripts/check-vip-premium-gate.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

/**
 * Three 1X2 prices whose de-vigged Home probability is exactly `home`.
 *
 * Built from shares rather than typed in, because a hand-picked price set that
 * de-vigs to "about 86" would make this test assert its own arithmetic rather
 * than the gate's. Overround 1.05 — a realistic book margin, and the thing
 * devig() exists to divide out.
 */
function oddsForHomeProbability(home: number, bookmakers = 6) {
  const overround = 1.05;
  const shares = { Home: home / 100, Draw: (1 - home / 100) * 0.55, Away: (1 - home / 100) * 0.45 };
  const price = (share: number) => Number((1 / (share * overround)).toFixed(3));
  return {
    bookmakerCount: bookmakers,
    update: new Date().toISOString(),
    markets: [
      {
        market: "Match Winner",
        selections: (["Home", "Draw", "Away"] as const).map((value) => ({
          value,
          best: price(shares[value]),
          median: price(shares[value]),
          bookmakers,
        })),
      },
    ],
  };
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const {
    applyVipPremiumGate,
    VIP_PREMIUM_INTENT,
    VIP_MARKET_FLOOR,
    PREMIUM_MARKET_FLOOR,
  } = await import("../src/lib/vipPremiumPipeline");
  const { VIP_GENERATED_PROVENANCE, PREMIUM_GENERATED_PROVENANCE, STANDARD_CURATED_PROVENANCE } = await import("../src/lib/geniusCuration");
  const { MC_MIN_MODEL_CONFIDENCE, MC_MIN_BOOKMAKERS, MC_MAX_QUOTE_AGE_MS } = await import("../src/lib/marketConfirmed");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const predictionIds: string[] = [];
  const jobIds: string[] = [];
  const matchKeys: string[] = [];
  let teamSeq = -66000;

  try {
    const author = await prisma.user.findFirst({
      where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
      select: { id: true },
    });
    if (!author) throw new Error("no admin user to attribute test rows to");

    // Far enough out that the gate's `kickoff > now` holds and no real feed
    // can see these rows.
    const kickoff = new Date("2099-06-15T18:00:00.000Z");
    const kickoffDayKey = "2099-06-15";

    /**
     * One draft on its own fixture, with its own cached quote.
     *
     * Distinct team ids per case so each draft gets its own matchKey — the gate
     * keeps at most one pick per fixture, so sharing a fixture would make the
     * cases compete instead of testing independently.
     */
    const seed = async (opts: {
      label: string;
      confidence: number;
      marketHomeProbability: number;
      intent?: string;
      bookmakers?: number;
      quoteAgeMs?: number;
    }) => {
      const homeId = teamSeq--;
      const awayId = teamSeq--;
      const key = `${homeId}-${awayId}-${kickoffDayKey}`;
      matchKeys.push(key);

      const job = await prisma.aIJob.create({
        data: {
          userId: author.id,
          prompt: JSON.stringify({ intent: opts.intent ?? VIP_PREMIUM_INTENT, home: opts.label }),
          model: "test:check-vip-premium-gate",
          rawOutput: "{}",
          /**
           * Dated into the far future so this test cannot consume the LIVE daily
           * quota while it runs.
           *
           * vipPremiumGeneratedToday counts AIJobs carrying this intent inside
           * today's Lagos bounds, and these rows carry exactly that intent. Left
           * at the default `now()`, seven of them land in today's window for the
           * duration of the run — and that is not hypothetical: a poller tick
           * landing mid-test reported "quota spent for today" and stood down
           * while the real remaining quota was six. A crash before the `finally`
           * cleanup would burn the day's quota permanently.
           *
           * The gate itself is unaffected: it selects on the PREDICTION's kickoff
           * and its job's intent, never on when the job was created.
           */
          createdAt: new Date("2099-06-14T00:00:00.000Z"),
        },
      });
      jobIds.push(job.id);

      const row = await prisma.prediction.create({
        data: {
          category: "FEATURED",
          status: "PENDING_REVIEW",
          kickoff,
          homeTeam: `ZZ VPG ${opts.label} A`,
          awayTeam: `ZZ VPG ${opts.label} B`,
          homeTeamApiId: homeId,
          awayTeamApiId: awayId,
          leagueApiId: 39,
          leagueName: "Premier League",
          marketType: "MATCH_WINNER",
          selection: { value: "HOME" },
          market: "Match Winner",
          pick: `ZZ VPG ${opts.label} A to win`,
          confidence: opts.confidence,
          reasoning: "temporary row from check-vip-premium-gate.ts",
          manualSettlementOnly: false,
          authorId: author.id,
          aiJobId: job.id,
        },
      });
      predictionIds.push(row.id);

      await prisma.fixtureOddsCache.upsert({
        where: { matchKey: key },
        create: {
          matchKey: key,
          oddsJson: oddsForHomeProbability(opts.marketHomeProbability, opts.bookmakers ?? MC_MIN_BOOKMAKERS + 1) as any,
          bookmakerCount: opts.bookmakers ?? MC_MIN_BOOKMAKERS + 1,
          fetchedAt: new Date(Date.now() - (opts.quoteAgeMs ?? 0)),
        },
        update: {
          oddsJson: oddsForHomeProbability(opts.marketHomeProbability, opts.bookmakers ?? MC_MIN_BOOKMAKERS + 1) as any,
          bookmakerCount: opts.bookmakers ?? MC_MIN_BOOKMAKERS + 1,
          fetchedAt: new Date(Date.now() - (opts.quoteAgeMs ?? 0)),
        },
      });
      return row;
    };

    console.log(`floors: model ${MC_MIN_MODEL_CONFIDENCE}, VIP market ${VIP_MARKET_FLOOR}, PREMIUM market ${PREMIUM_MARKET_FLOOR}\n`);

    // Model confidence is kept within MC_MAX_GAP_PP of the market in both
    // promotion cases, so the ONLY thing deciding the tier is the market.
    const vipCase = await seed({ label: "vip", confidence: 78, marketHomeProbability: 77 });
    const premiumCase = await seed({ label: "prem", confidence: 84, marketHomeProbability: 86 });
    const belowModel = await seed({ label: "lowmodel", confidence: MC_MIN_MODEL_CONFIDENCE - 1, marketHomeProbability: 86 });
    const belowMarket = await seed({ label: "lowmarket", confidence: 78, marketHomeProbability: 60 });
    const thinBooks = await seed({ label: "thin", confidence: 78, marketHomeProbability: 86, bookmakers: MC_MIN_BOOKMAKERS - 1 });
    const staleQuote = await seed({ label: "stale", confidence: 78, marketHomeProbability: 86, quoteAgeMs: MC_MAX_QUOTE_AGE_MS + 60_000 });
    // Would sail through on the numbers. Must never be looked at.
    const wrongIntent = await seed({ label: "otherintent", confidence: 84, marketHomeProbability: 86, intent: "REGULAR_COMBO" });

    /**
     * Asserted, not merely intended: if a future edit drops the far-future
     * createdAt above, this catches it here rather than by silently standing
     * down a real scheduled run one day.
     *
     * Phrased as "none of MY rows are in today's window" rather than "the day's
     * remaining quota is still the full six". The second is what this used to
     * assert, and it reads live state: production generating one paid pick on
     * the same day — which is the pass working correctly — left remaining at
     * five and failed the check for a reason that had nothing to do with this
     * test. The count of seeded rows inside today's bounds is the invariant
     * actually under test, and it is the same one whatever production is doing.
     *
     * The quota rule itself is covered with controlled counts in
     * scripts/check-vip-premium-quota.ts, which needs no database at all.
     */
    const { lagosTodayBounds } = await import("../src/lib/lagosDate");
    const today = lagosTodayBounds();
    const seededInTodaysWindow = await prisma.aIJob.count({
      where: { id: { in: jobIds }, createdAt: { gte: today.start, lt: today.end } },
    });
    check(
      "the test's own rows never land in today's quota window",
      seededInTodaysWindow === 0,
      `${seededInTodaysWindow} of ${jobIds.length} seeded job(s) dated into today`,
    );

    const gate = await applyVipPremiumGate();
    console.log(`gate evaluated ${gate.evaluated} draft(s) across ${gate.fixtures} fixture(s)\n`);

    const reload = (id: string) =>
      prisma.prediction.findUniqueOrThrow({
        where: { id },
        select: { provenance: true, categories: { select: { category: true } } },
      });
    const tags = async (id: string) => (await reload(id)).categories.map((c) => c.category).sort();
    const prov = async (id: string) => (await reload(id)).provenance;
    const reasonFor = (id: string) => gate.rejected.find((r) => r.predictionId === id)?.verdict.reason ?? null;

    console.log("tiering — the market, not the confidence, decides:");
    check("a 77% market pick is promoted", gate.promotedVip.some((p) => p.predictionId === vipCase.id));
    check("...stamped VIP_GENERATED", (await prov(vipCase.id)) === VIP_GENERATED_PROVENANCE, `${await prov(vipCase.id)}`);
    check("...tagged VIP only", JSON.stringify(await tags(vipCase.id)) === JSON.stringify(["VIP"]), `${JSON.stringify(await tags(vipCase.id))}`);

    check("an 86% market pick is promoted", gate.promotedPremium.some((p) => p.predictionId === premiumCase.id));
    check("...stamped PREMIUM_GENERATED", (await prov(premiumCase.id)) === PREMIUM_GENERATED_PROVENANCE, `${await prov(premiumCase.id)}`);
    check(
      "...tagged BOTH, because PREMIUM is a strict subset",
      JSON.stringify(await tags(premiumCase.id)) === JSON.stringify(["PREMIUM", "VIP"]),
      `${JSON.stringify(await tags(premiumCase.id))}`,
    );
    check(
      "the PREMIUM pick is NOT merely the more confident one",
      premiumCase.confidence - vipCase.confidence < PREMIUM_MARKET_FLOOR - VIP_MARKET_FLOOR + 10,
      "tier follows the market probability, and both drafts sit near their market",
    );

    console.log("\nthe gate still rejects — targeting has not loosened it:");
    check("a sub-floor model confidence is rejected", reasonFor(belowModel.id) === "MODEL_BELOW_FLOOR", `${reasonFor(belowModel.id)}`);
    check("a sub-floor market probability is rejected", reasonFor(belowMarket.id) === "MARKET_BELOW_FLOOR", `${reasonFor(belowMarket.id)}`);
    check("thin bookmaker coverage is rejected", reasonFor(thinBooks.id) === "THIN_COVERAGE", `${reasonFor(thinBooks.id)}`);
    check("a stale quote is rejected", reasonFor(staleQuote.id) === "STALE_QUOTE", `${reasonFor(staleQuote.id)}`);
    // Prediction.provenance defaults to STANDARD_CURATED and is never null, so
    // "untouched" means "still the default", not "empty".
    check(
      "no rejected draft was stamped with a paid-tier marker",
      (await prov(belowModel.id)) === STANDARD_CURATED_PROVENANCE && (await prov(belowMarket.id)) === STANDARD_CURATED_PROVENANCE,
      `${await prov(belowModel.id)} / ${await prov(belowMarket.id)}`,
    );

    console.log("\nintent — agreeing with the market is not enough:");
    check("a draft from another intent is not evaluated", !gate.rejected.some((r) => r.predictionId === wrongIntent.id));
    check(
      "...and is never promoted",
      (await prov(wrongIntent.id)) === STANDARD_CURATED_PROVENANCE,
      `${await prov(wrongIntent.id)}`,
    );
    check("...and gains no paid-tier tag", (await tags(wrongIntent.id)).length === 0);

    console.log("\nidempotence — a second run must not re-promote or churn:");
    const again = await applyVipPremiumGate();
    check("already-promoted rows are not re-evaluated", again.promotedVip.length === 0 && again.promotedPremium.length === 0);
    check("the VIP row keeps its tier", (await prov(vipCase.id)) === VIP_GENERATED_PROVENANCE);
    check("the PREMIUM row keeps its tier", (await prov(premiumCase.id)) === PREMIUM_GENERATED_PROVENANCE);
  } finally {
    if (predictionIds.length) {
      await prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: predictionIds } } });
      await prisma.prediction.deleteMany({ where: { id: { in: predictionIds } } });
    }
    if (jobIds.length) await prisma.aIJob.deleteMany({ where: { id: { in: jobIds } } });
    if (matchKeys.length) await prisma.fixtureOddsCache.deleteMany({ where: { matchKey: { in: matchKeys } } });

    const strayRows = await prisma.prediction.count({ where: { homeTeamApiId: { lte: -66000, gte: -66099 } } });
    const strayOdds = await prisma.fixtureOddsCache.count({ where: { matchKey: { in: matchKeys } } });
    console.log(`\ncleanup: ${strayRows} stray prediction(s), ${strayOdds} stray odds row(s)`);
    if (strayRows !== 0 || strayOdds !== 0) {
      failures++;
      console.log("  FAIL  test data still present");
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
