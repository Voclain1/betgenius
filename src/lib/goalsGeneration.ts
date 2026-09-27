import { GOALS, isGoalsPrediction, withGoalsCategory } from "@/lib/goalsCategory";
import { scanDraftForCertainty } from "@/lib/certaintyLanguage";
import { scanDraftForInternalTerminology } from "@/lib/houseVoice";
import { LEAGUE_CATALOGUE, leaguePriorityRank, normalizeLeagueName } from "@/lib/leagues";
import { lagosDateKey } from "@/lib/lagosDate";
import { matchKey } from "@/lib/slug";
import { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS, SAME_DAY_GENERATE_FROM_HOURS } from "@/lib/generation/window";

/**
 * The dedicated Goals generation pass: pure rules. No database, no network —
 * the DB reads live in src/lib/goalsPipeline.ts and the run in
 * src/lib/generation/worker.ts (runGoalsGeneration).
 *
 * WHY A DEDICATED PASS. Audited 12–25 Sep 2026, ordinary generation supplied
 * 2.7 public Over 2.5 singles a day (0.2/day over the last five days, as
 * adaptive combos took most fixtures) and no Over 1.5 single at all: the base
 * prompt's only O/U example is line 2.5. Hidden combo legs carry plenty of
 * both, but they stay hidden — they are settlement inputs, not picks.
 *
 * WHY ADDITIVE, NOT FIRST-IN-LINE. The generation ledger treats a fixture as
 * done the moment it has ANY prediction, so a pass that claims PENDING
 * fixtures ahead of ordinary generation does not share the pool — it removes
 * fixtures from it, leaving each one with a single Goals pick and nothing else.
 * It also has to win a race: ordinary generation claims a queued fixture a
 * median 23 minutes after discovery, and the VIP/PREMIUM pass, built exactly
 * that way, has seen 0 in-scope PENDING fixtures on every one of 681 runs.
 *
 * So this pass only targets fixtures ordinary generation has ALREADY covered
 * (ledger SUCCEEDED, with ordinary rows present), and adds one standalone pick
 * to each. It never reads or writes a PENDING ledger row, so it cannot consume
 * an ordinary fixture and cannot be starved by ordering: before or after
 * ordinary generation, its pool is the same. Replayed over the same 14 days
 * that pool held a mean of 54 eligible fixtures a day (min 4, on the 21 Sep
 * outage; under 8 on that day only).
 *
 * QUALITY. The fixture's existing rows prove the evidence exists: a row
 * generated with live match context, under a catalogued competition. Odds are
 * NOT required — Bet of the Day's price gate has found 0 priced candidates on
 * every recent run, and a dedicated pass that depends on them starves the same
 * way.
 */

/** Recorded on AIJob.prompt, which is how attempts are counted. */
export const GOALS_INTENT = "GOALS" as const;

/**
 * Stamped on rows this pass generates, so a row carries how it was made. Also
 * keeps it out of VIP/PREMIUM curation, which newly selects only VIP-route or
 * dedicated-paid rows: a goals pick was not generated to be sold as a paid one.
 */
export const GOALS_GENERATED_PROVENANCE = "GOALS_GENERATED" as const;

/**
 * Attempts per Lagos KICKOFF day, not per creation day: the feed is browsed by
 * kickoff day, and a creation-day quota could spend a whole day's budget on
 * tomorrow's card and leave today's empty. An attempt is an AIJob, counted
 * whether or not it produced a row — a job that returned no justified pick
 * still spent its call.
 */
export const GOALS_PER_KICKOFF_DAY = 8;

/**
 * Hard ceiling on AI calls per Lagos creation day. With a 48h window up to
 * three kickoff days can be open at once; this stops a catch-up day (after an
 * outage, say) spending three days' budget in one.
 */
export const GOALS_DAILY_SPEND_CEILING = 12;

