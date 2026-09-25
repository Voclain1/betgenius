/**
 * Asserts the adaptive combo quota, combo tagging and admin combo review.
 *
 * The regression: scheduled generation ran the first 20 jobs of every Lagos
 * day as combos, so on quiet days combos took almost the whole queue and
 * FEATURED got 0-5 single-market picks. The replay section below uses the
 * real kickoff-day volumes for 22-27 Sep 2026.
 *
 * Pure: no database, no network. Run: npx tsx scripts/check-adaptive-combo.ts
 */
export {};
import { readFileSync } from "node:fs";
import { LEAGUE_PRIORITY_ORDER } from "../src/lib/leagues";
import {
  adaptiveComboTarget,
  shouldGenerateCombo,
  planComboAllocation,
  compareDayPool,
  type DayPoolEntry,
  comboDestinationCategories,
  COMBO_MAX_PER_DAY,
  COMBO_MIN_PER_DAY,
  COMBO_CEILING_SHARE,
} from "../src/lib/comboQuota";
import {
  ADMIN_COMBO_FILTER,
  matchesAdminCategoryFilter,
  mergeEditedCategories,
  comboMarketEditError,
} from "../src/lib/comboAdmin";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
}
const same = (a: unknown[], b: unknown[]) => JSON.stringify(a) === JSON.stringify(b);
const code = (path: string) => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Claims `fixtures` for one kickoff day in order, as the worker does. */
function simulateDay(eligible: number, fixtures: number, dailyRemaining = Infinity) {
  let combos = 0, singles = 0, budget = dailyRemaining;
  for (let i = 0; i < fixtures; i++) {
    if (shouldGenerateCombo({ eligible, combosForDay: combos, dailyRemaining: budget })) { combos++; budget--; } else singles++;
  }
  return { combos, singles };
}

// ── 1. The target across slate sizes ───────────────────────────────────────
console.log("\n1. adaptiveComboTarget across tiny, small, medium and large slates");
const expected: Array<[number, number, string]> = [
  [0, 0, "empty"], [1, 0, "tiny: one fixture stays single"], [2, 0, "tiny"], [3, 1, "tiny: 40% ceiling"], [5, 2, "tiny"],
  [10, 4, "small: ceiling binds below the floor"], [14, 5, "small"], [15, 6, "small: floor reached"], [16, 6, "small"],
  [23, 6, "quiet day (26 Sep)"], [25, 6, "quiet day (27 Sep)"], [26, 7, "quiet day (23 Sep)"], [32, 8, "quiet day (22 Sep)"],
  [40, 10, "medium"], [60, 15, "medium"], [80, 20, "large: cap"], [128, 20, "large (19 Sep)"], [149, 20, "large (20 Sep)"], [500, 20, "huge"],
];
for (const [n, want, why] of expected) check(`${String(n).padStart(3)} fixtures -> ${want} combos (${why})`, adaptiveComboTarget(n) === want, `got ${adaptiveComboTarget(n)}`);

let capOk = true, ceilingOk = true, singlesOk = true, floorOk = true, monotone = true;
for (let n = 0; n <= 1000; n++) {
  const t = adaptiveComboTarget(n);
  if (t > COMBO_MAX_PER_DAY) capOk = false;
  if (t > Math.floor(n * COMBO_CEILING_SHARE)) ceilingOk = false;
  if (n - t < Math.ceil(n * (1 - COMBO_CEILING_SHARE))) singlesOk = false;
  if (n >= 15 && t < COMBO_MIN_PER_DAY) floorOk = false;
  if (n > 0 && t < adaptiveComboTarget(n - 1)) monotone = false;
}
check(`never exceeds the ${COMBO_MAX_PER_DAY}/day cap (n = 0..1000)`, capOk);
check(`never exceeds ${COMBO_CEILING_SHARE * 100}% of eligible fixtures (n = 0..1000)`, ceilingOk);
check("at least 60% of every slate stays single-market", singlesOk);
check(`Combo Bets gets at least ${COMBO_MIN_PER_DAY} on any day with 15+ fixtures`, floorOk);
check("monotone: more fixtures never means fewer combos", monotone);

