/**
 * The European-club lane: domestic league fixtures of clubs playing in Europe
 * this season, when their league is otherwise out of the daily scope.
 *
 * THE GAP. Adaptive coverage (src/lib/generation/coverage.ts) only reaches the
 * FALLBACK and DEEP_FALLBACK tiers on a thin day. Qarabağ (Azerbaijan) and The
 * New Saints (Wales) are DEEP_FALLBACK clubs, so on any normal weekend their
 * league matches were never looked at, even in a season they were in the
 * Champions League or Conference League. Those are the clubs in those leagues a
 * reader actually recognises.
 *
 * THE LANE. A club that reached the MAIN STAGE of the Champions League, Europa
 * League or Conference League this season (league stage onwards; qualifying
 * only does not count) has its domestic league fixtures considered every day,
 * whatever the slate looks like. It is deliberately strict: more attention,
 * not lower standards.
 *
 *   1. Only league fixtures in a catalogued FALLBACK/DEEP_FALLBACK competition.
 *      CORE/SECONDARY leagues are already covered daily; cups are left out
 *      (rotated squads against lower-division sides make poor evidence).
 *   2. The same cheap fixture checks as the fallback gate: ids, scheduled,
 *      12–48h out, senior sides only, not already covered by any path.
 *   3. MARKET FIRST, before a single model call or enrichment fetch: at least
 *      MIN_BOOKMAKERS books on the full 1X2 market, and a selection backing the
 *      European club (win or double chance) priced between 75% and ~87% after
 *      the bookmaker margin is removed. Shorter than that has no value; longer
 *      means the market does not rate the club in this match.
 *   4. AFTER generation, each draft must be Market-Confirmed (model ≥ 75%,
 *      market ≥ 75%, gap ≤ 10pp, ≥ 5 books, quote ≤ 2h; src/lib/marketConfirmed.ts)
 *      and not shorter than ~87%. The single best survivor stays PENDING_REVIEW
 *      for a human, like every ordinary pick. Every other draft is archived.
 *
 * SEPARATE FROM THE EXISTING SETUP. The lane never writes the GenerationAttempt
 * ledger, and the slate count ignores its fixtures (countViableSlate), so the
 * adaptive scope, the ordinary worker, the Goals, VIP/PREMIUM, Bet of the Day
 * and combo passes all behave exactly as if it did not exist. Its attempt
 * record is the EUROPEAN_CLUB-intent AIJob, as the Goals pass does it.
 *
 * PURE. No database and no provider calls here; the I/O is in
 * src/lib/europeanClubsPipeline.ts, so every rule is checked deterministically
 * by scripts/check-european-clubs.ts.
 */

import type { FixtureRow } from "@/lib/football/api-football";
import type { FixtureOdds, TrimmedMarket } from "@/lib/odds";
import type { Selection } from "@/lib/markets";
import { LEAGUE_CATALOGUE, generationTierOf, isSeniorWomensCompetition, leaguePriorityRank } from "@/lib/leagues";
import { isNonSeniorSide, type OddsKnowledge } from "@/lib/generation/coverage";
import { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS } from "@/lib/generation/window";
import {
  compareMarketConfirmed,
  devigProbability,
  evaluateMarketConfirmed,
  MC_MAX_QUOTE_AGE_MS,
  MC_MIN_BOOKMAKERS,
  MC_MIN_MARKET_PROBABILITY,
  type MarketConfirmedVerdict,
} from "@/lib/marketConfirmed";
import { PAID_MAX_MARKET_PROBABILITY } from "@/lib/vipPremiumOverlay";
import { lagosDateKey } from "@/lib/lagosDate";
import { matchKey } from "@/lib/slug";

/** Recorded on the AIJob prompt, which is this lane's attempt record. */
export const EUROPEAN_CLUB_INTENT = "EUROPEAN_CLUB" as const;

/** Champions League, Europa League, Conference League. */
export const UEFA_CLUB_COMPETITION_IDS: readonly number[] = [2, 3, 848];

/**
 * The tunables, together. None of them changes a threshold anywhere else: the
 * market numbers are the Market-Confirmed and paid-tier constants, imported,
 * so the lane can never be looser than those gates.
 */
