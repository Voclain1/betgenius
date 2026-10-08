/**
 * How fresh the cached football data is: league tables, team crests, squads
 * and coaches. READ-ONLY. Safe against production.
 *
 * Run: npx tsx --env-file=.env scripts/measure-football-data.ts
 */
export {};

// teamProfile wraps its loader in React's cache(), which only exists under
// the server build; outside Next it is a pass-through.
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";

const DAY = 86_400_000;
const age = (d: Date | null | undefined) => (d ? `${((Date.now() - d.getTime()) / DAY).toFixed(1)}d` : "never");

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
    console.log("session verified read-only");
  }

  console.log("\n1. League caches (season, ages, table shape):");
  const leagues = await prisma.leagueEnrichmentCache.findMany({ orderBy: { leagueApiId: "asc" } });
  for (const l of leagues) {
    const rows = (l.standingsJson as any[] | null) ?? [];
    const played = rows.map((r) => r.played ?? 0);
    const top = rows.slice(0, 3).map((r) => `${r.teamName}(${r.points})`).join(", ");
    console.log(
      `   ${String(l.leagueApiId).padStart(4)} season ${l.season ?? "?"}  table ${age(l.fetchedAt)}  attempt ${age(l.lastAttemptAt)}  players ${age(l.playersFetchedAt)}  rows ${rows.length} played ${played.length ? `${Math.min(...played)}-${Math.max(...played)}` : "-"}  top: ${top || "-"}${l.lastError ? `  ERR: ${l.lastError.slice(0, 80)}` : ""}`,
    );
  }

  for (const id of [39, 140, 135]) {
    const l = leagues.find((x) => x.leagueApiId === id);
    const sc = ((l?.topScorersJson as any[] | null) ?? []).slice(0, 3).map((r) => `${r.name} ${r.value}g/${r.appearances}apps`).join(", ");
    const up = ((l?.upcomingJson as any[] | null) ?? []).slice(0, 2).map((f) => `${f.date?.slice(0, 10)} ${f.homeTeam}-${f.awayTeam}`).join("; ");
    console.log(`   league ${id}: scorers ${sc || "-"} | upcoming ${up || "-"}`);
  }

  console.log("\n2. Team caches:");
  const teams = await prisma.teamEnrichmentCache.findMany({
    select: { teamApiId: true, teamName: true, leagueApiId: true, season: true, crestUrl: true, fetchedAt: true, squadFetchedAt: true, coachJson: true, squadJson: true, lastError: true },
  });
  const bucket = (d: Date | null) => (!d ? "never" : Date.now() - d.getTime() < 7 * DAY ? "<7d" : Date.now() - d.getTime() < 30 * DAY ? "7-30d" : Date.now() - d.getTime() < 90 * DAY ? "30-90d" : ">90d");
  const tally = (f: (t: (typeof teams)[number]) => string) => {
    const m: Record<string, number> = {};
    for (const t of teams) m[f(t)] = (m[f(t)] ?? 0) + 1;
    return JSON.stringify(m);
  };
  console.log(`   rows ${teams.length}, crest missing ${teams.filter((t) => !t.crestUrl).length}`);
  console.log(`   seasons ${tally((t) => String(t.season))}`);
  console.log(`   form refresh age ${tally((t) => bucket(t.fetchedAt))}`);
  console.log(`   squad refresh age ${tally((t) => bucket(t.squadFetchedAt))}`);

  const epl = leagues.find((l) => l.leagueApiId === 39);
  const eplIds = new Set(((epl?.standingsJson as any[] | null) ?? []).map((r) => r.teamId));
  console.log("\n3. Premier League clubs in the team cache (name, squad age, size, coach):");
  for (const t of teams.filter((t) => eplIds.has(t.teamApiId) || t.leagueApiId === 39)) {
    const coach = t.coachJson as any;
    console.log(`   ${String(t.teamApiId).padStart(5)} ${String(t.teamName).padEnd(24)} season ${t.season} squad ${age(t.squadFetchedAt)} (${((t.squadJson as any[]) ?? []).length})  coach ${coach?.name ?? "-"}${coach?.since ? ` since ${coach.since}` : ""}`);
  }

  console.log("\n4. Predictions (last 30d + upcoming) missing team ids:");
  const preds = await prisma.prediction.findMany({
    where: { kickoff: { gte: new Date(Date.now() - 30 * DAY) } },
    select: { homeTeamApiId: true, awayTeamApiId: true, homeTeam: true, awayTeam: true },
  });
  const missing = preds.filter((p) => p.homeTeamApiId == null || p.awayTeamApiId == null);
  console.log(`   ${missing.length} of ${preds.length}; e.g. ${missing.slice(0, 5).map((p) => `${p.homeTeam} v ${p.awayTeam}`).join("; ")}`);

  console.log("\n5. Team name drift (Prediction name vs cached name for the same id):");
  const nameById = new Map(teams.map((t) => [t.teamApiId, t.teamName]));
  const drift = new Map<string, number>();
  for (const p of preds) {
    for (const [id, name] of [[p.homeTeamApiId, p.homeTeam], [p.awayTeamApiId, p.awayTeam]] as const) {
      const cached = id != null ? nameById.get(id) : undefined;
      if (cached && name && cached !== name) drift.set(`${id}: "${name}" vs cache "${cached}"`, 1);
    }
  }
  console.log(`   ${drift.size}${drift.size ? ": " + [...drift.keys()].slice(0, 15).join("; ") : ""}`);

  console.log("\n6. Curated honours: each team id against the name stored for it:");
  const { CLUB_HONOURS, clubHonours } = await import("../src/lib/clubHonours");
  const ids = Object.keys(CLUB_HONOURS).map(Number);
  const stored = await prisma.prediction.findMany({
    where: { OR: [{ homeTeamApiId: { in: ids } }, { awayTeamApiId: { in: ids } }] },
    distinct: ["homeTeamApiId"],
    select: { homeTeamApiId: true, homeTeam: true, awayTeamApiId: true, awayTeam: true },
  });
  const seen = new Map<number, string>();
  for (const r of stored) {
    if (r.homeTeamApiId != null && ids.includes(r.homeTeamApiId)) seen.set(r.homeTeamApiId, r.homeTeam ?? "");
    if (r.awayTeamApiId != null && ids.includes(r.awayTeamApiId) && !seen.has(r.awayTeamApiId)) seen.set(r.awayTeamApiId, r.awayTeam ?? "");
  }
  for (const id of ids) {
    const name = seen.get(id) ?? nameById.get(id) ?? null;
    console.log(`   ${String(id).padStart(4)} ${String(name).padEnd(26)} ${name == null ? "NO NAME ON FILE" : clubHonours(id, name) ? "ok" : "MISMATCH (honours hidden)"}`);
  }

  console.log("\n7. Team pages as they would render (read-only), for a few clubs:");
  // require, not import(): on the runner a dynamic import goes through the ESM
  // loader, which does not see the react.cache stub patched in above.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getTeamProfile, buildTeamAbout } = require("../src/lib/teamProfile") as typeof import("../src/lib/teamProfile");
  for (const id of [49, 165, 529, 42]) {
    const team = await prisma.teamEnrichmentCache.findUnique({ where: { teamApiId: id } });
    const name = team?.teamName ?? String(id);
    const profile = await getTeamProfile(id);
    const squad = ((team?.squadJson as any[]) ?? []);
    const picks = await prisma.prediction.count({ where: { status: "PUBLISHED", OR: [{ homeTeamApiId: id }, { awayTeamApiId: id }] } });
    console.log(`\n   == ${name} (${id}) ==  country ${profile?.country}  published picks ${picks}`);
    console.log(`   standing: ${profile?.standing ? `${profile.standing.leagueName} ${profile.standing.row.rank}/${profile.standing.size}, ${profile.standing.row.points} pts from ${profile.standing.row.played}` : "-"}`);
    console.log(`   competitions: ${profile?.competitions.map((c) => `${c.name}${c.href ? "" : " (no link)"}`).join(", ") || "-"}`);
    console.log(`   upcoming (${profile?.upcoming.length ?? 0}):`);
    for (const f of profile?.upcoming ?? []) console.log(`     ${f.kickoff.toISOString().slice(0, 16)} ${f.homeTeam} v ${f.awayTeam} [${f.leagueName}]${f.href ? " -> " + f.href : ""}`);
    console.log(`   squad ${squad.length}, with season stats ${squad.filter((p) => p.stats).length}`);
    console.log(`   team cache: fetched ${age(team?.fetchedAt)} ago, attempt ${age(team?.lastAttemptAt)}, squad ${age(team?.squadFetchedAt)}${team?.lastError ? `, ERR ${team.lastError.slice(0, 100)}` : ""}`);
    console.log(`   lastFixtures: ${(((team?.lastFixtures as any[]) ?? []).map((f) => `${String(f.date).slice(0, 10)} ${f.result} v ${f.opponent}`)).join("; ")}`);
    console.log(`   honours: ${(clubHonours(id, name) ?? []).map((h) => `${h.count} ${h.title}`).join("; ") || "-"}`);
    const about = buildTeamAbout({
      name, profile,
      venue: { name: team?.venueName ?? null, city: team?.venueCity ?? null, capacity: team?.venueCapacity ?? null },
      coach: (team?.coachJson as any) ?? null, lastFixtures: (team?.lastFixtures as any) ?? null, squad: squad as any, pickCount: picks,
    });
    for (const p of about) console.log(`   | ${p}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
