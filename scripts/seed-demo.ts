// Throwaway demo data for visual review of the unlocked track-record/
// league/team layouts — NOT an admin feature, run manually via:
//   npx tsx scripts/seed-demo.ts
// Every row this script creates is linked to one fixed AIJob (id
// DEMO_AIJOB_ID) via aiJobId — that single foreign key is the entire
// removal marker. See scripts/unseed-demo.ts to remove everything again.
import { PrismaClient } from "@prisma/client";
import { DEMO_AIJOB_ID } from "./demo-seed-id";
import { PREDICTION_CATEGORIES, type PredictionCategory } from "../src/lib/enums";
import {
  MARKET_TYPES,
  MATCH_WINNER_VALUES,
  DOUBLE_CHANCE_VALUES,
  OU_DIRECTIONS,
  BTTS_VALUES,
  deriveMarketAndPick,
  deriveOverUnderText,
  resolveMarket,
  isValidSelection,
  type MarketType,
  type Selection,
  type MatchWinnerSelection,
  type DoubleChanceSelection,
  type OverUnderSelection,
  type BttsSelection,
  type CorrectScoreSelection,
} from "../src/lib/markets";

const prisma = new PrismaClient();

export { DEMO_AIJOB_ID };

// --- deterministic-ish randomness helpers -----------------------------
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function choice<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
function pickTwoDistinctTeams(teams: readonly string[]): [string, string] {
  const a = choice(teams);
  let b = choice(teams);
  while (b === a) b = choice(teams);
  return [a, b];
}

// --- leagues, including the deliberate name collision -----------------
// "Premier League" appears twice with different leagueApiIds (England 39,
// Kazakhstan 389) — same real-world collision documented in
// src/lib/leagues.ts, used here to sanity-check leagueSlug() disambiguation.
type LeagueDef = { apiId: number; name: string; teams: string[] };
const LEAGUES: LeagueDef[] = [
  {
    apiId: 39,
    name: "Premier League",
    teams: ["Arsenal", "Chelsea", "Liverpool", "Manchester United", "Manchester City", "Tottenham Hotspur", "Newcastle United", "Aston Villa"],
  },
  {
    apiId: 389,
    name: "Premier League",
    teams: ["Kairat Almaty", "FC Astana", "Tobol Kostanay", "Ordabasy", "Zhetysu", "Aktobe"],
  },
  {
    apiId: 140,
    name: "La Liga",
    teams: ["Real Madrid", "Barcelona", "Atletico Madrid", "Sevilla", "Real Sociedad", "Villarreal", "Real Betis", "Athletic Bilbao"],
  },
  {
    apiId: 135,
    name: "Serie A",
    teams: ["Inter Milan", "AC Milan", "Juventus", "Napoli", "AS Roma", "Lazio", "Atalanta", "Fiorentina"],
  },
];

// --- realistic-ish reasoning/preview text, templated not lorem-ipsum --
const openers = (h: string, a: string, l: string) => [
  `${h} head into this ${l} clash in fine form, winning ${randInt(3, 4)} of their last 5 matches.`,
  `${a} have been the more consistent side lately, picking up ${randInt(3, 4)} wins in their last 5 outings.`,
  `Both sides arrive at this ${l} fixture out of form, each winning just ${randInt(1, 2)} of their last 5.`,
  `${h} come into this on the back of a morale-boosting win over a top-half rival.`,
  `${a} have struggled on the road this season, losing ${randInt(2, 3)} of their last 5 away trips.`,
  `${h} and ${a} have split the last four meetings evenly, setting up a finely poised ${l} rematch.`,
];
const middles = (h: string, a: string) => [
  `${h}'s defence has been solid, keeping ${randInt(1, 3)} clean sheets in their last 5 games.`,
  `${a} have been leaky at the back, shipping goals in ${randInt(3, 4)} of their last 5.`,
  `Key injuries in ${a}'s midfield could open things up for ${h} to dominate possession.`,
  `${h} have the head-to-head edge, having won the last ${randInt(2, 3)} meetings between these two.`,
  `Expect a tightly contested midfield battle, with fine margins likely to decide this one.`,
  `${a}'s attack has clicked recently, scoring in ${randInt(4, 5)} of their last 5 outings.`,
];
const closers = (pick: string) => [
  `On balance, the value lies with ${pick}.`,
  `All told, ${pick} looks the shrewder call here.`,
  `Given the run of form on both sides, ${pick} is the pick for this one.`,
];
function buildReasoning(home: string, away: string, league: string, pick: string): string {
  return `${choice(openers(home, away, league))} ${choice(middles(home, away))} ${choice(closers(pick))}`;
}
function buildMatchPreview(home: string, away: string, league: string, kickoff: Date): string {
  const when = kickoff.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return `${home} vs ${away} — ${league} matchday clash, kicking off ${when}.`;
}