export const EUROPEAN_LANE_POLICY = {
  /** Model calls per Lagos day. The lane adds attention, it does not take over the budget. */
  DAILY_ATTEMPT_CAP: 4,
  /** One fixture per run: a multi-market generation is ~25s, the whole of a cron poke. */
  RUN_LIMIT: 1,
  /** The by-date sweep (2–3 provider calls) runs at most this often. */
  SWEEP_INTERVAL_MINUTES: 180,
  /** After a sweep whose every provider call failed, retry this much sooner. */
  SWEEP_RETRY_MINUTES: 30,
  /** Stricter than the fallback sweep's 1,000: the lane stands down first when quota is tight. */
  MIN_QUOTA_REMAINING: 1_500,
  /** Books that must quote the full 1X2 market and the club selection. */
  MIN_BOOKMAKERS: MC_MIN_BOOKMAKERS,
  /** De-vigged floor for the club selection, before generating. */
  MIN_MARKET_PROBABILITY: MC_MIN_MARKET_PROBABILITY,
  /** De-vigged ceiling (fair odds 1.15). Shorter is no value, before or after generating. */
  MAX_MARKET_PROBABILITY: PAID_MAX_MARKET_PROBABILITY,
  /** The draft gate's quote age limit: Market-Confirmed's own. */
  MAX_QUOTE_AGE_MS: MC_MAX_QUOTE_AGE_MS,
  /**
   * Fresher than that to START a generation: the drafts are judged against the
   * same quote ~25s later, so one picked at 1h59m would be stale by then and
   * every draft archived for nothing. Older quotes are re-priced first.
   */
  SELECTION_QUOTE_MAX_AGE_MS: 90 * 60_000,
  /** Odds fetches one run may spend looking for a fixture worth generating. */
  ODDS_WARM_PER_RUN: 2,
  /** A fixture whose generation threw is left alone this long. */
  RETRY_BACKOFF_MS: 3 * 3_600_000,
} as const;

/** AppLock row holding the sweep lease AND its result (the candidate list). */
export const EUROPEAN_LANE_SWEEP_KEY = "european-lane-sweep";
/** AppLock key prefix for a per-fixture retry backoff, as the Goals and VIP passes do it. */
export const EUROPEAN_LANE_BACKOFF_PREFIX = "european-lane-retry:";

// ---------------------------------------------------------------------------
// Who counts as a European club
// ---------------------------------------------------------------------------

/**
 * Rounds only a main-stage club plays. "Play-offs" on its own is the last
 * QUALIFYING round, so it is not here; "Knockout Round Play-offs" is after the
 * league stage and is.
 */
const MAIN_STAGE_ROUND = /^(?:League Stage\b|Knockout Round Play-offs$|Round of 16$|Quarter-finals$|Semi-finals$|Final$)/i;

export function isMainStageRound(round: string | null | undefined): boolean {
  return !!round && MAIN_STAGE_ROUND.test(round.trim());
}

/** 1 July (UTC) of the European season `now` falls in. */
export function europeanSeasonStart(now: Date): Date {
  const year = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, 6, 1));
}

export type EuropeanClub = { teamApiId: number; name: string; competitions: number[] };

/**
 * Main-stage clubs this season, from ledger rows the discovery cursor already
 * wrote for the UEFA competitions (they are CORE, so every fixture is seen).
 * Team ids come from the matchKey ("home-away-day"). Zero provider calls.
 */
export function europeanClubsFromLedger(
  rows: ReadonlyArray<{ leagueApiId: number | null; round: string | null; matchKey: string; kickoff: Date; homeTeam: string; awayTeam: string }>,
  now: Date,
): Map<number, EuropeanClub> {
  const since = europeanSeasonStart(now).getTime();
  const clubs = new Map<number, EuropeanClub>();
  for (const r of rows) {
    if (r.leagueApiId == null || !UEFA_CLUB_COMPETITION_IDS.includes(r.leagueApiId)) continue;
    if (!isMainStageRound(r.round) || r.kickoff.getTime() < since) continue;
    const [home, away] = r.matchKey.split("-").map(Number);
    for (const [id, name] of [[home, r.homeTeam], [away, r.awayTeam]] as const) {
      if (!Number.isInteger(id) || id <= 0) continue;
      const club = clubs.get(id) ?? { teamApiId: id, name, competitions: [] };
      if (!club.competitions.includes(r.leagueApiId)) club.competitions.push(r.leagueApiId);
      clubs.set(id, club);
    }
  }
  return clubs;
}

