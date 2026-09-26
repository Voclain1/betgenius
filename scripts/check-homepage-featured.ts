/**
 * Asserts the homepage Featured selector (src/lib/homepageFeatured.ts).
 *
 * The regression it guards: the homepage used orderForDisplay, which ranks
 * settled rows by kickoff, so a day's six Featured slots were re-chosen once
 * results came in. Yesterday's excerpt then showed a different six from the
 * one on the page that morning. Every scenario below replays one day through
 * settlement and demands the same ids in the same order at every stage.
 *
 * The three-row Genius excerpt gets the same replay. Also covers: combos kept
 * out of Featured unless exceptional and only after singles run out, short
 * days left short, the empty-state copy, and orderForDisplay itself, which
 * every category/archive feed and the combo feed still use, left as it was.
 *
 * Pure: no database, no network. Run: npx tsx scripts/check-homepage-featured.ts
 */
export {};
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  selectHomepageFeatured,
  selectHomepageGenius,
  isHomepageGeniusEligible,
  featuredBarMessage,
  isExceptionalHomepageCombo,
  HOMEPAGE_COMBO_MIN_CONFIDENCE,
  HOMEPAGE_FEATURED_LIMIT,
  HOMEPAGE_GENIUS_LIMIT,
  type HomepageComboLeg,
} from "../src/lib/homepageFeatured";
import { orderForDisplay } from "../src/lib/predictionOrdering";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

type Row = {
  id: string;
  marketType: string;
  confidence: number;
  leagueApiId: number | null;
  publishedAt: Date;
  kickoff: Date;
  outcome: string;
  settledAt: Date | null;
  manualSettlementOnly: boolean;
  selection: unknown;
  homeTeamApiId: number;
  awayTeamApiId: number;
};

