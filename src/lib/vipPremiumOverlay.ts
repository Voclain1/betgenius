import { leaguePriorityRank } from "@/lib/leagues";
import { VIP_PROXY_LEAGUE_IDS } from "@/lib/ai/generationRisk";
import { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS } from "@/lib/generation/window";
import type { FixtureOdds } from "@/lib/odds";
import {
  lopsidednessSignal,
  MC_MAX_QUOTE_AGE_MS,
  MC_MIN_MARKET_PROBABILITY,
  MC_MIN_MODEL_CONFIDENCE,
} from "@/lib/marketConfirmed";
import {
  DEDICATED_PAID_PROVENANCES,
  PREMIUM_CONFIDENCE_FLOOR,
  PREMIUM_GENERATED_PROVENANCE,
  VIP_GENERATED_PROVENANCE,
  VIP_CONFIDENCE_FLOOR,
  paidFixtureKey,
} from "@/lib/geniusCuration";
import { GOALS_GENERATED_PROVENANCE } from "@/lib/goalsGeneration";

/**
 * The dedicated VIP/PREMIUM pass as a post-ordinary OVERLAY: pure rules. No
 * database, no network. The reads and writes live in src/lib/vipPremiumPipeline.ts
 * and the run in src/lib/generation/worker.ts (runVipPremiumGeneration).
 *
 * WHY AN OVERLAY. The pass used to target only PENDING ledger rows, fixtures
 * ordinary generation had not claimed yet. Audited over its first scheduled
 * runs (19–28 Sep 2026) it made ZERO model calls in 871 runs. Ordinary generation claims a paid-scope fixture a
 * median 8 minutes after discovery, at ~44h before kickoff, so the pass saw
 * each fixture about once, and never with a fresh quote: in paid scope the
 * books do not price until ~24h before kickoff (0 of 225 fetches returned a
 * quote 24–48h out; 65% did 12–24h out, all the misses lower-league FA Cup
 * ties). The 20-minute reservation (paidTierGrace.ts) could not help: the queue
 * ignores nextAttemptAt on PENDING rows, and 20 minutes at 44h buys no quote.
 *
 * So, like the Goals pass, this targets fixtures ordinary generation has
 * ALREADY covered (ledger SUCCEEDED, ordinary rows present). It never reads or
 * writes a PENDING ledger row, so it cannot race ordinary generation, cannot
 * consume a fixture, and sees each fixture on every run until it is priced.
 * Ordinary generation is unchanged. The overlay adds at most one paid pick.
 */

/** Label recorded on AIJob.prompt.intent. It is also how attempts and the daily quota are counted. */
export const VIP_PREMIUM_INTENT = "VIP_PREMIUM" as const;

/**
 * The market bar for each tier.
 *
 * VIP reuses MC_MIN_MARKET_PROBABILITY rather than restating 75, because it IS
 * that bar — the gate's own floor, unchanged.
 *
 * PREMIUM's 80 is the measured separator. Over 206 settled paid-tier-eligible
 * rows, raising the MODEL confidence floor from 75 to 80 moved the strike rate
 * 76.2% -> 78.8% while cutting the sample from 206 to 33. Raising the MARKET
 * floor from 75 to 80 moved it 84.2% -> 86.5% on a larger surviving sample
 * (n=57 -> n=37). The market is what separates the tiers.
 */
export const VIP_MARKET_FLOOR = MC_MIN_MARKET_PROBABILITY;
export const PREMIUM_MARKET_FLOOR = 80;

/**
 * Fixtures generated per run. A multi-market paid job takes ~25s (measured
 * 23.6–26.8s), which is the whole of cron-job.org's 30s client budget, so one
 * per run — the same reason the Goals pass takes one. At a run every 15 minutes
 * the daily quota (VIP_PREMIUM_DAILY_QUOTA) is still reachable within hours.
 */
export const VIP_PREMIUM_RUN_LIMIT = 1;

/**
 * Most fixtures one run will price itself. One api-football call each. The
 * existing cap, unchanged.
 */
export const VIP_PREMIUM_ODDS_WARM_LIMIT = 12;