/** A domestic LEAGUE the lane may reach into: catalogued, men's, and outside the daily scope. */
export function isLaneDomesticLeague(leagueApiId: number | null | undefined): boolean {
  const tier = generationTierOf(leagueApiId);
  if (tier !== "FALLBACK" && tier !== "DEEP_FALLBACK") return false;
  if (isSeniorWomensCompetition(leagueApiId)) return false;
  return LEAGUE_CATALOGUE.find((l) => l.id === leagueApiId)?.kind === "league";
}

// ---------------------------------------------------------------------------
// The fixture gate (sweep time, no provider calls)
// ---------------------------------------------------------------------------

export type LaneGateRejection =
  | "invalid_ids"
  | "not_lane_league"
  | "no_european_club"
  | "not_scheduled"
  | "bad_kickoff"
  | "inside_lead_time"
  | "outside_window"
  | "missing_team_names"
  | "non_senior_side"
  | "already_covered"
  | "no_bookmakers";

export type ClubSide = "home" | "away";

/** What is already being handled by another path: any prediction, any ledger row. */
export type Covered = { fixtureIds: ReadonlySet<number>; matchKeys: ReadonlySet<string> };

export function europeanLaneGate(
  row: FixtureRow,
  ctx: { clubs: ReadonlyMap<number, unknown>; covered: Covered; odds?: OddsKnowledge | null; now: Date },
): { ok: true; clubSides: ClubSide[] } | { ok: false; reason: LaneGateRejection } {
  const isPositiveInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;
  const home = row.teams?.home;
  const away = row.teams?.away;
  if (!isPositiveInt(row.fixture?.id) || !isPositiveInt(home?.id) || !isPositiveInt(away?.id) || home.id === away.id) {
    return { ok: false, reason: "invalid_ids" };
  }
  if (!isLaneDomesticLeague(row.league?.id)) return { ok: false, reason: "not_lane_league" };

  const clubSides: ClubSide[] = [];
  if (ctx.clubs.has(home.id)) clubSides.push("home");
  if (ctx.clubs.has(away.id)) clubSides.push("away");
  if (!clubSides.length) return { ok: false, reason: "no_european_club" };

  if (row.fixture.status?.short !== "NS") return { ok: false, reason: "not_scheduled" };
  const kickoff = new Date(row.fixture.date).getTime();
  if (Number.isNaN(kickoff)) return { ok: false, reason: "bad_kickoff" };
  if (kickoff < ctx.now.getTime() + GENERATE_FROM_HOURS * 3_600_000) return { ok: false, reason: "inside_lead_time" };
  if (kickoff > ctx.now.getTime() + GENERATE_UNTIL_HOURS * 3_600_000) return { ok: false, reason: "outside_window" };

  if (!home.name?.trim() || !away.name?.trim()) return { ok: false, reason: "missing_team_names" };
  if (isNonSeniorSide(home.name, row.league.id) || isNonSeniorSide(away.name, row.league.id)) return { ok: false, reason: "non_senior_side" };

  const key = matchKey({ homeTeamApiId: home.id, awayTeamApiId: away.id, kickoff: row.fixture.date });
  if (ctx.covered.fixtureIds.has(row.fixture.id) || (key && ctx.covered.matchKeys.has(key))) return { ok: false, reason: "already_covered" };

  if (ctx.odds?.fetchedAt && ctx.odds.bookmakerCount === 0) return { ok: false, reason: "no_bookmakers" };
  return { ok: true, clubSides };
}

/** A gated fixture, as stored with the sweep result. JSON-safe: kickoff is an ISO string. */
export type LaneCandidate = {
  fixtureApiId: number;
  matchKey: string;
  leagueApiId: number;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number;
  awayTeamApiId: number;
  kickoff: string;
  round: string | null;
  clubSides: ClubSide[];
};

