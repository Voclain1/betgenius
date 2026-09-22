/**
 * Senior women's competitions: the name gate, adaptive tiering, and
 * notification eligibility. Deterministic; no database, no provider.
 *
 * Run: npx tsx scripts/check-senior-womens.ts
 */
export {};

import { readFileSync } from "node:fs";
import {
  GENERATION_TIERS,
  LEAGUE_CATALOGUE,
  SENIOR_WOMENS_COMPETITION_IDS,
  generationTierOf,
  isSeniorWomensCompetition,
  leaguePriorityRank,
  leaguesInTiers,
} from "../src/lib/leagues";
import {
  decideCoverage,
  emptyTierCounts,
  excludedLeagueIds,
  fallbackQualityGate,
  isNonSeniorSide,
  planFallback,
  tallySlate,
} from "../src/lib/generation/coverage";
import {
  HIGHLIGHT_TIERS,
  selectTopMatches,
  TOP_PREDICTION_PUSH_MARKET_CONFIRMED_ONLY,
  dailyCapClass,
  shouldPush,
  topPredictionDelivery,
  topPredictionEvidence,
  topPredictionPushEligible,
  type DigestPick,
} from "../src/lib/notificationDigest";
import { MIN_BOOKMAKERS, MIN_ODDS, MAX_ODDS } from "../src/lib/odds";
import { MC_MIN_MODEL_CONFIDENCE } from "../src/lib/marketConfirmed";
import { TREND_MIN_CONFIDENCE, qualifiesAsTopPrediction } from "../src/lib/topPredictions";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

// Provider ids (2026-09-22 audit).
const WSL = 44, FRAUEN_BL = 82, LIGA_F = 142, NWSL = 254; // SECONDARY
const UWCL = 525; // FALLBACK, for data quality: the provider does not price it yet
const PREMIERE_LIGUE = 64, DAMALLSVENSKAN = 549; // FALLBACK
const BELGIUM_W = 146, BRASILEIRO_W = 74; // DEEP_FALLBACK
const SERIE_A_W = 139; // audited, deliberately not added
// Men's references.
const EPL = 39, EREDIVISIE = 88, FRIENDLIES = 10, ENG_NATIONAL_LEAGUE = 43, SUPERETTAN = 114;

const NOW = new Date("2026-09-22T09:00:00Z");
let nextId = 1;
function fixture(league: number, home: string, away: string, hoursOut = 24) {
  const id = nextId++;
  return {
    fixture: { id, date: new Date(NOW.getTime() + hoursOut * 3_600_000).toISOString(), status: { short: "NS" } },
    league: { id: league, name: `League ${league}`, round: "Regular Season - 3" },
    teams: { home: { id: id * 10 + 1, name: home }, away: { id: id * 10 + 2, name: away } },
  } as any;
}