/**
 * A draft below this confidence is discarded, not persisted.
 *
 * Measured, not chosen: over the same window, published Over 2.5 picks
 * (singles and hidden legs, settled) struck 53–56% below 70 (n=41) and ~80% at
 * 70 and above (n=81). It is also GENIUS_CONFIDENCE_FLOOR, so a Goals pick is
 * held to the free tier's existing bar rather than a new one.
 */
export const GOALS_MIN_CONFIDENCE = 70;

/** One fixture per run: a run's soft deadline (22s) fits one generation, as for ordinary runs. */
export const GOALS_RUN_LIMIT = 1;

/** How long a fixture whose generation threw is left alone before this pass retries it. */
export const GOALS_RETRY_BACKOFF_MS = 6 * 3_600_000;

/** Key prefix for that backoff in AppLock — the same lease table the generation run uses. */
export const GOALS_BACKOFF_LOCK_PREFIX = "goals-retry:";

/** The only persisted categories a Goals draft gets: GOALS itself, never FEATURED. */
export const GOALS_PERSISTED_CATEGORIES = [GOALS] as const;

// ── Draft filtering ─────────────────────────────────────────────────────────

export type GoalsDraft = { marketType: string; selection: unknown; confidence: number };
export type GoalsDraftRejection = {
  marketType: string;
  selection: unknown;
  confidence: number;
  reason: "NOT_A_GOALS_MARKET" | "BELOW_CONFIDENCE_FLOOR" | "EXTRA_PICK";
};

/** Confidence as generate.ts persists it, so the floor compares the stored number. */
const persistedConfidence = (c: number) => Math.min(90, Math.max(0, Math.round(Number(c) || 0)));

/**
 * At most ONE draft survives, and only an Over 1.5 / Over 2.5 total-goals call
 * at or above the floor.
 *
 * The prompt asks for exactly this, but a prompt alone has already proven
 * insufficient in this codebase (the certainty scan, TEAM_TOTAL lines and the
 * handicap line are all enforced after parsing for that reason). This is the
 * structural guarantee: an Under, a 3.5, a team total, BTTS, a result market or
 * a double cannot be persisted by this pass whatever the model returns.
 *
 * One pick per fixture because the two lines nest — Over 2.5 winning implies
 * Over 1.5 — so a pair would be one call stated twice. The highest-confidence
 * qualifying draft wins; ties keep the model's own order.
 */
export function pickGoalsDraft<T extends GoalsDraft>(drafts: readonly T[]): { pick: T | null; rejected: GoalsDraftRejection[] } {
  const rejected: GoalsDraftRejection[] = [];
  const reject = (d: T, reason: GoalsDraftRejection["reason"]) =>
    rejected.push({ marketType: d.marketType, selection: d.selection, confidence: persistedConfidence(d.confidence), reason });
  const eligible: T[] = [];
  for (const d of drafts) {
    if (!isGoalsPrediction(d.marketType, d.selection)) reject(d, "NOT_A_GOALS_MARKET");
    else if (persistedConfidence(d.confidence) < GOALS_MIN_CONFIDENCE) reject(d, "BELOW_CONFIDENCE_FLOOR");
    else eligible.push(d);
  }
  let pick: T | null = null;
  for (const d of eligible) if (!pick || persistedConfidence(d.confidence) > persistedConfidence(pick.confidence)) pick = d;
  for (const d of eligible) if (d !== pick) reject(d, "EXTRA_PICK");
  return { pick, rejected };
}

// ── Target planning ─────────────────────────────────────────────────────────