// --- market/selection/score generation ---------------------------------
// WIN_EITHER_HALF is excluded alongside OTHER. The demo seeder invents a
// full-time scoreline only, and that market settles from the HALVES — so a
// seeded row would either be unsettleable or have a scoreline that contradicts
// its own outcome. Seeding it would need the seeder to model half-time scores
// too, which is more machinery than a demo fixture set warrants.
const REAL_MARKET_TYPES = MARKET_TYPES.filter(
  (m) => m !== "OTHER" && m !== "WIN_EITHER_HALF" && m !== "SAME_GAME_DOUBLE" && m !== "HT_FT" && m !== "DRAW_NO_BET",
) as Exclude<
  MarketType,
  "OTHER" | "WIN_EITHER_HALF" | "SAME_GAME_DOUBLE" | "HT_FT" | "DRAW_NO_BET"
>[];

function randomSelection(marketType: MarketType): Selection {
  switch (marketType) {
    case "MATCH_WINNER":
      return { value: choice(MATCH_WINNER_VALUES) };
    case "DOUBLE_CHANCE":
      return { value: choice(DOUBLE_CHANCE_VALUES) };
    case "OVER_UNDER":
      return { line: choice([1.5, 2.5, 3.5]), direction: choice(OU_DIRECTIONS) };
    case "BTTS":
      return { value: choice(BTTS_VALUES) };
    case "CORRECT_SCORE":
      return { home: randInt(0, 3), away: randInt(0, 3) };
    case "OTHER":
    default:
      return null;
  }
}

/** Random-search a plausible scoreline that actually resolves to `outcome` for this market/selection, so settled demo rows don't contradict their own pick. Falls back to a constructed score if search doesn't converge (OVER_UNDER on a .5 line can never VOID, so VOID is never requested here). */
function scoreForOutcome(marketType: Exclude<MarketType, "OTHER" | "WIN_EITHER_HALF" | "SAME_GAME_DOUBLE" | "HT_FT" | "DRAW_NO_BET">, selection: Selection, outcome: "WON" | "LOST"): { hs: number; as: number } {
  for (let i = 0; i < 30; i++) {
    const hs = randInt(0, 4);
    const as = randInt(0, 4);
    if (resolveMarket(marketType, selection, hs, as) === outcome) return { hs, as };
  }
  switch (marketType) {
    case "MATCH_WINNER": {
      const v = (selection as MatchWinnerSelection).value;
      const actual = outcome === "WON" ? v : choice((["HOME", "DRAW", "AWAY"] as const).filter((x) => x !== v));
      if (actual === "HOME") return { hs: randInt(1, 3), as: 0 };
      if (actual === "AWAY") return { hs: 0, as: randInt(1, 3) };
      const n = randInt(0, 2);
      return { hs: n, as: n };
    }
    case "DOUBLE_CHANCE": {
      const v = (selection as DoubleChanceSelection).value;
      const covers: Record<string, Array<"HOME" | "DRAW" | "AWAY">> = {
        HOME_OR_DRAW: ["HOME", "DRAW"],
        AWAY_OR_DRAW: ["AWAY", "DRAW"],
        HOME_OR_AWAY: ["HOME", "AWAY"],
      };
      const all: Array<"HOME" | "DRAW" | "AWAY"> = ["HOME", "DRAW", "AWAY"];
      const pool = outcome === "WON" ? covers[v] : all.filter((x) => !covers[v].includes(x));
      const actual = choice(pool);
      if (actual === "HOME") return { hs: randInt(1, 3), as: 0 };
      if (actual === "AWAY") return { hs: 0, as: randInt(1, 3) };
      const n = randInt(0, 2);
      return { hs: n, as: n };
    }
    case "OVER_UNDER": {
      const s = selection as OverUnderSelection;
      const over = s.direction === "OVER" ? outcome === "WON" : outcome === "LOST";
      const total = over ? Math.ceil(s.line) + randInt(0, 2) : Math.max(0, Math.floor(s.line) - randInt(0, 1));
      const hs = randInt(0, total);
      return { hs, as: total - hs };
    }
    case "BTTS": {
      const v = (selection as BttsSelection).value;
      const both = outcome === "WON" ? v === "YES" : v === "NO";
      return both ? { hs: randInt(1, 3), as: randInt(1, 3) } : { hs: choice([0, randInt(1, 3)]), as: 0 };
    }
    case "CORRECT_SCORE": {
      const s = selection as CorrectScoreSelection;
      if (outcome === "WON") return { hs: s.home, as: s.away };
      let hs = randInt(0, 3);
      let as = randInt(0, 3);
      while (hs === s.home && as === s.away) as = (as + 1) % 4;
      return { hs, as };
    }
  }
}

