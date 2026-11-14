/**
 * Read-only historical dataset extractor for the forecasting research engine.
 *
 * Reads Prediction and AIJob rows inside one verified read-only snapshot (see
 * readonlyDb.ts), consolidates them per provider fixture id, selects each
 * fixture's earliest valid pre-kickoff generation context, and writes:
 *
 *   <out>/fixtures.jsonl, <out>/observations.jsonl, <out>/manifest.json
 *
 * No writes to any database, no API-Football calls, no enrichment-cache reads:
 * only what was stored at generation time and at settlement is used.
 *
 * Run (never in CI — CI uses synthetic data only):
 *   RESEARCH_READONLY_DATABASE_URL=postgres://… npx tsx research/forecasting/extract/extract.ts \
 *     [--out research/forecasting/work/dataset] [--as-of 2026-11-14T00:00:00Z] [--page-size 50]
 *     [--page-delay-ms 0] [--max-transaction-minutes 10] [--statement-timeout-s 60]
 *
 * On the shared VPS, see docs/research/XGBOOST_RESEARCH_ENGINE.md section 11
 * for the recommended limits: small pages, a delay between pages, off-peak.
 *
 * --as-of bounds every timestamp read (rows created, jobs created, settlements
 * recorded after it are treated as not existing), so re-running with the same
 * value against a later database reproduces the same dataset, barring deletions.
 */
export {};

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assembleDataset } from "./assemble";
import { parseJob, type ParsedJob, type PredictionRow } from "./core";
import { assertDedicatedCredential, withReadOnlySnapshot, ReadOnlyRefusal } from "./readonlyDb";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** True peak resident memory (VmHWM) on Linux; current RSS elsewhere. */
function peakRssMiB(): number {
  try {
    const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"));
    if (m) return Number(m[1]) / 1024;
  } catch { /* not Linux */ }
  return process.memoryUsage().rss / 2 ** 20;
}

function boundedNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`--${name} must be between ${min} and ${max}`);
  return n;
}

type RawPrediction = Omit<PredictionRow, "fixtureApiId"> & { fixtureApiId: number | null };

async function main() {
  const url = assertDedicatedCredential(process.env);
  const out = resolve(arg("out") ?? "research/forecasting/work/dataset");
  const pageSize = boundedNumber("page-size", 50, 10, 1000);
  const pageDelayMs = boundedNumber("page-delay-ms", 0, 0, 10_000);
  const maxTxMinutes = boundedNumber("max-transaction-minutes", 10, 1, 30);
  const statementTimeoutS = boundedNumber("statement-timeout-s", 60, 5, 300);
  const asOfArg = arg("as-of");
  if (asOfArg && !Number.isFinite(Date.parse(asOfArg))) throw new Error(`--as-of is not a timestamp: ${asOfArg}`);
  const started = Date.now();

  const { result, info } = await withReadOnlySnapshot(url, async (q, info) => {
    const asOf = new Date(asOfArg ?? info.snapshot_time);
    console.log(`snapshot verified read-only (${info.isolation}); as_of ${asOf.toISOString()}`);

    const [{ total }] = await q<{ total: number }>(`SELECT count(*)::int AS total FROM "Prediction" WHERE "createdAt" <= $1`, asOf);

    // Settlement recorded after as_of did not exist at as_of: scores and
    // settledAt are masked rather than read, so the snapshot is reproducible.
    const raw = await q<RawPrediction>(`
      SELECT id, "fixtureApiId", "leagueApiId", "leagueName", "homeTeam", "awayTeam", "homeTeamApiId", "awayTeamApiId",
             kickoff,
             CASE WHEN "settledAt" <= $1 THEN "finalHomeScore" END AS "finalHomeScore",
             CASE WHEN "settledAt" <= $1 THEN "finalAwayScore" END AS "finalAwayScore",
             CASE WHEN "settledAt" <= $1 THEN outcome ELSE 'PENDING' END AS outcome,
             CASE WHEN "settledAt" <= $1 THEN "settledAt" END AS "settledAt",
             "marketType", selection, confidence, "createdAt", "aiJobId"
        FROM "Prediction" WHERE "createdAt" <= $1 ORDER BY id`, asOf);
    const predictions = raw.filter((r): r is PredictionRow => r.fixtureApiId != null);
    console.log(`predictions: ${total} total, ${predictions.length} with a provider fixture id`);

    // Jobs are paged by id and parsed immediately, so v1's raw payloads never
    // accumulate in memory.
    const jobs: ParsedJob[] = [];
    let cursor = "";
    for (;;) {
      const page = await q<{ id: string; createdAt: Date; model: string | null; context: unknown }>(
        `SELECT id, "createdAt", model, context FROM "AIJob" WHERE "createdAt" <= $1 AND id > $2 ORDER BY id LIMIT ${pageSize}`, asOf, cursor);
      if (!page.length) break;
      for (const j of page) jobs.push(parseJob(j));
      cursor = page[page.length - 1].id;
      process.stdout.write(`\rjobs parsed: ${jobs.length}`);
      if (pageDelayMs) await new Promise((r) => setTimeout(r, pageDelayMs));
    }
    process.stdout.write("\n");

    return { asOf, total, predictions, withoutId: raw.length - predictions.length, jobs };
  }, { statementTimeoutMs: statementTimeoutS * 1000, transactionTimeoutMs: maxTxMinutes * 60_000 });
  const snapshotSeconds = (Date.now() - started) / 1000;

  const ds = assembleDataset({
    predictions: result.predictions,
    jobs: result.jobs,
    predictionsWithoutFixtureId: result.withoutId,
    totalPredictions: result.total,
    asOf: result.asOf.toISOString(),
    generatedAt: new Date().toISOString(),
    source: "postgres",
    database: { server_version: info.server_version, read_only_verified: info.read_only_verified, isolation: info.isolation, snapshot_time: info.snapshot_time },
  });

  mkdirSync(out, { recursive: true });
  for (const [name, text] of Object.entries(ds.lines)) writeFileSync(join(out, name), text);
  writeFileSync(join(out, "manifest.json"), JSON.stringify(ds.manifest, null, 2) + "\n");

  const m = ds.manifest;
  console.log(`\nwrote ${out}`);
  console.log(`  fixtures: ${m.counts.distinct_fixture_ids} distinct, ${m.counts.fixtures_included} included, ${m.counts.fixtures_excluded} excluded`);
  for (const [k, v] of Object.entries(m.fixture_exclusions)) console.log(`    ${k}: ${v}`);
  console.log(`  observations: ${m.counts.observations}`);
  console.log(`  snapshot held ${snapshotSeconds.toFixed(1)}s, total ${((Date.now() - started) / 1000).toFixed(1)}s, peak rss ${peakRssMiB().toFixed(0)} MiB`);
}

main().catch((e) => {
  // Never print connection strings: refusals carry their own safe message; any
  // other error message is scrubbed of URLs and host:port pairs before printing.
  const msg = String(e?.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/gi, "<redacted-url>")
    .replace(/`[^`\s]+:\d{2,5}`/g, "<redacted-host>");
  console.error(e instanceof ReadOnlyRefusal ? e.message : `extract failed: ${msg}`);
  process.exit(1);
});
