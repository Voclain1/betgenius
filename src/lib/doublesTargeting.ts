import { prisma } from "@/lib/prisma";
import { lagosTodayBounds, lagosDateKey } from "@/lib/lagosDate";
import { matchKey } from "@/lib/slug";
import type { DayPoolEntry } from "@/lib/comboQuota";

/**
 * Multi-market generation inside the regular prediction mix.
 *
 * The source legs are stored under SAME_GAME_DOUBLE only, keeping them out of
 * public feeds. One compatible compound row is assembled immediately and is
 * tagged SAME_GAME_DOUBLE plus any category the run was explicitly asked for
 * (none for the ordinary scheduled run; see comboQuota.ts). That row follows
 * the same review and later automatic curation path as any other prediction.
 *
 * How many ordinary fixtures become combos is decided per kickoff day by
 * adaptiveComboTarget (src/lib/comboQuota.ts). DOUBLES_DAILY_QUOTA below is
 * the per-creation-day SPEND ceiling on top of that.
 *
 * Measured production cap: 20 x $0.0087 = about $0.17/day of model spend.
 * A fully cold digest is roughly 11 football calls, so the worst case is 220
 * calls/day (2.9% of the 7,500-call allowance). At the conservative 50-75%
 * compatibility yield this should create 10-15 reviewable doubles per day.
 */
export const DOUBLES_DAILY_QUOTA = 20;

export const SAME_GAME_DOUBLE = "SAME_GAME_DOUBLE" as const;
export const REGULAR_COMBO_INTENT = "REGULAR_COMBO" as const;

/**
 * How many doubles-intent generations have run today.
 *
 * Counted from AIJob.prompt, which stores the literal categories the job was
 * launched with, rather than from the resulting Prediction rows. Rows are the
 * wrong thing to count twice over: a doubles job creates two or three of them,
 * and a job that failed created none while still having spent its slot and its
 * money. The same reasoning and the same mechanism as
 * betOfTheDayGeneratedToday.
 */
export async function doublesGeneratedToday(now: Date = new Date()): Promise<number> {
  const { start, end } = lagosTodayBounds(now);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { prompt: true },
  });
  return jobs.filter((j) => {
    try {
      return isComboJobInput(JSON.parse(j.prompt));
    } catch {
      // A job whose prompt is unparseable cannot be proven to be a doubles
      // job, and counting it would silently eat somebody else's slot.
      return false;
    }
  }).length;
}

/** Remaining multi-market generations allowed today. */
export async function doublesQuotaRemaining(now: Date = new Date()): Promise<number> {
  return Math.max(0, DOUBLES_DAILY_QUOTA - (await doublesGeneratedToday(now)));
}

const isComboJobInput = (input: any) =>
  (input?.categories ?? []).includes(SAME_GAME_DOUBLE) || input?.intent === REGULAR_COMBO_INTENT;

/**
 * Per Lagos KICKOFF day: the eligible fixture pool that planComboAllocation
 * (src/lib/comboQuota.ts) sizes the combo target from and spreads its slots
 * across.
 *
 * Eligible = generation-ledger fixtures kicking off that day, not ABANDONED,
 * and inside the run's competition scope (`excludeLeagueApiIds` is the same
 * exclusion the worker applies, so fallback tiers held back on a strong day do
 * not inflate the count). A fixture is `generated` once its ledger row is
 * SUCCEEDED or any job has run for it, and `combo` when one of those jobs was a
 * combo job. Jobs are read from AIJob.prompt, attempts rather than rows,
 * exactly like doublesGeneratedToday. A job for a given kickoff can only have
 * been created within the 48h generation window before it, so four days of jobs
 * covers every day this is asked about.
 */
export async function loadComboDayPools(
  now: Date,
  excludeLeagueApiIds: readonly number[] = [],
): Promise<Map<string, DayPoolEntry[]>> {
  const { start } = lagosTodayBounds(now);
  const [attempts, jobs] = await Promise.all([
    prisma.generationAttempt.findMany({
      where: {
        kickoff: { gte: start },
        status: { not: "ABANDONED" },
        ...(excludeLeagueApiIds.length ? { leagueApiId: { notIn: [...excludeLeagueApiIds] } } : {}),
      },
      select: { matchKey: true, leagueApiId: true, kickoff: true, status: true },
    }),
    prisma.aIJob.findMany({
      where: { createdAt: { gte: new Date(start.getTime() - 4 * 86_400_000) } },
      select: { prompt: true },
    }),
  ]);

  const jobbed = new Set<string>();
  const comboKeys = new Set<string>();
  for (const j of jobs) {
    try {
      const input = JSON.parse(j.prompt);
      const key = matchKey({ homeTeamApiId: input?.homeTeamApiId, awayTeamApiId: input?.awayTeamApiId, kickoff: input?.kickoff });
      if (!key) continue;
      jobbed.add(key);
      if (isComboJobInput(input)) comboKeys.add(key);
    } catch {
      // Same stance as doublesGeneratedToday: unparseable is not provably a combo.
    }
  }

  const pools = new Map<string, DayPoolEntry[]>();
  for (const a of attempts) {
    const day = lagosDateKey(a.kickoff);
    const generated = a.status === "SUCCEEDED" || jobbed.has(a.matchKey);
    const pool = pools.get(day) ?? [];
    pool.push({ matchKey: a.matchKey, leagueApiId: a.leagueApiId, kickoff: a.kickoff, generated, combo: generated && comboKeys.has(a.matchKey) });
    pools.set(day, pool);
  }
  return pools;
}

