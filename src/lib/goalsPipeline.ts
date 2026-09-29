import { prisma } from "@/lib/prisma";
import { lagosDateKey } from "@/lib/lagosDate";
import { GENERATE_UNTIL_HOURS, SAME_DAY_GENERATE_FROM_HOURS } from "@/lib/generation/window";
import { applyReviewAction } from "@/lib/predictions";
import { GOALS } from "@/lib/goalsCategory";
import { generatePredictionForFixture } from "@/lib/ai/analysis";
import { parseStoredContext } from "@/lib/ai/context";
import { isDigestEmpty } from "@/lib/ai/digest";
import { resolveGenerationRisk } from "@/lib/ai/generationRisk";
import {
  GOALS_BACKOFF_LOCK_PREFIX,
  GOALS_GENERATED_PROVENANCE,
  GOALS_RETRY_BACKOFF_MS,
  goalsAutoPublishVerdict,
  goalsPublishFixture,
  evaluateGoalsProbe,
  planGoalsTargets,
  readGoalsAttempt,
  type GoalsAttempt,
  type GoalsPlan,
  type GoalsPublishBlock,
} from "@/lib/goalsGeneration";

/**
 * Database side of the dedicated Goals pass. The rules are in
 * src/lib/goalsGeneration.ts; this only gathers their inputs.
 *
 * Reads the GenerationAttempt ledger but never writes it: a Goals pick is added
 * to a fixture ordinary generation already covered, and that fixture's ledger
 * row stays exactly as ordinary generation left it.
 */

/** Far enough back to cover every kickoff day the 48h window can still reach. */
const ATTEMPT_LOOKBACK_MS = 4 * 24 * 3_600_000;

/** Goals-intent AIJobs in the lookback, read from their stored prompts. */
export async function loadGoalsAttempts(now: Date = new Date()): Promise<GoalsAttempt[]> {
  const jobs = await prisma.aIJob.findMany({
    // Narrowed in SQL on the literal JSON.stringify writes; readGoalsAttempt
    // then parses properly, so a false match costs nothing but a parse.
    where: { createdAt: { gte: new Date(now.getTime() - ATTEMPT_LOOKBACK_MS) }, prompt: { contains: '"intent":"GOALS"' } },
    select: { prompt: true, createdAt: true },
  });
  return jobs.map((j) => readGoalsAttempt(j.prompt, j.createdAt)).filter((a): a is GoalsAttempt => a !== null);
}

/** Goals AI calls made so far today (Lagos). */
export async function goalsGeneratedToday(now: Date = new Date()): Promise<number> {
  const today = lagosDateKey(now);
  return (await loadGoalsAttempts(now)).filter((a) => lagosDateKey(a.createdAt) === today).length;
}

export async function selectGoalsTargets(now: Date = new Date(), limit: number): Promise<GoalsPlan> {
  const from = new Date(now.getTime() + SAME_DAY_GENERATE_FROM_HOURS * 3_600_000);
  const until = new Date(now.getTime() + GENERATE_UNTIL_HOURS * 3_600_000);
  const [ledger, rows, attempts, backoffs] = await Promise.all([
    prisma.generationAttempt.findMany({
      where: { kickoff: { gte: from, lte: until }, status: "SUCCEEDED", fixtureApiId: { not: null } },
      select: { matchKey: true, fixtureApiId: true, leagueApiId: true, leagueName: true, homeTeam: true, awayTeam: true, kickoff: true, round: true, status: true },
    }),
    prisma.prediction.findMany({
      where: { kickoff: { gte: from, lte: until }, status: { not: "ARCHIVED" } },
      select: {
        fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, status: true,
        marketType: true, contextComplete: true, provenance: true, categories: { select: { category: true } },
      },
    }),
    loadGoalsAttempts(now),
    prisma.appLock.findMany({ where: { key: { startsWith: GOALS_BACKOFF_LOCK_PREFIX }, expiresAt: { gt: now } }, select: { key: true } }),
  ]);
  const backingOff = new Set(backoffs.map((b) => Number(b.key.slice(GOALS_BACKOFF_LOCK_PREFIX.length))).filter(Number.isFinite));
  return planGoalsTargets({
    ledger: ledger.map((l) => ({ ...l, kickoff: l.kickoff! })),
    rows: rows.map((r) => ({ ...r, categories: r.categories.map((c) => c.category) })),
    attempts,
    backingOff,
    now,
    limit,
  });
}

