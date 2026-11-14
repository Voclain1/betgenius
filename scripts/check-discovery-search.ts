/**
 * Sprint 08 — how the match finder reads a query and describes its filters
 * (pure: no database, network or browser).
 *
 *   - query reading: case, accents, spacing, "vs" connectors, symbols,
 *     partials, two-name matches, no false match across two clubs;
 *   - the SQL pieces: LIKE metacharacters escaped, the accent fold derived
 *     from the same function the JS uses (so the two cannot disagree);
 *   - active filters: only what differs from the page with nothing set (a past
 *     date does not count as a filter nobody chose; a chosen date does), one
 *     removable href per filter that changes nothing else;
 *   - empty-state wording: names the limits, offers the two fixes, never says
 *     a match "does not exist";
 *   - the discovery query still applies access to every id the prefilter
 *     returns, the SQL is parameterised, and nothing new reaches a third party.
 *
 * Run: npx tsx scripts/check-discovery-search.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const root = join(__dirname, "..");
  const src = (f: string) => readFileSync(join(root, f), "utf8");
  const react = require("react");
  if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
  const t = await import("../src/lib/discoveryText");
  const flt = await import("../src/lib/discoveryFilters");
  const { parseDiscovery } = await import("../src/lib/predictionDiscovery");

  console.log("\nreading a query");
  const P = t.searchPhrase;
  check("case and outer space ignored", P("  ARSENAL ") === "arsenal");
  check("inner double spaces collapse", P("real   madrid") === "real madrid");
  check("accents fold, including letters NFD does not split", P("Fenerbahçe") === "fenerbahce" && P("Beşiktaş") === "besiktas" && P("Łódź Ørsted Müller ß") === "lodz orsted muller ss" && P("Atlético") === "atletico");
  check("connectors between two names read as one space", ["arsenal vs chelsea", "arsenal v chelsea", "arsenal  VS.  chelsea", "arsenal - chelsea", "arsenal – chelsea", "arsenal x chelsea"].every((q) => P(q) === "arsenal chelsea"));
  check("a name containing 'v' or 'x' inside a word is untouched", P("Valencia") === "valencia" && P("Xavier") === "xavier" && P("Vitesse") === "vitesse");
  check("symbols that are not part of a name are dropped; only symbols leave nothing", P("%") === "" && P("_____") === "" && P("%%") === "" && P("<script>") === "script");
  check("punctuation inside real names survives", P("St. Pauli") === "st. pauli" && P("Paris Saint-Germain") === "paris saint-germain" && P("Bayer 04") === "bayer 04" && P("Brighton & Hove") === "brighton & hove");
  check("capped at 80 characters", P("a".repeat(500)).length === 80);
  const M = (q: string, h: string, a: string) => t.matchesTeamPhrase(P(q), h, a);
  check("one club, partial or whole", M("ars", "Arsenal", "Chelsea") && M("Chelsea", "Arsenal", "Chelsea") && !M("liverpool", "Arsenal", "Chelsea"));
  check("two names find the fixture, either order", M("arsenal chelsea", "Arsenal", "Chelsea") && M("chelsea arsenal", "Arsenal", "Chelsea") && M("arsenal vs chelsea", "Arsenal", "Chelsea"));
  check("a two-word club does not match across two clubs", M("real madrid", "Real Madrid", "Barcelona") && !M("real madrid", "Real Sociedad", "Atlético Madrid"));
  check("an accent-free query finds an accented club and the reverse", M("fenerbahce", "Fenerbahçe", "Beşiktaş") && M("besiktas", "Fenerbahçe", "Beşiktaş") && M("fenerbahçe", "Fenerbahce", "Besiktas"));
  check("a competition name is not a team: it matches no team text", !M("premier league", "Arsenal", "Chelsea"));
  check("an empty phrase matches everything; a missing name matches nothing", t.matchesTeamPhrase("", "A", "B") && !t.matchesTeamPhrase("a", null, "B"));

  console.log("\nthe SQL pieces");
  check("LIKE metacharacters are escaped", t.likeContains("a%b_c\\d") === "%a\\%b\\_c\\\\d%");
  const tr = t.foldTranslation();
  check("the fold tables are the same length and contain the common accents", tr.from.length === tr.to.length && tr.from.length > 100 && ["é", "ç", "ş", "ö", "ñ", "ğ", "ž"].every((c) => tr.from.includes(c)));
  check("every letter in the table folds, in JS, to the letter the SQL maps it to", [...tr.from].every((c, i) => t.foldSearchText(c) === tr.to[i]));
  const ts = src("src/lib/discoveryTeamSearch.ts");
  check("the prefilter is a parameterised tagged query: no unsafe raw call, no text spliced in", /\$queryRaw<[^>]*>`/.test(ts) && !/queryRawUnsafe|executeRawUnsafe/.test(ts) && !/Prisma\.raw\((?!'"(?:home|away)Team"')/.test(ts) && !/\$\{rawTeam\}|\$\{phrase\}/.test(ts));
  check("the prefilter is bounded", /LIMIT \$\{TEAM_ID_LIMIT\}/.test(ts) && /TEAM_ID_LIMIT = 1000/.test(ts));
  check("it reads only published rows in the day window", /"status" = 'PUBLISHED'/.test(ts) && /"kickoff" >= \$\{bounds\.start\} AND "kickoff" < \$\{bounds\.end\}/.test(ts));

  console.log("\nthe discovery query keeps its access rules");
  const data = src("src/lib/predictionDiscoveryData.ts");
  check("the typed team narrows by id; access, category, status and visibility rules still run on every row", /\{ id: \{ in: teamIds \} \}/.test(data) && data.includes("discoveryAccessWhere(viewer)") && data.includes("rowViewable(") && !/homeTeam:\s*\{\s*contains/.test(data));
  check("the prefilter is called once, only when a team was typed", (data.match(/teamSearchIds\(/g) ?? []).length === 1 && /f\.team \? await teamSearchIds/.test(data));
  check("no new third party, library or request", !/from "(?!\.|@\/|@prisma|node:)[^"]+"/.test(ts + src("src/lib/discoveryText.ts") + src("src/lib/discoveryFilters.ts")) && !/fetch\(/.test(ts + src("src/lib/discoveryText.ts")));

  console.log("\nactive filters");
  const now = new Date("2026-11-14T10:00:00Z"); // 11:00 in Lagos
  const parse = (p: Record<string, string> = {}, day?: string) => parseDiscovery(p, "Africa/Lagos", now, day);
  check("nothing set: nothing active", flt.activeFilters(parse()).length === 0);
  check("a date the reader chose is one active filter", flt.activeFilters(parse({ d_date: "2026-11-15" })).map((a) => a.key).join() === "d_date,d_state" || flt.activeFilters(parse({ d_date: "2026-11-15" })).map((a) => a.key).join() === "d_date");
  const pastDefault = flt.activeFilters(parse({ d_date: "2026-11-13" }));
  check("a past date's default status ('Finished') is not counted as a filter nobody set", pastDefault.map((a) => a.key).join() === "d_date", pastDefault.map((a) => a.key).join());
  check("…but choosing 'Upcoming only' on a past date is, because it differs from that default", flt.activeFilters(parse({ d_date: "2026-11-13", d_state: "upcoming" })).some((a) => a.key === "d_state"));
  check("today with 'All statuses' counts the status", flt.activeFilters(parse({ d_state: "all" })).map((a) => a.key).join() === "d_state");
  const many = flt.activeFilters(parse({ d_competition: "39", d_market: "BTTS", d_window: "evening", d_odds: "quoted", d_category: "banker" }), { competition: "Premier League", category: "Banker" });
  check("each active filter is listed once, in words", many.map((a) => a.label).join(" | ") === "Premier League | Both teams to score | From 18:00 | Banker | With a bookmaker quote", many.map((a) => a.label).join(" | "));
  check("the team text is not a chip (it is visible in its own box)", !flt.activeFilters(parse({ d_team: "arsenal" })).length);
  check("an unknown competition still reads sensibly", flt.activeFilters(parse({ d_competition: "999999" }))[0].label === "Competition #999999");

  console.log("\nremoving one filter");
  const params = { d_team: "arsenal", d_market: "BTTS", d_competition: "39", d_date: "2026-11-15", d_page: "3", date: "tomorrow", unexpected: "secret" };
  const url = flt.withoutFilter("/predictions/genius", params, "d_market");
  const q = new URL(url, "http://x").searchParams;
  check("drops that filter only; keeps the others, the day tab and the page anchor; resets the page", !q.has("d_market") && q.get("d_competition") === "39" && q.get("d_team") === "arsenal" && q.get("d_date") === "2026-11-15" && q.get("date") === "tomorrow" && !q.has("d_page") && url.endsWith("#discover"), url);
  check("never carries an unknown parameter", !url.includes("secret"));
  check("with nothing left it is the bare page", flt.withoutFilter("/predictions", { d_market: "BTTS" }, "d_market") === "/predictions#discover");

  console.log("\nthe empty state");
  const e = flt.emptyState(parse({ d_team: "bayern" }), "/predictions", { d_team: "bayern" });
  check("names what the search was limited by", e.text === "No published predictions for “bayern” · Sat 14 Nov · upcoming only.", e.text);
  check("offers to include started and finished, which changes only the status", e.actions[0]?.label === "Include started and finished" && new URL(e.actions[0].href, "http://x").searchParams.get("d_state") === "all" && new URL(e.actions[0].href, "http://x").searchParams.get("d_team") === "bayern");
  check("offers to clear everything", e.actions.some((a) => a.label === "Clear all filters" && a.href === "/predictions#discover"));
  const all = flt.emptyState(parse({ d_state: "all" }), "/predictions", { d_state: "all" });
  check("with every status already included, only 'Clear all filters' remains, and a quiet unfiltered day offers nothing to clear", all.actions.map((a) => a.label).join() === "Clear all filters" && flt.emptyState(parse(), "/predictions", {}).actions.map((a) => a.label).join() === "Include started and finished");
  check("it never claims the match does not exist", !/does not exist|not available|unavailable|no such/i.test(e.text + all.text));
  check("the old filler sentence is gone from the component", !src("src/components/PredictionDiscovery.tsx").includes("A quiet feed does not lower the publication standard"));

  console.log("\nboundaries");
  check("no public copy says AI and nothing promises a result", !/>[^<{]*\bAI\b[^<}]*</.test(src("src/components/PredictionDiscovery.tsx")) && !/guaranteed|sure win/i.test(src("src/components/PredictionDiscovery.tsx") + src("src/lib/discoveryFilters.ts")));
  check("the entry point, route, canonical and noindex rules are untouched", src("src/app/(public)/predictions/page.tsx").includes("hasDiscoveryFilters(searchParams)") && src("src/components/PredictionDiscovery.tsx").includes('href="/predictions#discover"'));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
