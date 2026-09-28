/**
 * Synthetic sitemap datasets, shared by scripts/check-sitemap-scoping.tsx (run
 * over the in-memory Prisma stand-in) and scripts/compare-sitemap-output.ts
 * (seeded into a disposable local Postgres). Rows are plain objects in the
 * Prisma model's shape, slug keys derived exactly as src/lib/prisma.ts derives
 * them on write. Nothing here touches a database.
 */
import { derivePredictionSlugs, h2hPairKey } from "../../src/lib/slug";
import { buildAnalysis } from "../../src/lib/predictionAnalysis";
import { lagosDayBounds } from "../../src/lib/lagosDate";
import { CUP_CONFIGS } from "../../src/lib/cupConfig";

export type SitemapDataset = { prediction: any[]; teamEnrichmentCache: any[]; leagueEnrichmentCache: any[]; h2HCache: any[] };

export function createSitemapFixtures(now: number) {
  let seq = 0;
  const DAY = 24 * 60 * 60_000;
  function prediction(over: Record<string, any>) {
    const row: Record<string, any> = {
      id: `p${String(++seq).padStart(6, "0")}`,
      status: "PUBLISHED",
      category: "TODAY",
      categories: [{ category: "TODAY" }],
      leagueApiId: 39,
      leagueName: "Premier League",
      homeTeam: "Home",
      awayTeam: "Away",
      homeTeamApiId: null,
      awayTeamApiId: null,
      kickoff: new Date(now - 3 * DAY),
      marketType: "MATCH_WINNER",
      selection: null,
      market: "1X2",
      pick: "Home",
      overUnder: null,
      odds: 1.8,
      confidence: 70,
      reasoning: "reasoning",
      matchPreview: null,
      analysisJson: null,
      outcome: "PENDING",
      settledAt: null,
      publishedAt: new Date(now - 4 * DAY),
      ...over,
    };
    return { ...row, ...derivePredictionSlugs(row as any) };
  }

  function digest(over: Record<string, any> = {}) {
    return {
      name: "T", apiId: 1, rank: null, points: null,
      overall: null, home: null, away: null,
      goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null,
      form: null, streak: null, biggest: null, formations: [], cards: null, penalties: null,
      last5: [], availability: [], availabilityAsOf: null, keyPlayers: [],
      ...over,
    };
  }
  const warmDigest = digest({
    overall: { played: 17, win: 13, draw: 3, loss: 1, goalsFor: 47, goalsAgainst: 23 },
    home: { played: 8, win: 6, draw: 2, loss: 0, goalsFor: 23, goalsAgainst: 11 },
    goalsForAvg: { total: 2.8, home: 2.9, away: 2.7 },
    last5: [1, 2, 3, 4, 5].map((i) => ({ opponent: `O${i}`, venue: "home" as const, result: "W", goalsFor: 2, goalsAgainst: 0, date: `2026-08-0${i}` })),
  });
  const newsOnlyDigest = digest({ availabilityAsOf: "2026-08-17", availability: [] });
  const meetings = (n: number, a: number, b: number) =>
    Array.from({ length: n }, (_, i) => ({
      fixtureApiId: 900000 + i, date: `202${i % 6}-0${(i % 9) + 1}-01T00:00:00Z`, leagueName: "L", leagueApiId: 1,
      homeTeamApiId: a, homeTeam: "A", awayTeamApiId: b, awayTeam: "B", homeGoals: 1, awayGoals: 0,
    }));
  const standingRow = (teamId: number, played: number) => ({
    rank: 1, teamId, teamName: `T${teamId}`, teamLogo: null, points: 10, played, win: 3, draw: 1, loss: 1, goalsFor: 8, goalsAgainst: 4, form: null, zone: null,
  });
  const teamCache = (teamApiId: number, over: Record<string, any>) => ({
    id: `t${teamApiId}`, teamApiId, teamName: null, leagueApiId: null, season: null, crestUrl: null, venueName: null, venueCity: null,
    venueAddress: null, venueCapacity: null, form: null, statsJson: { big: "x".repeat(2000) }, lastFixtures: null, teamDigestJson: null,
    squadJson: [{ big: "x".repeat(4000) }], coachJson: { name: "C" }, squadFetchedAt: null, fetchedAt: new Date(now - DAY),
    lastAttemptAt: null, lastError: null, updatedAt: new Date(now), ...over,
  });
  const leagueCache = (leagueApiId: number, over: Record<string, any>) => ({
    id: `l${leagueApiId}`, leagueApiId, season: 2026, standingsJson: null, upcomingJson: null, topScorersJson: null, topAssistsJson: null,
    topCardsJson: null, fetchedAt: new Date(now - DAY), playersFetchedAt: null, lastAttemptAt: null, lastError: null, updatedAt: new Date(now), ...over,
  });
  const h2hCache = (a: number, b: number, over: Record<string, any>) => ({
    id: `h${a}-${b}`, pairKey: h2hPairKey(a, b)!, teamAApiId: Math.min(a, b), teamBApiId: Math.max(a, b), meetingsJson: null,
    fetchedAt: new Date(now - DAY), lastAttemptAt: null, lastError: null, updatedAt: new Date(now), ...over,
  });

  // --- dataset 1: exhaustive evidence grid ----------------------------------
  // Every combination of the signals that feed assessMatchEvidence, around
  // every threshold, with null/malformed JSON and fetchedAt-null caches — plus
  // extra rows that make display ORDER decide which preview is scored.
  function evidenceGrid(): SitemapDataset {
    const predictions: any[] = [];
    const teams: any[] = [];
    const leagues: any[] = [];
    const pairs: any[] = [];
    const digestVariants = ["none", "warm", "newsOnly", "warmUnfetched", "nullDigest", "emptyObject"] as const;
    const standingsVariants = ["none", "played", "unplayed", "unfetched", "nullJson"] as const;
    const h2hVariants = ["none", "two", "three", "six", "objectJson", "nullJson", "unfetchedFive"] as const;
    const previewVariants = [null, "", "x".repeat(199), "x".repeat(200), `   ${"x".repeat(199)}   `] as const;
    const analysisVariants = ["none", "valid", "invalid", "falseJson"] as const;
    let i = 0;
    for (const dv of digestVariants)
      for (const sv of standingsVariants)
        for (const hv of h2hVariants)
          for (const pv of previewVariants)
            for (const av of analysisVariants) {
              i++;
              const home = 100000 + i * 2;
              const away = home + 1;
              const leagueApiId = 700000 + i;
              const kickoff = new Date(now - (10 + (i % 300)) * DAY - (i % 7) * 60_000);
              const homeTeam = `Grid Home ${i}`;
              const awayTeam = `Grid Away ${i}`;
              const fixture = { homeTeam, awayTeam, homeTeamApiId: home, awayTeamApiId: away, leagueApiId, leagueName: `Grid League ${i}`, kickoff };
              const analysisJson =
                av === "valid" ? buildAnalysis({ keyFactors: ["a", "b"] }) : av === "invalid" ? { nonsense: true } : av === "falseJson" ? false : null;
              predictions.push(prediction({ ...fixture, confidence: 60, matchPreview: pv, analysisJson, publishedAt: new Date(kickoff.getTime() - DAY) }));
              // Ordering cases: a higher-ranked row whose short preview must
              // shadow the variant, and a settled row (ranked after pending)
              // whose long preview must NOT shadow a pending one.
              if (i % 3 === 0) predictions.push(prediction({ ...fixture, confidence: 90, matchPreview: "s".repeat(150), publishedAt: new Date(kickoff.getTime() - 2 * DAY) }));
              if (i % 3 === 1) predictions.push(prediction({ ...fixture, confidence: 99, outcome: "WON", settledAt: kickoff, matchPreview: "l".repeat(400), publishedAt: null }));
              if (i % 11 === 0) predictions.push(prediction({ ...fixture, status: "DRAFT", matchPreview: "d".repeat(400), analysisJson: buildAnalysis({ keyFactors: ["x"] }) }));

              if (dv !== "none") {
                const teamDigestJson = dv === "warm" || dv === "warmUnfetched" ? warmDigest : dv === "newsOnly" ? newsOnlyDigest : dv === "emptyObject" ? {} : null;
                teams.push(teamCache(home, { teamDigestJson, lastFixtures: [], fetchedAt: dv === "warmUnfetched" ? null : new Date(now - DAY) }));
              }
              if (i % 4 === 0) teams.push(teamCache(away, { teamDigestJson: newsOnlyDigest }));
              if (sv !== "none") {
                leagues.push(
                  leagueCache(leagueApiId, {
                    standingsJson: sv === "nullJson" ? null : [standingRow(home, sv === "unplayed" ? 0 : 5), standingRow(999, 5)],
                    fetchedAt: sv === "unfetched" ? null : new Date(now - DAY),
                  }),
                );
              }
              if (hv !== "none") {
                const meetingsJson =
                  hv === "two" ? meetings(2, home, away) : hv === "three" ? meetings(3, home, away) : hv === "six" ? meetings(6, home, away)
                  : hv === "objectJson" ? { length: 5 } as any : hv === "unfetchedFive" ? meetings(5, home, away) : null;
                pairs.push(h2hCache(home, away, { meetingsJson, fetchedAt: hv === "unfetchedFive" ? null : new Date(now - DAY) }));
              }
            }
    return { prediction: predictions, teamEnrichmentCache: teams, leagueEnrichmentCache: leagues, h2HCache: pairs };
  }

  // --- dataset 2: seeded general corpus ------------------------------------
  function generalCorpus(seed: number, settledCount: number): SitemapDataset {
    let s = seed >>> 0;
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)];
    // Spelling variants that slug alike, a name that slugs to "", and ids that
    // sometimes go missing — the cases the old per-row slugging handled.
    const teamNames = [
      ["São Paulo", 1], ["Sao Paulo", 1], ["Arsenal", 2], ["Chelsea", 3], ["Man Utd", 4], ["Manchester United", 4],
      ["Inter", 5], ["Inter Milan", 5], ["Porto", 6], ["Benfica", 7], ["???", 8], ["Ajax", 9], ["PSV", 10], ["Celtic", 11],
      ["Rangers", 12], ["Real Madrid", 13], ["Barcelona", 14], ["Casa Pia", 15], ["Enyimba", 16], ["Rivers United", 17],
    ] as const;
    const leagues = [
      ["Premier League", 39], ["Premier League", 332], ["La Liga", 140], ["NPFL", 399], ["Serie A", 135], [null, null], ["", 61],
      ...CUP_CONFIGS.slice(0, 4).map((cup) => [cup.slug, cup.id] as const),
    ] as const;
    const { start, end } = lagosDayBounds(0, new Date(now));
    const kickoffs = [
      null, new Date(start.getTime() - 1), start, new Date(start.getTime() + 12 * 3600_000), new Date(end.getTime() - 1), end,
      new Date(now - 2 * DAY), new Date(now - 40 * DAY), new Date(now + 2 * DAY),
    ];
    const selections = [{ line: 2.5, direction: "OVER" }, { line: 2.5, direction: "UNDER" }, { line: 1.5, direction: "OVER" }, [], null, "x"];
    const categories = ["TODAY", "FEATURED", "GENIUS", "BANKER", "VIP", "PREMIUM", "BET_OF_THE_DAY", "GOALS", "SAME_GAME_DOUBLE"];
    const predictions: any[] = [];
    const fixtures: any[] = [];
    for (let f = 0; f < 140; f++) {
      const [homeTeam, homeId] = pick(teamNames);
      let [awayTeam, awayId] = pick(teamNames);
      if (awayTeam === homeTeam) [awayTeam, awayId] = teamNames[(teamNames.findIndex((t) => t[0] === homeTeam) + 3) % teamNames.length];
      const [leagueName, leagueApiId] = pick(leagues);
      fixtures.push({ homeTeam, awayTeam, homeTeamApiId: rnd() < 0.85 ? homeId : null, awayTeamApiId: rnd() < 0.85 ? awayId : null, leagueName, leagueApiId, kickoff: pick(kickoffs) });
    }
    let settled = 0;
    for (let n = 0; n < 520; n++) {
      const fixture = pick(fixtures);
      const marketType = pick(["OVER_UNDER", "BTTS", "DOUBLE_CHANCE", "MATCH_WINNER", "OTHER"] as const);
      const cats = [...new Set([pick(categories), ...(rnd() < 0.3 ? [pick(categories)] : [])])];
      const settle = settled < settledCount && rnd() < 0.5;
      if (settle) settled++;
      predictions.push(
        prediction({
          ...fixture,
          status: rnd() < 0.85 ? "PUBLISHED" : pick(["DRAFT", "PENDING_REVIEW", "REJECTED"]),
          category: cats[0],
          categories: cats.map((category) => ({ category })),
          marketType,
          selection: marketType === "OVER_UNDER" ? pick(selections) : null,
          confidence: Math.floor(rnd() * 60) + 40,
          outcome: settle ? pick(["WON", "LOST", "VOID"]) : "PENDING",
          settledAt: settle ? new Date(now - Math.floor(rnd() * 90) * DAY) : null,
          publishedAt: rnd() < 0.07 ? null : new Date(now - Math.floor(rnd() * 200) * DAY - Math.floor(rnd() * DAY)),
          matchPreview: rnd() < 0.5 ? "p".repeat(Math.floor(rnd() * 400)) : null,
          analysisJson: rnd() < 0.3 ? buildAnalysis({ keyFactors: ["k"] }) : null,
        }),
      );
    }
    const ids = [...new Set(teamNames.map((t) => t[1]))];
    const teams = ids.filter(() => rnd() < 0.6).map((id) => teamCache(id, { teamDigestJson: pick([warmDigest, newsOnlyDigest, null]), lastFixtures: [] }));
    const leagueCaches = [39, 140, 399].map((id) => leagueCache(id, { standingsJson: ids.map((t) => standingRow(t, Math.floor(rnd() * 3))) }));
    const pairCaches: any[] = [];
    for (const a of ids) for (const b of ids) if (a < b && rnd() < 0.3) pairCaches.push(h2hCache(a, b, { meetingsJson: meetings(Math.floor(rnd() * 6), a, b) }));
    return { prediction: predictions, teamEnrichmentCache: teams, leagueEnrichmentCache: leagueCaches, h2HCache: pairCaches };
  }

  return { DAY, prediction, digest, warmDigest, newsOnlyDigest, meetings, standingRow, teamCache, leagueCache, h2hCache, evidenceGrid, generalCorpus };
}