/**
 * Leave a fixture alone for GOALS_RETRY_BACKOFF_MS after its generation threw
 * before an AIJob was written (a provider outage, a digest failure).
 *
 * A rejected draft needs no backoff — its AIJob already marks the fixture
 * attempted. This covers the other case, which would otherwise be retried on
 * every 15-minute tick. Stored in AppLock, the lease table the generation run
 * already uses, rather than as a second ledger.
 */
export async function backOffGoalsFixture(fixtureApiId: number, now: Date = new Date()): Promise<void> {
  const key = `${GOALS_BACKOFF_LOCK_PREFIX}${fixtureApiId}`;
  const expiresAt = new Date(now.getTime() + GOALS_RETRY_BACKOFF_MS);
  await prisma.appLock
    .upsert({ where: { key }, create: { key, holder: "goals", acquiredAt: now, expiresAt }, update: { acquiredAt: now, expiresAt } })
    .catch((error) => console.error("[goals] could not record retry backoff", error));
}

// ── Automatic publication ──────────────────────────────────────────────────

/** Every row on the same fixture, and its ledger status — read fresh at publish time. */
async function loadFixtureState(row: { fixtureApiId: number | null }) {
  if (row.fixtureApiId == null) return { ledgerStatus: null, rows: [] };
  const [ledger, rows] = await Promise.all([
    prisma.generationAttempt.findFirst({ where: { fixtureApiId: row.fixtureApiId }, orderBy: { lastAttemptAt: "desc" }, select: { status: true } }),
    prisma.prediction.findMany({
      where: { fixtureApiId: row.fixtureApiId },
      select: { id: true, status: true, marketType: true, provenance: true, categories: { select: { category: true } } },
    }),
  ]);
  return { ledgerStatus: ledger?.status ?? null, rows: rows.map((r) => ({ ...r, categories: r.categories.map((c) => c.category) })) };
}

/**
 * Publish a Goals-pass row with no reviewer, if and only if it clears
 * goalsAutoPublishVerdict. Otherwise it stays PENDING_REVIEW, untouched, for a
 * human to decide — a gate that fails here is a question, not a rejection.
 *
 * Publication goes through applyReviewAction, the same transition and
 * NEW_PREDICTION event a bulk publish uses, attributed to `actorId` (the admin
 * the generation run is attributed to). One of the app's two automatic
 * publishes, reachable only from runGoalsGeneration; the other is the dedicated
 * VIP/PREMIUM pick (autoPublishVipPremiumPrediction in vipPremiumPipeline.ts).
 */
export async function autoPublishGoalsPrediction(
  predictionId: string,
  actorId: string,
): Promise<{ published: boolean; blocks: GoalsPublishBlock[] }> {
  const row = await prisma.prediction.findUnique({ where: { id: predictionId }, include: { categories: true } });
  if (!row) return { published: false, blocks: ["NOT_GOALS_GENERATED"] };
  const fixture = await loadFixtureState(row);
  const verdict = goalsAutoPublishVerdict(
    { ...row, categories: row.categories.map((c) => c.category) },
    goalsPublishFixture(row, fixture.ledgerStatus, fixture.rows),
  );
  if (!verdict.publish) return { published: false, blocks: verdict.blocks };
  await applyReviewAction(row, "PUBLISH", actorId);
  return { published: true, blocks: [] };
}

// ── Live-model probe (dry run) ─────────────────────────────────────────────