/** A GenerationAttempt row. Only SUCCEEDED rows are ever targets. */
export type GoalsLedgerRow = {
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

/** An existing prediction on a fixture in the window. */
export type GoalsExistingRow = {
  fixtureApiId: number | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: Date | null;
  status: string;
  marketType: string;
  contextComplete: boolean;
  provenance: string | null;
  categories: string[];
};

/** A previous Goals-intent AIJob, read from its stored prompt. */
export type GoalsAttempt = { fixtureApiId: number | null; kickoff: Date | null; createdAt: Date };

export type GoalsTarget = {
  matchKey: string;
  fixtureApiId: number;
  leagueApiId: number;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number;
  awayTeamApiId: number;
  kickoff: Date;
  round: string | null;
};

export type GoalsSkipReason =
  | "OUTSIDE_WINDOW"
  | "NOT_YET_GENERATED" // ordinary generation has not covered it: the ledger row is not SUCCEEDED, or it has no ordinary row
  | "NO_MATCH_CONTEXT"
  | "NO_COMPETITION"
  | "HAS_STANDALONE_TOTAL_GOALS" // a public (or about-to-be-public) O/U single already exists — Over, Under, any line
  | "ALREADY_ATTEMPTED"
  | "BACKING_OFF"
  | "KICKOFF_DAY_FULL";

export type GoalsPlan = {
  targets: GoalsTarget[];
  considered: number;
  skipped: Partial<Record<GoalsSkipReason, number>>;
  spentToday: number;
  /** Attempts already made, per Lagos kickoff day, before this plan. */
  attemptsByKickoffDay: Record<string, number>;
  stoodDown: string | null;
};

const SAME_GAME_DOUBLE = "SAME_GAME_DOUBLE";
const LIVE_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED"]);

/** A combo's hidden source leg: a settlement input, never a public pick. */
const isHiddenLeg = (r: GoalsExistingRow) => r.categories.includes(SAME_GAME_DOUBLE) && r.marketType !== SAME_GAME_DOUBLE;

/** The same kickoff window ordinary generation uses (see candidatesFromFixtures). */
export function inGoalsWindow(kickoff: Date, now: Date): boolean {
  const k = kickoff.getTime();
  if (Number.isNaN(k)) return false;
  if (k < now.getTime() + SAME_DAY_GENERATE_FROM_HOURS * 3_600_000) return false;
  if (k > now.getTime() + GENERATE_UNTIL_HOURS * 3_600_000) return false;
  return lagosDateKey(kickoff) === lagosDateKey(now) || k >= now.getTime() + GENERATE_FROM_HOURS * 3_600_000;
}

function realLeagueName(leagueApiId: number | null, discovered: string | null): string | null {
  if (leagueApiId == null) return null;
  return normalizeLeagueName(LEAGUE_CATALOGUE.find((l) => l.id === leagueApiId)?.name) ?? normalizeLeagueName(discovered);
}

/**
 * Which fixtures this run may generate a Goals pick for.
 *
 * Pure so the rules — additive only, deduplicated, capped per kickoff day and
 * per spend day — are pinned without a database. Order matches the ordinary
 * selector: today's fixtures first, then competition priority, then kickoff.
 */
export function planGoalsTargets(input: {
  ledger: readonly GoalsLedgerRow[];
  rows: readonly GoalsExistingRow[];
  attempts: readonly GoalsAttempt[];
  backingOff?: ReadonlySet<number>;
  now: Date;
  limit: number;
}): GoalsPlan {
  const { now } = input;
  const today = lagosDateKey(now);
  const skipped: GoalsPlan["skipped"] = {};
  const skip = (r: GoalsSkipReason) => (skipped[r] = (skipped[r] ?? 0) + 1);

  const spentToday = input.attempts.filter((a) => lagosDateKey(a.createdAt) === today).length;
  const attemptsByKickoffDay: Record<string, number> = {};
  const attempted = new Set<number>();
  for (const a of input.attempts) {
    if (a.fixtureApiId != null) attempted.add(a.fixtureApiId);
    if (a.kickoff) {
      const day = lagosDateKey(a.kickoff);
      attemptsByKickoffDay[day] = (attemptsByKickoffDay[day] ?? 0) + 1;
    }
  }
  const base = { considered: input.ledger.length, skipped, spentToday, attemptsByKickoffDay };
  if (spentToday >= GOALS_DAILY_SPEND_CEILING) {
    return { ...base, targets: [], stoodDown: `daily Goals spend ceiling reached (${spentToday}/${GOALS_DAILY_SPEND_CEILING})` };
  }

  // Existing rows per fixture: by provider id, falling back to the team/day key
  // for rows that predate fixtureApiId.
  const byFixture = new Map<string, GoalsExistingRow[]>();
  for (const r of input.rows) {
    if (!LIVE_STATUSES.has(r.status)) continue;
    const keys = [r.fixtureApiId != null ? `f${r.fixtureApiId}` : null, matchKey(r)].filter((k): k is string => !!k);
    for (const k of keys) (byFixture.get(k) ?? byFixture.set(k, []).get(k)!).push(r);
  }

  const eligible: GoalsTarget[] = [];
  for (const l of input.ledger) {
    if (!inGoalsWindow(l.kickoff, now)) { skip("OUTSIDE_WINDOW"); continue; }
    const rows = [...new Set([...(l.fixtureApiId != null ? byFixture.get(`f${l.fixtureApiId}`) ?? [] : []), ...(byFixture.get(l.matchKey) ?? [])])];
    const ordinary = rows.filter((r) => r.provenance !== GOALS_GENERATED_PROVENANCE);
    if (l.status !== "SUCCEEDED" || l.fixtureApiId == null || ordinary.length === 0) { skip("NOT_YET_GENERATED"); continue; }
    if (!ordinary.some((r) => r.contextComplete)) { skip("NO_MATCH_CONTEXT"); continue; }
    const leagueName = realLeagueName(l.leagueApiId, l.leagueName);
    if (!leagueName || l.leagueApiId == null) { skip("NO_COMPETITION"); continue; }
    if (rows.some((r) => r.marketType === "OVER_UNDER" && !isHiddenLeg(r)) || rows.some((r) => r.provenance === GOALS_GENERATED_PROVENANCE)) {
      skip("HAS_STANDALONE_TOTAL_GOALS");
      continue;
    }
    if (attempted.has(l.fixtureApiId)) { skip("ALREADY_ATTEMPTED"); continue; }
    if (input.backingOff?.has(l.fixtureApiId)) { skip("BACKING_OFF"); continue; }
    const [homeId, awayId] = l.matchKey.split("-").map(Number);
    if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) { skip("NOT_YET_GENERATED"); continue; }
    eligible.push({
      matchKey: l.matchKey, fixtureApiId: l.fixtureApiId, leagueApiId: l.leagueApiId, leagueName,
      homeTeam: l.homeTeam, awayTeam: l.awayTeam, homeTeamApiId: homeId, awayTeamApiId: awayId,
      kickoff: l.kickoff, round: l.round,
    });
  }

  eligible.sort((a, b) =>
    Number(lagosDateKey(a.kickoff) !== today) - Number(lagosDateKey(b.kickoff) !== today) ||
    leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
    a.kickoff.getTime() - b.kickoff.getTime() ||
    a.matchKey.localeCompare(b.matchKey),
  );

  const budget = Math.min(input.limit, GOALS_DAILY_SPEND_CEILING - spentToday);
  const perDay = { ...attemptsByKickoffDay };
  const targets: GoalsTarget[] = [];
  for (const t of eligible) {
    const day = lagosDateKey(t.kickoff);
    if ((perDay[day] ?? 0) >= GOALS_PER_KICKOFF_DAY) { skip("KICKOFF_DAY_FULL"); continue; }
    if (targets.length >= budget) break;
    perDay[day] = (perDay[day] ?? 0) + 1;
    targets.push(t);
  }
  return { ...base, targets, stoodDown: null };
}