export type LanePlan = {
  candidates: LaneCandidate[];
  /** Rows in lane leagues, before the gate. */
  considered: number;
  rejected: Partial<Record<LaneGateRejection, number>>;
};

/**
 * Sort a by-date payload into lane candidates. Rows outside lane leagues are
 * ignored, not counted as rejected: the payload is every competition on earth.
 */
export function planLaneSweep(
  rows: FixtureRow[],
  ctx: { clubs: ReadonlyMap<number, unknown>; covered: Covered; now: Date; oddsByMatchKey?: ReadonlyMap<string, OddsKnowledge> },
): LanePlan {
  const plan: LanePlan = { candidates: [], considered: 0, rejected: {} };
  const taken = new Set<number>();
  const leagueName = new Map(LEAGUE_CATALOGUE.map((l) => [l.id as number, l.name as string]));
  for (const row of rows) {
    if (!isLaneDomesticLeague(row.league?.id)) continue;
    plan.considered++;
    const key = matchKey({ homeTeamApiId: row.teams?.home?.id, awayTeamApiId: row.teams?.away?.id, kickoff: row.fixture?.date });
    const verdict = europeanLaneGate(row, { ...ctx, odds: key ? ctx.oddsByMatchKey?.get(key) : null });
    if (!verdict.ok) {
      plan.rejected[verdict.reason] = (plan.rejected[verdict.reason] ?? 0) + 1;
      continue;
    }
    if (!key || taken.has(row.fixture.id)) continue;
    taken.add(row.fixture.id);
    plan.candidates.push({
      fixtureApiId: row.fixture.id,
      matchKey: key,
      leagueApiId: row.league.id,
      leagueName: leagueName.get(row.league.id) ?? row.league.name,
      homeTeam: row.teams.home.name,
      awayTeam: row.teams.away.name,
      homeTeamApiId: row.teams.home.id,
      awayTeamApiId: row.teams.away.id,
      kickoff: new Date(row.fixture.date).toISOString(),
      round: row.league.round ?? null,
      clubSides: verdict.clubSides,
    });
  }
  plan.candidates.sort(compareLaneCandidates);
  return plan;
}

/** League priority, then kickoff, then id: stable across runs. */
export function compareLaneCandidates(a: LaneCandidate, b: LaneCandidate): number {
  return leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId)
    || Date.parse(a.kickoff) - Date.parse(b.kickoff)
    || a.fixtureApiId - b.fixtureApiId;
}

// ---------------------------------------------------------------------------
// The stored sweep result
// ---------------------------------------------------------------------------

export type LaneSweepRecord = {
  version: 1;
  token: string;
  sweptAt: string;
  dates: string[];
  clubs: number;
  considered: number;
  rejected: Partial<Record<LaneGateRejection, number>>;
  candidates: LaneCandidate[];
};