// ── 2. Per-fixture decisions ───────────────────────────────────────────────
console.log("\n2. shouldGenerateCombo, claimed fixture by fixture");
{
  const d = simulateDay(32, 32);
  check("a 32-fixture day splits 8 combos / 24 singles", d.combos === 8 && d.singles === 24, JSON.stringify(d));
  const spend = simulateDay(128, 128, 5);
  check("the per-creation-day spend ceiling still binds (5 left -> 5 combos)", spend.combos === 5, JSON.stringify(spend));
  check("no budget -> no combos", simulateDay(50, 50, 0).combos === 0);
  check("combos already spent that day count against the target",
    !shouldGenerateCombo({ eligible: 32, combosForDay: 8, dailyRemaining: 20 }) && shouldGenerateCombo({ eligible: 32, combosForDay: 7, dailyRemaining: 20 }));
  const early = simulateDay(10, 10);
  const later = simulateDay(40, 30);
  check("a ledger that grows later can only add combos, never exceed the final target",
    early.combos <= adaptiveComboTarget(40) && later.combos <= adaptiveComboTarget(40));
}

// ── 3. Replay: real kickoff days 22-27 Sep 2026 ────────────────────────────
console.log("\n3. Replay on production kickoff days 22-27 Sep (read-only measurement)");
{
  // eligible = generation-ledger fixtures; ordinary = combo + single-market jobs that actually ran.
  const days = [
    { day: "22 Sep", eligible: 32, ordinary: 34, oldCombos: 29, oldSingles: 5 },
    { day: "23 Sep", eligible: 26, ordinary: 23, oldCombos: 22, oldSingles: 1 },
    { day: "24 Sep", eligible: 16, ordinary: 13, oldCombos: 9, oldSingles: 4 },
    { day: "25 Sep", eligible: 15, ordinary: 13, oldCombos: 12, oldSingles: 1 },
    { day: "26 Sep", eligible: 23, ordinary: 22, oldCombos: 17, oldSingles: 5 },
    { day: "27 Sep", eligible: 25, ordinary: 17, oldCombos: 17, oldSingles: 0 },
  ];
  const replay = days.map((d) => ({ ...d, ...simulateDay(d.eligible, d.ordinary, 20) }));
  for (const r of replay) console.log(`      ${r.day}: eligible ${r.eligible}  combos ${r.oldCombos} -> ${r.combos}  singles ${r.oldSingles} -> ${r.singles}`);
  check("combos per day: 8, 7, 6, 6, 6, 6", same(replay.map((r) => r.combos), [8, 7, 6, 6, 6, 6]));
  check("singles per day: 26, 16, 7, 7, 16, 11", same(replay.map((r) => r.singles), [26, 16, 7, 7, 16, 11]));
  check("every quiet day now has 6+ single-market picks (a full homepage Featured)", replay.every((r) => r.singles >= 6));
  check("every quiet day keeps 6+ combos for Combo Bets", replay.every((r) => r.combos >= 6));
  check("single-market output rises from 16 to 83 across the six days",
    replay.reduce((s, r) => s + r.oldSingles, 0) === 16 && replay.reduce((s, r) => s + r.singles, 0) === 83);
}