/** The Goals-intent fields of a stored AIJob prompt, or null for any other job. */
export function readGoalsAttempt(prompt: string, createdAt: Date): GoalsAttempt | null {
  try {
    const p = JSON.parse(prompt);
    if (p?.intent !== GOALS_INTENT) return null;
    const kickoff = p.kickoff ? new Date(p.kickoff) : null;
    return {
      fixtureApiId: typeof p.fixtureApiId === "number" ? p.fixtureApiId : null,
      kickoff: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff : null,
      createdAt,
    };
  } catch {
    return null;
  }
}

// ── Automatic publication ──────────────────────────────────────────────────

/**
 * Why a Goals-pass row may NOT be published without a human. Every one is a
 * fresh check against the row as persisted and the fixture as it stands at
 * publish time — nothing is taken on trust from the generation step, because
 * the point of the gate is that the feed can be filled without anyone looking.
 */
export type GoalsPublishBlock =
  | "NOT_GOALS_GENERATED"
  | "NOT_PENDING_REVIEW"
  | "REWRITTEN"
  | "COMBO"
  | "HIDDEN_LEG"
  | "NOT_GOALS_MARKET"
  | "BELOW_CONFIDENCE_FLOOR"
  | "NOT_TAGGED_GOALS"
  | "NO_MATCH_CONTEXT"
  | "NO_COMPETITION"
  | "NOT_ORDINARY_COVERED"
  | "DUPLICATE_TOTAL_GOALS";