const OTHER_MARKETS = (h: string, a: string) =>
  [
    { market: "Asian Handicap", pick: `${h} -1` },
    { market: "Asian Handicap", pick: `${a} +1` },
    { market: "First Half Result", pick: `${h}/Draw` },
    { market: "Half-Time/Full-Time", pick: `${h}/${h}` },
    { market: "Team Total Goals", pick: `${h} Over 1.5` },
  ] as const;

function randomOdds(marketType: MarketType): number {
  const band = marketType === "CORRECT_SCORE" ? [5, 9] : marketType === "MATCH_WINNER" || marketType === "OTHER" ? [1.4, 3.2] : [1.5, 2.6];
  return Math.round((band[0] + Math.random() * (band[1] - band[0])) * 100) / 100;
}

// --- row spec: one planned Prediction, before hitting the DB -----------
type RowSpec = {
  league: LeagueDef;
  category: PredictionCategory;
  extraCategory: PredictionCategory | null;
  marketType: MarketType;
  status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED";
  outcome: "PENDING" | "WON" | "LOST" | "VOID";
  settleMethod: "auto" | "manual" | null; // null when outcome is PENDING
  kickoffOffsetDays: number; // negative = past, positive = future
};

function buildRowSpecs(): RowSpec[] {
  const specs: RowSpec[] = [];
  let catCursor = 0;
  let leagueCursor = 0;
  const nextCategory = () => PREDICTION_CATEGORIES[catCursor++ % PREDICTION_CATEGORIES.length];
  const nextLeague = () => LEAGUES[leagueCursor++ % LEAGUES.length];

  // 150 settled WON/LOST across the 5 real market types (30 each) — the
  // volume that actually clears MIN_SETTLED_SAMPLE_SIZE (20) per category
  // AND per market-type bucket, inside the track-record page's default
  // 30-day window, not just the 90-day one.
  let rowIndex = 0;
  for (const marketType of REAL_MARKET_TYPES) {
    for (let i = 0; i < 30; i++) {
      const category = nextCategory();
      specs.push({
        league: nextLeague(),
        category,
        extraCategory: rowIndex % 10 === 0 ? PREDICTION_CATEGORIES[(catCursor + 2) % PREDICTION_CATEGORIES.length] : null,
        marketType,
        status: "PUBLISHED",
        outcome: Math.random() < 0.58 ? "WON" : "LOST", // realistic-ish win rate, not 100%
        settleMethod: Math.random() < 0.15 ? "manual" : "auto",
        kickoffOffsetDays: -randInt(0, 25),
      });
      rowIndex++;
    }
  }

  // 10 VOID, spread across the 5 real market types.
  for (let i = 0; i < 10; i++) {
    specs.push({
      league: nextLeague(),
      category: nextCategory(),
      extraCategory: null,
      marketType: REAL_MARKET_TYPES[i % REAL_MARKET_TYPES.length],
      status: "PUBLISHED",
      outcome: "VOID",
      settleMethod: Math.random() < 0.3 ? "manual" : "auto",
      kickoffOffsetDays: -randInt(0, 25),
    });
  }

  // 10 genuinely PENDING (future kickoff, never touched by settlement) —
  // exercises the admin quick-settle UI's "nothing to do yet" state.
  for (let i = 0; i < 10; i++) {
    specs.push({
      league: nextLeague(),
      category: nextCategory(),
      extraCategory: null,
      marketType: REAL_MARKET_TYPES[i % REAL_MARKET_TYPES.length],
      status: "PUBLISHED",
      outcome: "PENDING",
      settleMethod: null,
      kickoffOffsetDays: randInt(1, 5),
    });
  }

  // 10 OTHER-marketType rows: 6 settled (always manual — OTHER can never
  // auto-resolve), 2 VOID (manual), 2 PENDING with a *past* kickoff — the
  // literal "auto-settle-skipped tip" scenario A2's manual settlement UI
  // was built for.
  for (let i = 0; i < 6; i++) {
    specs.push({
      league: nextLeague(),
      category: nextCategory(),
      extraCategory: null,
      marketType: "OTHER",
      status: "PUBLISHED",
      outcome: Math.random() < 0.58 ? "WON" : "LOST",
      settleMethod: "manual",
      kickoffOffsetDays: -randInt(0, 25),
    });
  }
  for (let i = 0; i < 2; i++) {
    specs.push({
      league: nextLeague(),
      category: nextCategory(),
      extraCategory: null,
      marketType: "OTHER",
      status: "PUBLISHED",
      outcome: "VOID",
      settleMethod: "manual",
      kickoffOffsetDays: -randInt(0, 25),
    });
  }
  for (let i = 0; i < 2; i++) {
    specs.push({
      league: nextLeague(),
      category: nextCategory(),
      extraCategory: null,
      marketType: "OTHER",
      status: "PUBLISHED",
      outcome: "PENDING",
      settleMethod: null,
      kickoffOffsetDays: -randInt(1, 3),
    });
  }

  // 8 unpublished (4 DRAFT + 4 PENDING_REVIEW) so the admin approve/publish
  // views aren't empty either.
  for (let i = 0; i < 8; i++) {
    specs.push({
      league: nextLeague(),
      category: nextCategory(),
      extraCategory: null,
      marketType: i % 4 === 0 ? "OTHER" : REAL_MARKET_TYPES[i % REAL_MARKET_TYPES.length],
      status: i < 4 ? "DRAFT" : "PENDING_REVIEW",
      outcome: "PENDING",
      settleMethod: null,
      kickoffOffsetDays: randInt(2, 10),
    });
  }

  return specs;
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No ADMIN/SUPER_ADMIN user found — run `npm run db:seed` first to create one.");

  const existingJob = await prisma.aIJob.findUnique({ where: { id: DEMO_AIJOB_ID } });
  if (existingJob) {
    throw new Error(`Demo data already present (AIJob '${DEMO_AIJOB_ID}' exists). Run scripts/unseed-demo.ts first if you want to reseed.`);
  }

  const realPredictionCountBeforeSeed = await prisma.prediction.count();

  const job = await prisma.aIJob.create({
    data: {
      id: DEMO_AIJOB_ID,
      userId: admin.id,
      prompt: "scripts/seed-demo.ts — throwaway demo data for visual review",
      model: "demo-seed-script",
      rawOutput: JSON.stringify({ realPredictionCountBeforeSeed, seededAt: new Date().toISOString() }),
      status: "COMPLETED",
      contextComplete: true,
    },
  });

  const specs = buildRowSpecs();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const counts = { created: 0, byStatus: {} as Record<string, number>, byOutcome: {} as Record<string, number> };

  const CHUNK = 8;
  for (let start = 0; start < specs.length; start += CHUNK) {
    const chunk = specs.slice(start, start + CHUNK);
    await Promise.all(
      chunk.map(async (spec) => {
        const [home, away] = pickTwoDistinctTeams(spec.league.teams);
        const kickoff = new Date(now + spec.kickoffOffsetDays * DAY + randInt(-4, 4) * 60 * 60 * 1000);

        const selection = spec.marketType === "OTHER" ? null : randomSelection(spec.marketType);
        if (spec.marketType !== "OTHER" && !isValidSelection(spec.marketType, selection)) {
          throw new Error(`Generated invalid selection for ${spec.marketType}: ${JSON.stringify(selection)}`);
        }

        const otherPick = spec.marketType === "OTHER" ? choice(OTHER_MARKETS(home, away)) : null;
        const { market, pick } =
          spec.marketType === "OTHER"
            ? { market: otherPick!.market, pick: otherPick!.pick }
            : deriveMarketAndPick(spec.marketType, selection, home, away);

        // Secondary over/under pick — present on every prediction regardless
        // of primary marketType (see schema.prisma's comment on ouLine).
        const ouLine = choice([1.5, 2.5, 3.5]);
        const ouDirection = choice(OU_DIRECTIONS);

        let finalHomeScore: number | null = null;
        let finalAwayScore: number | null = null;
        if (spec.outcome === "WON" || spec.outcome === "LOST") {
          // These three get an arbitrary scoreline rather than a searched one:
          // OTHER is free text with nothing to resolve against, WIN_EITHER_HALF
          // settles from the halves this seeder does not model, and
          // SAME_GAME_DOUBLE settles from two other rows rather than from any
          // scoreline at all. None is produced by REAL_MARKET_TYPES, so this
          // branch is belt-and-braces against a future widening.
          const s =
            spec.marketType === "OTHER" ||
            spec.marketType === "WIN_EITHER_HALF" ||
            spec.marketType === "SAME_GAME_DOUBLE" ||
            spec.marketType === "HT_FT" ||
            spec.marketType === "DRAW_NO_BET"
              ? { hs: randInt(0, 3), as: randInt(0, 3) }
              : scoreForOutcome(spec.marketType, selection, spec.outcome);
          finalHomeScore = s.hs;
          finalAwayScore = s.as;
        } else if (spec.outcome === "VOID") {
          finalHomeScore = randInt(0, 3);
          finalAwayScore = randInt(0, 3);
        }

        const isSettled = spec.outcome !== "PENDING";
        const settledAt = isSettled
          ? new Date(kickoff.getTime() + (spec.settleMethod === "manual" ? randInt(2, 20) : randInt(1, 3)) * 60 * 60 * 1000)
          : null;
        const settledById = isSettled && spec.settleMethod === "manual" ? admin.id : null;

        const publishedAt = spec.status === "PUBLISHED" ? new Date(kickoff.getTime() - randInt(2, 20) * 60 * 60 * 1000) : null;
        const approvedAt = spec.status === "PUBLISHED" ? new Date((publishedAt as Date).getTime() - randInt(0, 4) * 60 * 60 * 1000) : null;

        const categories = [spec.category, ...(spec.extraCategory ? [spec.extraCategory] : [])];

        const created = await prisma.prediction.create({
          data: {
            category: spec.category,
            categories: { create: categories.map((c) => ({ category: c })) },
            leagueApiId: spec.league.apiId,
            leagueName: spec.league.name,
            homeTeam: home,
            awayTeam: away,
            kickoff,
            status: spec.status,
            marketType: spec.marketType,
            selection: selection ?? undefined,
            manualSettlementOnly: spec.marketType === "OTHER",
            market,
            pick,
            ouLine,
            ouDirection,
            overUnder: deriveOverUnderText(ouLine, ouDirection),
            odds: randomOdds(spec.marketType),
            confidence: randInt(55, 88),
            reasoning: buildReasoning(home, away, spec.league.name, pick),
            matchPreview: buildMatchPreview(home, away, spec.league.name, kickoff),
            contextComplete: true,
            outcome: spec.outcome,
            finalHomeScore,
            finalAwayScore,
            settledById,
            settledAt,
            settlementNote: null,
            authorId: admin.id,
            approvedById: spec.status === "PUBLISHED" ? admin.id : null,
            approvedAt,
            publishedAt,
            aiJobId: job.id,
          },
        });

        counts.created++;
        counts.byStatus[spec.status] = (counts.byStatus[spec.status] ?? 0) + 1;
        counts.byOutcome[spec.outcome] = (counts.byOutcome[spec.outcome] ?? 0) + 1;
      }),
    );
  }

  console.log(`Created ${counts.created} demo predictions under AIJob '${DEMO_AIJOB_ID}'.`);
  console.log("By status:", counts.byStatus);
  console.log("By outcome:", counts.byOutcome);

  // Sanity-check the two thresholds this whole exercise is about, so the
  // report doesn't have to guess whether the layout will actually unlock.
  const settledRows = await prisma.prediction.findMany({
    where: { aiJobId: job.id, status: "PUBLISHED", outcome: { not: "PENDING" } },
    select: { outcome: true, marketType: true, category: true, categories: { select: { category: true } } },
  });
  const decidedCountFor = (pred: (r: (typeof settledRows)[number]) => boolean) => {
    const rows = settledRows.filter(pred);
    return rows.filter((r) => r.outcome === "WON" || r.outcome === "LOST").length;
  };
  console.log("\nDecided (WON+LOST) count per category (join table, threshold 20):");
  for (const cat of PREDICTION_CATEGORIES) {
    console.log(`  ${cat}: ${decidedCountFor((r) => r.categories.some((c) => c.category === cat))}`);
  }
  console.log("Decided (WON+LOST) count per market type (threshold 20, OTHER excluded from track-record):");
  for (const mt of REAL_MARKET_TYPES) {
    console.log(`  ${mt}: ${decidedCountFor((r) => r.marketType === mt)}`);
  }

  const leagueSlugCheck = new Map<string, number>();
  const teamCheck = new Map<string, number>();
  const allRows = await prisma.prediction.findMany({ where: { aiJobId: job.id, status: "PUBLISHED" }, select: { leagueName: true, homeTeam: true, awayTeam: true } });
  for (const r of allRows) {
    if (r.leagueName) leagueSlugCheck.set(r.leagueName, (leagueSlugCheck.get(r.leagueName) ?? 0) + 1);
    for (const t of [r.homeTeam, r.awayTeam]) if (t) teamCheck.set(t, (teamCheck.get(t) ?? 0) + 1);
  }
  console.log("\nPublished rows per league name (collision case — same name, different leagueApiId):", Object.fromEntries(leagueSlugCheck));
  console.log(`Distinct teams touched: ${teamCheck.size}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