/**
 * Whether a generation job should ask for several markets.
 *
 * Derived from the job's own intent rather than passed down through the queue,
 * for the same reason resolveGenerationRisk derives calibration from
 * categories: the caller already says what the job is FOR, and threading a
 * second parameter through every layer would let the two disagree.
 */
export function marketBreadthForCategories(categories: readonly string[], intent?: string | null): "single" | "multi" {
  // The dedicated VIP/PREMIUM pass also wants several markets per fixture, for
  // a different reason from doubles: the odds gate rejects most selections, so
  // a fixture that offers only one has exactly one chance to clear it. Its
  // intent is not a category — its rows are tagged VIP/PREMIUM only after they
  // pass — so it is matched here explicitly rather than through the category
  // list.
  //
  // The string is written out rather than imported from vipPremiumPipeline,
  // which imports generation/selector and would close an import cycle back
  // through here. MARKET_CONFIRMED is kept alongside it: the pass that used it
  // is retired, but leaving the arm costs nothing and removing it would silently
  // narrow any replay of an old job.
  if (intent === "VIP_PREMIUM" || intent === "MARKET_CONFIRMED") return "multi";
  if (intent === REGULAR_COMBO_INTENT) return "multi";
  return categories.includes(SAME_GAME_DOUBLE) ? "multi" : "single";
}

/**
 * The client-side ceiling this path is scheduled against.
 *
 * cron-job.org disconnects at 30s. That is the number the budget below is
 * derived from — not Vercel's 300s function limit, which is far larger and
 * never the binding constraint here.
 */
export const DOUBLES_CLIENT_BUDGET_MS = 30_000;

/**
 * Runway one doubles fixture needs, measured rather than guessed.
 *
 * Five real end-to-end runs came in at 20.3, 23.9, 24.6, 28.3 and 29.9s. The
 * cost splits into a near-constant ~15s of throttled api-football fetches
 * (11 calls to build the digest) and a model call of 6.8-13.2s — roughly
 * double a single-market call, which is expected since the job writes two or
 * three predictions' worth of reasoning.
 *
 * 27s is the observed spread rounded UP, not an average. Budgeting to the mean
 * would guarantee overruns on exactly the slow runs the budget exists to catch.
 */
export const DOUBLES_FIXTURE_COST_MS = 27_000;

/**
 * Stop STARTING doubles fixtures once this much of the run has elapsed.
 *
 * The honest limitation: with limit=1 this can never save the FIRST fixture —
 * at zero elapsed there is always runway, so the fixture starts and takes what
 * it takes. It bounds every fixture after the first, which is what makes a
 * limit>1 run safe rather than a gamble.
 *
 * That the first fixture can still exceed 30s is deliberate and safe, because
 * the work does not stop when the client hangs up: a request aborted at 5s was
 * verified to keep running and finish its rows a minute later. A reported
 * timeout on this route is cosmetic. The lease in worker.ts is what prevents a
 * retry from starting a duplicate alongside the run still in flight.
 */
export const DOUBLES_START_CUTOFF_MS = Math.max(0, DOUBLES_CLIENT_BUDGET_MS - DOUBLES_FIXTURE_COST_MS);

/**
 * How long a run may keep claiming new fixtures, given what it is generating.
 *
 * Doubles cost roughly twice a normal fixture, so they cannot share the
 * general 22s cutoff: at 22s elapsed a doubles fixture would be started with
 * 8s of client budget left and about 27s of work to do.
 */
export function startCutoffMsForCategories(
  categories: readonly string[],
  defaultCutoffMs: number,
  intent?: string | null,
): number {
  // Multi-market dedicated passes were measured SEPARATELY rather than assumed
  // to match: 26.8, 25.7, 23.6 and 24.3s per fixture, mean 25.1s. That is the
  // same regime as doubles — both ask for several markets and both pay the same
  // ~15s of throttled api-football fetches — so they take the same tight cutoff
  // rather than the general 22s one, which would start a fixture with 8s of
  // client budget left and ~25s of work to do.
  //
  // VIP_PREMIUM belongs here for exactly the reason it takes "multi" breadth
  // above: it asks for several markets per fixture so its odds gate has more
  // than one selection to judge. Leaving it on the general cutoff would let a
  // run start a ~25s fixture with 8s of budget left. Kept in step with
  // marketBreadthForCategories — the two must not disagree about which intents
  // are multi-market.
  if (intent === "VIP_PREMIUM" || intent === "MARKET_CONFIRMED") return DOUBLES_START_CUTOFF_MS;
  if (intent === REGULAR_COMBO_INTENT) return DOUBLES_START_CUTOFF_MS;
  return categories.includes(SAME_GAME_DOUBLE) ? DOUBLES_START_CUTOFF_MS : defaultCutoffMs;
}
