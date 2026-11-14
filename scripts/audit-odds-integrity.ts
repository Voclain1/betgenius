const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
import { assessJobCompletion } from "../src/lib/jobOutcome";
import { assessOperationalOdds } from "../src/lib/operationsIntegrity";
import { prisma } from "../src/lib/prisma";
import { loadOperations } from "../src/lib/operationsData";
import { auditPublicationQuoteEvidence } from "../src/lib/paidEntryEvidence";
import { matchKey } from "../src/lib/slug";
import { toBookmakerSelection } from "../src/lib/odds";
import { KNOWN_JOBS } from "../src/lib/jobRuns";
const tally = (xs: string[]) =>
  xs.reduce<Record<string, number>>((a, k) => {
    a[k] = (a[k] ?? 0) + 1;
    return a;
  }, {});
async function main() {
  const daily = await loadOperations({ days: 1 }),
    weekly = await loadOperations({ days: 7 });
  const findings = [...daily.findings, ...weekly.findings];
  const targetIds = [
    ...new Set(
      findings.flatMap((f) => (f.predictionId ? [f.predictionId] : [])),
    ),
  ];
  const report = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
      const guard = await tx.$queryRaw<
        Array<{ transaction_read_only: string }>
      >`SHOW transaction_read_only`;
      if (guard[0]?.transaction_read_only !== "on")
        throw new Error("Read-only required");
      const rows = await tx.prediction.findMany({
        where: { id: { in: targetIds } },
        take: 1000,
        select: {
          id: true,
          status: true,
          category: true,
          categories: { select: { category: true } },
          provenance: true,
          createdAt: true,
          publishedAt: true,
          updatedAt: true,
          kickoff: true,
          fixtureApiId: true,
          homeTeamApiId: true,
          awayTeamApiId: true,
          marketType: true,
          selection: true,
          marketConfirmation: true,
          leagueApiId: true,
        },
      });
      const keys = rows.map((p) => matchKey(p)).filter((k): k is string => !!k);
      const quotes = await tx.fixtureOddsCache.findMany({
        where: { matchKey: { in: keys } },
        take: 1000,
      });
      const byKey = new Map(quotes.map((q) => [q.matchKey, q]));
      const fixtures = await tx.fixture.findMany({
        where: {
          apiId: {
            in: rows.flatMap((p) =>
              p.fixtureApiId != null ? [p.fixtureApiId] : [],
            ),
          },
        },
        take: 1000,
        select: {
          apiId: true,
          status: true,
          kickoff: true,
          updatedAt: true,
          homeScore: true,
          awayScore: true,
        },
      });
      const fixtureById = new Map(fixtures.map((f) => [f.apiId, f]));
      const duplicates = [];
      for (const p of rows.filter((p) =>
        findings.some(
          (f) => f.predictionId === p.id && f.code === "DUPLICATE_SELECTION",
        ),
      )) {
        const matches = await tx.prediction.findMany({
          where: {
            fixtureApiId: p.fixtureApiId,
            marketType: p.marketType,
            status: "PUBLISHED",
            selection: { equals: p.selection as any },
          },
          take: 10,
          select: {
            provenance: true,
            category: true,
            publishedAt: true,
            createdAt: true,
          },
        });
        duplicates.push({
          market: p.marketType,
          matchingPublications: matches,
          unstructured: p.selection == null,
        });
      }
      const paid = rows
        .filter((p) =>
          findings.some(
            (f) =>
              f.predictionId === p.id &&
              [
                "MISSING_PAID_EVIDENCE",
                "PAID_PRICE_EVIDENCE_UNAVAILABLE",
              ].includes(f.code),
          ),
        )
        .map((p, i) => {
          const c = p.marketConfirmation as any,
            s = c?.publicationQuoteEvidence;
          return {
            record: `paid-${i + 1}`,
            dailyPeriod:
              daily.findings.find(
                (f) =>
                  f.predictionId === p.id &&
                  [
                    "MISSING_PAID_EVIDENCE",
                    "PAID_PRICE_EVIDENCE_UNAVAILABLE",
                  ].includes(f.code),
              )?.period ?? null,
            category: p.category,
            provenance: p.provenance,
            createdAt: p.createdAt,
            publishedAt: p.publishedAt,
            kickoff: p.kickoff,
            modifiedAfterPublication:
              !!p.publishedAt && p.updatedAt > p.publishedAt,
            audit: p.kickoff
              ? auditPublicationQuoteEvidence(c, p.kickoff).reason
              : "MISSING_KICKOFF",
            confirmationKeys: c && typeof c === "object" ? Object.keys(c) : [],
            promotionQuoteFetchedAt: c?.quoteFetchedAt ?? null,
            promotionConfirmedAt: c?.confirmedAt ?? null,
            snapshotKeys: s && typeof s === "object" ? Object.keys(s) : [],
            quoteFetchedAt: s?.quoteFetchedAt ?? null,
            confirmedAt: s?.confirmedAt ?? null,
            evidenceKind: s?.evidenceKind ?? null,
            priceBasis: s?.entryPriceBasis ?? null,
            namedQuoteCount: Array.isArray(s?.entryQuoteSources)
              ? s.entryQuoteSources.length
              : 0,
          };
        });
      const odds = rows
        .filter((p) =>
          findings.some(
            (f) => f.predictionId === p.id && f.code.startsWith("ODDS_"),
          ),
        )
        .map((p) => {
          const q = byKey.get(matchKey(p) ?? ""),
            raw = q?.oddsJson as any;
          const mapped = toBookmakerSelection(p.marketType, p.selection);
          return {
            state: p.status,
            phase:
              p.kickoff && p.kickoff > new Date()
                ? "UPCOMING"
                : "STARTED_OR_UNKNOWN",
            paid: p.categories.some((c) =>
              ["VIP", "PREMIUM"].includes(c.category),
            ),
            competition: p.leagueApiId,
            market: p.marketType,
            supportedMapping: !!mapped,
            quotedMarket:
              !!mapped &&
              !!raw?.markets?.some((m: any) => m.market === mapped.market),
            localAgeMinutes: q?.fetchedAt
              ? (Date.now() - +q.fetchedAt) / 60000
              : null,
            providerAgeMinutes: raw?.update
              ? (Date.now() - Date.parse(raw.update)) / 60000
              : null,
            missingFixtureId: !p.fixtureApiId,
            storedFixtureState:
              p.fixtureApiId != null
                ? (fixtureById.get(p.fixtureApiId)?.status ?? "UNCACHED")
                : "MISSING_ID",
            createdAt: p.createdAt,
            publishedAt: p.publishedAt,
            diagnostic:
              assessOperationalOdds({
                status: p.status,
                kickoff: p.kickoff,
                marketType: p.marketType,
                selection: p.selection,
                cache: q,
                fixture:
                  p.fixtureApiId != null
                    ? fixtureById.get(p.fixtureApiId)
                    : undefined,
                now: new Date(),
                maxMinutes: 120,
              }).issue?.code ?? "NONE",
            lastErrorCategory: !q?.lastError
              ? "NONE"
              : /No bookmaker prices/i.test(q.lastError)
                ? "NO_QUOTES"
                : /no response|timeout|network/i.test(q.lastError)
                  ? "FETCH_UNAVAILABLE"
                  : "OTHER_UNVERIFIED",
          };
        });
      const attempts = await tx.$queryRaw<
        Array<{
          fixtureApiId: number | null;
          homeTeam: string;
          awayTeam: string;
          kickoff: Date;
          status: string;
          createdAt: Date;
          updatedAt: Date;
          attempts: number;
        }>
      >`SELECT "fixtureApiId","homeTeam","awayTeam","kickoff","status","createdAt","updatedAt","attempts" FROM "GenerationAttempt" WHERE status='SUCCEEDED' AND ("predictionIds" IS NULL OR cardinality("predictionIds")=0) AND kickoff > NOW()-INTERVAL '7 days' LIMIT 20`;
      const generation = [];
      for (const a of attempts) {
        const matches = await tx.prediction.count({
          where: {
            OR: [
              ...(a.fixtureApiId ? [{ fixtureApiId: a.fixtureApiId }] : []),
              {
                kickoff: a.kickoff,
                homeTeam: a.homeTeam,
                awayTeam: a.awayTeam,
              },
            ],
          },
        });
        generation.push({
          status: a.status,
          kickoff: a.kickoff,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          matchingPredictions: matches,
          attempts: a.attempts,
        });
      }
      const jobs = [];
      for (const job of KNOWN_JOBS) {
        const h = await tx.jobRun.findMany({
          where: { job },
          take: 3,
          orderBy: { ranAt: "desc" },
          select: { detail: true, ok: true },
        });
        jobs.push({
          job,
          reportedOk: h.map((r) => r.ok),
          classified: h.map((r) =>
            assessJobCompletion(job, r.detail, r.ok ? 200 : 500),
          ),
          shapes: h.map((r) => {
            const p = r.detail as any;
            return p && typeof p === "object"
              ? Object.fromEntries(
                  Object.entries(p)
                    .filter(
                      ([k, v]) =>
                        k !== "operationalCompletion" &&
                        (typeof v === "number" ||
                          typeof v === "boolean" ||
                          v === null ||
                          typeof v === "object"),
                    )
                    .map(([k, v]) => [
                      k,
                      Array.isArray(v)
                        ? {
                            length: v.length,
                            ...(k === "tiers"
                              ? {
                                  outcomes: tally(
                                    v.map((t: any) =>
                                      ["created", "exists", "empty"].includes(
                                        t?.status,
                                      )
                                        ? t.status
                                        : "UNKNOWN",
                                    ),
                                  ),
                                }
                              : {}),
                          }
                        : v && typeof v === "object"
                          ? {
                              keys: Object.keys(v).slice(0, 25),
                              counters: Object.fromEntries(
                                Object.entries(v).filter(
                                  ([_, n]) =>
                                    typeof n === "number" ||
                                    typeof n === "boolean",
                                ),
                              ),
                              ...(k === "digests" ? { outcomes: v } : {}),
                            }
                          : v,
                    ]),
                )
              : {};
          }),
        });
      }
      return {
        paid,
        duplicates,
        odds: {
          total: odds.length,
          byMarket: tally(odds.map((x) => x.market)),
          byCompetition: tally(odds.map((x) => String(x.competition))),
          byStoredFixtureState: tally(odds.map((x) => x.storedFixtureState)),
          byDiagnostic: tally(odds.map((x) => x.diagnostic)),
          createdRange: odds
            .map((x) => x.createdAt.toISOString())
            .sort()
            .filter((_, i, a) => i === 0 || i === a.length - 1),
          publishedRange: odds
            .flatMap((x) =>
              x.publishedAt ? [x.publishedAt.toISOString()] : [],
            )
            .sort()
            .filter((_, i, a) => i === 0 || i === a.length - 1),
          byCategory: tally(odds.map((x) => (x.paid ? "PAID" : "FREE"))),
          byState: tally(odds.map((x) => x.state)),
          byPhase: tally(odds.map((x) => x.phase)),
          mapping: tally(
            odds.map((x) =>
              !x.supportedMapping
                ? "UNSUPPORTED"
                : x.quotedMarket
                  ? "QUOTED_MARKET"
                  : "MISSING_MARKET",
            ),
          ),
          errors: tally(odds.map((x) => x.lastErrorCategory)),
          missingFixtureId: odds.filter((x) => x.missingFixtureId).length,
          localAgeBands: tally(
            odds.map((x) =>
              x.localAgeMinutes == null
                ? "MISSING"
                : x.localAgeMinutes > 120
                  ? "OVER_120"
                  : "WITHIN_120",
            ),
          ),
          providerAgeBands: tally(
            odds.map((x) =>
              x.providerAgeMinutes == null
                ? "MISSING"
                : x.providerAgeMinutes > 120
                  ? "OVER_120"
                  : "WITHIN_120",
            ),
          ),
        },
        generation,
        jobs,
      };
    },
    { timeout: 60000, maxWait: 10000 },
  );
  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        readOnly: true,
        providerCalls: 0,
        daily: {
          total: daily.total,
          sampled: daily.universe,
          groups: daily.findingGroups.map(
            ({ code, severity, period, count }) => ({
              code,
              severity,
              period,
              count,
            }),
          ),
        },
        weekly: {
          total: weekly.total,
          sampled: weekly.universe,
          groups: weekly.findingGroups.map(
            ({ code, severity, period, count }) => ({
              code,
              severity,
              period,
              count,
            }),
          ),
        },
        ...report,
      },
      null,
      2,
    ),
  );
}
main()
  .catch(() => {
    console.error("Read-only integrity audit failed; no records changed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