/**
 * The overlay only spends an odds call on a fixture this close to kickoff.
 *
 * Measured, not chosen: over 19–29 Sep, 0 of 225 on-demand and scheduled
 * fetches returned a quote for a paid-scope fixture 24–48h before kickoff,
 * against 65% at 12–24h (100% for the league fixtures; the misses were
 * lower-league FA Cup ties the books never priced). Warming earlier buys an
 * empty response. It equals ODDS_NEAR_KICKOFF_WINDOW_MS, where the odds
 * workload starts re-pricing hourly, for the same reason.
 *
 * Eligibility is NOT narrowed: a fixture 24–48h out that already carries a
 * fresh qualifying quote is still a target.
 */
export const VIP_PREMIUM_WARM_WITHIN_MS = 24 * 3_600_000;

/**
 * A fixture whose last on-demand fetch came back empty is not re-asked sooner
 * than this. Equals ODDS_FAILED_RETRY_MS for the same reason: a market that
 * opens late is picked up the same day without re-spending a call every run.
 */
export const VIP_PREMIUM_WARM_RETRY_MS = 60 * 60_000;

/** How long a fixture whose generation threw is left alone. Same as the Goals pass. */
export const VIP_PREMIUM_RETRY_BACKOFF_MS = 6 * 3_600_000;

/** AppLock key prefix for that backoff — the lease table the generation run already uses. */
export const VIP_PREMIUM_BACKOFF_LOCK_PREFIX = "vip-premium-retry:";

// ── Target planning ─────────────────────────────────────────────────────────

/** A GenerationAttempt row. Only SUCCEEDED rows are ever targets. */
export type OverlayLedgerRow = {
  matchKey: string;
  fixtureApiId: number | null;
  leagueApiId: number | null;
  leagueName: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  round: string | null;
  status: string;
};

/** A prediction on a fixture in the window. */
export type OverlayFixtureRow = {
  id: string;
  fixtureApiId: number | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: Date | null;
  status: string;
  provenance: string | null;
  contextComplete: boolean;
};

/** A previous VIP_PREMIUM-intent AIJob, read from its stored prompt. */
export type OverlayAttempt = { fixtureApiId: number | null; createdAt: Date };

export type OverlayCandidate = {
  matchKey: string;
  fixtureApiId: number;
  leagueApiId: number;
  leagueName: string | null;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number;
  awayTeamApiId: number;
  kickoff: Date;
  round: string | null;
};

export type OverlaySkipReason =
  | "OUTSIDE_WINDOW"
  | "OUT_OF_SCOPE" // not one of the paid competitions (VIP_PROXY_LEAGUE_IDS) — unchanged
  | "NOT_YET_GENERATED" // the ledger row is not SUCCEEDED, or no ordinary row exists yet
  | "NO_MATCH_CONTEXT"
  | "HAS_DEDICATED_PAID" // a live dedicated paid row already exists: one paid pick per fixture
  | "ALREADY_ATTEMPTED" // this pass already spent a model call on it
  | "BACKING_OFF";

export type OverlayPlan = {
  candidates: OverlayCandidate[];
  considered: number;
  skipped: Partial<Record<OverlaySkipReason, number>>;
};

