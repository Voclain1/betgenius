/**
 * Sprint 08 — the match finder's search against a real (isolated) database.
 *
 * Inserts its own predictions (names carry a unique marker so no other row can
 * match), runs the real discovery query as a signed-out, a free and a VIP
 * reader, and asserts: accents, case, spacing, "vs", two-name and partial
 * matches; a two-word club not matching across two clubs; "%" and "_" taken
 * literally; symbols-only matching nothing; hostile text harmless; a VIP-only
 * match never found, counted or hinted at for a reader without access, found
 * for one with it; Lagos day boundaries; filters combined; the prefilter
 * bounded. Deletes its rows in `finally`. Refuses to run anywhere but an
 * integration database.
 *
 * Run: npm run preflight:integration (or directly with the integration env).
 */
export {};

import "./lib/reactCacheShim";
import { assertIntegrationDatabase } from "./lib/dbSafety";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

async function main() {
  await assertIntegrationDatabase();
  const { prisma } = await import("../src/lib/prisma");
  const { parseDiscovery } = await import("../src/lib/predictionDiscovery");
  const { loadDiscovery } = await import("../src/lib/predictionDiscoveryData");
  const { teamSearchIds } = await import("../src/lib/discoveryTeamSearch");
  const { matchSlug } = await import("../src/lib/slug");
  const { ANONYMOUS } = await import("../src/lib/entitlement");

  const tag = `ZQ${Date.now().toString(36)}`.toUpperCase();
  const api = 1_930_000_000 + Math.floor(Math.random() * 100_000);
  const user = await prisma.user.create({ data: { email: `s08-search-${tag.toLowerCase()}@example.invalid` } });
  const now = new Date();
  // Noon Lagos tomorrow = 11:00Z: safely inside one Lagos calendar day.
  const noon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 11, 0, 0));
  const dateOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d);
  const day = dateOf(noon);
  const nextDay = dateOf(new Date(+noon + 86_400_000));
  const free = { role: "USER", tier: "FREE", status: "ACTIVE" } as const;
  const vip = { role: "USER", tier: "VIP", status: "ACTIVE" } as const;
  const q = (extra: Record<string, string>, d = day) => parseDiscovery({ d_date: d, d_state: "all", ...extra }, "Africa/Lagos", now);
  const ids: string[] = [];
  let n = 0;
  async function row(home: string, away: string, over: Record<string, unknown> = {}) {
    n++;
    const p = await prisma.prediction.create({
      data: {
        authorId: user.id, homeTeam: `${home} ${tag}`, awayTeam: `${away} ${tag}`, homeTeamApiId: api + n, awayTeamApiId: api + 5000 + n,
        leagueApiId: api, leagueName: "Synthetic Search League", fixtureApiId: null, kickoff: noon, status: "PUBLISHED", publishedAt: now,
        category: "FEATURED", categories: { create: [{ category: "FEATURED" }] }, market: "Both Teams to Score", marketType: "BTTS",
        selection: { value: "YES" }, pick: "Yes", confidence: 80, reasoning: "Synthetic", manualSettlementOnly: false, ...over,
      } as any,
    });
    await prisma.prediction.update({ where: { id: p.id }, data: { matchSlugKey: matchSlug(p) } });
    ids.push(p.id);
    return p;
  }
  const names = async (extra: Record<string, string>, viewer: any = ANONYMOUS, d = day) =>
    (await loadDiscovery(q(extra, d), viewer, undefined, undefined, now)).items.map((i) => `${i.home}|${i.away}`.replaceAll(` ${tag}`, ""));
  const one = (arr: string[], want: string) => arr.length === 1 && arr[0] === want;

  try {
    await row("Fenerbahçe", "Beşiktaş");
    await row("Real Madrid", "Barcelona");
    await row("Real Sociedad", "Atlético Madrid");
    await row("Arsenal", "Chelsea", { marketType: "OVER_UNDER", market: "Total Goals", selection: { line: 2.5, direction: "OVER" }, pick: "Over 2.5 Goals" });
    await row("Privatespor", "Hiddenspor", { category: "VIP", categories: { create: [{ category: "VIP" }] }, provenance: "VIP_GENERATED", pick: "PRIVATE_S08_SEARCH" });
    // Day edges in Lagos (UTC+1): 23:30 local is 22:30Z the same day; 00:30 local next day is 23:30Z.
    const edgeLate = new Date(`${day}T22:30:00Z`);
    const edgeEarly = new Date(`${day}T23:30:00Z`);
    await row("Lateedge", "Eveningfc", { kickoff: edgeLate });
    await row("Earlyedge", "Midnightfc", { kickoff: edgeEarly });

    console.log("\nreading what was typed");
    check("an accent-free query finds the accented fixture", one(await names({ d_team: `fenerbahce ${tag}` }), "Fenerbahçe|Beşiktaş"));
    check("…in capitals, and by the other club", one(await names({ d_team: `BESIKTAS ${tag}` }), "Fenerbahçe|Beşiktaş"));
    check("an accented query finds it too", one(await names({ d_team: `Fenerbahçe ${tag}` }), "Fenerbahçe|Beşiktaş"));
    check("two names find the fixture", one(await names({ d_team: `fenerbahce ${tag} besiktas ${tag}` }), "Fenerbahçe|Beşiktaş"));
    check("'vs' between the names finds it", one(await names({ d_team: `fenerbahce ${tag} vs besiktas ${tag}` }), "Fenerbahçe|Beşiktaş"));
    check("outer and inner extra spaces do not defeat a match", one(await names({ d_team: `   real    madrid   ${tag}  ` }), "Real Madrid|Barcelona"));
    check("a two-word club does not match across two clubs (Real Sociedad v Atlético Madrid is not 'real madrid')", (await names({ d_team: `real madrid ${tag}` })).join() === "Real Madrid|Barcelona");
    check("a shared word finds both fixtures", (await names({ d_team: `madrid ${tag}` })).sort().join() === "Real Madrid|Barcelona,Real Sociedad|Atlético Madrid");
    check("a partial finds it", (await names({ d_team: `ars` })).includes("Arsenal|Chelsea"));
    check("a competition name is not read as a team", (await names({ d_team: "synthetic search league" })).length === 0);

    console.log("\nwildcards and hostile text");
    check("'%' alone matches nothing (it used to match everything)", (await names({ d_team: "%" })).length === 0);
    check("'_____' alone matches nothing", (await names({ d_team: "_____" })).length === 0);
    check("'f_n' does not use '_' as a wildcard for Fenerbahçe", (await names({ d_team: "f_n" })).length === 0);
    check("a trailing '%' is not a wildcard: 'fener%' reads as 'fener'", (await names({ d_team: "fener%" })).includes("Fenerbahçe|Beşiktaş") && (await names({ d_team: "fener%" })).every((r) => r === "Fenerbahçe|Beşiktaş"));
    for (const evil of ["'; DROP TABLE \"Prediction\"; --", "\\", "\\' OR 1=1 --", "😀 ⚽", "a".repeat(500), "\u0000x"]) {
      let ok = true;
      try {
        const r = await loadDiscovery(q({ d_team: evil }), ANONYMOUS, undefined, undefined, now);
        ok = Array.isArray(r.items);
      } catch {
        ok = false;
      }
      check(`hostile text is harmless: ${JSON.stringify(evil.slice(0, 18))}`, ok);
    }
    check("the table is still there", (await prisma.prediction.count({ where: { id: { in: ids } } })) === ids.length);

    console.log("\nentitlement");
    const hidden = `privatespor ${tag}`;
    check("signed out: the VIP-only match is not found", (await names({ d_team: hidden })).length === 0);
    check("free: not found", (await names({ d_team: hidden }, free)).length === 0);
    check("VIP: found", one(await names({ d_team: hidden }, vip), "Privatespor|Hiddenspor"));
    const anonAll = await loadDiscovery(q({ d_team: tag }), ANONYMOUS, undefined, undefined, now);
    const vipAll = await loadDiscovery(q({ d_team: tag }), vip, undefined, undefined, now);
    check("the count a signed-out reader sees excludes the hidden match, and is lower than VIP's by exactly one", vipAll.matched - anonAll.matched === 1, `${anonAll.matched} vs ${vipAll.matched}`);
    check("no item for a signed-out reader mentions the hidden fixture or its pick", !JSON.stringify(anonAll.items).match(/Privatespor|Hiddenspor|PRIVATE_S08/));
    check("the id prefilter does contain the hidden row (it is only a prefilter)…", ((await teamSearchIds(hidden, q({}).bounds)) ?? []).length === 1);
    check("…and is never what the reader is shown: results come from the access-checked query", (await names({ d_team: hidden })).length === 0);

    console.log("\nfilters together and day edges");
    check("team + market narrows", one(await names({ d_team: "arsenal", d_market: "OVER_UNDER" }), "Arsenal|Chelsea") && (await names({ d_team: "arsenal", d_market: "BTTS" })).length === 0);
    check("team + competition narrows", one(await names({ d_team: `arsenal`, d_competition: String(api) }), "Arsenal|Chelsea") && (await names({ d_team: "arsenal", d_competition: String(api + 1) })).length === 0);
    check("23:30 Lagos belongs to the day, 00:30 the next day belongs to the next", one(await names({ d_team: `lateedge ${tag}` }), "Lateedge|Eveningfc") && (await names({ d_team: `earlyedge ${tag}` })).length === 0 && one(await names({ d_team: `earlyedge ${tag}` }, ANONYMOUS, nextDay), "Earlyedge|Midnightfc") && (await names({ d_team: `lateedge ${tag}` }, ANONYMOUS, nextDay)).length === 0);
    check("an empty box applies no team filter", (await names({ d_team: "" })).length >= 6);
    check("the prefilter returns null for an empty box and [] for symbols only", (await teamSearchIds("", q({}).bounds)) === null && (await teamSearchIds("%%", q({}).bounds))!.length === 0);
  } finally {
    await prisma.prediction.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => null);
    await prisma.$disconnect();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