// ── 3b. Which fixtures get the slots ───────────────────────────────────────
console.log("\n3b. Allocation: combo slots spread across the day's ranked slate");
{
  type Fx = { matchKey: string; leagueApiId: number | null; kickoff: Date };
  const base = new Date("2026-09-22T12:00:00Z");
  /** n fixtures, one per priority rank from the top, so rank == index. */
  const slate = (n: number, prefix = "f"): Fx[] =>
    Array.from({ length: n }, (_, i) => ({ matchKey: `${prefix}${String(i).padStart(3, "0")}`, leagueApiId: LEAGUE_PRIORITY_ORDER[i] ?? null, kickoff: base }));
  const ranked = (fx: Fx[]) => [...fx].sort(compareDayPool);

  /**
   * Claims `order` one by one, as the worker does, against a pool that holds
   * `known(i)` of the day's fixtures when claim i happens. Returns the keys
   * that became combos.
   */
  function allocate(all: Fx[], order: Fx[], known: (i: number) => number = () => all.length, dailyRemaining = 20) {
    const state = new Map<string, { generated: boolean; combo: boolean }>();
    const combos: string[] = [];
    let budget = dailyRemaining;
    const maxSeen: number[] = [];
    order.forEach((c, i) => {
      const visible = all.slice(0, known(i));
      const pool: DayPoolEntry[] = visible.map((f) => ({ ...f, generated: state.get(f.matchKey)?.generated ?? false, combo: state.get(f.matchKey)?.combo ?? false }));
      const combo = planComboAllocation({ pool, candidate: c, dailyRemaining: budget });
      state.set(c.matchKey, { generated: true, combo });
      if (combo) { combos.push(c.matchKey); budget--; }
      const poolSize = visible.some((f) => f.matchKey === c.matchKey) ? visible.length : visible.length + 1;
      maxSeen.push(combos.length - adaptiveComboTarget(poolSize));
    });
    return { combos, overshoot: Math.max(0, ...maxSeen) };
  }
  /** First-come: the rule this replaces. */
  function firstCome(all: Fx[], order: Fx[]) {
    const combos: string[] = [];
    for (const c of order) if (shouldGenerateCombo({ eligible: all.length, combosForDay: combos.length, dailyRemaining: 20 })) combos.push(c.matchKey);
    return combos;
  }

  // A quiet 32-fixture day claimed strictly best-first: the worst case for
  // first-come, and what the queue does when a batch is pending together.
  const day = slate(32);
  const order = ranked(day);
  const spread = allocate(day, order).combos;
  const topBlock = order.slice(0, 8).map((f) => f.matchKey);
  const old = firstCome(day, order);
  check("control: first-come gives the whole top 8 to combos", topBlock.every((k) => old.includes(k)));
  check("quota count unchanged: 8 combos", spread.length === adaptiveComboTarget(32), `${spread.length}`);
  check("the best-ranked fixture stays single-market", !spread.includes(order[0].matchKey));
  const topCombos = topBlock.filter((k) => spread.includes(k)).length;
  check("the top quartile is not consumed by combos (it keeps singles)", topCombos < topBlock.length && topBlock.length - topCombos >= 5, `${topCombos} combos in top 8`);
  check("both products get top-quartile fixtures", topCombos >= 1 && topBlock.length - topCombos >= 1);
  check("slots sit at spread positions 2, 6, 10, ... 30",
    same(spread.map((k) => order.findIndex((f) => f.matchKey === k)), [2, 6, 10, 14, 18, 22, 26, 30]));

  const again = allocate(day, order).combos;
  check("deterministic: the same slate gives the same combos", same(again, spread));
  const reversed = allocate(day, [...order].reverse()).combos;
  check("claim order does not move the allocation off-quota", reversed.length === 8);
  const shuffledPool = allocate([...day].reverse(), order).combos;
  check("pool order does not matter (ranking is by league, kickoff, matchKey)", same(shuffledPool, spread));

  // Tiny slates still obey the 40% ceiling.
  let tinyOk = true;
  for (let n = 1; n <= 14; n++) {
    const s = slate(n, `t${n}-`);
    const got = allocate(s, ranked(s)).combos.length;
    if (got > Math.floor(n * 0.4) || got !== adaptiveComboTarget(n)) tinyOk = false;
  }
  check("tiny slates (1-14 fixtures) get exactly their target, within 40%", tinyOk);

  // Early discovery: the pool grows from 5 to 40 while claims happen.
  const grown = slate(40, "g");
  const growOrder = grown; // claimed as they arrive (arrival = rank order here, the worst case)
  const known = (i: number) => Math.min(40, 5 + i * 2);
  const g = allocate(grown, growOrder, known);
  check("early low eligible count under-grants, then catches up to the final target", g.combos.length === adaptiveComboTarget(40), `${g.combos.length}/${adaptiveComboTarget(40)}`);
  check("never more combos than the target for the pool known at the time", g.overshoot === 0);
  const firstFive = allocate(grown.slice(0, 5), grown.slice(0, 5)).combos.length;
  check("a 5-fixture early pool grants at most 2 (its own 40% ceiling)", firstFive <= 2, `${firstFive}`);
  check("spend ceiling still binds", allocate(day, order, undefined, 3).combos.length === 3);

  // The replayed quiet days, claimed best-first (worst case): count, capacity and spread.
  for (const [label, n] of [["22 Sep", 32], ["23 Sep", 26], ["24 Sep", 16], ["25 Sep", 15], ["26 Sep", 23], ["27 Sep", 25]] as const) {
    const s = slate(n, label);
    const o = ranked(s);
    const got = allocate(s, o).combos;
    const top = o.slice(0, Math.ceil(n / 4)).map((f) => f.matchKey);
    const topC = top.filter((k) => got.includes(k)).length;
    check(`${label}: ${got.length} combos (target ${adaptiveComboTarget(n)}), ${n - got.length} singles, top quartile ${topC}C/${top.length - topC}S`,
      got.length === adaptiveComboTarget(n) && n - got.length >= 6 && topC < top.length && top.length - topC >= 2);
  }
}