const LIVE_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED"]);
const isDedicatedPaid = (provenance: string | null) => (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(provenance ?? "");

/** An ordinary-generation row: not produced by the Goals pass or a dedicated paid pass. */
const isOrdinary = (r: OverlayFixtureRow) => r.provenance !== GOALS_GENERATED_PROVENANCE && !isDedicatedPaid(r.provenance);

/** The paid-generation window, unchanged: GENERATE_FROM_HOURS..GENERATE_UNTIL_HOURS before kickoff. */
export function inVipPremiumWindow(kickoff: Date, now: Date): boolean {
  const k = kickoff.getTime();
  if (Number.isNaN(k)) return false;
  return k >= now.getTime() + GENERATE_FROM_HOURS * 3_600_000 && k <= now.getTime() + GENERATE_UNTIL_HOURS * 3_600_000;
}

/**
 * Which covered fixtures may take a paid-tier attempt — before odds.
 *
 * Pure so the overlay's rules (SUCCEEDED only, paid scope only, one dedicated
 * pick per fixture, one attempt per fixture) are pinned without a database.
 * Order: soonest kickoff first, which is also the order odds are warmed in.
 */
export function planVipPremiumCandidates(input: {
  ledger: readonly OverlayLedgerRow[];
  rows: readonly OverlayFixtureRow[];
  attempts: readonly OverlayAttempt[];
  backingOff?: ReadonlySet<number>;
  now: Date;
  /** VERIFICATION ONLY (scripts/verify-vip-premium-pass.ts): drops the paid-scope restriction. */
  anyLeague?: boolean;
}): OverlayPlan {
  const skipped: OverlayPlan["skipped"] = {};
  const skip = (r: OverlaySkipReason) => (skipped[r] = (skipped[r] ?? 0) + 1);

  const attempted = new Set(input.attempts.map((a) => a.fixtureApiId).filter((id): id is number => id != null));
  // Live rows per fixture, by provider id and by the team/day key, so a row
  // that predates fixtureApiId is still found.
  const byFixture = new Map<string, OverlayFixtureRow[]>();
  for (const r of input.rows) {
    if (!LIVE_STATUSES.has(r.status)) continue;
    const keys = [r.fixtureApiId != null ? `f${r.fixtureApiId}` : null, paidFixtureKey(r)].filter((k): k is string => !!k);
    for (const k of keys) (byFixture.get(k) ?? byFixture.set(k, []).get(k)!).push(r);
  }

  const candidates: OverlayCandidate[] = [];
  for (const l of input.ledger) {
    if (!inVipPremiumWindow(l.kickoff, input.now)) { skip("OUTSIDE_WINDOW"); continue; }
    if (!input.anyLeague && !(VIP_PROXY_LEAGUE_IDS as readonly number[]).includes(l.leagueApiId ?? -1)) { skip("OUT_OF_SCOPE"); continue; }
    const rows = [...new Set([...(l.fixtureApiId != null ? byFixture.get(`f${l.fixtureApiId}`) ?? [] : []), ...(byFixture.get(l.matchKey) ?? [])])];
    const ordinary = rows.filter(isOrdinary);
    const [homeId, awayId] = l.matchKey.split("-").map(Number);
    if (l.status !== "SUCCEEDED" || l.fixtureApiId == null || l.leagueApiId == null || ordinary.length === 0 || !Number.isFinite(homeId) || !Number.isFinite(awayId)) {
      skip("NOT_YET_GENERATED");
      continue;
    }
    if (!ordinary.some((r) => r.contextComplete)) { skip("NO_MATCH_CONTEXT"); continue; }
    if (rows.some((r) => isDedicatedPaid(r.provenance))) { skip("HAS_DEDICATED_PAID"); continue; }
    if (attempted.has(l.fixtureApiId)) { skip("ALREADY_ATTEMPTED"); continue; }
    if (input.backingOff?.has(l.fixtureApiId)) { skip("BACKING_OFF"); continue; }
    candidates.push({
      matchKey: l.matchKey, fixtureApiId: l.fixtureApiId, leagueApiId: l.leagueApiId, leagueName: l.leagueName,
      homeTeam: l.homeTeam, awayTeam: l.awayTeam, homeTeamApiId: homeId, awayTeamApiId: awayId,
      kickoff: l.kickoff, round: l.round,
    });
  }
  candidates.sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.matchKey.localeCompare(b.matchKey));
  return { candidates, considered: input.ledger.length, skipped };
}

// ── Odds ─────────────────────────────────────────────────────────────────────

/** A FixtureOddsCache row. */
export type OverlayQuote = { oddsJson: FixtureOdds | null; fetchedAt: Date | null; lastAttemptAt: Date | null };

const isFresh = (q: OverlayQuote | undefined, now: Date) =>
  !!q?.fetchedAt && now.getTime() - q.fetchedAt.getTime() <= MC_MAX_QUOTE_AGE_MS;

