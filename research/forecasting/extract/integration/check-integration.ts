/**
 * End-to-end extractor check against a THROWAWAY local Postgres seeded with
 * SYNTHETIC rows. Run by run-local-integration.sh, which creates the cluster,
 * pushes the schema and creates the read-only role. Never point this at a
 * shared or production database: it writes seed rows through the admin URL.
 *
 * Env: INTEGRATION_ADMIN_URL (local superuser, seeding only)
 *      INTEGRATION_RO_URL    (local read-only role, extraction)
 *      INTEGRATION_RW_URL    (local role WITH write grants, must be refused)
 *      INTEGRATION_OUT       (scratch output directory)
 */
export {};

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildStoredContext } from "../../../../src/lib/ai/context";
import type { MatchDigest, TeamDigest } from "../../../../src/lib/ai/digest";
import { withReadOnlySnapshot } from "../readonlyDb";

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} not set`); return v; };
const ADMIN = env("INTEGRATION_ADMIN_URL"), RO = env("INTEGRATION_RO_URL"), RW = env("INTEGRATION_RW_URL"), OUT = env("INTEGRATION_OUT");
for (const u of [ADMIN, RO, RW]) {
  const host = new URL(u).hostname;
  if (!["localhost", "127.0.0.1", ""].includes(host)) throw new Error("integration check only runs against a local throwaway database");
}

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const L = 9901, AUTHOR = "synthetic-author";
const h = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * 3_600_000);
const team = (name: string, apiId: number, last5: TeamDigest["last5"]): TeamDigest => ({
  name, apiId, rank: null, points: null, overall: null, home: null, away: null, goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null,
  failedToScore: null, form: null, streak: null, biggest: null, formations: [], cards: null, penalties: null, last5, availability: [],
  availabilityAsOf: null, keyPlayers: [],
});
const entry = (date: string, venue: "home" | "away", gf: number, ga: number, opp: number) => ({
  opponent: `Synthetic ${opp}`, venue, result: gf > ga ? "W" : gf < ga ? "L" : "D", goalsFor: gf, goalsAgainst: ga, date,
  competition: "Synthetic League", opponentApiId: opp, competitionApiId: L,
});
const v2 = (home: number, away: number, kickoff: string): MatchDigest => ({
  v: 2,
  fixture: { home: `Synthetic ${home}`, away: `Synthetic ${away}`, league: "Synthetic League", kickoff },
  teams: { home: team(`Synthetic ${home}`, home, [entry("2026-08-01", "home", 2, 0, 99050)]), away: team(`Synthetic ${away}`, away, [entry("2026-08-02", "away", 1, 1, 99051)]) },
  h2h: null, standings: null, coverage: { stats: false, form: true, availability: false, h2h: false, standings: false },
});

async function seed() {
  const db = new PrismaClient({ datasourceUrl: ADMIN });
  await db.user.create({ data: { id: AUTHOR, email: "synthetic-author@example.invalid", name: "Synthetic" } });
  const job = (id: string, createdAt: Date, context: unknown) =>
    db.aIJob.create({ data: { id, userId: AUTHOR, prompt: "synthetic", model: "synthetic:engine", rawOutput: "{}", createdAt, context: context as any } });
  const pred = (id: string, o: Record<string, unknown>) => db.prediction.create({ data: {
    id, category: "TODAY", market: "Match Winner", pick: "Home", confidence: 60, reasoning: "synthetic", authorId: AUTHOR, leagueApiId: L,
    leagueName: "Synthetic League", marketType: "MATCH_WINNER", selection: { value: "HOME" }, status: "PUBLISHED", ...o } as any });

  // F1: three rows, two valid pre-kickoff jobs and one post-kickoff job; home win 2-1.
  const k1 = "2026-08-15T15:00:00.000Z";
  await job("j1a", h(k1, -30), buildStoredContext(v2(99001, 99002, k1)));
  await job("j1b", h(k1, -10), buildStoredContext(v2(99001, 99002, k1)));
  await job("j1c", h(k1, 1), buildStoredContext(v2(99001, 99002, k1)));
  const f1 = { fixtureApiId: 91000001, homeTeamApiId: 99001, awayTeamApiId: 99002, homeTeam: "Synthetic 99001", awayTeam: "Synthetic 99002", kickoff: new Date(k1), finalHomeScore: 2, finalAwayScore: 1, outcome: "WON", settledAt: h(k1, 3) };
  await pred("p1a", { ...f1, aiJobId: "j1b", createdAt: h(k1, -10) });
  await pred("p1b", { ...f1, aiJobId: "j1a", createdAt: h(k1, -30), marketType: "BTTS", selection: { value: "YES" }, outcome: "WON" });
  await pred("p1c", { ...f1, aiJobId: "j1c", createdAt: h(k1, 1) });

  // F2: v1 context with raw payloads; 0-0 draw.
  const k2 = "2026-08-16T18:00:00.000Z";
  const fr = (id: number, date: string, hId: number, aId: number, hg: number, ag: number) => ({ fixture: { id, date, status: { short: "FT" } }, league: { id: L, name: "Synthetic League" }, teams: { home: { id: hId, name: `Synthetic ${hId}` }, away: { id: aId, name: `Synthetic ${aId}` } }, goals: { home: hg, away: ag } });
  await job("j2", h(k2, -20), { v: 1, home: "Synthetic 99003", away: "Synthetic 99004", league: "Synthetic League", kickoff: k2,
    homeContext: { lastFixtures: [fr(91000101, "2026-08-08T15:00:00+00:00", 99003, 99060, 3, 1)] }, awayContext: { lastFixtures: [] }, standings: null,
    h2h: [fr(91000102, "2026-03-01T15:00:00+00:00", 99004, 99003, 1, 2)] });
  await pred("p2", { fixtureApiId: 91000002, homeTeamApiId: 99003, awayTeamApiId: 99004, homeTeam: "Synthetic 99003", awayTeam: "Synthetic 99004", kickoff: new Date(k2), finalHomeScore: 0, finalAwayScore: 0, outcome: "LOST", settledAt: h(k2, 4), aiJobId: "j2", createdAt: h(k2, -20) });

  // F3: conflicting final scores.
  const k3 = "2026-08-17T12:00:00.000Z";
  await job("j3", h(k3, -5), buildStoredContext(v2(99005, 99006, k3)));
  const f3 = { fixtureApiId: 91000003, homeTeamApiId: 99005, awayTeamApiId: 99006, kickoff: new Date(k3), settledAt: h(k3, 3), aiJobId: "j3", createdAt: h(k3, -5) };
  await pred("p3a", { ...f3, finalHomeScore: 1, finalAwayScore: 0, outcome: "WON" });
  await pred("p3b", { ...f3, finalHomeScore: 2, finalAwayScore: 0, outcome: "WON" });

  // F4: only a post-kickoff context.
  const k4 = "2026-08-18T12:00:00.000Z";
  await job("j4", h(k4, 2), buildStoredContext(v2(99007, 99008, k4)));
  await pred("p4", { fixtureApiId: 91000004, homeTeamApiId: 99007, awayTeamApiId: 99008, kickoff: new Date(k4), finalHomeScore: 1, finalAwayScore: 0, outcome: "WON", settledAt: h(k4, 3), aiJobId: "j4", createdAt: h(k4, 2) });

  // F5: settled only after the as_of used below.
  const k5 = "2026-08-19T12:00:00.000Z";
  await job("j5", h(k5, -6), buildStoredContext(v2(99009, 99010, k5)));
  await pred("p5", { fixtureApiId: 91000005, homeTeamApiId: 99009, awayTeamApiId: 99010, kickoff: new Date(k5), finalHomeScore: 3, finalAwayScore: 3, outcome: "LOST", settledAt: new Date("2026-09-30T00:00:00Z"), aiJobId: "j5", createdAt: h(k5, -6) });

  // A hand-entered row with no provider fixture id, and an orphan job with context.
  await pred("p6", { fixtureApiId: null, createdAt: new Date("2026-08-10T00:00:00Z") });
  await job("j7", new Date("2026-08-12T00:00:00Z"), buildStoredContext(v2(99011, 99012, "2026-08-13T12:00:00.000Z")));
  await db.$disconnect();
}

function extract(url: string, out: string, asOf: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync("npx", ["tsx", "research/forecasting/extract/extract.ts", "--out", out, "--as-of", asOf],
      { env: { ...process.env, RESEARCH_READONLY_DATABASE_URL: url, DATABASE_URL: ADMIN }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, output };
  } catch (e: any) {
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

async function main() {
  await seed();
  const asOf = "2026-09-01T00:00:00.000Z";

  console.log("credential and posture refusals:");
  const admin = extract(ADMIN, join(OUT, "refused-admin"), asOf);
  check("the application credential is refused", !admin.ok && /identical to DATABASE_URL/.test(admin.output));
  const rw = extract(RW, join(OUT, "refused-rw"), asOf);
  check("a role holding write grants is refused", !rw.ok && /write privileges/.test(rw.output), rw.output.trim().split("\n").pop());
  check("refusals never print the password", !admin.output.includes("integration-pw") && !rw.output.includes("integration-pw"));

  console.log("writes are impossible inside the snapshot:");
  let writeBlocked = false;
  try {
    await withReadOnlySnapshot(RO, async (q) => { await q(`UPDATE "Prediction" SET confidence = 1 WHERE id = 'p1a'`); });
  } catch (e: any) { writeBlocked = /read-only|permission denied/i.test(String(e?.message)); }
  check("UPDATE inside the research session fails", writeBlocked);

  console.log("extraction through the read-only role:");
  const a = extract(RO, join(OUT, "a"), asOf);
  check("extract succeeds", a.ok, a.ok ? "" : a.output);
  const m = JSON.parse(readFileSync(join(OUT, "a", "manifest.json"), "utf8"));
  const fixtures = readFileSync(join(OUT, "a", "fixtures.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const byId = new Map(fixtures.map((f: any) => [f.fixture_id, f]));
  check("read-only posture recorded", m.database?.read_only_verified === true && m.database?.isolation === "repeatable read");
  check("prediction counts", m.counts.prediction_rows_total === 9 && m.counts.prediction_rows_without_fixture_id === 1 && m.counts.distinct_fixture_ids === 5, JSON.stringify(m.counts));
  check("two fixtures included", m.counts.fixtures_included === 2);
  check("F1 uses the earliest pre-kickoff job", (byId.get(91000001) as any)?.generation?.job_id === "j1a");
  check("F1 engine rows only from that job", (byId.get(91000001) as any)?.engine_predictions.map((e: any) => e.prediction_id).join() === "p1b");
  check("F2 included from a v1 context", (byId.get(91000002) as any)?.generation?.context_version === 1);
  check("F3 excluded for conflicting scores", (byId.get(91000003) as any)?.exclusion_reasons.includes("final_score_conflict"));
  check("F4 excluded: no valid pre-kickoff context", (byId.get(91000004) as any)?.exclusion_reasons.includes("no_valid_pre_kickoff_context"));
  check("F5 settlement after as_of is masked", (byId.get(91000005) as any)?.exclusion_reasons.includes("final_score_missing"));
  const obs = readFileSync(join(OUT, "a", "observations.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  check("orphan job contributes observations", obs.some((o: any) => o.source_ref === "j7"));
  check("v1 h2h meeting extracted with exact kickoff", obs.some((o: any) => o.fixture_id === 91000102 && o.kickoff === "2026-03-01T15:00:00.000Z"));
  check("settlement observations only for verified results", obs.filter((o: any) => o.source === "settlement").map((o: any) => o.fixture_id).sort().join() === "91000001,91000002,91000004");

  console.log("reproducibility:");
  const b = extract(RO, join(OUT, "b"), asOf);
  const mb = JSON.parse(readFileSync(join(OUT, "b", "manifest.json"), "utf8"));
  check("same as_of, identical file hashes", b.ok && JSON.stringify(mb.files) === JSON.stringify(m.files));

  console.log(failures ? `\n${failures} integration check(s) FAILED` : "\nall integration checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
