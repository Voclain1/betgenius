import { GENERATION_TIERS, isSeniorWomensCompetition, leaguePriorityRank } from "@/lib/leagues";
import { VIP_PROXY_LEAGUE_IDS } from "@/lib/ai/generationRisk";
import { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS, SAME_DAY_GENERATE_FROM_HOURS } from "@/lib/generation/window";
import type { FixtureOdds } from "@/lib/odds";
import {
  lopsidednessSignal,
  MC_MAX_QUOTE_AGE_MS,
  MC_MIN_MARKET_PROBABILITY,
  MC_MIN_MODEL_CONFIDENCE,
} from "@/lib/marketConfirmed";
import {
  DEDICATED_PAID_PROVENANCES,
  PAID_ONLY_PROVENANCES,
  PREMIUM_CONFIDENCE_FLOOR,
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

// ── Scope ────────────────────────────────────────────────────────────────────

/**
 * The competitions this pass always considers.
 *
 * Stated explicitly rather than read as "the first twelve of the priority
 * order" (VIP_PROXY_LEAGUE_IDS). That proxy still decides ordinary
 * generation's calibration route and ordinary VIP curation, unchanged. But the
 * comment beside it promised the European club competitions, and the slice
 * actually holds the big five's domestic cups instead, so a Champions League
 * night never reached this pass. Here the proxy twelve are joined by UCL, UEL,
 * UECL, the World Cup and the Euros.
 */
export const PAID_CORE_LEAGUE_IDS: readonly number[] = [...new Set([...VIP_PROXY_LEAGUE_IDS, 2, 3, 848, 1, 4])];

/**
 * National-team competitions: the Nations League and the World Cup / Euro
 * qualifiers (GENERATION_TIERS.FALLBACK's international-break slate, minus
 * friendlies, which field experimental sides the books price loosely).
 */
export const PAID_NATIONAL_TEAM_LEAGUE_IDS: readonly number[] = [5, 32, 960, 34, 29, 36];

/**
 * Where the pass may look when the core is thin: the men's SECONDARY leagues
 * plus national-team competitions. Senior women's leagues are left out — their
 * books are thinner and their quotes rarely reach MC_MIN_BOOKMAKERS.
 *
 * WHY. Under FIFA's merged autumn window (21 Sep – 6 Oct 2026) the core had no
 * fixtures for two weeks and VIP/PREMIUM carried nothing, while ordinary
 * generation had already widened (generation/coverage.ts). Nothing about the
 * BAR changes for these fixtures: the same fresh quote, books, market floors,
 * model floors and gap apply. The league list was only ever a proxy for "the
 * market prices this well"; the gate checks that directly.
 */
export const PAID_WIDENED_LEAGUE_IDS: readonly number[] = [
  ...(GENERATION_TIERS.SECONDARY as readonly number[]).filter((id) => !isSeniorWomensCompetition(id)),
  ...PAID_NATIONAL_TEAM_LEAGUE_IDS,
].filter((id) => !PAID_CORE_LEAGUE_IDS.includes(id));

/** Every competition a dedicated paid pick may come from, core or widened. */
export const PAID_ANY_LEAGUE_IDS: readonly number[] = [...PAID_CORE_LEAGUE_IDS, ...PAID_WIDENED_LEAGUE_IDS];

/**
 * Fewer covered core fixtures than this inside the window and the pass widens.
 * Re-decided on every run from the ledger, like adaptive coverage, so there is
 * no break mode to switch off: once the core is back it stops widening.
 * 3 is half the measured ~6.4 paid-eligible fixtures on a normal day.
 */
export const PAID_THIN_CORE_MIN = 3;

export type PaidScope = { leagueIds: ReadonlySet<number>; widened: boolean; coreFixtures: number };

/** Which competitions this run may target, from the covered ledger rows inside the window. Pure. */
export function paidScopeFor(ledger: ReadonlyArray<{ leagueApiId: number | null; kickoff: Date; status: string }>, now: Date): PaidScope {
  const coreFixtures = ledger.filter(
    (l) => l.status === "SUCCEEDED" && inVipPremiumWindow(l.kickoff, now) && PAID_CORE_LEAGUE_IDS.includes(l.leagueApiId ?? -1),
  ).length;
  const widened = coreFixtures < PAID_THIN_CORE_MIN;
  return { leagueIds: new Set(widened ? PAID_ANY_LEAGUE_IDS : PAID_CORE_LEAGUE_IDS), widened, coreFixtures };
}

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
  | "OUT_OF_SCOPE" // not in this run's paid scope (paidScopeFor)
  | "NOT_YET_GENERATED" // the ledger row is not SUCCEEDED, or no ordinary row exists yet
  | "NO_MATCH_CONTEXT"
  | "HAS_DEDICATED_PAID" // a live dedicated paid row already exists: one paid pick per fixture
  | "ALREADY_ATTEMPTED" // this pass already spent a model call on it
  | "BACKING_OFF";

export type OverlayPlan = {
  candidates: OverlayCandidate[];
  considered: number;
  skipped: Partial<Record<OverlaySkipReason, number>>;
  /** The core was thin, so this run also looked at PAID_WIDENED_LEAGUE_IDS. */
  widened: boolean;
  /** Covered core fixtures inside the window — what decided `widened`. */
  coreFixtures: number;
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
  /** This run's competitions. Defaults to paidScopeFor(ledger, now). */
  scope?: PaidScope;
  /** VERIFICATION ONLY (scripts/verify-vip-premium-pass.ts): drops the paid-scope restriction. */
  anyLeague?: boolean;
}): OverlayPlan {
  const skipped: OverlayPlan["skipped"] = {};
  const skip = (r: OverlaySkipReason) => (skipped[r] = (skipped[r] ?? 0) + 1);

  const scope = input.scope ?? paidScopeFor(input.ledger, input.now);
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
    if (!input.anyLeague && !scope.leagueIds.has(l.leagueApiId ?? -1)) { skip("OUT_OF_SCOPE"); continue; }
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
  return { candidates, considered: input.ledger.length, skipped, widened: scope.widened, coreFixtures: scope.coreFixtures };
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

// ── Ordinary picks as a fallback ─────────────────────────────────────────────

/**
 * Fixtures whose paid slot still belongs to the dedicated pass, so ordinary
 * curation must not fill it yet. Pure.
 *
 * An ordinary pick in VIP/PREMIUM is a pick a free reader can also see. That
 * overlap is allowed only as a FALLBACK: once the dedicated pass has had its
 * chance at the fixture and found no distinct, lower-risk pick worth carrying.
 * Until then the slot waits. A fixture is still the pass's when it is in the
 * paid core and either
 *
 *   - it has not been attempted and is still more than GENERATE_FROM_HOURS
 *     from kickoff, i.e. inside (or ahead of) the pass's window; or
 *   - a dedicated draft for it is still in review (held for a fresh quote, or
 *     promoted and waiting to publish) and kickoff is more than
 *     SAME_DAY_GENERATE_FROM_HOURS away.
 *
 * After that — attempted with nothing promoted, or the window simply closed
 * because the market never priced a qualifying selection — ordinary curation
 * may fill the slot under its own floors, as before.
 */
export function fixturesAwaitingDedicated(input: {
  rows: ReadonlyArray<{ id: string; leagueApiId: number | null; kickoff: Date | null; fixtureApiId: number | null; homeTeamApiId: number | null; awayTeamApiId: number | null }>;
  attemptedFixtureApiIds: ReadonlySet<number>;
  /** paidFixtureKey()s with a dedicated draft still in review. */
  openDraftKeys: ReadonlySet<string>;
  now: Date;
}): Set<string> {
  const awaiting = new Set<string>();
  for (const r of input.rows) {
    if (!r.kickoff || !PAID_CORE_LEAGUE_IDS.includes(r.leagueApiId ?? -1)) continue;
    const key = paidFixtureKey(r);
    const untilKickoff = r.kickoff.getTime() - input.now.getTime();
    const attempted = r.fixtureApiId != null && input.attemptedFixtureApiIds.has(r.fixtureApiId);
    if (!attempted && untilKickoff > GENERATE_FROM_HOURS * 3_600_000) awaiting.add(key);
    else if (input.openDraftKeys.has(key) && untilKickoff > SAME_DAY_GENERATE_FROM_HOURS * 3_600_000) awaiting.add(key);
  }
  return awaiting;
}

// ── Distinct picks ───────────────────────────────────────────────────────────

const stable = (v: unknown): string =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
    : JSON.stringify(v ?? null);

/** The same bet: same market type and the same structured selection (key order ignored). Pure. */
export function sameSelection(
  a: { marketType: string; selection: unknown },
  b: { marketType: string; selection: unknown },
): boolean {
  return a.marketType === b.marketType && stable(a.selection) === stable(b.selection);
}

/**
 * Does this paid draft repeat a selection another row on its fixture already
 * carries? A paid pick is its own pick: it never re-sells a selection a reader
 * can already see in a free feed, a Banker or inside a free double. Dedicated
 * paid rows are ignored here; one-paid-pick-per-fixture handles those.
 */
export function repeatsExistingPick(
  draft: { id: string; marketType: string; selection: unknown },
  onFixture: ReadonlyArray<{ id: string; provenance: string | null; marketType: string; selection: unknown }>,
): boolean {
  return onFixture.some((r) => r.id !== draft.id && !isDedicatedPaid(r.provenance) && sameSelection(r, draft));
}

// ── Tiering ──────────────────────────────────────────────────────────────────

/**
 * A paid pick must still be worth backing: its fair odds (100 / the de-vigged
 * market probability) must be at least this. 1.15 fair is a bookmaker price of
 * about 1.10 after the margin. Above ~87% the market calls it a near-formality —
 * double chance on an overwhelming favourite at 1.03 — and selling that as a
 * paid pick would be safety with nothing in it for the subscriber.
 *
 * It narrows the tiers to a band: VIP 75–87% market, PREMIUM 80–87%. A fixture
 * whose only confirmable selections are shorter than this gets no dedicated
 * pick, which is exactly the case where an ordinary pick may stand in for it
 * (see the fallback rule in geniusCuration.ts).
 */
export const PAID_MIN_FAIR_ODDS = 1.15;
export const PAID_MAX_MARKET_PROBABILITY = 100 / PAID_MIN_FAIR_ODDS;

/** True when the market prices this selection too short to carry as a paid pick. */
export function tooShortForPaid(marketProbability: number | null | undefined): boolean {
  return (marketProbability ?? 0) > PAID_MAX_MARKET_PROBABILITY;
}

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
  if (tooShortForPaid(verdict.marketProbability)) return null;
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
  | "REPEATS_EXISTING_PICK" // the same selection is already live on the fixture as a non-paid pick
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
  /** A live non-paid row on the fixture already carries this exact selection. */
  repeatsExisting: boolean;
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
  // The widest scope the pass can ever target. Whether THIS day was thin is a
  // targeting decision, already taken; a pick generated on a thin day is not
  // un-published because the core filled up before its publish ran.
  if (!PAID_ANY_LEAGUE_IDS.includes(row.leagueApiId ?? -1)) blocks.push("OUT_OF_SCOPE");
  if (!row.contextComplete) blocks.push("NO_MATCH_CONTEXT");
  if (!row.categories.includes("VIP")) blocks.push("NOT_TAGGED_VIP");
  const tier = paidTierFor(verdict, row.confidence);
  if (!verdict.confirmed) blocks.push("GATE_FAILED");
  else if (!tier) blocks.push("BELOW_VIP_FLOOR");
  if (row.categories.includes("PREMIUM") && tier !== "PREMIUM") blocks.push("PREMIUM_NOT_EARNED");
  if (fixture.conflictingDedicated) blocks.push("CONFLICTING_DEDICATED_PICK");
  if (fixture.repeatsExisting) blocks.push("REPEATS_EXISTING_PICK");
  if (!fixture.withinDailyQuota) blocks.push("OVER_DAILY_QUOTA");
  return { publish: blocks.length === 0, blocks };
}

/**
 * The fixture facts paidAutoPublishVerdict needs, from the live (not archived)
 * rows on the fixture and its ledger status. Pure. Goals rows and dedicated
 * rows are not ordinary coverage.
 */
export function paidPublishFixture(
  self: { id: string; marketType: string; selection: unknown },
  ledgerStatus: string | null,
  rows: ReadonlyArray<{ id: string; provenance: string | null; marketType: string; selection: unknown }>,
  withinDailyQuota: boolean,
): PaidPublishFixture {
  const others = rows.filter((r) => r.id !== self.id);
  return {
    ordinaryCovered: ledgerStatus === "SUCCEEDED" && others.some((r) => r.provenance !== GOALS_GENERATED_PROVENANCE && !isDedicatedPaid(r.provenance)),
    conflictingDedicated: others.some((r) => isDedicatedPaid(r.provenance)),
    repeatsExisting: repeatsExistingPick(self, others),
    withinDailyQuota,
  };
}

/** Provenances only this pass stamps (MARKET_CONFIRMED is the retired pass's, never auto-published). */
export const DEDICATED_GENERATED_PROVENANCES = PAID_ONLY_PROVENANCES;

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