/**
 * Which candidates this run should price itself, nearest kickoff first, at most
 * `limit` (VIP_PREMIUM_ODDS_WARM_LIMIT).
 *
 * Only what the gate cannot already read: a candidate inside
 * VIP_PREMIUM_WARM_WITHIN_MS of kickoff whose cached quote is missing or older
 * than MC_MAX_QUOTE_AGE_MS, and whose last empty fetch was not within
 * VIP_PREMIUM_WARM_RETRY_MS. The odds workload already re-prices published
 * fixtures hourly inside 24h, so most candidates cost this pass nothing.
 */
export function vipPremiumOddsToWarm(
  candidates: readonly OverlayCandidate[],
  quotes: ReadonlyMap<string, OverlayQuote>,
  now: Date,
  limit = VIP_PREMIUM_ODDS_WARM_LIMIT,
): OverlayCandidate[] {
  return candidates
    .filter((c) => {
      if (c.kickoff.getTime() - now.getTime() > VIP_PREMIUM_WARM_WITHIN_MS) return false;
      const q = quotes.get(c.matchKey);
      if (isFresh(q, now)) return false;
      const failedSinceLastQuote = !!q?.lastAttemptAt && (!q.fetchedAt || q.lastAttemptAt.getTime() > q.fetchedAt.getTime());
      if (failedSinceLastQuote && now.getTime() - q!.lastAttemptAt!.getTime() < VIP_PREMIUM_WARM_RETRY_MS) return false;
      return true;
    })
    .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.matchKey.localeCompare(b.matchKey))
    .slice(0, Math.max(0, limit));
}

export type VipPremiumTarget = OverlayCandidate & {
  /** The de-vigged probability that made this fixture worth a paid-tier attempt. */
  marketProbability: number;
  market: string;
  selection: string;
  bookmakers: number;
  quoteAgeMs: number;
};

/** NO_QUOTED_MARKET: no targetable market quoted by MC_MIN_BOOKMAKERS or more books (lopsidednessSignal drops thinner ones). */
export type OddsSkipReason = "NO_FRESH_QUOTE" | "NO_QUOTED_MARKET" | "MARKET_BELOW_BAR";

export type OddsQualification = {
  targets: VipPremiumTarget[];
  /** Candidates with a quote fresh enough for the gate to read. */
  freshlyPriced: number;
  /** ...of which the market prices at or above the VIP bar, at MC_MIN_BOOKMAKERS or more. */
  qualified: number;
  skipped: Partial<Record<OddsSkipReason, number>>;
};

/**
 * Candidates the market already puts in paid-tier territory, strongest market
 * first, at most `limit`.
 *
 * The same pre-checks the gate will make, so no model call is spent on a
 * fixture that cannot pass: a fresh quote (MC_MAX_QUOTE_AGE_MS), and a
 * headline favourite quoted by at least MC_MIN_BOOKMAKERS books at or above
 * the VIP bar.
 */
export function qualifyVipPremiumTargets(
  candidates: readonly OverlayCandidate[],
  quotes: ReadonlyMap<string, OverlayQuote>,
  now: Date,
  limit: number,
): OddsQualification {
  const skipped: OddsQualification["skipped"] = {};
  const skip = (r: OddsSkipReason) => (skipped[r] = (skipped[r] ?? 0) + 1);
  let freshlyPriced = 0;
  const qualified: VipPremiumTarget[] = [];
  for (const c of candidates) {
    const q = quotes.get(c.matchKey);
    if (!isFresh(q, now)) { skip("NO_FRESH_QUOTE"); continue; }
    freshlyPriced++;
    const best = lopsidednessSignal(q!.oddsJson);
    if (!best) { skip("NO_QUOTED_MARKET"); continue; }
    if (best.probability < VIP_MARKET_FLOOR) { skip("MARKET_BELOW_BAR"); continue; }
    qualified.push({
      ...c,
      marketProbability: best.probability,
      market: best.market,
      selection: best.value,
      bookmakers: best.bookmakers,
      quoteAgeMs: now.getTime() - q!.fetchedAt!.getTime(),
    });
  }
  // Strongest market conviction first: the market's own confidence is the
  // thing being bought. League priority, then kickoff, break ties.
  qualified.sort(
    (a, b) =>
      b.marketProbability - a.marketProbability ||
      leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
      a.kickoff.getTime() - b.kickoff.getTime() ||
      a.matchKey.localeCompare(b.matchKey),
  );
  return { targets: qualified.slice(0, Math.max(0, limit)), freshlyPriced, qualified: qualified.length, skipped };
}