const EPL = 39;
const OBSCURE = 999999;
const DAY = "2026-09-19";
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00Z`);

let n = 0;
function single(id: string, confidence: number, kickoff: string, leagueApiId: number | null = OBSCURE, publishedAt = "06:00"): Row {
  n++;
  return {
    id, marketType: "MATCH_WINNER", confidence, leagueApiId, publishedAt: at(publishedAt), kickoff: at(kickoff),
    outcome: "PENDING", settledAt: null, manualSettlementOnly: false, selection: { value: "HOME" },
    homeTeamApiId: 1000 + n, awayTeamApiId: 2000 + n,
  };
}

/** Replays settlement exactly as the settle route writes it: outcome, settledAt, sometimes a corrected kickoff or the manual flag. */
function settle(rows: Row[], results: Record<string, "WON" | "LOST" | "VOID">, extra: Partial<Row> = {}): Row[] {
  return rows.map((r) => (results[r.id] ? { ...r, outcome: results[r.id], settledAt: at("23:30"), ...extra } : r));
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const pick = (rows: Row[]) => ids(selectHomepageFeatured(rows, new Map()));
/** What the homepage did before this change: orderForDisplay, first six. */
const legacy = (rows: Row[]) => ids(orderForDisplay(rows).slice(0, HOMEPAGE_FEATURED_LIMIT));

// ── 1. The regression, replayed ─────────────────────────────────────────────
console.log("\n1. Same six through settlement (the reported regression)");
{
  // Ten singles on one Lagos day: confidence, competition and kickoff all vary,
  // with the strongest picks kicking off earliest, the shape that exposed it.
  const morning: Row[] = [
    single("s-88", 88, "12:00"),
    single("s-84", 84, "12:30", EPL),
    single("s-84b", 84, "12:30"),
    single("s-82", 82, "13:00"),
    single("s-80", 80, "14:00", EPL),
    single("s-78", 78, "15:00"),
    single("s-76", 76, "18:00"),
    single("s-74", 74, "19:00", EPL),
    single("s-72", 72, "20:00"),
    single("s-70", 70, "21:00"),
  ];
  const before = pick(morning);
  check("morning: the six strongest, strongest first", same(before, ["s-88", "s-84", "s-84b", "s-82", "s-80", "s-78"]), before.join(","));
  check("morning: an EPL pick breaks a confidence tie ahead of an obscure one", before.indexOf("s-84") < before.indexOf("s-84b"));

  // Afternoon: the early kickoffs settle, some WON, some LOST. One kickoff is
  // corrected by settlement and one fixture is flipped to manual settlement.
  const midday = settle(morning, { "s-88": "WON", "s-84": "LOST", "s-84b": "WON", "s-82": "LOST" });
  midday[3] = { ...midday[3], kickoff: at("13:15") };
  midday[5] = { ...midday[5], manualSettlementOnly: true };
  const during = pick(midday);
  check("partly settled: same six, same order", same(during, before), during.join(","));

  // Night: everything settles, the late low-confidence rows among them.
  const night = settle(midday, {
    "s-80": "WON", "s-78": "LOST", "s-76": "WON", "s-74": "LOST", "s-72": "WON", "s-70": "LOST",
  });
  const after = pick(night);
  check("all settled: same six, same order", same(after, before), after.join(","));

  // Only the result chip changes.
  const shown = selectHomepageFeatured(night, new Map());
  check(
    "all settled: the six now carry their settled outcomes",
    shown.every((r) => r.outcome !== "PENDING") && shown.find((r) => r.id === "s-84")?.outcome === "LOST",
  );
  check(
    "morning: the same six carried PENDING",
    selectHomepageFeatured(morning, new Map()).every((r) => r.outcome === "PENDING"),
  );

  // The check has to be able to fail: the old ordering must rewrite this day.
  const old = legacy(night);
  check("control: orderForDisplay DOES rewrite the settled six (regression reproduced)", !same(old, before), old.join(","));

  // 2. A late, lower-confidence loss cannot take a higher-confidence row's slot.
  console.log("\n2. Lower-confidence settled loss cannot displace a selected row");
  check("s-70 (70%, latest kickoff, LOST) stays out", !after.includes("s-70"));
  check("s-88 (88%, earliest kickoff, WON) stays in", after.includes("s-88"));
  check("control: orderForDisplay puts the 70% loss into the six", old.includes("s-70"));

  // 3. Deterministic regardless of input order: Today, Yesterday and Tomorrow
  // all go through this one function.
  console.log("\n3. Deterministic");
  let stable = true;
  for (let seed = 1; seed <= 8; seed++) {
    // Deterministic Fisher-Yates, so a failure is reproducible.
    const shuffled = [...night];
    let s = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648;
      const j = s % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (!same(pick(shuffled), before)) stable = false;
  }
  check("eight input orders, one output", stable);
  const tomorrow = morning.map((r) => ({ ...r, kickoff: new Date(r.kickoff.getTime() + 86_400_000) }));
  check("tomorrow (all pending) gives the same deterministic six", same(pick(tomorrow), before));
  const tie = [single("t-b", 75, "12:00", OBSCURE, "06:00"), single("t-a", 75, "12:00", OBSCURE, "06:00"), single("t-c", 75, "12:00", OBSCURE, "05:00")];
  check("full tie: earliest published, then id", same(pick(tie), ["t-c", "t-a", "t-b"]), pick(tie).join(","));
}

// ── 4. Combos ───────────────────────────────────────────────────────────────
console.log("\n4. Combo eligibility");
{
  const legs = new Map<string, HomepageComboLeg>();
  let fixture = 5000;
  function leg(id: string, marketType: string, selection: unknown, confidence: number, home: number, over: Partial<HomepageComboLeg> = {}) {
    legs.set(id, { id, status: "PUBLISHED", marketType, selection, confidence, contextComplete: true, homeTeamApiId: home, awayTeamApiId: home + 1, ...over });
  }
  /** A combo whose confidence is its ceiling, min(legA, legB), as assembly writes it. */
  function combo(id: string, a: number, b: number, over: { a?: Partial<HomepageComboLeg>; b?: Partial<HomepageComboLeg>; aMarket?: [string, unknown]; bMarket?: [string, unknown] } = {}): Row {
    fixture += 10;
    const [am, as] = over.aMarket ?? ["MATCH_WINNER", { value: "HOME" }];
    const [bm, bs] = over.bMarket ?? ["OVER_UNDER", { line: 2.5, direction: "OVER" }];
    leg(`${id}-a`, am, as, a, fixture, over.a);
    leg(`${id}-b`, bm, bs, b, fixture, over.b);
    return {
      id, marketType: "SAME_GAME_DOUBLE", confidence: Math.min(a, b), leagueApiId: EPL, publishedAt: at("06:00"),
      kickoff: at("16:00"), outcome: "PENDING", settledAt: null, manualSettlementOnly: false,
      selection: { legIds: [`${id}-a`, `${id}-b`] }, homeTeamApiId: fixture, awayTeamApiId: fixture + 1,
    };
  }

  const exceptional = combo("c-exc", 88, 82);
  const ordinary = [combo("c-72", 80, 72), combo("c-78", 85, 78), combo("c-79", 79, 90)];
  check(`threshold is ${HOMEPAGE_COMBO_MIN_CONFIDENCE}`, HOMEPAGE_COMBO_MIN_CONFIDENCE === 80);
  check("an 82% combo with two sound legs is exceptional", isExceptionalHomepageCombo(exceptional, legs));
  for (const c of ordinary) check(`an ordinary ${c.confidence}% combo is not`, !isExceptionalHomepageCombo(c, legs));

  const rejected: Array<[string, Row]> = [
    ["a missing leg", (() => { const c = combo("c-missing", 90, 90); legs.delete("c-missing-b"); return c; })()],
    ["a leg below the threshold (combo stamped higher than its leg)", { ...combo("c-lowleg", 90, 76), confidence: 85 }],
    ["an ARCHIVED leg", combo("c-archived", 90, 90, { b: { status: "ARCHIVED" } })],
    ["a leg generated without live context", combo("c-noctx", 90, 90, { a: { contextComplete: false } })],
    ["a leg from another fixture", combo("c-otherfix", 90, 90, { b: { homeTeamApiId: 1, awayTeamApiId: 2 } })],
    ["an OTHER-market leg", combo("c-other", 90, 90, { bMarket: ["OTHER", null] })],
    ["a leg with an invalid selection", combo("c-badsel", 90, 90, { bMarket: ["BTTS", { value: "MAYBE" }] })],
    ["a REDUNDANT pair (Home + Home-or-Draw)", combo("c-redundant", 90, 90, { bMarket: ["DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }] })],
    ["a malformed legIds selection", { ...combo("c-malformed", 90, 90), selection: { legIds: ["c-malformed-a"] } }],
  ];
  for (const [why, c] of rejected) check(`excluded: ${why}`, !isExceptionalHomepageCombo(c, legs));

  // Eligibility is pre-match only: settling the combo and its legs changes nothing.
  const settledExceptional = { ...exceptional, outcome: "LOST", settledAt: at("23:30"), manualSettlementOnly: true };
  check("exceptional combo stays eligible after it settles LOST", isExceptionalHomepageCombo(settledExceptional, legs));

  const eightSingles = Array.from({ length: 8 }, (_, i) => single(`f-${i}`, 70 + i, "15:00"));
  const allCombos = [exceptional, ...ordinary];

  console.log("\n5. Combos in the homepage excerpt");
  const full = ids(selectHomepageFeatured([...allCombos, ...eightSingles], legs));
  check("six singles available: no combo at all, not even the exceptional one", full.every((id) => id.startsWith("f-")), full.join(","));
  check("  …and the exceptional combo outranks every single on confidence, yet still loses", exceptional.confidence > Math.max(...eightSingles.map((s) => s.confidence)));

  const fewSingles = [single("f-a", 70, "15:00"), single("f-b", 72, "15:00"), single("f-c", 74, "15:00")];
  const short = ids(selectHomepageFeatured([...allCombos, ...fewSingles], legs));
  check("three singles: singles first, then only the exceptional combo", same(short, ["f-c", "f-b", "f-a", "c-exc"]), short.join(","));
  check("  …ordinary combos leave the remaining slots empty", short.length === 4);

  const onlyOrdinary = ids(selectHomepageFeatured(ordinary, legs));
  check("a day of only ordinary combos shows none", onlyOrdinary.length === 0, onlyOrdinary.join(","));

  const settledDay = [...allCombos, ...fewSingles].map((r) => ({ ...r, outcome: r.id === "c-exc" ? "LOST" : "WON", settledAt: at("23:30") }));
  check("same combo selection once everything has settled", same(ids(selectHomepageFeatured(settledDay, legs)), short));

  // The combo feed is untouched: /predictions/combo-bets still goes through
  // getCategoryPredictions → orderForDisplay, and every combo stays in it.
  console.log("\n6. Combo Bets feed unchanged");
  const feed = orderForDisplay(allCombos);
  check("orderForDisplay still returns every combo, ordinary ones included", feed.length === allCombos.length);
  check("  …highest confidence first while pending", same(ids(feed), ["c-exc", "c-79", "c-78", "c-72"]), ids(feed).join(","));
}

// ── 7. orderForDisplay itself ───────────────────────────────────────────────
console.log("\n7. orderForDisplay unchanged (category / archive / team / league pages)");
{
  const rows = [
    { ...single("o-p70", 70, "12:00") },
    { ...single("o-p90", 90, "20:00") },
    { ...single("o-early-won", 95, "10:00"), outcome: "WON" },
    { ...single("o-late-lost", 60, "21:00"), outcome: "LOST" },
    { ...single("o-p80-epl", 80, "15:00", EPL) },
    { ...single("o-p80", 80, "15:00") },
  ];
  const got = ids(orderForDisplay(rows));
  check(
    "pending by confidence (league breaks ties), then settled newest kickoff first",
    same(got, ["o-p90", "o-p80-epl", "o-p80", "o-p70", "o-late-lost", "o-early-won"]),
    got.join(","),
  );
}

// ── 8. Genius excerpt ───────────────────────────────────────────────────────
console.log("\n8. Genius homepage excerpt: same three through settlement");
{
  const morning: Row[] = [
    single("g-86", 86, "11:00"),
    single("g-83-epl", 83, "12:00", EPL),
    single("g-83", 83, "12:00"),
    single("g-80", 80, "14:00"),
    single("g-77", 77, "19:00"),
    single("g-71", 71, "21:30"),
  ];
  const noLegs = new Map<string, HomepageComboLeg>();
  const before = ids(selectHomepageGenius(morning, noLegs));
  check("morning: the three strongest, EPL first on a tie", same(before, ["g-86", "g-83-epl", "g-83"]), before.join(","));

  const midday = settle(morning, { "g-86": "LOST", "g-83-epl": "WON" });
  check("partly settled: same three, same order", same(ids(selectHomepageGenius(midday, noLegs)), before));

  const night = settle(midday, { "g-83": "LOST", "g-80": "WON", "g-77": "WON", "g-71": "WON" });
  const after = selectHomepageGenius(night, noLegs);
  check("all settled: same three, same order", same(ids(after), before), ids(after).join(","));
  check("all settled: only the outcomes changed", after.map((r) => r.outcome).join() === "LOST,WON,LOST");
  check("a late 71% WON cannot displace the 86% LOST", !ids(after).includes("g-71"));

  const old = ids(orderForDisplay(night).slice(0, HOMEPAGE_GENIUS_LIMIT));
  check("control: orderForDisplay DOES rewrite the settled three", !same(old, before), old.join(","));

  const tomorrow = morning.map((r) => ({ ...r, kickoff: new Date(r.kickoff.getTime() + 86_400_000) }));
  check("tomorrow gives the same deterministic three", same(ids(selectHomepageGenius(tomorrow, noLegs)), before));
  check("input order does not matter", same(ids(selectHomepageGenius([...night].reverse(), noLegs)), before));

  // No Featured confidence bar on Genius: a combo without an O/U 2.5 leg
  // competes on confidence alone.
  const cleanLegs = new Map<string, Pick<HomepageComboLeg, "marketType" | "selection">>([
    ["x", { marketType: "MATCH_WINNER", selection: { value: "HOME" } }],
    ["y", { marketType: "BTTS", selection: { value: "YES" } }],
  ]);
  const geniusCombo = { ...single("g-combo", 90, "16:00"), marketType: "SAME_GAME_DOUBLE", selection: { legIds: ["x", "y"] } };
  check("a GENIUS combo is not held to the Featured combo bar", ids(selectHomepageGenius([...morning, geniusCombo], cleanLegs))[0] === "g-combo");
}

// ── 8b. Genius showcase: distinct matches, no O/U 2.5 ───────────────────────
console.log("\n8b. Genius homepage showcase: one pick per match, no Over/Under 2.5 call");
{
  type Legs = Map<string, Pick<HomepageComboLeg, "marketType" | "selection">>;
  const legs: Legs = new Map();
  const ou = (line: number, direction: "OVER" | "UNDER") => ({ line, direction });
  /** A GENIUS row on its own fixture unless `fixture` names a shared one. */
  function pick(id: string, confidence: number, marketType: string, selection: unknown, fixture?: number): Row {
    const r = single(id, confidence, "15:00");
    return fixture == null
      ? { ...r, marketType, selection }
      : { ...r, marketType, selection, homeTeamApiId: fixture, awayTeamApiId: fixture + 1 };
  }
  function combo(id: string, confidence: number, a: [string, unknown], b: [string, unknown], fixture?: number): Row {
    legs.set(`${id}-a`, { marketType: a[0], selection: a[1] });
    legs.set(`${id}-b`, { marketType: b[0], selection: b[1] });
    return pick(id, confidence, "SAME_GAME_DOUBLE", { legIds: [`${id}-a`, `${id}-b`] }, fixture);
  }

  const over25 = pick("over25", 90, "OVER_UNDER", ou(2.5, "OVER"));
  const under25 = pick("under25", 89, "OVER_UNDER", ou(2.5, "UNDER"));
  const winOver = combo("win-over25", 88, ["MATCH_WINNER", { value: "HOME" }], ["OVER_UNDER", ou(2.5, "OVER")]);
  const bttsOver = combo("btts-over25", 87, ["BTTS", { value: "YES" }], ["OVER_UNDER", ou(2.5, "OVER")]);
  const dcUnder = combo("dc-under25", 86, ["DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }], ["OVER_UNDER", ou(2.5, "UNDER")]);
  const cleanCombo = combo("win-btts", 85, ["MATCH_WINNER", { value: "HOME" }], ["BTTS", { value: "YES" }]);
  const winner = pick("winner", 84, "MATCH_WINNER", { value: "AWAY" });
  const dc = pick("dc", 83, "DOUBLE_CHANCE", { value: "HOME_OR_DRAW" });
  const bttsNo = pick("btts-no", 82, "BTTS", { value: "NO" });
  const teamGoals = pick("team-goals", 81, "TEAM_TOTAL", { side: "HOME", line: 1.5, direction: "OVER" });
  const over15 = pick("over15", 80, "OVER_UNDER", ou(1.5, "OVER"));
  const unreadable = pick("combo-no-legs", 95, "SAME_GAME_DOUBLE", { legIds: ["gone-a", "gone-b"] });

  const excluded: Array<[string, Row]> = [
    ["pure Over 2.5", over25],
    ["pure Under 2.5", under25],
    ["Team to win + Over 2.5", winOver],
    ["BTTS Yes + Over 2.5", bttsOver],
    ["Double Chance + Under 2.5 (combo containing Under 2.5)", dcUnder],
    ["a combo whose legs cannot be read (fails closed)", unreadable],
  ];
  for (const [why, r] of excluded) check(`excluded: ${why}`, !isHomepageGeniusEligible(r, legs));
  const included: Array<[string, Row]> = [
    ["combo without an O/U 2.5 leg (Win + BTTS)", cleanCombo],
    ["Match Winner", winner],
    ["Double Chance", dc],
    ["BTTS No", bttsNo],
    ["team goals (TEAM_TOTAL 1.5)", teamGoals],
    ["O/U on another line (Over 1.5)", over15],
  ];
  for (const [why, r] of included) check(`eligible: ${why}`, isHomepageGeniusEligible(r, legs));
  // A plain pick's legacy side fields are not its market.
  check("eligible: a Match Winner that also carries ouLine 2.5 side info", isHomepageGeniusEligible({ ...winner, ouLine: 2.5 } as Row, legs));

  // The six strongest rows are all O/U 2.5; the selector backfills below them.
  const day = [over25, under25, winOver, bttsOver, dcUnder, unreadable, cleanCombo, winner, dc, bttsNo, teamGoals, over15];
  const got = ids(selectHomepageGenius(day, legs));
  check("backfills past ineligible rows to three distinct eligible picks", same(got, ["win-btts", "winner", "dc"]), got.join(","));

  // One pick per match: the highest-ranked eligible one.
  const sameMatchStrong = pick("fx-strong", 88, "MATCH_WINNER", { value: "HOME" }, 7000);
  const sameMatchO25 = pick("fx-over25", 92, "OVER_UNDER", ou(2.5, "OVER"), 7000);
  const sameMatchWeak = pick("fx-weak", 80, "BTTS", { value: "YES" }, 7000);
  const other1 = pick("other-1", 84, "DOUBLE_CHANCE", { value: "AWAY_OR_DRAW" });
  const other2 = pick("other-2", 70, "BTTS", { value: "NO" });
  const dup = ids(selectHomepageGenius([sameMatchWeak, other2, sameMatchO25, other1, sameMatchStrong], legs));
  check("duplicate fixture keeps only its highest-ranked ELIGIBLE pick", same(dup, ["fx-strong", "other-1", "other-2"]), dup.join(","));
  const byFixtureId = [
    { ...pick("fid-a", 90, "MATCH_WINNER", { value: "HOME" }), fixtureApiId: 555 },
    { ...pick("fid-b", 89, "BTTS", { value: "YES" }), fixtureApiId: 555 },
  ];
  check("the provider fixture id also identifies a match", same(ids(selectHomepageGenius(byFixtureId, legs)), ["fid-a"]));
  check("fewer than three eligible matches shows fewer (no padding)", selectHomepageGenius([over25, sameMatchStrong, sameMatchWeak], legs).length === 1);

  // Settlement does not move the selection.
  const settled = settle(day, Object.fromEntries(day.map((r, i) => [r.id, i % 2 ? "WON" : "LOST"])) as Record<string, "WON" | "LOST">)
    .map((r) => ({ ...r, kickoff: new Date(r.kickoff.getTime() + 3_600_000), manualSettlementOnly: true }));
  check("settling everything (and a kickoff correction) keeps the same ids and order", same(ids(selectHomepageGenius(settled, legs)), got));
  check("input order does not matter", same(ids(selectHomepageGenius([...day].reverse(), legs)), got));
}

// ── 9. Short days and the empty state ───────────────────────────────────────
console.log("\n9. Short days are not padded; empty-state copy");
{
  const legs = new Map<string, HomepageComboLeg>();
  const ordinary = (id: string, c: number): Row => ({
    ...single(id, c, "16:00"), marketType: "SAME_GAME_DOUBLE", selection: { legIds: [`${id}-a`, `${id}-b`] },
  });
  const oneSingle = [single("d-1", 68, "15:00"), ordinary("d-c1", 75), ordinary("d-c2", 72), ordinary("d-c3", 79)];
  check("1 single + ordinary combos: shows exactly 1", same(ids(selectHomepageFeatured(oneSingle, legs)), ["d-1"]));
  check("only ordinary combos: shows 0 (caller renders the quality-bar message)", selectHomepageFeatured(oneSingle.slice(1), legs).length === 0);

  for (const day of ["today", "yesterday", "tomorrow"] as const) {
    const msg = featuredBarMessage(day);
    check(`${day}: names the day`, msg.includes(day === "today" ? "today's" : day === "yesterday" ? "yesterday's" : "tomorrow's"), msg);
    check(`${day}: no threshold, number or rule leaks to readers`, !/\d|combo|confidence|threshold|leg|filter/i.test(msg), msg);
  }

  const page = readFileSync("src/app/(public)/page.tsx", "utf8");
  check("page distinguishes no-FEATURED from none-eligible", /featured\.published === 0/.test(page) && /featuredBarMessage\(day\)/.test(page));
  check("page keeps the View all link to /predictions/featured", /href="\/predictions\/featured"[^>]*>View all/.test(page));
  const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("page no longer ranks either excerpt with orderForDisplay", !/orderForDisplay/.test(pageCode));
  check("page picks Genius with selectHomepageGenius and the combos' legs",
    /fetchCategoryDay\("GENIUS", day\)/.test(page) && /selectHomepageGenius\(rows, await loadComboLegs\(rows\)\)/.test(page));
  const feeds = readFileSync("src/lib/categoryPredictions.ts", "utf8");
  check("/predictions/genius untouched: the category feed never uses the homepage selector",
    !/homepageFeatured|selectHomepageGenius|isHomepageGeniusEligible/.test(feeds) && /return orderForDisplay\(rows\)/.test(feeds));
}

// ── 10. Source guards ───────────────────────────────────────────────────────
console.log("\n10. Source guards");
{
  const src = readFileSync("src/lib/homepageFeatured.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  for (const field of ["outcome", "settledAt", "manualSettlementOnly", "kickoff", "settlementNote"]) {
    check(`selector code never reads ${field}`, !new RegExp(`\\b${field}\\b`).test(src));
  }

  const importers: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && /homepageFeatured/.test(readFileSync(p, "utf8"))) importers.push(p.replace(/\\/g, "/"));
    }
  };
  walk("src");
  const outside = importers.filter((p) => p !== "src/lib/homepageFeatured.ts" && p !== "src/app/(public)/page.tsx");
  check("only the homepage uses the homepage selector", outside.length === 0, outside.join(", "));
  check(
    "category feeds (incl. combo-bets) still order with orderForDisplay",
    /return orderForDisplay\(rows\)/.test(readFileSync("src/lib/categoryPredictions.ts", "utf8")),
  );
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
