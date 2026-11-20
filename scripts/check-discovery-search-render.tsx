/**
 * Sprint 08 — the match finder's markup (render tier).
 *
 *   - the filters form: a signed-out reader is not shown a control that does
 *     nothing for them; a signed-in one is; active filters are removable
 *     items outside the collapsed panel; the "N active" count equals the number
 *     of items; the panel's explanatory paragraph is gone;
 *   - a result card has one link to the match (the title, stretched over the
 *     card), no duplicate "View match", the save button above it, a quote line
 *     only when there is a quote, and the existing status wording;
 *   - the empty state names its limits and links to the two fixes;
 *   - labels are plain, nothing says AI, nothing promises a result.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-discovery-search-render.tsx
 */
import "./lib/reactCacheShim";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscoveryFilters, DiscoveryResultCard, DiscoveryEmpty } from "../src/components/PredictionDiscovery";
import { parseDiscovery } from "../src/lib/predictionDiscovery";
import { emptyState } from "../src/lib/discoveryFilters";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && got !== undefined ? ` — ${String(got).slice(0, 300)}` : ""}`);
};
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const NOW = new Date("2026-11-14T10:00:00Z");
const parse = (p: Record<string, string> = {}) => parseDiscovery(p, "Africa/Lagos", NOW);
const filters = (p: Record<string, string>, signedIn: boolean, category?: any) => renderToStaticMarkup(<DiscoveryFilters filter={parse(p)} basePath="/predictions" signedIn={signedIn} params={p} category={category} />);

console.log("\nthe filters form");
const out = filters({}, false);
check("signed out: no interests control, one sign-in line", !out.includes('name="d_personal"') && text(out).includes("Sign in to filter by your followed teams, preferred markets and saved picks."), text(out));
const inn = filters({}, true);
check("signed in: the interests control, no explanatory paragraph", inn.includes('name="d_personal"') && !/Access is checked|Interests use your existing|Browsing is open/.test(text(inn)), text(inn));
check("the odds checkbox reads plainly", text(out).includes("Only with a bookmaker quote") && !/named quotes/.test(text(out)));
check("every other control is still there", ["d_team", "d_date", "d_competition", "d_market", "d_state", "d_window", "d_category", "d_odds"].every((n) => out.includes(`name="${n}"`)));
check("on a category page the category control stays out (it is fixed there)", !filters({}, false, "GENIUS").includes('name="d_category"'));
check("nothing set: no chips, the summary hints what is inside", !out.includes('aria-label="Active filters"') && text(out).includes("Filters · date, competition, market & more"), text(out));
const pastDay = filters({ d_date: "2026-11-13" }, false);
check("a past date shows ONE chip (the date) and '1 active', not a phantom status filter", (pastDay.match(/aria-label="Remove filter: /g) ?? []).length === 1 && text(pastDay).includes("· 1 active") && pastDay.includes("Remove filter: Fri 13 Nov"), text(pastDay));

const p3 = { d_team: "bayern", d_market: "BTTS", d_competition: "39", d_state: "all", d_page: "2", date: "tomorrow" };
const act = filters(p3, true);
const chips = [...act.matchAll(/aria-label="Remove filter: ([^"]+)"/g)].map((m) => m[1]);
check("three active filters → three chips and '3 active'", chips.length === 3 && text(act).includes("· 3 active"), chips.join("|"));
check("the chips sit outside the collapsed panel (visible with the panel closed)", act.indexOf('aria-label="Active filters"') < act.indexOf("<details"));
const tagOf = (label: string) => act.match(new RegExp(`<a [^>]*aria-label="Remove filter: ${label}"[^>]*>`))![0];
const hrefOf = (label: string) => new URL(tagOf(label).match(/href="([^"]+)"/)![1].replace(/&amp;/g, "&"), "http://x").searchParams;
const market = hrefOf("Both teams to score");
check("a chip removes its own filter and nothing else (and resets the page)", !market.has("d_market") && market.get("d_competition") === "39" && market.get("d_state") === "all" && market.get("d_team") === "bayern" && market.get("date") === "tomorrow" && !market.has("d_page"));
check("each chip is at least 36px tall", chips.every((c) => /min-h-9/.test(tagOf(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))));
check("the Search button and the Team box are unchanged", out.includes('aria-label="Find predictions"') && out.includes('type="search"') && out.includes('name="d_team"'));

console.log("\na result card");
const item: any = { id: "p1", category: "TODAY", home: "Arsenal", away: "Chelsea", league: "Premier League", leagueApiId: 39, kickoff: new Date("2026-11-14T15:00:00Z"), market: "Both Teams to Score", pick: "Yes", confidence: 68, phase: "upcoming", statusVerified: false, statusLabel: null, href: "/predictions/match/arsenal-vs-chelsea-2026-11-14", quote: null };
const card = renderToStaticMarkup(<DiscoveryResultCard item={item} zone="Africa/Lagos" />);
check("one link to the match, on the title; no second 'View match' link", (card.match(/href="\/predictions\/match\//g) ?? []).length === 1 && !card.includes("View match"), card);
check("the title link is stretched over the card; the card is the positioning context", card.includes("after:absolute after:inset-0") && /<article class="card relative/.test(card));
check("the save control sits above the stretched link", /relative z-10/.test(card));
check("match, competition, kickoff in the reader's zone, market and pick are shown", ["Arsenal", "Chelsea", "Premier League", "16:00", "Both Teams to Score", "Yes", "upcoming · stored schedule"].every((s) => text(card).includes(s)), text(card));
check("no quote: nothing is said about quotes on the card", !/quote/i.test(text(card)), text(card));
const quoted = renderToStaticMarkup(<DiscoveryResultCard item={{ ...item, quote: { decimal: 1.85, bookmaker: "Demo Book", kind: "cached", timeBasis: "provider", at: new Date("2026-11-14T09:00:00Z") } }} zone="Africa/Lagos" />);
check("with a quote: the price, bookmaker, its kind and its own timestamp", /Decimal odds\s*1\.85/.test(text(quoted)) && text(quoted).includes("Demo Book") && text(quoted).includes("cached quote") && /Provider quote 14 Nov, 10:00/.test(text(quoted)), text(quoted));
check("a started match keeps its status label", text(renderToStaticMarkup(<DiscoveryResultCard item={{ ...item, phase: "started", statusLabel: "Kicked off", statusVerified: true }} zone="Africa/Lagos" />)).includes("Kicked off"));
check("a missing competition does not break the card", text(renderToStaticMarkup(<DiscoveryResultCard item={{ ...item, league: null }} zone="Africa/Lagos" />)).includes("Competition unavailable"));

console.log("\nthe empty state");
const empty = renderToStaticMarkup(<DiscoveryEmpty state={emptyState(parse({ d_team: "bayern" }), "/predictions", { d_team: "bayern" })} />);
check("names the limits", text(empty).includes("No published predictions for “bayern” · Sat 14 Nov · upcoming only."), text(empty));
check("links: include started and finished; clear all filters (each ≥ 44px)", /Include started and finished/.test(text(empty)) && /Clear all filters/.test(text(empty)) && (empty.match(/min-h-11/g) ?? []).length === 2, empty);
check("it is a status message for screen readers", empty.includes('role="status"'));
check("it does not say the match is unavailable or does not exist", !/does not exist|unavailable|not available/i.test(text(empty)));

console.log("\nwording");
const all = out + inn + act + card + quoted + empty;
check("no AI wording, no promised result, no urgency", !/\bAI\b|guarantee|sure win|hurry|last chance/i.test(text(all)));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