// ── Tiering ──────────────────────────────────────────────────────────────────

export type PaidTier = "VIP" | "PREMIUM";

/**
 * The tier a market-confirmed draft earns, or null.
 *
 * The market-confirmation gate (evaluateMarketConfirmed) is unchanged and
 * already requires model confidence >= MC_MIN_MODEL_CONFIDENCE (75, VIP's
 * floor) and market >= 75. PREMIUM additionally needs the market at
 * PREMIUM_MARKET_FLOOR (80), as before, AND the pick at PREMIUM's own
 * confidence floor (80): every PREMIUM pick meets PREMIUM's floor, whichever
 * path it came by. A market-80 pick at 77 confidence is a VIP pick.
 */
export function paidTierFor(verdict: { confirmed: boolean; marketProbability?: number | null }, confidence: number): PaidTier | null {
  if (!verdict.confirmed || confidence < VIP_CONFIDENCE_FLOOR || confidence < MC_MIN_MODEL_CONFIDENCE) return null;
  return (verdict.marketProbability ?? 0) >= PREMIUM_MARKET_FLOOR && confidence >= PREMIUM_CONFIDENCE_FLOOR ? "PREMIUM" : "VIP";
}

/**
 * Gate rejections that say nothing final about the pick: the quote was missing
 * or stale when the gate read it. Drafts rejected only for these stay in review
 * and are re-judged on the next run. Every other rejection is final.
 */
export const RETRYABLE_GATE_REASONS = ["NO_ODDS", "STALE_QUOTE"] as const;

// ── Automatic publication ────────────────────────────────────────────────────

/**
 * Why a dedicated paid pick may NOT be published without a human. Every one is
 * re-checked at publish time against the row as persisted, the fixture as it
 * stands and the quote in the cache now — nothing is taken on trust from the
 * gate that promoted it.
 */
export type PaidPublishBlock =
  | "NOT_DEDICATED_PAID" // provenance is not VIP_GENERATED / PREMIUM_GENERATED
  | "NOT_PAID_PASS_JOB" // its AIJob did not carry the VIP_PREMIUM intent
  | "NOT_PENDING_REVIEW"
  | "REWRITTEN" // a human asked for another draft, so a human publishes it
  | "COMBO"
  | "HIDDEN_LEG"
  | "NOT_ORDINARY_COVERED"
  | "OUT_OF_SCOPE"
  | "NO_MATCH_CONTEXT"
  | "NOT_TAGGED_VIP"
  | "GATE_FAILED" // the market-confirmation gate (quote, books, gap, floors) fails now
  | "BELOW_VIP_FLOOR"
  | "PREMIUM_NOT_EARNED" // tagged PREMIUM without model >= 80 AND market >= 80
  | "CONFLICTING_DEDICATED_PICK" // another live dedicated paid row is on the fixture
  | "OVER_DAILY_QUOTA";

export type PaidPublishRow = {
  provenance: string | null;
  /** The intent recorded on the row's own AIJob. */
  intent: string | null;
  status: string;
  rewriteCount: number;
  marketType: string;
  confidence: number;
  contextComplete: boolean;
  leagueApiId: number | null;
  categories: string[];
};

export type PaidPublishFixture = {
  /** The fixture's ledger row is SUCCEEDED and it holds at least one live ordinary row. */
  ordinaryCovered: boolean;
  /** Another live (not archived) dedicated paid row exists on the fixture. */
  conflictingDedicated: boolean;
  /** This row's attempt was within VIP_PREMIUM_DAILY_QUOTA for its Lagos day. */
  withinDailyQuota: boolean;
};