export type GoalsProbeResult =
  | { ok: false; dryRun: true; persisted: false; reason: string }
  | ({
      ok: true;
      dryRun: true;
      persisted: false;
      fixture: { fixtureApiId: number; match: string; league: string | null; kickoff: string | null };
      evidence: { source: "stored-digest"; generatedAt: string; contextComplete: boolean };
      model: string;
      durationMs: number;
      usage: { promptTokens: number | null; outputTokens: number | null };
    } & ReturnType<typeof evaluateGoalsProbe>);

/**
 * Ask the live model for a Goals pick on one covered fixture and report what
 * the server-side gates would do with the answer — WITHOUT persisting anything.
 *
 * Strictly read-only against the database. It replays the evidence digest the
 * fixture's ordinary generation stored on its AIJob, exactly as a rewrite does
 * (src/lib/ai/rewrite.ts), rather than calling buildGenerationDigest, which
 * refreshes the enrichment caches on a miss — a write. So: no api-football
 * call, no cache write, no AIJob (which is also the Goals attempt ledger), no
 * Prediction, no category link, no generation-ledger change, no lease, no
 * publish, no notification. The model call is its only side effect.
 *
 * The response carries the model's structured answer and the gate verdicts,
 * never the system prompt or the evidence digest.
 */
export async function probeGoalsFixture(opts: { fixtureApiId?: number | null; now?: Date }): Promise<GoalsProbeResult> {
  const now = opts.now ?? new Date();
  const fail = (reason: string): GoalsProbeResult => ({ ok: false, dryRun: true, persisted: false, reason });

  let fixtureApiId = opts.fixtureApiId ?? null;
  if (fixtureApiId == null) {
    const plan = await selectGoalsTargets(now, 1);
    fixtureApiId = plan.targets[0]?.fixtureApiId ?? null;
    if (fixtureApiId == null) return fail(plan.stoodDown ?? "no eligible covered fixture right now; pass fixtureApiId to probe a specific one");
  }

  // The newest ordinary row on the fixture that has a stored digest.
  const source = await prisma.prediction.findFirst({
    where: { fixtureApiId, status: { not: "ARCHIVED" }, provenance: { not: GOALS_GENERATED_PROVENANCE }, aiJobId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      leagueApiId: true, leagueName: true, homeTeam: true, awayTeam: true, kickoff: true, fixtureApiId: true, createdAt: true,
      aiJob: { select: { context: true } },
    },
  });
  if (!source) return fail(`fixture ${fixtureApiId} has no ordinary prediction with a stored evidence digest`);
  const digest = parseStoredContext(source.aiJob?.context);
  if (!digest) return fail(`fixture ${fixtureApiId}'s ordinary generation predates stored evidence digests`);

  const route = resolveGenerationRisk([GOALS], source.leagueApiId);
  const startedAt = Date.now();
  const { output, usage, model } = await generatePredictionForFixture({
    digest,
    tiers: route.promptTiers,
    riskCalibration: route.calibration !== "legacy",
    marketBreadth: "single",
    goalsOnly: true,
  });
  const durationMs = Date.now() - startedAt;

  // Same derivation generate.ts stores on the row.
  const contextComplete = source.leagueApiId ? !isDigestEmpty(digest) : true;
  const fixture = await loadFixtureState(source);
  const evaluated = evaluateGoalsProbe({
    output,
    leagueApiId: source.leagueApiId,
    leagueName: source.leagueName,
    contextComplete,
    fixture: goalsPublishFixture({ id: "(probe)" }, fixture.ledgerStatus, fixture.rows),
  });

  return {
    ok: true,
    dryRun: true,
    persisted: false,
    fixture: { fixtureApiId, match: `${source.homeTeam} vs ${source.awayTeam}`, league: source.leagueName, kickoff: source.kickoff?.toISOString() ?? null },
    evidence: { source: "stored-digest", generatedAt: source.createdAt.toISOString(), contextComplete },
    model,
    durationMs,
    usage: { promptTokens: usage.promptTokens ?? null, outputTokens: usage.outputTokens ?? null },
    ...evaluated,
  };
}