export type GoalsPublishRow = {
  status: string;
  provenance: string | null;
  marketType: string;
  selection: unknown;
  confidence: number;
  contextComplete: boolean;
  leagueApiId: number | null;
  leagueName: string | null;
  rewriteCount: number;
  categories: string[];
};

export type GoalsPublishFixture = {
  /** The fixture's ledger row is SUCCEEDED and it holds at least one non-Goals, non-archived row. */
  ordinaryCovered: boolean;
  /** Another live (not archived), standalone — not hidden-leg — O/U row exists on the fixture. */
  otherStandaloneTotalGoals: boolean;
};

/**
 * May this row go public with no reviewer?
 *
 * Only a Goals-pass row, only in review and never rewritten (a rewrite is a
 * human asking for another draft, so a human should publish it), never a
 * double or a hidden leg, only a structured Over 1.5 / Over 2.5 at or above
 * the floor that already carries the derived GOALS tag, generated with live
 * match data under a catalogued competition, on a fixture ordinary generation
 * already covered, with no other standalone total-goals row beside it.
 *
 * Validation failures (certainty language, house voice) never reach this: they
 * throw inside generation before anything is persisted.
 */
export function goalsAutoPublishVerdict(row: GoalsPublishRow, fixture: GoalsPublishFixture): { publish: boolean; blocks: GoalsPublishBlock[] } {
  const blocks: GoalsPublishBlock[] = [];
  if (row.provenance !== GOALS_GENERATED_PROVENANCE) blocks.push("NOT_GOALS_GENERATED");
  if (row.status !== "PENDING_REVIEW") blocks.push("NOT_PENDING_REVIEW");
  if (row.rewriteCount > 0) blocks.push("REWRITTEN");
  if (row.marketType === SAME_GAME_DOUBLE) blocks.push("COMBO");
  if (row.categories.includes(SAME_GAME_DOUBLE) && row.marketType !== SAME_GAME_DOUBLE) blocks.push("HIDDEN_LEG");
  if (!isGoalsPrediction(row.marketType, row.selection)) blocks.push("NOT_GOALS_MARKET");
  if (!(row.confidence >= GOALS_MIN_CONFIDENCE)) blocks.push("BELOW_CONFIDENCE_FLOOR");
  if (!row.categories.includes(GOALS)) blocks.push("NOT_TAGGED_GOALS");
  if (!row.contextComplete) blocks.push("NO_MATCH_CONTEXT");
  if (!realLeagueName(row.leagueApiId, row.leagueName)) blocks.push("NO_COMPETITION");
  if (!fixture.ordinaryCovered) blocks.push("NOT_ORDINARY_COVERED");
  if (fixture.otherStandaloneTotalGoals) blocks.push("DUPLICATE_TOTAL_GOALS");
  return { publish: blocks.length === 0, blocks };
}