/**
 * May this dedicated paid pick go public with no reviewer?
 *
 * Only a row the overlay generated and the gate promoted, still in review and
 * never rewritten, a single (never a double or a hidden leg), in the paid
 * competitions, generated with live match data on a fixture ordinary
 * generation covered, whose market-confirmation verdict — recomputed now —
 * passes, at VIP's floors (75/75) and, if tagged PREMIUM, at PREMIUM's
 * (model 80 AND market 80), with no other dedicated pick on the fixture, inside
 * the daily quota. Ordinary rows fail NOT_DEDICATED_PAID and NOT_PAID_PASS_JOB,
 * so ordinary generation can never reach publication through this.
 */
export function paidAutoPublishVerdict(
  row: PaidPublishRow,
  verdict: { confirmed: boolean; marketProbability?: number | null },
  fixture: PaidPublishFixture,
): { publish: boolean; blocks: PaidPublishBlock[] } {
  const blocks: PaidPublishBlock[] = [];
  if (!(DEDICATED_GENERATED_PROVENANCES as readonly string[]).includes(row.provenance ?? "")) blocks.push("NOT_DEDICATED_PAID");
  if (row.intent !== VIP_PREMIUM_INTENT) blocks.push("NOT_PAID_PASS_JOB");
  if (row.status !== "PENDING_REVIEW") blocks.push("NOT_PENDING_REVIEW");
  if (row.rewriteCount > 0) blocks.push("REWRITTEN");
  if (row.marketType === "SAME_GAME_DOUBLE") blocks.push("COMBO");
  if (row.marketType !== "SAME_GAME_DOUBLE" && row.categories.includes("SAME_GAME_DOUBLE")) blocks.push("HIDDEN_LEG");
  if (!fixture.ordinaryCovered) blocks.push("NOT_ORDINARY_COVERED");
  if (!(VIP_PROXY_LEAGUE_IDS as readonly number[]).includes(row.leagueApiId ?? -1)) blocks.push("OUT_OF_SCOPE");
  if (!row.contextComplete) blocks.push("NO_MATCH_CONTEXT");
  if (!row.categories.includes("VIP")) blocks.push("NOT_TAGGED_VIP");
  const tier = paidTierFor(verdict, row.confidence);
  if (!verdict.confirmed) blocks.push("GATE_FAILED");
  else if (!tier) blocks.push("BELOW_VIP_FLOOR");
  if (row.categories.includes("PREMIUM") && tier !== "PREMIUM") blocks.push("PREMIUM_NOT_EARNED");
  if (fixture.conflictingDedicated) blocks.push("CONFLICTING_DEDICATED_PICK");
  if (!fixture.withinDailyQuota) blocks.push("OVER_DAILY_QUOTA");
  return { publish: blocks.length === 0, blocks };
}

/**
 * The fixture facts paidAutoPublishVerdict needs, from the live (not archived)
 * rows on the fixture and its ledger status. Pure. Goals rows and dedicated
 * rows are not ordinary coverage.
 */
export function paidPublishFixture(
  self: { id: string },
  ledgerStatus: string | null,
  rows: ReadonlyArray<{ id: string; provenance: string | null }>,
  withinDailyQuota: boolean,
): PaidPublishFixture {
  const others = rows.filter((r) => r.id !== self.id);
  return {
    ordinaryCovered: ledgerStatus === "SUCCEEDED" && others.some((r) => r.provenance !== GOALS_GENERATED_PROVENANCE && !isDedicatedPaid(r.provenance)),
    conflictingDedicated: others.some((r) => isDedicatedPaid(r.provenance)),
    withinDailyQuota,
  };
}

/** Provenances only this pass stamps (MARKET_CONFIRMED is the retired pass's, never auto-published). */
export const DEDICATED_GENERATED_PROVENANCES = [VIP_GENERATED_PROVENANCE, PREMIUM_GENERATED_PROVENANCE] as const;

/** The VIP_PREMIUM-intent fields of a stored AIJob prompt, or null for any other job. */
export function readVipPremiumAttempt(prompt: string, createdAt: Date): OverlayAttempt | null {
  try {
    const p = JSON.parse(prompt);
    if (p?.intent !== VIP_PREMIUM_INTENT) return null;
    return { fixtureApiId: typeof p.fixtureApiId === "number" ? p.fixtureApiId : null, createdAt };
  } catch {
    return null;
  }
}
