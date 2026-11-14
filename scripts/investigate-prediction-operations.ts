import { assessJobCompletion } from "../src/lib/jobOutcome";
import { meaningfulCompletion } from "../src/lib/predictionOperations";
/** Bounded production investigation. Direct read-only Prisma client; never imports job writers/provider usage. */
import { PrismaClient, Prisma } from "@prisma/client";
const db = new PrismaClient({ log: [] });
const JOBS = [
  "generation-discovery",
  "refresh-odds",
  "generate-vip-premium",
  "generate-goals",
  "generate-european-clubs",
  "generate-ordinary",
  "generate-bet-of-the-day",
  "select-bet-of-the-day",
  "settle",
  "results-pass",
];
const tally = (values: string[]) =>
  values.reduce<Record<string, number>>((s, k) => {
    s[k] = (s[k] ?? 0) + 1;
    return s;
  }, {});
function numericShape(
  value: unknown,
  prefix = "",
  depth = 0,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || depth > 3) return {};
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value).slice(0, 60)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      (typeof v === "number" && Number.isFinite(v)) ||
      typeof v === "boolean" ||
      v === null
    )
      out[path] = v;
    else if (Array.isArray(v)) {
      out[path + ".length"] = v.length;
      if (v.length && depth < 3)
        Object.assign(out, numericShape(v[0], path + "[first]", depth + 1));
    } else if (typeof v === "object")
      Object.assign(out, numericShape(v, path, depth + 1));
    else if (typeof v === "string") out[path + ".present"] = !!v; // Never print raw errors, picks, names, payload strings or credentials.
  }
  return out;
}
function failureCategory(message: unknown): string {
  if (typeof message !== "string") return "NO_STORED_ERROR_TEXT";
  if (
    /ground|evidence|unsupported claim|hallucin|factual|competition.stage|inconsistent/i.test(
      message,
    )
  )
    return "EVIDENCE_OR_CONTENT_GUARD";
  if (/timed out|timeout|AbortError/i.test(message)) return "TIMEOUT";
  if (/429|rate.limit|quota|budget/i.test(message))
    return "RATE_OR_QUOTA_GUARD";
  if (
    /no predictions|no valid|no usable|empty|invalid.*output|JSON|parse|schema/i.test(
      message,
    )
  )
    return "EMPTY_OR_INVALID_OUTPUT";
  if (/prisma|constraint|database|P[0-9]{4}/i.test(message))
    return "DATABASE_OR_CONSTRAINT";
  if (/provider|api|network|fetch|connection/i.test(message))
    return "PROVIDER_OR_NETWORK";
  return "UNCLASSIFIED_STORED_ERROR";
}
async function main() {
  const now = new Date(),
    since = new Date(+now - 86400000),
    cutoff = new Date(+now - 360 * 60000);
  const state = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8000ms'");
      const guard = await tx.$queryRaw<
        Array<{ transaction_read_only: string }>
      >`SHOW transaction_read_only`;
      if (guard[0]?.transaction_read_only !== "on")
        throw new Error("Read-only guard required");
      const where = { outcome: "PENDING", kickoff: { lt: cutoff } };
      const grouped = await tx.prediction.groupBy({
        by: ["status", "manualSettlementOnly", "marketType"],
        where,
        _count: { _all: true },
      });
      const rows = await tx.prediction.findMany({
        where: { ...where, status: "PUBLISHED" },
        take: 2001,
        orderBy: [
          { manualSettlementOnly: "asc" },
          { kickoff: "desc" },
          { id: "asc" },
        ],
        select: {
          id: true,
          kickoff: true,
          createdAt: true,
          publishedAt: true,
          marketType: true,
          manualSettlementOnly: true,
          fixtureApiId: true,
          leagueApiId: true,
          homeTeam: true,
          awayTeam: true,
          homeTeamApiId: true,
          awayTeamApiId: true,
          settlementAttempts: true,
          settlementNote: true,
          selection: true,
        },
      });
      const legIds = [
        ...new Set(
          rows
            .filter((r) => r.marketType === "SAME_GAME_DOUBLE")
            .flatMap((r) => {
              const ids = (r.selection as any)?.legIds;
              return Array.isArray(ids)
                ? ids.filter((id): id is string => typeof id === "string")
                : [];
            }),
        ),
      ];
      const legs = await tx.prediction.findMany({
        where: { id: { in: legIds.slice(0, 4000) } },
        take: 4000,
        select: {
          id: true,
          status: true,
          outcome: true,
          marketType: true,
          manualSettlementOnly: true,
          kickoff: true,
          leagueApiId: true,
          homeTeam: true,
          awayTeam: true,
          fixtureApiId: true,
        },
      });
      const cohorts = [];
      for (const days of [1, 7]) {
        const whereWindow = {
          kickoff: {
            gte: new Date(+now - days * 86400000),
            lte: new Date(+now + 3 * 86400000),
          },
        };
        const [cohort, total] = await Promise.all([
          tx.prediction.findMany({
            where: whereWindow,
            take: 501,
            orderBy: [{ kickoff: "asc" }, { id: "asc" }],
            select: {
              status: true,
              outcome: true,
              kickoff: true,
              manualSettlementOnly: true,
              marketType: true,
            },
          }),
          tx.prediction.count({ where: whereWindow }),
        ]);
        const warnings = cohort
          .slice(0, 500)
          .filter(
            (p) => p.outcome === "PENDING" && p.kickoff && p.kickoff < cutoff,
          );
        cohorts.push({
          days,
          total,
          sampled: Math.min(cohort.length, 500),
          capped: total > 500,
          legacySettlementDelayCount: warnings.length,
          byStatus: tally(warnings.map((p) => p.status)),
          manual: warnings.filter((p) => p.manualSettlementOnly).length,
        });
      }
      const fixtures = await tx.fixture.findMany({
        where: {
          apiId: {
            in: [
              ...new Set(
                rows.flatMap((r) =>
                  r.fixtureApiId != null ? [r.fixtureApiId] : [],
                ),
              ),
            ],
          },
        },
        take: 2000,
        select: { apiId: true, status: true, kickoff: true, updatedAt: true },
      });
      const histories = [];
      for (const job of JOBS) {
        const [runs, total] = await Promise.all([
          tx.jobRun.findMany({
            where: { job, ranAt: { gte: since } },
            take: 200,
            orderBy: { ranAt: "desc" },
            select: { ranAt: true, ok: true, detail: true, ms: true },
          }),
          tx.jobRun.count({ where: { job, ranAt: { gte: since } } }),
        ]);
        histories.push({ job, total, runs });
      }
      const recentSettlements = await tx.prediction.count({
        where: {
          settledAt: { gte: since },
          outcome: { in: ["WON", "LOST", "VOID"] },
        },
      });
      const eligiblePending = await tx.prediction.count({
        where: {
          status: "PUBLISHED",
          outcome: "PENDING",
          manualSettlementOnly: false,
          marketType: { not: "SAME_GAME_DOUBLE" },
          leagueApiId: { not: null },
          homeTeam: { not: null },
          awayTeam: { not: null },
          kickoff: { lt: new Date(+now - 110 * 60000) },
        },
      });
      return {
        grouped,
        rows,
        fixtures,
        histories,
        recentSettlements,
        eligiblePending,
        legs,
        cohorts,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 60000,
      maxWait: 10000,
    },
  );
  const rows = state.rows.slice(0, 2000),
    byFixture = new Map(state.fixtures.map((f) => [f.apiId, f]));
  const selected = [
    ...new Set(
      rows
        .filter((r) => r.fixtureApiId != null && r.fixtureApiId > 0)
        .sort(
          (a, b) =>
            Number(a.manualSettlementOnly) - Number(b.manualSettlementOnly),
        )
        .map((r) => r.fixtureApiId!),
    ),
  ].slice(0, 100);
  const live = new Map<number, any>();
  let requests = 0;
  const providerFailures: Record<string, number> = {};
  const key = process.env.API_FOOTBALL_KEY;
  if (process.env.OPS_PROBE_PROVIDER === "1" && key) {
    for (let i = 0; i < selected.length; i += 20) {
      const chunk = selected.slice(i, i + 20),
        url = new URL("https://v3.football.api-sports.io/fixtures");
      url.searchParams.set(
        chunk.length === 1 ? "id" : "ids",
        chunk.length === 1 ? String(chunk[0]) : chunk.join("-"),
      );
      requests++;
      try {
        const r = await fetch(url, {
          headers: { "x-apisports-key": key },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          providerFailures[`HTTP_${r.status}`] =
            (providerFailures[`HTTP_${r.status}`] ?? 0) + 1;
          continue;
        }
        const body = await r.json();
        if (body.errors && Object.keys(body.errors).length) {
          const restriction = /plan|subscription|season|access/i.test(
            JSON.stringify(body.errors),
          );
          const code = restriction
            ? "SUBSCRIPTION_OR_ACCESS_RESTRICTION"
            : "PROVIDER_ERROR";
          providerFailures[code] = (providerFailures[code] ?? 0) + 1;
          continue;
        }
        for (const f of body.response ?? [])
          if (chunk.includes(f?.fixture?.id)) live.set(f.fixture.id, f);
      } catch {
        providerFailures.TIMEOUT_OR_NETWORK =
          (providerFailures.TIMEOUT_OR_NETWORK ?? 0) + 1;
      }
      if (i + 20 < selected.length)
        await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const byLeg = new Map(state.legs.map((l) => [l.id, l]));
  const compoundBreakdown = rows
    .filter((r) => r.marketType === "SAME_GAME_DOUBLE")
    .map((r) => {
      const ids = (r.selection as any)?.legIds;
      if (!Array.isArray(ids) || ids.length !== 2)
        return "INVALID_LEG_REFERENCES";
      const legs = ids.map((id) => byLeg.get(id));
      if (legs.some((l) => !l)) return "MISSING_LEG";
      if (legs.every((l) => l!.outcome !== "PENDING"))
        return "LEGS_RESOLVED_REQUIRES_COMPOSITION_CHECK";
      if (legs.some((l) => l!.outcome === "PENDING" && l!.manualSettlementOnly))
        return "WAITING_MANUAL_LEG";
      return "WAITING_PENDING_LEG";
    });
  const manualReasons = rows
    .filter((p) => p.manualSettlementOnly)
    .map((p) => {
      const s = p.settlementNote ?? "";
      return /reversed/i.test(s)
        ? "TEAM_ORIENTATION_REVIEW"
        : /different pairing/i.test(s)
          ? "FIXTURE_IDENTITY_REVIEW"
          : /no longer exists|leg references|Malformed double/i.test(s)
            ? "COMPOUND_REFERENCE_REVIEW"
            : /gave up after.*not|matched both team|no fixtures|no fixture/i.test(
                  s,
                )
              ? "LOOKUP_EXHAUSTION"
              : /still not confirmed|postponed|abandoned/i.test(s)
                ? "UNCONFIRMED_FINAL_BACKSTOP"
                : /breakdown|score|halftime/i.test(s)
                  ? "SCORE_OR_SELECTION_EVIDENCE_REVIEW"
                  : s
                    ? "OTHER_RECORDED_MANUAL_REASON"
                    : "MANUAL_WITHOUT_RECORDED_REASON";
    });
  const classification = rows.map((p) => {
    const f = p.fixtureApiId != null ? live.get(p.fixtureApiId) : null;
    const status = f?.fixture?.status?.short;
    const actual = f?.fixture?.date ? Date.parse(f.fixture.date) : NaN;
    const identityMatches =
      f &&
      (p.homeTeamApiId == null || f.teams?.home?.id === p.homeTeamApiId) &&
      (p.awayTeamApiId == null || f.teams?.away?.id === p.awayTeamApiId);
    let category =
      !p.fixtureApiId || p.fixtureApiId <= 0
        ? "MISSING_OR_INVALID_ID"
        : !f
          ? "LIVE_STATUS_UNVERIFIED"
          : !identityMatches
            ? "IDENTITY_MISMATCH"
            : Number.isFinite(actual) && actual > +now
              ? "RESCHEDULED_FUTURE"
              : ["PST", "CANC", "ABD", "SUSP", "INT"].includes(status)
                ? status
                : ["FT", "AET", "PEN"].includes(status)
                  ? "CONFIRMED_FINAL"
                  : "NOT_CONFIRMED_FINAL";
    if (category === "CONFIRMED_FINAL" && p.manualSettlementOnly)
      category = "CONFIRMED_FINAL_MANUAL";
    return {
      category,
      autoEligible:
        !p.manualSettlementOnly &&
        p.marketType !== "SAME_GAME_DOUBLE" &&
        p.leagueApiId != null &&
        !!p.homeTeam &&
        !!p.awayTeam,
      market: p.marketType,
    };
  });
  const history = state.histories.map((h) => {
    const times = h.runs.map((r) => +r.ranAt).sort((a, b) => a - b);
    const gaps = times
      .slice(1)
      .map((t, i) => (t - times[i]) / 60000)
      .sort((a, b) => a - b);
    return {
      job: h.job,
      observedRuns24h: h.total,
      sample: h.runs.length,
      sampleCapped: h.total > h.runs.length,
      lastAt: h.runs[0]?.ranAt ?? null,
      transportSuccess: h.runs.filter((r) => r.ok).length,
      medianObservedGapMinutes: gaps.length
        ? gaps[Math.floor(gaps.length / 2)]
        : null,
      failureEvidence: tally(
        h.runs.flatMap((r) => {
          const p = r.detail as any;
          return Array.isArray(p?.results)
            ? p.results
                .filter((x: any) => x?.ok === false)
                .map((x: any) => failureCategory(x.error))
            : [];
        }),
      ),
      legacyClassification: tally(
        h.runs.map(
          (r) => meaningfulCompletion(r.detail, r.ok ? 200 : 500).status,
        ),
      ),
      correctedClassification: tally(
        h.runs.map(
          (r) => assessJobCompletion(h.job, r.detail, r.ok ? 200 : 500).status,
        ),
      ),
      correctedReasons: tally(
        h.runs.map(
          (r) => assessJobCompletion(h.job, r.detail, r.ok ? 200 : 500).reason,
        ),
      ),
      recent: h.runs.slice(0, 5).map((r) => ({
        at: r.ranAt,
        transportOk: r.ok,
        ms: r.ms,
        shape: numericShape(r.detail),
      })),
    };
  });
  console.log(
    JSON.stringify(
      {
        version: "ops-investigation-v1",
        at: now.toISOString(),
        databaseReadOnly: true,
        population: {
          pendingPast360Minutes: state.grouped.map((g) => ({
            status: g.status,
            manual: g.manualSettlementOnly,
            market: g.marketType,
            count: g._count._all,
          })),
          publishedSample: rows.length,
          publishedSampleCapped: state.rows.length > 2000,
          publishedCurrentLookback: rows.filter(
            (p) => p.kickoff && p.kickoff >= since,
          ).length,
          publishedHistorical: rows.filter(
            (p) => p.kickoff && p.kickoff < since,
          ).length,
          eligiblePending110Minutes: state.eligiblePending,
          eligibleHiddenLegs110Minutes: state.legs.filter(
            (l) =>
              l.outcome === "PENDING" &&
              !l.manualSettlementOnly &&
              l.marketType !== "SAME_GAME_DOUBLE" &&
              l.leagueApiId != null &&
              l.homeTeam != null &&
              l.awayTeam != null &&
              l.kickoff &&
              +l.kickoff < +now - 110 * 60000,
          ).length,
          settledLast24h: state.recentSettlements,
          dashboardCohorts: state.cohorts,
          compoundDependencies: tally(compoundBreakdown),
          manualReasonCategories: tally(manualReasons),
        },
        evidence: {
          nativeCacheCoverage: rows.filter(
            (r) => r.fixtureApiId != null && byFixture.has(r.fixtureApiId),
          ).length,
          nativeCachedStatuses: tally(state.fixtures.map((f) => f.status)),
          manualPublished: rows.filter((r) => r.manualSettlementOnly).length,
          missingFixtureId: rows.filter(
            (r) => r.fixtureApiId == null || r.fixtureApiId <= 0,
          ).length,
          missingLeagueOrNames: rows.filter(
            (r) => r.leagueApiId == null || !r.homeTeam || !r.awayTeam,
          ).length,
          notePresent: rows.filter((r) => !!r.settlementNote).length,
        },
        provider: {
          requested: process.env.OPS_PROBE_PROVIDER === "1",
          credentialAvailable: !!key,
          requests,
          maxRequests: 5,
          selectedFixtureIds: selected.length,
          returnedFixtures: live.size,
          failures: providerFailures,
          classifications: tally(classification.map((r) => r.category)),
          confirmedFinalAutoEligible: classification.filter(
            (r) => r.category === "CONFIRMED_FINAL" && r.autoEligible,
          ).length,
          completePublishedVerification:
            state.rows.length <= 2000 &&
            selected.length ===
              new Set(
                rows.flatMap((r) =>
                  r.fixtureApiId && r.fixtureApiId > 0 ? [r.fixtureApiId] : [],
                ),
              ).size &&
            live.size === selected.length,
        },
        jobs: history,
        limitations: [
          "No production records written; no fixture outcomes or identities printed",
          "Provider verification capped at 100 unique fixtures / five requests, auto-settlement candidates first",
          "Cached statuses are not live verification; missing returned ids remain unverified",
          "Observed cadence is not an external scheduler configuration",
          "Final status is not by itself sufficient regulation-score/selection evidence to settle",
        ],
      },
      null,
      2,
    ),
  );
}
main()
  .catch(() => {
    console.error(
      "Read-only operations investigation failed; no production records were changed",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
