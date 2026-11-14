/**
 * Sprint 06 — the returning reader's shortcuts, measurement and boundaries
 * (pure: no database, no network, no browser).
 *
 *   - jumpLinks: the row's labels, in-page anchors and counts, and that a
 *     missing or zero count is never printed as "0";
 *   - the dashboard sections carry the ids the row points at;
 *   - the account sidebar offers Saved and Following, every key unique;
 *   - the three new analytics events carry fixed enums only, are fired once per
 *     mount, never from two places, and add no name, email, id or label;
 *   - dashboard_view is still fired from exactly one place (no duplicate);
 *   - nothing invents a "last visit": no such column exists, none was added,
 *     and no tracking route was created;
 *   - the files this sprint edits import nothing from discovery, odds,
 *     generation, settlement or the forecasting research.
 *
 * Run: npx tsx scripts/check-return-experience.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  const sc = await import("../src/lib/returnShortcuts");
  const eng = await import("../src/lib/engagement");
  const { dashboardNavItems } = await import("../src/lib/dashboardContext");

  console.log("\njump row");
  const full = sc.jumpLinks({ savedTotal: 5, upcomingCount: 3, favouriteCount: 7 });
  check("four links: Upcoming, Saved, Favourites, Following", full.map((l) => l.label).join() === "Upcoming,Saved,Favourites,Following");
  check("counts shown when positive", full[0].count === 3 && full[1].count === 5 && full[2].count === 7);
  check("Following carries no count and is an ordinary page link", full[3].count === null && full[3].external && full[3].href === "/following");
  check("the in-page links are anchors, not routes", full.slice(0, 3).every((l) => l.href.startsWith("#") && !l.external));
  const empty = sc.jumpLinks({ savedTotal: 0, upcomingCount: 0, favouriteCount: 0 });
  check("zero counts are omitted, never printed as 0", empty.every((l) => l.count === null));
  check("negative, NaN and fractional inputs are safe", sc.jumpLinks({ savedTotal: -2, upcomingCount: NaN, favouriteCount: 2.9 }).map((l) => l.count).join() === [null, null, 2, null].join());
  check("every target is a registered target", full.every((l) => (sc.SHORTCUT_TARGETS as readonly string[]).includes(l.target)));

  console.log("\ndashboard anchors");
  const dash = src("src/app/dashboard/page.tsx");
  for (const [k, id] of Object.entries(sc.DASHBOARD_ANCHORS)) check(`the ${k} section carries id "${id}"`, dash.includes(`id={DASHBOARD_ANCHORS.${k}}`));
  check("the jump row is on the overview, with the dashboard's own counts", /<JumpRow links=\{jumpLinks\(\{ savedTotal: saved\.total, upcomingCount: upcoming\.length, favouriteCount \}\)\} \/>/.test(dash));
  check("no second dashboard: the overview still has one 'Saved' section and one 'Upcoming for you'", (dash.match(/title="Saved"/g) ?? []).length === 1 && (dash.match(/title="Upcoming for you"/g) ?? []).length === 1);
  check("'Recently settled' no longer claims recency it does not check", !dash.includes("Recently settled") && dash.includes("Latest results"));

  console.log("\naccount navigation");
  const none = { FEATURED: true, GENIUS: true, TODAY: true, BANKER: true, VIP: false, PREMIUM: false, BET_OF_THE_DAY: true, SAME_GAME_DOUBLE: true, GOALS: true } as any;
  const items = dashboardNavItems(none);
  const keys = items.map((i) => i.key);
  check("every sidebar key is unique", new Set(keys).size === keys.length);
  check("Saved then Following lead the account items", keys.indexOf("saved") === 1 && keys.indexOf("following") === 2, keys.slice(0, 4).join());
  check("Following links to the existing /following page, not a copy", items.find((i) => i.key === "following")?.href === "/following");
  check("existing items and routes are unchanged", items.find((i) => i.key === "saved")?.href === "/dashboard/saved" && items.find((i) => i.key === "preferences")?.href === "/dashboard/preferences" && items.find((i) => i.key === "overview")?.href === "/dashboard");
  check("locked categories stay locked", items.find((i) => i.key === "vip")?.locked === true && items.find((i) => i.key === "today")?.locked === false);

  console.log("\nanalytics: privacy and duplicates");
  const reg = eng.PERSONALIZATION_EVENTS as Record<string, readonly string[]>;
  check("saved_view carries only `filter`", reg.saved_view?.join() === "filter");
  check("following_view carries only `follows`", reg.following_view?.join() === "follows");
  check("account_shortcut carries only `target` and `surface`", reg.account_shortcut?.join() === "target,surface");
  check("no new event allows a name, email, id, label or free text", ["saved_view", "following_view", "account_shortcut"].every((e) => reg[e].every((p) => !/name|email|user|id|label|text|team|pick|odds/i.test(p))));
  check("existing events keep their parameters", reg.dashboard_view?.join() === "personalized" && reg.prediction_save?.join() === "source");
  check("follows is a coarse bucket, never an exact count", sc.followBucket(0) === "0" && sc.followBucket(1) === "1_5" && sc.followBucket(5) === "1_5" && sc.followBucket(6) === "6_plus" && sc.followBucket(400) === "6_plus" && sc.followBucket(NaN) === "0");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(join(root, dir))) {
      const rel = `${dir}/${n}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(rel);
    }
    return out;
  };
  const files = walk("src");
  const callers = (name: string) => files.filter((f) => src(f).includes(`trackEngagement("${name}"`));
  check("dashboard_view is fired from exactly one place (no duplicate event)", callers("dashboard_view").length === 1 && callers("dashboard_view")[0].endsWith("ClientBits.tsx"), callers("dashboard_view").join());
  check("saved_view and following_view are each fired from exactly one place", callers("saved_view").length === 1 && callers("following_view").length === 1);
  check("account_shortcut goes only through trackAccountShortcut", callers("account_shortcut").length === 1 && callers("account_shortcut")[0].endsWith("engagement.ts"));
  const bits = src("src/components/personal/ClientBits.tsx");
  check("the trackers fire once per mount (ref guard)", ["SavedViewTracker", "FollowingViewTracker"].every((n) => new RegExp(`export function ${n}[\\s\\S]{0,260}useRef\\(false\\)[\\s\\S]{0,200}sent\\.current = true`).test(bits)));
  check("the shortcut link sends two fixed words and nothing else", /trackAccountShortcut\(target, surface\)/.test(bits));
  const calls = [...files.flatMap((f) => [...src(f).matchAll(/trackAccountShortcut\(([^)]*)\)/g)].map((m) => m[1]))].filter((c) => !/target, surface|target: ShortcutTarget/.test(c));
  check("every direct shortcut call passes literal enum words", calls.every((c) => /^"(saved|following)", "(account_menu|sidebar)"$/.test(c.trim()) || /^item\.key, "sidebar"$/.test(c.trim())), calls.join(" | "));

  console.log("\nno invented last visit, no new tracking, no schema change");
  const schema = src("prisma/schema.prisma");
  check("the schema has no last-visit / last-seen / last-active field", !/lastVisit|lastSeen|lastActive|lastLogin|lastAccess/i.test(schema));
  check("no tracking or visit route was added", !existsSync(join(root, "src/app/api/visit")) && !existsSync(join(root, "src/app/api/track")) && !files.some((f) => /api\/(visit|track|last-?seen)/i.test(f)));
  check("no code writes a visit time", !files.some((f) => /lastVisitAt|lastSeenAt|lastActiveAt|recordVisit/.test(src(f))));

  console.log("\nboundary with the protected workstreams");
  const EDITED = [
    "src/lib/returnShortcuts.ts", "src/components/personal/FollowingFeedCard.tsx", "src/components/personal/ClientBits.tsx", "src/components/personal/DashboardParts.tsx",
    "src/components/DashboardShell.tsx", "src/app/dashboard/page.tsx", "src/app/dashboard/saved/page.tsx", "src/app/(public)/following/page.tsx", "src/lib/dashboardContext.ts",
  ];
  const DENY = /predictionDiscovery|PredictionDiscovery|PublishedMarketComparison|MatchEvidenceGuide|selectionQuote|predictionVisibility|predictionExplanation|lib\/odds["']|oddsRefresh|paidFeedData|marketConfirmed|generation|settle|research\//;
  for (const f of EDITED) {
    const imports = [...src(f).matchAll(/^import (?!type ).* from "([^"]+)"/gm)].map((m) => m[1]);
    check(`${f}: imports nothing from discovery, odds, generation, settlement or research`, imports.every((i) => !DENY.test(i)), imports.filter((i) => DENY.test(i)).join());
  }
  check("no new external request: no fetch to a third party in the new code", !/fetch\(["']https?:/.test(src("src/lib/returnShortcuts.ts") + src("src/components/personal/FollowingFeedCard.tsx") + src("src/components/personal/ClientBits.tsx")));
  check("no public copy says AI", EDITED.every((f) => !/>[^<{]*\bAI\b[^<}]*</.test(src(f))));
  check("no streak, leaderboard, urgency or guarantee wording was added", EDITED.every((f) => !/streak|leaderboard|don't miss|hurry|last chance|guaranteed|sure win/i.test(src(f))));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
