/**
 * Sprint 05 — odds on every changed surface, rendered and read (render tier).
 *
 * Each surface gets a valid price, a missing one, an invalid one, and where it
 * applies a locked, historical or settled case:
 *   - a valid price is written once, to two decimals, with screen-reader text
 *     "Decimal odds …" and the visual lead (Odds, @, ×) hidden from readers;
 *   - a missing or invalid price is never printed as a number: the surface shows
 *     its own "not available" state, or nothing where it never offered one;
 *   - a saved price is labelled as the one saved, and a locked row carries no
 *     price at all;
 *   - paid quote labels claim only what the data says (no "now", no "closing");
 *   - a multi bet's prices are labelled as the prices when it was built, and a
 *     leg that is not a valid price leaves the whole card without figures
 *     (nothing is recalculated or substituted);
 *   - a settled Bet of the Day shows its result, not a price.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-odds-presentation-render.tsx
 */
import "./lib/reactCacheShim";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OddsFigure } from "../src/components/OddsFigure";
import { PredictionCard } from "../src/components/PredictionCard";
import { ComboCard } from "../src/components/ComboCard";
import { TrendCard } from "../src/components/TrendCard";
import { BetOfTheDayCard } from "../src/components/BetOfTheDayCard";
import { PickRow, SavedRow } from "../src/components/personal/DashboardParts";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && got !== undefined ? ` — ${String(got).slice(0, 260)}` : ""}`);
};
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const BAD = [0, 1, 0.5, -3, NaN, Infinity];
const NUMBER_JUNK = /NaN|Infinity|\b0\.00\b|-\d\.\d\d/;

console.log("\nOddsFigure");
const f = html(<OddsFigure value={1.85} lead="Odds " />);
check("writes 1.85 once", text(f).includes("1.85") && (text(f).match(/1\.85/g) ?? []).length === 1, text(f));
check("screen readers hear 'Decimal odds 1.85'", f.includes('<span class="sr-only">Decimal odds </span>1.85'), f);
check("the visual lead is hidden from screen readers", f.includes('<span aria-hidden="true">Odds </span>'));
check("tail text is read, not hidden", html(<OddsFigure value={2.1} tail="when saved" />).includes("<span> when saved</span>"));
for (const v of [null, undefined, ...BAD]) check(`renders nothing for ${String(v)}`, html(<OddsFigure value={v} lead="Odds " />) === "", html(<OddsFigure value={v} />));

console.log("\ndashboard pick and saved rows");
const pick = (odds: number | null) => ({ id: "a", category: "TODAY", categories: [], marketType: "BTTS", market: "Both Teams to Score", pick: "Yes", odds, confidence: 68, outcome: "PENDING", leagueApiId: 39, leagueName: "Premier League", homeTeam: "Arsenal", awayTeam: "Chelsea", homeTeamApiId: 42, awayTeamApiId: 49, fixtureApiId: 1, kickoff: new Date(Date.now() + 36 * 3_600_000), publishedAt: new Date(), finalHomeScore: null, finalAwayScore: null, presented: "TODAY", href: "/x", statusCode: null }) as any;
const pickText = (odds: number | null) => text(html(<PickRow row={pick(odds)} reasons={["team"]} timezone="Africa/Lagos" />));
check("pick row: Odds 1.72", pickText(1.72).includes("Odds 1.72") || pickText(1.72).includes("Decimal odds 1.72"), pickText(1.72));
check("pick row: confidence is separate from odds", pickText(1.72).includes("Confidence 68%"));
for (const v of [null, ...BAD]) check(`pick row: ${String(v)} shows no price`, !/odds/i.test(pickText(v)) && !NUMBER_JUNK.test(pickText(v)), pickText(v));
const saved = (odds: number | null, view: Record<string, unknown> = {}) => ({ id: "s", predictionId: "p", homeTeam: "Arsenal", awayTeam: "Chelsea", homeTeamApiId: 42, awayTeamApiId: 49, leagueApiId: 39, leagueName: "Premier League", kickoff: new Date(Date.now() + 36 * 3_600_000), settledAt: null, savedAt: new Date(), category: "TODAY", market: "Match Winner", pick: "Arsenal", odds, confidence: 70, href: "/m", statusCode: null, view: { state: "upcoming", outcome: null, changedTo: null, finalScore: null, locked: false, ...view } }) as any;
const savedText = (it: any) => text(html(<SavedRow item={it} timezone="Africa/Lagos" />));
check("saved row: the saved price is labelled 'when saved'", /Odds 2\.10 when saved|Decimal odds 2\.10 when saved/.test(savedText(saved(2.1))), savedText(saved(2.1)));
check("saved row: a changed pick keeps the price it was saved with", savedText(saved(2.1, { changedTo: "Chelsea" })).includes("2.10") && savedText(saved(2.1, { changedTo: "Chelsea" })).includes("Your saved pick is shown and settled as saved"));
check("saved row: settled outcome keeps the saved price", savedText(saved(2.1, { state: "settled", outcome: "WON", finalScore: "2-1" })).includes("2.10"));
for (const v of [null, ...BAD]) check(`saved row: ${String(v)} shows no price`, !/odds/i.test(savedText(saved(v))) && !NUMBER_JUNK.test(savedText(saved(v))), savedText(saved(v)));
const lockedSaved = saved(null, { locked: true, state: "locked" });
lockedSaved.market = null; lockedSaved.pick = null; lockedSaved.category = "VIP";
check("saved row: a locked row shows no price, market or pick", !/odds|\d\.\d\d/i.test(savedText(lockedSaved)) && savedText(lockedSaved).includes("upgrade to view"), savedText(lockedSaved));

console.log("\npaid card quote labels");
const NOW = new Date("2026-11-14T12:00:00.000Z");
const paidRow = (price: unknown, extra: Record<string, unknown> = {}) => ({ id: "p1", category: "VIP", market: "Match Winner", pick: "Arsenal to win", marketType: "MATCH_WINNER", confidence: 78, reasoning: "Stronger form.", homeTeam: "Arsenal", awayTeam: "Chelsea", leagueName: "Premier League", leagueApiId: 39, kickoff: new Date(NOW.getTime() + 5 * 3_600_000), marketConfirmation: null, paid: { status: "UPCOMING", statusLabel: "Upcoming", price, publishedAt: "2026-11-13T10:00:00Z", reason: "Picked for VIP." }, ...extra }) as any;
const card = (price: unknown, extra: Record<string, unknown> = {}) => text(html(<PredictionCard p={paidRow(price, extra)} />));
check("entry: 'Price when published'", card({ odds: 1.38, bookmakers: 9, kind: "entry", at: "2026-11-13T10:00:00Z" }).includes("Price when published") && card({ odds: 1.38, bookmakers: 9, kind: "entry", at: null }).includes("1.38"));
const cur = card({ odds: 1.9, bookmakers: 5, kind: "current", at: "2026-11-14T09:00:00Z" });
check("current: 'Latest quote' with its own timestamp, never 'now'", cur.includes("Latest quote") && cur.includes("1.90") && cur.includes("median of 5 books") && !/Price now|right now|live/i.test(cur), cur);
const clo = card({ odds: 1.9, bookmakers: 5, kind: "closing", at: "2026-11-14T09:00:00Z" });
check("closing: 'Last quote before kickoff', not 'Closing price'", clo.includes("Last quote before kickoff") && !clo.includes("Closing price"), clo);
for (const v of BAD) check(`paid card: invalid ${String(v)} → 'No bookmaker quote for this market'`, card({ odds: v, bookmakers: 5, kind: "current", at: "2026-11-14T09:00:00Z" }).includes("No bookmaker quote for this market") && !NUMBER_JUNK.test(card({ odds: v, bookmakers: 5, kind: "current", at: "2026-11-14T09:00:00Z" })));
check("paid card: no quote → 'No bookmaker quote for this market'", card(null).includes("No bookmaker quote for this market"));
check("paid card: a locked card shows no price", !/Latest quote|Price when published|1\.38|Last quote/.test(text(html(<PredictionCard p={paidRow({ odds: 1.38, bookmakers: 9, kind: "entry", at: null }, { locked: true, reasoning: "", paid: undefined })} />))));

console.log("\nmulti bets");
const combo = (odds: unknown[], oddsTier: number | null = 5) => ({ id: "c", title: "5x accumulator", description: null, category: "PREMIUM", oddsTier, legs: odds.map((o, i) => ({ id: `l${i}`, matchLabel: `Home ${i} vs Away ${i}`, market: "Match Winner", pick: `Home ${i}`, odds: o })) }) as any;
const comboText = (c: any, locked = false) => text(html(<ComboCard combo={c} locked={locked} categoryLabel="Premium" bookmakers={[]} />));
const good = comboText(combo([1.5, 1.6, 1.8]));
check("tiered: leg prices and the unchanged product (1.5×1.6×1.8 = 4.32)", good.includes("1.50") && good.includes("1.60") && good.includes("1.80") && good.includes("4.32"), good);
check("tiered: says the prices are those when it was built", good.includes("at the prices when this multi bet was built") && !good.includes("best available prices"), good);
check("tiered: product keeps its '×' lead hidden from screen readers, with Decimal odds text", html(<ComboCard combo={combo([1.5, 1.6, 1.8])} locked={false} categoryLabel="Premium" bookmakers={[]} />).includes('<span aria-hidden="true">×</span><span class="sr-only">Decimal odds </span>4.32'));
for (const bad of BAD) { const t = comboText(combo([1.5, bad, 1.8])); check(`tiered: a leg of ${String(bad)} → no prices, no product`, !/\d\.\d\d/.test(t) && !NUMBER_JUNK.test(t) && !t.includes("combined odds"), t); }
check("hand-built multi bet (no tier): shows no prices, as before", !/combined odds|\d\.\d\d/.test(comboText(combo([null, null], null))));
check("locked multi bet: no price, no leg", !/\d\.\d\d|Home 0/.test(comboText(combo([1.5, 1.6]), true)) && comboText(combo([1.5, 1.6]), true).includes("Subscribe to unlock"));

console.log("\ntrend card");
const trend = (price: unknown) => ({ id: "t", teamName: "Arsenal", crestUrl: null, badge: { title: "Unbeaten", figure: "7", tone: "positive" }, sentence: [{ text: "Arsenal are unbeaten." }], match: "Arsenal vs Chelsea", kickoff: "Sat 14 Nov", href: "/m", price: price === null ? null : { label: "Both teams to score", odds: price } }) as any;
const tr = html(<TrendCard card={trend(1.85)} />);
check("trend: '@ 1.85' with Decimal odds for screen readers", text(tr).includes("1.85") && tr.includes('<span class="sr-only">Decimal odds </span>1.85'), text(tr));
for (const v of [null, ...BAD]) check(`trend: ${String(v)} shows no price line`, !html(<TrendCard card={trend(v)} />).includes(" @ ") && !NUMBER_JUNK.test(text(html(<TrendCard card={trend(v)} />))));

console.log("\nBet of the Day");
const botd = (gate: unknown, outcome = "PENDING", kick = Date.now() + 5 * 3_600_000) => ({ row: { id: "b", homeTeam: "Arsenal", awayTeam: "Chelsea", leagueApiId: 39, leagueName: "Premier League", kickoff: new Date(kick), market: "Match Winner", pick: "Arsenal", marketType: "MATCH_WINNER", selection: null, confidence: 77, reasoning: "x", matchPreview: null, outcome, category: "BET_OF_THE_DAY", homeTeamApiId: 42, awayTeamApiId: 49, betOfDayPinnedAt: null, finalHomeScore: outcome === "PENDING" ? null : 2, finalAwayScore: outcome === "PENDING" ? null : 1 }, odds: null, oddsFetchedAt: new Date(Date.now() - 20 * 60_000), gate }) as any;
const g = (price: number | null) => ({ qualifies: true, reasons: [], price, bookmakers: 6, impliedProbability: 52, edgePP: 4 });
const bt = (d: any) => text(html(<BetOfTheDayCard data={d} variant="hero" />));
const live = bt(botd(g(2.4)));
check("BOTD: shows 2.40, the bookmaker count and the quote's age", live.includes("2.40") && live.includes("Best of 6 bookmakers") && /\d+m ago/.test(live), live);
check("BOTD: confidence and odds stay separate figures", live.includes("77%") && live.includes("confidence"));
for (const v of [null, ...BAD]) check(`BOTD: price ${String(v)} → 'Price not available yet'`, bt(botd(g(v as number | null))).includes("Price not available yet") && !NUMBER_JUNK.test(bt(botd(g(v as number | null)))), bt(botd(g(v as number | null))));
check("BOTD: no gate → 'Price not available yet'", bt(botd(null)).includes("Price not available yet"));
const settled = bt(botd(g(2.4), "WON", Date.now() - 6 * 3_600_000));
check("BOTD: a settled pick shows its result, not a price", settled.includes("Won") || settled.includes("WON"), settled);
check("BOTD: a settled pick does not present the old price as current", !settled.includes("Best of 6 bookmakers"), settled);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