// ── 4. Combo tagging ───────────────────────────────────────────────────────
console.log("\n4. Assembled doubles: SAME_GAME_DOUBLE always, FEATURED only when asked");
check("ordinary scheduled run (no explicit categories) -> SAME_GAME_DOUBLE only", same(comboDestinationCategories([]), ["SAME_GAME_DOUBLE"]));
check("explicit doubles-only request -> SAME_GAME_DOUBLE only (no FEATURED fallback)", same(comboDestinationCategories(["SAME_GAME_DOUBLE"]), ["SAME_GAME_DOUBLE"]));
check("explicit ?categories=FEATURED -> FEATURED kept (editorial choice)", same(comboDestinationCategories(["FEATURED"]), ["FEATURED", "SAME_GAME_DOUBLE"]));
check("explicit GENIUS+FEATURED -> both kept", same(comboDestinationCategories(["GENIUS", "FEATURED"]), ["GENIUS", "FEATURED", "SAME_GAME_DOUBLE"]));
{
  const assembly = code("src/lib/sameGameDoubleAssembly.ts");
  check("assembly no longer falls back to FEATURED", !/push\("FEATURED"\)/.test(assembly));
  check("assembly tags through comboDestinationCategories", /comboDestinationCategories\(categories\)/.test(assembly));
  check("historical rows untouched: assembly writes tags only on the row it just created",
    (assembly.match(/setPredictionCategories\(/g) ?? []).length === 2 && /setPredictionCategories\(row\.id, tags\)/.test(assembly));
  const route = code("src/app/api/admin/generate/run/route.ts");
  check("run route no longer puts the whole run in REGULAR_COMBO", !/REGULAR_COMBO_INTENT/.test(route));
  check("run route passes only explicit categories as combo destinations", /comboCategories: valid\.filter/.test(route));
  const worker = code("src/lib/generation/worker.ts");
  check("worker decides per fixture from its kickoff day's pool", /lagosDateKey\(c\.kickoff\)/.test(worker) && /planComboAllocation\(\{ pool, candidate/.test(worker));
  check("worker marks each claimed fixture in the pool (later decisions see it)", /Object\.assign\(entry, \{ generated: true, combo: isCombo \}\)/.test(worker));
  const queue = code("src/lib/generation/queue.ts");
  check("compareDayPool mirrors the queue's claim order (rank, kickoff, matchKey)",
    /leaguePriorityRank\(a\.leagueApiId\) - leaguePriorityRank\(b\.leagueApiId\)\s*\|\| a\.kickoff\.getTime\(\) - b\.kickoff\.getTime\(\)\s*\|\| a\.matchKey\.localeCompare\(b\.matchKey\)/.test(queue));
  const feeds = code("src/lib/categoryPredictions.ts");
  check("Combo Bets feed still reads the SAME_GAME_DOUBLE tag plus marketType",
    /"combo-bets": "SAME_GAME_DOUBLE"/.test(feeds) && /cat === "SAME_GAME_DOUBLE" \? \{ marketType: "SAME_GAME_DOUBLE" \}/.test(feeds));
  const curation = code("src/lib/geniusCuration.ts");
  const pool = curation.slice(curation.indexOf("async function curateCategory"), curation.indexOf("const tagged"));
  check("Genius/VIP/Premium curation pool does not depend on FEATURED", pool.length > 0 && !/FEATURED/.test(pool));
}

// ── 5. Admin review ────────────────────────────────────────────────────────
console.log("\n5. Admin: find and edit Combo Bets");
{
  const combo = { marketType: "SAME_GAME_DOUBLE", category: "SAME_GAME_DOUBLE", categories: [{ category: "SAME_GAME_DOUBLE" }] };
  const oldCombo = { marketType: "SAME_GAME_DOUBLE", category: "FEATURED", categories: [{ category: "FEATURED" }, { category: "SAME_GAME_DOUBLE" }] };
  const leg = { marketType: "MATCH_WINNER", category: "SAME_GAME_DOUBLE", categories: [{ category: "SAME_GAME_DOUBLE" }] };
  const single = { marketType: "OVER_UNDER", category: "FEATURED", categories: [{ category: "FEATURED" }] };
  check("Combo Bets filter finds a new SAME_GAME_DOUBLE-only double", matchesAdminCategoryFilter(combo, ADMIN_COMBO_FILTER));
  check("Combo Bets filter finds an older FEATURED-tagged double", matchesAdminCategoryFilter(oldCombo, ADMIN_COMBO_FILTER));
  check("Combo Bets filter skips hidden source legs", !matchesAdminCategoryFilter(leg, ADMIN_COMBO_FILTER));
  check("Combo Bets filter skips ordinary singles", !matchesAdminCategoryFilter(single, ADMIN_COMBO_FILTER));
  check("FEATURED filter unchanged", matchesAdminCategoryFilter(single, "FEATURED") && !matchesAdminCategoryFilter(combo, "FEATURED"));

  const r1 = mergeEditedCategories(["FEATURED", "SAME_GAME_DOUBLE"], []);
  check("editing a double with no editorial category keeps it in Combo Bets", r1.ok && same(r1.categories, ["SAME_GAME_DOUBLE"]));
  const r2 = mergeEditedCategories(["SAME_GAME_DOUBLE"], ["GENIUS"]);
  check("adding GENIUS to a double keeps SAME_GAME_DOUBLE", r2.ok && same(r2.categories, ["GENIUS", "SAME_GAME_DOUBLE"]));
  check("an ordinary row still needs at least one category", !mergeEditedCategories(["FEATURED"], []).ok);
  const r3 = mergeEditedCategories(["FEATURED", "BET_OF_THE_DAY"], ["GENIUS"]);
  check("Bet of the Day is still carried through a save", r3.ok && same(r3.categories, ["GENIUS", "BET_OF_THE_DAY"]));
  const r4 = mergeEditedCategories(["GENIUS"], ["FEATURED"]);
  check("an ordinary replace still replaces", r4.ok && same(r4.categories, ["FEATURED"]));

  check("a double's market fields are rejected", comboMarketEditError(true, { marketType: "MATCH_WINNER" }) !== null && comboMarketEditError(true, { ouLine: 2.5 }) !== null);
  check("a double's non-market edit is accepted", comboMarketEditError(true, {}) === null);
  check("ordinary rows may still edit their market", comboMarketEditError(false, { marketType: "MATCH_WINNER", ouLine: 2.5 }) === null);

  const patch = code("src/app/api/admin/predictions/[id]/route.ts");
  check("PATCH category input is still only the six editorial values",
    /categories: z\.array\(z\.enum\(\["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"\]\)\)/.test(patch));
  check("PATCH market type input still excludes SAME_GAME_DOUBLE", /marketType: z\.enum\(ADMIN_MARKET_TYPES\)/.test(patch));
  check("PATCH merges categories and guards combo market edits", /mergeEditedCategories\(/.test(patch) && /comboMarketEditError\(/.test(patch));
  const list = code("src/app/api/admin/predictions/route.ts");
  check("admin list API filters by marketType=SAME_GAME_DOUBLE server-side", /marketType: z\.literal\(COMBO_MARKET_TYPE\)/.test(list) && /where: query\.data\.marketType/.test(list));
  const listPage = code("src/app/admin/predictions/page.tsx");
  check("admin list offers a Combo Bets view", /value=\{ADMIN_COMBO_FILTER\}>Combo Bets/.test(listPage) && /marketType=\$\{COMBO_MARKET_TYPE\}/.test(listPage));
  const editPage = code("src/app/admin/predictions/[id]/page.tsx");
  check("edit page sends no market fields for a double", /\.\.\.\(combo\s*\?\s*\{\}/.test(editPage));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