/** The fixture facts goalsAutoPublishVerdict needs, from the rows on it. Pure. */
export function goalsPublishFixture(
  self: { id: string },
  ledgerStatus: string | null,
  rows: ReadonlyArray<{ id: string; status: string; marketType: string; provenance: string | null; categories: string[] }>,
): GoalsPublishFixture {
  const others = rows.filter((r) => r.id !== self.id && LIVE_STATUSES.has(r.status));
  return {
    ordinaryCovered: ledgerStatus === "SUCCEEDED" && others.some((r) => r.provenance !== GOALS_GENERATED_PROVENANCE),
    // An O/U row carrying SAME_GAME_DOUBLE is a hidden leg: not public supply.
    otherStandaloneTotalGoals: others.some((r) => r.marketType === "OVER_UNDER" && !r.categories.includes(SAME_GAME_DOUBLE)),
  };
}

// ── Probe evaluation ───────────────────────────────────────────────────────

export type GoalsProbeOutput = { matchPreview?: unknown; keyFactors?: unknown; predictions?: unknown };

/**
 * What a real Goals run would do with one model answer, for the dry-run probe
 * (probeGoalsFixture in src/lib/goalsPipeline.ts). Pure: the same draft gate,
 * the same two validation scans and the same publication verdict a real run
 * applies, over an answer the caller already has.
 *
 * Also the probe's redaction boundary: only these fields leave the server.
 * The model's structured answer and the verdicts — never the system prompt,
 * the user prompt or the evidence digest.
 */
export function evaluateGoalsProbe(input: {
  output: GoalsProbeOutput;
  leagueApiId: number | null;
  leagueName: string | null;
  contextComplete: boolean;
  fixture: GoalsPublishFixture;
}) {
  const drafts = (Array.isArray(input.output.predictions) ? input.output.predictions : []).filter(
    (p): p is GoalsDraft & { reasoning?: unknown; overUnderLine?: unknown; overUnderDirection?: unknown } => !!p && typeof p === "object",
  );
  const matchPreview = typeof input.output.matchPreview === "string" ? input.output.matchPreview : null;
  const keyFactors = Array.isArray(input.output.keyFactors) ? input.output.keyFactors.filter((k): k is string => typeof k === "string") : [];
  const { pick, rejected } = pickGoalsDraft(drafts);
  const reasoning = pick && typeof pick.reasoning === "string" ? pick.reasoning : "";
  const scan = { matchPreview, keyFactors, reasoning };
  const certaintyViolations = scanDraftForCertainty(scan).length;
  const houseVoiceViolations = scanDraftForInternalTerminology(scan).length;
  const wouldPersist = !!pick && certaintyViolations === 0 && houseVoiceViolations === 0;
  const confidence = pick ? persistedConfidence(pick.confidence) : 0;
  const verdict = pick
    ? goalsAutoPublishVerdict(
        {
          status: "PENDING_REVIEW", provenance: GOALS_GENERATED_PROVENANCE, marketType: pick.marketType, selection: pick.selection,
          confidence, contextComplete: input.contextComplete, leagueApiId: input.leagueApiId, leagueName: input.leagueName,
          rewriteCount: 0, categories: withGoalsCategory([GOALS], pick),
        },
        input.fixture,
      )
    : { publish: false, blocks: ["NOT_GOALS_MARKET" as GoalsPublishBlock] };
  return {
    output: {
      matchPreview,
      keyFactors,
      predictions: drafts.map((p) => ({
        marketType: p.marketType, selection: p.selection, confidence: p.confidence,
        overUnderLine: p.overUnderLine, overUnderDirection: p.overUnderDirection, reasoning: p.reasoning,
      })),
    },
    gate: {
      kept: pick ? { marketType: pick.marketType, selection: pick.selection, confidence } : null,
      rejected,
      certaintyViolations,
      houseVoiceViolations,
      /** What a real run would do with this answer. */
      wouldPersist,
      wouldAutoPublish: wouldPersist && verdict.publish,
      publishBlocks: verdict.blocks,
    },
  };
}
