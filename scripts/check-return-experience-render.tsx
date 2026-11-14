/**
 * Sprint 06 — the returning-user surfaces, rendered and read (render tier).
 *
 *   - JumpRow: labelled nav, counts only when positive, hidden from lg;
 *   - saved rows: the settlement date appears for an unlocked settled pick, not
 *     for a locked one or one with no recorded settlement time, and the saved
 *     price stays "when saved" — nothing is re-fetched or replaced;
 *   - the Following card: kickoff in the reader's own timezone, a recorded
 *     result only for a reader allowed to see it, "Awaiting result" instead of
 *     silence once a match is past kickoff, nothing for an upcoming one, a
 *     locked row shows neither pick nor result, missing data does not crash;
 *   - the account sidebar offers Following and keeps a closed mobile sidebar
 *     out of the keyboard and screen-reader order.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-return-experience-render.tsx
 */
import "./lib/reactCacheShim";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JumpRow, SavedRow } from "../src/components/personal/DashboardParts";
import { FollowingFeedCard } from "../src/components/personal/FollowingFeedCard";
import { DashboardShell } from "../src/components/DashboardShell";
import { jumpLinks } from "../src/lib/returnShortcuts";
import { dashboardNavItems } from "../src/lib/dashboardContext";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && got !== undefined ? ` — ${String(got).slice(0, 280)}` : ""}`);
};
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

console.log("\njump row");
const j = html(<JumpRow links={jumpLinks({ savedTotal: 5, upcomingCount: 3, favouriteCount: 0 })} />);
check("a labelled navigation landmark, hidden from lg", j.includes('<nav aria-label="Jump to your sections"') && j.includes("lg:hidden"), j);
check("links (a space separates each label from its count for screen readers): Upcoming 3, Saved 5, Favourites (no count), Following", /Upcoming\s*3/.test(text(j)) && /Saved\s*5/.test(text(j)) && j.includes("Saved <span") && j.includes("Upcoming <span") && /Favourites(?!\s*\d)/.test(text(j)) && text(j).includes("Following"), text(j));
check("in-page anchors and the one real page", j.includes('href="#upcoming"') && j.includes('href="#saved"') && j.includes('href="#favourites"') && j.includes('href="/following"'));
check("each link is at least 36px tall (min-h-9)", (j.match(/min-h-9/g) ?? []).length === 4);
check("a brand-new reader (all zero) sees no counts", !/\d/.test(text(html(<JumpRow links={jumpLinks({ savedTotal: 0, upcomingCount: 0, favouriteCount: 0 })} />))));

console.log("\nsaved rows: settlement date, snapshot price");
const settledAt = new Date("2026-11-12T20:30:00Z");
const saved = (over: Record<string, unknown> = {}, view: Record<string, unknown> = {}) => ({ id: "s", predictionId: "p", homeTeam: "Arsenal", awayTeam: "Chelsea", homeTeamApiId: 42, awayTeamApiId: 49, leagueApiId: 39, leagueName: "Premier League", kickoff: new Date("2026-11-12T18:00:00Z"), settledAt, savedAt: new Date("2026-11-10T09:00:00Z"), category: "TODAY", market: "Match Winner", pick: "Arsenal", odds: 2.1, confidence: 70, href: "/m", statusCode: null, view: { state: "settled", outcome: "WON", changedTo: null, finalScore: "2-1", locked: false, ...view }, ...over }) as any;
const rowText = (it: any, tz = "Africa/Lagos") => text(html(<ul><SavedRow item={it} timezone={tz} /></ul>));
const won = rowText(saved());
check("a settled, unlocked pick shows WON, FT score and when it settled", /WON/.test(won) && won.includes("FT 2-1") && /settled 12 Nov/.test(won), won);
check("the saved price is still the one saved", /Odds\s+(Decimal odds\s+)?2\.10 when saved/.test(won), won);
check("no settlement time → no date, no invented one", !/settled \d/.test(rowText(saved({ settledAt: null }))));
const lockedRow = saved({ market: null, pick: null, odds: null, category: "VIP" }, { locked: true, outcome: null, finalScore: null });
check("a locked row shows no result date, price or pick", !/settled \d|WON|2\.10|Arsenal"|Match Winner/.test(rowText(lockedRow)) && rowText(lockedRow).includes("upgrade to view"), rowText(lockedRow));
check("the date follows the reader's timezone (20:30 UTC is the 13th in Tokyo)", /settled 13 Nov/.test(rowText(saved(), "Asia/Tokyo")), rowText(saved(), "Asia/Tokyo"));
check("a pick the saved selection was graded for keeps its outcome after the live pick changed", /WON/.test(rowText(saved({}, { changedTo: "Chelsea" }))) && rowText(saved({}, { changedTo: "Chelsea" })).includes("Your saved pick is shown and settled as saved"));

console.log("\nFollowing feed card");
const NOW = new Date("2026-11-14T12:00:00Z");
const row = (o: Record<string, unknown> = {}) => ({ homeTeam: "Arsenal", awayTeam: "Chelsea", leagueName: "Premier League", kickoff: new Date("2026-11-14T15:00:00Z"), pick: "Both Teams to Score — Yes", outcome: "PENDING", finalHomeScore: null, finalAwayScore: null, ...o }) as any;
const card = (r: any, allowed = true, tz = "Africa/Lagos") => text(html(<FollowingFeedCard row={r} allowed={allowed} reasons={["Arsenal"]} href="/predictions/match/a-vs-b-2026-11-14" timezone={tz} now={NOW} />));
check("kickoff 15:00 UTC reads 16:00 WAT in Lagos", /16:00 WAT/.test(card(row())), card(row()));
check("…and 00:00 (GMT+9) the next day in Tokyo (the reader's own zone, not fixed WAT)", /Sun 00:00 GMT\+9/.test(card(row(), true, "Asia/Tokyo")) && !card(row(), true, "Asia/Tokyo").includes("WAT"), card(row(), true, "Asia/Tokyo"));
check("upcoming: no status line, pick and match link shown", !/Awaiting result|Kicked off|WON|LOST/.test(card(row())) && card(row()).includes("Both Teams to Score") && card(row()).includes("Open match"));
const past = row({ kickoff: new Date("2026-11-14T08:00:00Z") });
check("past kickoff, no result: says Awaiting result, never silence", /Awaiting result/.test(card(past)), card(past));
check("just kicked off: says Kicked off", /Kicked off/.test(card(row({ kickoff: new Date("2026-11-14T11:00:00Z") }))), card(row({ kickoff: new Date("2026-11-14T11:00:00Z") })));
const done = row({ kickoff: new Date("2026-11-13T15:00:00Z"), outcome: "WON", finalHomeScore: 2, finalAwayScore: 1 });
check("settled, allowed: WON with FT 2-1", /WON/.test(card(done)) && card(done).includes("FT 2-1"), card(done));
check("settled VOID shows VOID", /VOID/.test(card(row({ kickoff: new Date("2026-11-13T15:00:00Z"), outcome: "VOID" }))));
check("settled, NOT allowed: no pick, no result, no score", !/WON|LOST|FT 2-1|Both Teams/.test(card(done, false)) && card(done, false).includes("Locked selection"), card(done, false));
check("locked and past kickoff shows a clock-only label, not a result", !/WON|LOST/.test(card(row({ kickoff: new Date("2026-11-14T08:00:00Z"), outcome: "WON" }), false)));
check("missing kickoff and teams do not crash", typeof card(row({ kickoff: null, homeTeam: null, awayTeam: null, leagueName: null })) === "string");
check("the reason line is unchanged", card(row()).includes("Because you follow Arsenal"));

console.log("\naccount sidebar");
const none = { FEATURED: true, GENIUS: true, TODAY: true, BANKER: true, VIP: false, PREMIUM: false, BET_OF_THE_DAY: true, SAME_GAME_DOUBLE: true, GOALS: true } as any;
const shell = html(<DashboardShell items={dashboardNavItems(none)} activeKey="saved" title="Saved predictions" userEmail="reader@example.com"><p>x</p></DashboardShell>);
check("the sidebar offers Following, linking to /following", /<a[^>]*href="\/following"[^>]*>[\s\S]*?Following/.test(shell));
check("Saved predictions is the current page and is marked", /aria-current="page"[^>]*>[\s\S]{0,80}Saved predictions|Saved predictions[\s\S]{0,5}/.test(shell) && shell.includes('aria-current="page"'));
check("a closed phone sidebar is out of the tab and reading order (invisible), shown from md", /<aside class="[^"]*\binvisible\b[^"]*\bmd:visible\b/.test(shell), shell.slice(shell.indexOf("<aside"), shell.indexOf("<aside") + 400));
check("the content column can shrink (min-w-0), so one wide row cannot widen the page", shell.includes("min-w-0 flex-1 flex-col"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