/** The sweep row's holder, read back. Anything unreadable is "no candidates", never an error. */
export function parseLaneSweep(holder: string | null | undefined): LaneSweepRecord | null {
  if (!holder || holder[0] !== "{") return null;
  try {
    const parsed = JSON.parse(holder) as LaneSweepRecord;
    return parsed?.version === 1 && Array.isArray(parsed.candidates) ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Choosing what to generate (run time)
// ---------------------------------------------------------------------------

export type LaneAttempt = { fixtureApiId: number; createdAt: Date };

/** Lane-intent AIJob prompts, read back. Same shape of reader as readGoalsAttempt. */
export function readLaneAttempt(prompt: string, createdAt: Date): LaneAttempt | null {
  try {
    const p = JSON.parse(prompt);
    if (p?.intent !== EUROPEAN_CLUB_INTENT) return null;
    const fixtureApiId = Number(p.fixtureApiId);
    return Number.isInteger(fixtureApiId) && fixtureApiId > 0 ? { fixtureApiId, createdAt } : null;
  } catch {
    return null;
  }
}

export type LaneSkip = "attempted" | "backing_off" | "already_covered" | "inside_lead_time" | "kicked_off";

export type LaneTargets = {
  /** Why the lane did nothing this run, or null. */
  stoodDown: string | null;
  attemptsToday: number;
  /** Eligible candidates in order; the run takes the first that clears the value gate. */
  ordered: LaneCandidate[];
  skipped: Partial<Record<LaneSkip, number>>;
};

/**
 * One shot per fixture. A fixture already attempted is never retried (its
 * drafts were judged and kept or archived); a fixture whose run THREW is held
 * off by the backoff instead, since nothing was judged.
 */
export function planLaneTargets(input: {
  candidates: readonly LaneCandidate[];
  attempts: readonly LaneAttempt[];
  backingOff: ReadonlySet<number>;
  covered: Covered;
  now: Date;
  policy?: typeof EUROPEAN_LANE_POLICY;
}): LaneTargets {
  const policy = input.policy ?? EUROPEAN_LANE_POLICY;
  const today = lagosDateKey(input.now);
  const attemptsToday = input.attempts.filter((a) => lagosDateKey(a.createdAt) === today).length;
  const plan: LaneTargets = { stoodDown: null, attemptsToday, ordered: [], skipped: {} };
  if (attemptsToday >= policy.DAILY_ATTEMPT_CAP) {
    plan.stoodDown = `daily cap reached (${attemptsToday}/${policy.DAILY_ATTEMPT_CAP} attempts today)`;
    return plan;
  }
  const attempted = new Set(input.attempts.map((a) => a.fixtureApiId));
  const skip = (why: LaneSkip) => { plan.skipped[why] = (plan.skipped[why] ?? 0) + 1; };
  for (const c of input.candidates) {
    const kickoff = Date.parse(c.kickoff);
    if (!(kickoff > input.now.getTime())) { skip("kicked_off"); continue; }
    if (kickoff < input.now.getTime() + GENERATE_FROM_HOURS * 3_600_000) { skip("inside_lead_time"); continue; }
    if (attempted.has(c.fixtureApiId)) { skip("attempted"); continue; }
    if (input.backingOff.has(c.fixtureApiId)) { skip("backing_off"); continue; }
    if (input.covered.fixtureIds.has(c.fixtureApiId) || input.covered.matchKeys.has(c.matchKey)) { skip("already_covered"); continue; }
    plan.ordered.push(c);
  }
  plan.ordered.sort(compareLaneCandidates);
  if (!plan.ordered.length) plan.stoodDown = "no eligible European-club fixture in the window";
  return plan;
}

// ---------------------------------------------------------------------------
// The market-first value gate (before generating)
// ---------------------------------------------------------------------------

export type LaneValueRejection = "NO_ODDS" | "STALE_QUOTE" | "THIN_MARKET" | "CLUB_NOT_FAVOURED" | "TOO_SHORT";

/** Whether a rejection can change by re-pricing, so is worth one odds call. */
export const LANE_RETRYABLE_VALUE_REASONS: readonly LaneValueRejection[] = ["NO_ODDS", "STALE_QUOTE"];

const CLUB_SELECTIONS: Record<ClubSide, ReadonlyArray<{ market: TrimmedMarket; value: string }>> = {
  home: [{ market: "Match Winner", value: "Home" }, { market: "Double Chance", value: "Home/Draw" }],
  away: [{ market: "Match Winner", value: "Away" }, { market: "Double Chance", value: "Away/Draw" }],
};

export type LaneValue = { market: TrimmedMarket; value: string; probability: number; bookmakers: number };

/**
 * Is this fixture worth a model call? Read from the market alone.
 *
 * The 1X2 market must be quoted in full by MIN_BOOKMAKERS books (a thin book on
 * an Azerbaijani league fixture is not a market), and some selection backing
 * the European club must sit inside [MIN, MAX] de-vigged. The best such
 * selection, by probability, is returned for the run report.
 */
export function laneValueVerdict(
  odds: FixtureOdds | null,
  fetchedAt: Date | null,
  clubSides: readonly ClubSide[],
  now: Date,
  policy: typeof EUROPEAN_LANE_POLICY = EUROPEAN_LANE_POLICY,
): { ok: true; value: LaneValue } | { ok: false; reason: LaneValueRejection; detail: string } {
  if (!odds?.markets?.length) return { ok: false, reason: "NO_ODDS", detail: "no cached odds for this fixture" };
  if (!fetchedAt || now.getTime() - fetchedAt.getTime() > policy.SELECTION_QUOTE_MAX_AGE_MS) {
    return { ok: false, reason: "STALE_QUOTE", detail: fetchedAt ? `quote is ${Math.round((now.getTime() - fetchedAt.getTime()) / 60_000)}m old` : "no fetch timestamp" };
  }

  const oneXTwo = ["Home", "Draw", "Away"].map((v) => devigProbability(odds, "Match Winner", v));
  const depth = oneXTwo.every((p) => p) ? Math.min(...oneXTwo.map((p) => p!.bookmakers)) : 0;
  if (depth < policy.MIN_BOOKMAKERS) {
    return { ok: false, reason: "THIN_MARKET", detail: `1X2 quoted by ${depth} bookmakers (< ${policy.MIN_BOOKMAKERS})` };
  }

  let best: LaneValue | null = null;
  let shortest: number | null = null;
  for (const side of clubSides) {
    for (const want of CLUB_SELECTIONS[side]) {
      const p = devigProbability(odds, want.market, want.value);
      if (!p || p.bookmakers < policy.MIN_BOOKMAKERS || p.probability < policy.MIN_MARKET_PROBABILITY) continue;
      if (p.probability > policy.MAX_MARKET_PROBABILITY) {
        shortest = Math.max(shortest ?? 0, p.probability);
        continue;
      }
      if (!best || p.probability > best.probability) best = { market: want.market, value: want.value, probability: p.probability, bookmakers: p.bookmakers };
    }
  }
  if (best) return { ok: true, value: best };
  if (shortest != null) {
    return { ok: false, reason: "TOO_SHORT", detail: `the club is priced ${shortest.toFixed(1)}% (> ${policy.MAX_MARKET_PROBABILITY.toFixed(1)}%): no value left` };
  }
  return { ok: false, reason: "CLUB_NOT_FAVOURED", detail: `no selection backing the club reaches ${policy.MIN_MARKET_PROBABILITY}% with ${policy.MIN_BOOKMAKERS}+ books` };
}

// ---------------------------------------------------------------------------
// The draft gate (after generating)
// ---------------------------------------------------------------------------

export type LaneDraft = { id: string; marketType: string; selection: Selection; confidence: number };
export type LaneDraftRejection = MarketConfirmedVerdict["reason"] | "TOO_SHORT" | "RUNNER_UP";
export type LaneDraftJudgement = { id: string; verdict: MarketConfirmedVerdict; kept: boolean; reason: LaneDraftRejection | null };

/**
 * Keep at most ONE draft: Market-Confirmed, not shorter than the value
 * ceiling, and best by compareMarketConfirmed (the strongest weaker side, then
 * the tightest agreement). Everything else is reported with its reason, for the
 * caller to archive.
 */
export function judgeLaneDrafts(
  drafts: readonly LaneDraft[],
  odds: FixtureOdds | null,
  fetchedAt: Date | null,
  now: Date,
  policy: typeof EUROPEAN_LANE_POLICY = EUROPEAN_LANE_POLICY,
): LaneDraftJudgement[] {
  const judged: LaneDraftJudgement[] = drafts.map((d) => {
    const verdict = evaluateMarketConfirmed({ marketType: d.marketType, selection: d.selection, confidence: d.confidence, odds, fetchedAt, now });
    if (!verdict.confirmed) return { id: d.id, verdict, kept: false, reason: verdict.reason ?? null };
    if ((verdict.marketProbability ?? 0) > policy.MAX_MARKET_PROBABILITY) return { id: d.id, verdict, kept: false, reason: "TOO_SHORT" };
    return { id: d.id, verdict, kept: false, reason: null };
  });
  const passing = judged.filter((j) => j.reason === null).sort(compareMarketConfirmed);
  for (const [i, j] of passing.entries()) {
    if (i === 0) j.kept = true;
    else j.reason = "RUNNER_UP";
  }
  return judged;
}