(async () => {
  console.log("\nexplicit senior women's competitions:");
  check("the list is exactly the nine audited competitions", JSON.stringify([...SENIOR_WOMENS_COMPETITION_IDS].sort((a, b) => a - b)) === JSON.stringify([44, 64, 74, 82, 142, 146, 254, 525, 549]));
  check("each is catalogued", SENIOR_WOMENS_COMPETITION_IDS.every((id) => LEAGUE_CATALOGUE.some((l) => l.id === id)));
  check("each sits in exactly one generation tier", SENIOR_WOMENS_COMPETITION_IDS.every((id) => generationTierOf(id) !== null));
  check("recognition is by competition id, not by name", isSeniorWomensCompetition(WSL) && !isSeniorWomensCompetition(EPL) && !isSeniorWomensCompetition(null));
  check("Serie A Women is not supported (provider has no events, statistics or odds)", !isSeniorWomensCompetition(SERIE_A_W) && generationTierOf(SERIE_A_W) === null);

  console.log("\nassigned tiers:");
  for (const id of [WSL, FRAUEN_BL, LIGA_F, NWSL]) check(`${id} is SECONDARY`, generationTierOf(id) === "SECONDARY");
  for (const id of [UWCL, PREMIERE_LIGUE, DAMALLSVENSKAN]) check(`${id} is FALLBACK`, generationTierOf(id) === "FALLBACK");
  check("UWCL is not SECONDARY (unpriced, a data-quality tier)", generationTierOf(UWCL) !== "SECONDARY");
  for (const id of [BELGIUM_W, BRASILEIRO_W]) check(`${id} is DEEP_FALLBACK`, generationTierOf(id) === "DEEP_FALLBACK");
  check("no women's competition is CORE", !SENIOR_WOMENS_COMPETITION_IDS.some((id) => (GENERATION_TIERS.CORE as readonly number[]).includes(id)));
  const menSecondary = (GENERATION_TIERS.SECONDARY as readonly number[]).filter((id) => !isSeniorWomensCompetition(id));
  check(
    "women's SECONDARY leagues rank after every men's SECONDARY league",
    [WSL, FRAUEN_BL, LIGA_F, NWSL].every((w) => menSecondary.every((m) => leaguePriorityRank(m) < leaguePriorityRank(w))),
  );
  check("...and after every CORE league", [UWCL, WSL].every((w) => leaguesInTiers(["CORE"]).every((c) => leaguePriorityRank(c) < leaguePriorityRank(w))));
  check("the paid-tier VIP proxy set (first 12 CORE) is untouched", !(GENERATION_TIERS.CORE as readonly number[]).slice(0, 12).some(isSeniorWomensCompetition));

  console.log("\nthe women's-name gate:");
  const pass = (row: any) => fallbackQualityGate(row).ok;
  const reason = (row: any) => { const v = fallbackQualityGate(row); return v.ok ? "ok" : v.reason; };
  check("isNonSeniorSide: 'Arsenal W' in the WSL is senior", !isNonSeniorSide("Arsenal W", WSL));
  check("isNonSeniorSide: 'Barcelona W' in the UWCL is senior", !isNonSeniorSide("Barcelona W", UWCL));
  check("isNonSeniorSide: 'Lyon Women' / 'Wolfsburg Ladies' / 'Pachuca Femenil' in a supported competition", !isNonSeniorSide("Lyon Women", UWCL) && !isNonSeniorSide("Wolfsburg Ladies", FRAUEN_BL) && !isNonSeniorSide("Pachuca Femenil", NWSL));
  check("default (no league) is the unchanged full rule: 'Arsenal W' fails", isNonSeniorSide("Arsenal W"));
  check("a supported WSL-style FALLBACK fixture passes the gate", pass(fixture(PREMIERE_LIGUE, "Lyon W", "Paris FC W")));
  check("a supported DEEP_FALLBACK fixture passes the gate", pass(fixture(BELGIUM_W, "Anderlecht W", "Club Brugge W")));
  check("an unsupported women's fixture in an unrelated FALLBACK competition still fails", reason(fixture(FRIENDLIES, "England W", "Spain W")) === "non_senior_side");
  check("...and in an unrelated lower division", reason(fixture(SUPERETTAN, "Hammarby W", "AIK W")) === "non_senior_side");
  check("...and in DEEP_FALLBACK", reason(fixture(ENG_NATIONAL_LEAGUE, "Wrexham Ladies", "York Women")) === "non_senior_side");
  for (const name of ["Lyon W U21", "Lyon W U-19", "Barcelona B W", "Barcelona W B", "Arsenal W Reserves", "Chelsea W II", "Bayern W Youth", "Man City W Academy", "Jong Ajax W"]) {
    check(`'${name}' still fails in a supported competition`, isNonSeniorSide(name, PREMIERE_LIGUE) && reason(fixture(PREMIERE_LIGUE, name, "Paris FC W")) === "non_senior_side");
  }
  check("men's rule unchanged: 'Luton Town U21' fails in the EFL Trophy-style case", reason(fixture(FRIENDLIES, "Luton Town U21", "Stevenage")) === "non_senior_side");
  const coverage = readFileSync("src/lib/generation/coverage.ts", "utf8");
  check(
    "the full safety regex is still present and still the default",
    coverage.includes("Women|Ladies|W|Fem\\.?|Femenil|Feminino|Femenino") && /isSeniorWomensCompetition\(leagueApiId\) \? NON_SENIOR_WOMENS_SIDE : NON_SENIOR_SIDE/.test(coverage),
  );

  console.log("\nCORE/SECONDARY discovery applies the same rule (real candidatesFromFixtures):");
  const { prisma } = await import("../src/lib/prisma");
  const db = prisma as unknown as Record<string, Record<string, unknown>>;
  db.prediction.findMany = async () => [];
  db.generationAttempt.findMany = async () => [];
  db.generationAttempt.createMany = async () => ({ count: 0 });
  db.aIJob.findMany = async () => [];
  const { candidatesFromFixtures } = await import("../src/lib/generation/selector");
  const discovered = await candidatesFromFixtures(
    [
      fixture(WSL, "Arsenal W", "Chelsea W", 30),
      fixture(WSL, "Arsenal W U21", "Chelsea W U21", 30),
      fixture(UWCL, "Barcelona W", "Lyon W", 30),
      fixture(LIGA_F, "Barcelona B W", "Real Madrid W", 30),
      fixture(EPL, "Arsenal", "Chelsea", 30),
    ],
    { now: NOW, limit: 50 },
  );
  const names = discovered.candidates.map((c) => `${c.homeTeam} v ${c.awayTeam}`);
  check("senior WSL fixture is a candidate", names.includes("Arsenal W v Chelsea W"), names);
  check("senior UWCL fixture is a candidate", names.includes("Barcelona W v Lyon W"), names);
  check("WSL U21 sides are refused", !names.some((n) => n.includes("U21")), names);
  check("a Liga F B team is refused", !names.some((n) => n.includes("Barcelona B W")), names);
  // A CORE top-12 fixture this far out is held for the paid-tier pass (existing
  // paid-tier grace), so it is reserved rather than dropped: 5 in, 2 refused, 3 accounted for.
  check(
    "men's CORE is unaffected (a candidate, or held for the paid-tier pass)",
    names.includes("Arsenal v Chelsea") || discovered.reservedForPaidTier === 1,
    { names, reserved: discovered.reservedForPaidTier },
  );

  console.log("\nadaptive coverage by tier:");
  const slate = (league: number, n: number) => Array.from({ length: n }, (_, i) => ({ fixtureApiId: league * 1000 + i, matchKey: null, leagueApiId: league }));
  const counts = tallySlate([...slate(WSL, 4), ...slate(UWCL, 2), ...slate(PREMIERE_LIGUE, 3), ...slate(BELGIUM_W, 2)]);
  check("women's fixtures are counted in their own tiers (UWCL as FALLBACK)", counts.SECONDARY === 4 && counts.FALLBACK === 5 && counts.DEEP_FALLBACK === 2, counts);

  const menCore = slate(EPL, 10);
  const withUwcl = tallySlate([...menCore, ...slate(UWCL, 20)]);
  const withUwclDecision = decideCoverage(withUwcl);
  check(
    "UWCL does not count toward the healthy CORE+SECONDARY total",
    withUwcl.CORE + withUwcl.SECONDARY === 10 && withUwclDecision.higherTierCount === 10,
    withUwcl,
  );
  check("...so 20 unpriced UWCL fixtures cannot make a thin day look healthy", withUwclDecision.widened, withUwclDecision.reason);
  const withSecondaryWomen = tallySlate([...menCore, ...slate(WSL, 4), ...slate(FRAUEN_BL, 4), ...slate(LIGA_F, 4), ...slate(NWSL, 3)]);
  check("WSL, Frauen-Bundesliga, Liga F and NWSL do count toward it", withSecondaryWomen.SECONDARY === 15 && decideCoverage(withSecondaryWomen).higherTierCount === 25);
  check("...and with them the same day is healthy", !decideCoverage(withSecondaryWomen).widened);

  const busy = decideCoverage({ ...emptyTierCounts(), CORE: 30, SECONDARY: 10 });
  check("a busy men's slate is healthy and not widened", !busy.widened && busy.need === 0);
  const excluded = excludedLeagueIds(busy);
  check(
    "...women's FALLBACK and DEEP_FALLBACK leagues (UWCL included) are excluded from generation",
    [UWCL, PREMIERE_LIGUE, DAMALLSVENSKAN, BELGIUM_W, BRASILEIRO_W].every((id) => excluded.includes(id)),
  );
  check("...women's SECONDARY leagues stay in scope", [WSL, FRAUEN_BL, LIGA_F, NWSL].every((id) => !excluded.includes(id)));
  const sweepRows = [
    fixture(UWCL, "Barcelona W", "Wolfsburg W"),
    fixture(PREMIERE_LIGUE, "Lyon W", "PSG W"),
    fixture(DAMALLSVENSKAN, "Hammarby W", "Häcken W"),
    fixture(BELGIUM_W, "Anderlecht W", "Gent W"),
  ];
  const busyPlan = planFallback(sweepRows, busy);
  check("...a sweep on a busy day selects no women's fallback fixture", busyPlan.eligible.FALLBACK.length === 0 && busyPlan.eligible.DEEP_FALLBACK.length === 0);

  const thin = decideCoverage({ ...emptyTierCounts(), CORE: 10, SECONDARY: 6 });
  const thinPlan = planFallback(sweepRows, thin);
  check("a thin slate (FALLBACK mode) admits the women's FALLBACK leagues", thinPlan.eligible.FALLBACK.length === 3, thinPlan.eligible);
  check("...UWCL included", thinPlan.eligible.FALLBACK.some((r) => r.league.id === UWCL));
  check("...but not DEEP_FALLBACK", thinPlan.eligible.DEEP_FALLBACK.length === 0);
  check(
    "an unpriced UWCL fixture the bookmakers declined is refused like any other",
    (() => {
      const v = fallbackQualityGate(fixture(UWCL, "Barcelona W", "Lyon W"), { odds: { bookmakerCount: 0, fetchedAt: NOW } });
      return !v.ok && v.reason === "no_bookmakers";
    })(),
  );
  const veryThin = decideCoverage({ ...emptyTierCounts(), CORE: 4, SECONDARY: 2 });
  const deepPlan = planFallback(sweepRows, veryThin);
  check("a very thin slate admits DEEP_FALLBACK women's leagues too", deepPlan.eligible.FALLBACK.length === 3 && deepPlan.eligible.DEEP_FALLBACK.length === 1);
  const mixed = planFallback([fixture(PREMIERE_LIGUE, "Lyon W", "PSG W"), fixture(FRIENDLIES, "Brazil", "Chile")], thin);
  check(
    "within FALLBACK, league priority still decides (men's friendlies before Première Ligue)",
    mixed.eligible.FALLBACK[0]?.league.id === FRIENDLIES && mixed.eligible.FALLBACK[1]?.league.id === PREMIERE_LIGUE,
  );

  console.log("\nthresholds are the men's thresholds (nothing women-specific):");
  check("MIN_BOOKMAKERS is 5", MIN_BOOKMAKERS === 5);
  check("Bet of the Day price band is 2.20-4.50", MIN_ODDS === 2.2 && MAX_ODDS === 4.5);
  check("market-confirmed model floor is 75", MC_MIN_MODEL_CONFIDENCE === 75);
  check("trend top-prediction floor is unchanged at 80", TREND_MIN_CONFIDENCE === 80);
  const thresholdFiles = ["src/lib/odds.ts", "src/lib/marketConfirmed.ts", "src/lib/betOfTheDay.ts", "src/lib/topPredictions.ts"];
  check("no threshold module mentions women's competitions", thresholdFiles.every((f) => !/women|SENIOR_WOMENS|isSeniorWomensCompetition|UWCL|\b525\b/i.test(readFileSync(f, "utf8"))));

  console.log("\ndigest highlights:");
  let seq = 0;
  const pick = (leagueApiId: number, confidence = 70, odds: number | null = 2.0): DigestPick => {
    seq++;
    return {
      id: `w${String(seq).padStart(2, "0")}`, homeTeam: `H${seq}`, awayTeam: `A${seq}`, leagueApiId, market: "1X2", pick: "Home",
      odds, confidence, kickoff: new Date(NOW.getTime() + (6 + seq) * 3_600_000), outcome: "PENDING", category: "FEATURED", categories: [], link: `/predictions/match/w${seq}`,
    };
  };
  check("SECONDARY is a highlight tier", HIGHLIGHT_TIERS.includes("SECONDARY"));
  const womenOnly = selectTopMatches([pick(WSL), pick(FRAUEN_BL), pick(LIGA_F)]);
  check("top SECONDARY women's competitions can be highlighted", womenOnly.length === 3);
  const withMen = selectTopMatches([pick(WSL, 90), pick(EPL, 60), pick(EREDIVISIE, 60)]);
  check("...ranked after men's CORE, as SECONDARY", withMen[0].leagueApiId === EPL, withMen.map((p) => p.leagueApiId));
  check("women's FALLBACK/DEEP_FALLBACK leagues are never highlighted", selectTopMatches([pick(PREMIERE_LIGUE, 95), pick(DAMALLSVENSKAN, 95), pick(BELGIUM_W, 95)]).length === 0);
  check("an unpriced UWCL pick is not highlighted", selectTopMatches([pick(UWCL, 95, null)]).length === 0);
  check("...nor is a priced one while UWCL is FALLBACK: being UWCL is not enough", selectTopMatches([pick(UWCL, 95, 2.1)]).length === 0);

  console.log("\nimmediate TOP_PREDICTION pushes:");
  const on = { pushEnabled: true, inQuietHours: false };
  // What broadcastTopPrediction stores on the event (src/lib/topPredictions.ts).
  const eventData = (p: { provenance: string; odds: number | null; confidence: number }) => ({ source: "ADMIN_PINNED", categories: [], confidence: p.confidence, odds: p.odds, provenance: p.provenance });
  const confirmedUwcl = { status: "PUBLISHED", outcome: "PENDING", confidence: 82, odds: 2.1, provenance: "MARKET_CONFIRMED" };
  const unconfirmedUwcl = { ...confirmedUwcl, provenance: "STANDARD_CURATED" };
  const unpricedUwcl = { ...confirmedUwcl, odds: null };

  check("UWCL is in the explicit market-confirmed-only push list", TOP_PREDICTION_PUSH_MARKET_CONFIRMED_ONLY.includes(UWCL));
  check("an unpriced UWCL top prediction cannot push", !shouldPush("TOP_PREDICTION", { ...on, leagueApiId: UWCL, data: eventData(unpricedUwcl) }));
  check("...nor an unconfirmed (standard) one", !shouldPush("TOP_PREDICTION", { ...on, leagueApiId: UWCL, data: eventData(unconfirmedUwcl) }));
  check("...nor one with no evidence on the event at all (fails closed)", !shouldPush("TOP_PREDICTION", { ...on, leagueApiId: UWCL }) && !topPredictionPushEligible(UWCL));
  check("...each still reaches the inbox", topPredictionDelivery(UWCL, 0, 3, topPredictionEvidence(eventData(unconfirmedUwcl))) === "inbox-only");
  check(
    "a published, market-confirmed UWCL top prediction qualifies for the existing policy",
    qualifiesAsTopPrediction(confirmedUwcl, "ADMIN_PINNED") && shouldPush("TOP_PREDICTION", { ...on, leagueApiId: UWCL, data: eventData(confirmedUwcl) }),
  );
  check("...via the trend path too, with the unchanged 80% trend floor", qualifiesAsTopPrediction(confirmedUwcl, "TREND_SELECTED") && !qualifiesAsTopPrediction({ ...confirmedUwcl, confidence: 79 }, "TREND_SELECTED"));
  check("...but not once it is settled or unpublished", !qualifiesAsTopPrediction({ ...confirmedUwcl, outcome: "WON" }, "ADMIN_PINNED") && !qualifiesAsTopPrediction({ ...confirmedUwcl, status: "PENDING_REVIEW" }, "ADMIN_PINNED"));
  check("...and still subject to quiet hours and push being enabled", !shouldPush("TOP_PREDICTION", { ...on, inQuietHours: true, leagueApiId: UWCL, data: eventData(confirmedUwcl) }) && !shouldPush("TOP_PREDICTION", { ...on, pushEnabled: false, leagueApiId: UWCL, data: eventData(confirmedUwcl) }));
  const topSource = readFileSync("src/lib/topPredictions.ts", "utf8");
  check("the broadcast records the prediction's provenance on the event", /provenance: prediction\.provenance/.test(topSource));
  const dispatchSource = readFileSync("src/lib/notificationDispatch.ts", "utf8");
  check("dispatch passes the event's data to the push decision and the cap", dispatchSource.includes("data: row.event.data") && dispatchSource.includes("topPredictionEvidence(row.event.data)"));
  check("UWCL top predictions draw on the push allowance of the daily cap (conservative)", dailyCapClass({ type: "TOP_PREDICTION", leagueApiId: UWCL }) === "push" && dailyCapClass({ type: "TOP_PREDICTION", leagueApiId: PREMIERE_LIGUE }) === "inbox");

  check("WSL is push-eligible on tier", topPredictionPushEligible(WSL) && shouldPush("TOP_PREDICTION", { ...on, leagueApiId: WSL }));
  for (const id of [FRAUEN_BL, LIGA_F, NWSL]) check(`${id} (SECONDARY, not strongest) is inbox-only`, !topPredictionPushEligible(id) && topPredictionDelivery(id, 0, 3) === "inbox-only");
  for (const id of [PREMIERE_LIGUE, DAMALLSVENSKAN, BELGIUM_W, BRASILEIRO_W]) {
    const mc = topPredictionEvidence(eventData(confirmedUwcl));
    check(`${id} (fallback) cannot push even when market-confirmed, still reaches the inbox`, !shouldPush("TOP_PREDICTION", { ...on, leagueApiId: id, data: eventData(confirmedUwcl) }) && topPredictionDelivery(id, 0, 3, mc) === "inbox-only");
  }
  let pushed = 0;
  const mcEvidence = topPredictionEvidence(eventData(confirmedUwcl));
  for (const id of [UWCL, WSL, UWCL, WSL, UWCL]) if (topPredictionDelivery(id, pushed, 3, mcEvidence) === "push") pushed++;
  check("five eligible women's top predictions still push at most 3", pushed === 3);
  check("no automatic push per women's match: publication stays inbox-only", !shouldPush("NEW_PREDICTION", { ...on, leagueApiId: WSL }));

  console.log("\ndocumentation is accurate about cost:");
  const doc = readFileSync("docs/ADAPTIVE_COMPETITION_COVERAGE.md", "utf8");
  check("no blanket 'no extra provider cost' claim", !/no extra provider cost/i.test(doc));
  check("says SECONDARY additions lengthen the per-league discovery rotation", /rotation/i.test(doc) && /SECONDARY/.test(doc));
  check("says fallback tiers are found through the by-date sweep when widening", /by-date sweep/i.test(doc));
  check("says no new cron job or provider endpoint", /no new cron job/i.test(doc) && /no new provider endpoint/i.test(doc));

  if (failures) {
    console.error(`\n${failures} senior women's check(s) failed`);
    process.exit(1);
  }
  console.log("\nsenior women's checks passed");
  await prisma.$disconnect().catch(() => {});
})();
