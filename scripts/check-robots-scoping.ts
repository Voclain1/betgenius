/**
 * Fails when robots.txt's per-agent groups are scoped wrongly.
 *
 * This exists because robots.txt specificity is winner-takes-all and that is
 * easy to get wrong in a way nothing else would catch. A crawler obeys the
 * single most specific User-agent group matching it and ignores every other
 * group, including "*". So the moment src/app/robots.ts names an agent to give
 * it a Crawl-delay, that group becomes the ONLY thing the agent reads — and if
 * it does not restate the disallow list, the named agent has just been granted
 * /admin, /dashboard and /api while every other crawler stays blocked.
 *
 * Nothing else in the suite would notice: typecheck passes, the build passes,
 * and robots.txt still looks plausible to a human reading it.
 *
 * Run: npx tsx scripts/check-robots-scoping.ts
 */
import robots from "../src/app/robots";

type Group = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[]; crawlDelay?: number };

const EXPECTED_DELAYED_AGENT = "meta-externalagent";
const EXPECTED_DELAY = 10;
// Agents that must keep falling through to "*" with no rate request of their own.
const MUST_BE_UNTHROTTLED = ["googlebot", "bingbot", "ahrefsbot"];

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};
const list = (v?: string | string[]) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const agents = (g: Group) => list(g.userAgent).map((a) => a.toLowerCase());

const file = robots();
const groups: Group[] = Array.isArray(file.rules) ? (file.rules as Group[]) : [file.rules as Group];

console.log("\nrobots.txt group scoping:");
const wildcard = groups.find((g) => agents(g).includes("*"));
check(Boolean(wildcard), 'a "*" group still exists');
check(wildcard?.crawlDelay === undefined, 'the "*" group carries NO Crawl-delay',
  `found ${wildcard?.crawlDelay} — that would throttle every crawler and every agent that falls through, not just one`);

const named = groups.filter((g) => !agents(g).includes("*"));
const delayed = named.find((g) => agents(g).includes(EXPECTED_DELAYED_AGENT));
check(Boolean(delayed), `a group exists for ${EXPECTED_DELAYED_AGENT}`);
check(delayed?.crawlDelay === EXPECTED_DELAY, `${EXPECTED_DELAYED_AGENT} asks for Crawl-delay ${EXPECTED_DELAY}`,
  `found ${delayed?.crawlDelay}`);
check(agents(delayed ?? {}).length === 1, `the Crawl-delay group names ONLY ${EXPECTED_DELAYED_AGENT}`,
  `also names ${agents(delayed ?? {}).filter((a) => a !== EXPECTED_DELAYED_AGENT).join(", ")}`);

console.log("\nnamed groups may not widen access (specificity is winner-takes-all):");
const wildcardDisallow = list(wildcard?.disallow);
for (const group of named) {
  const missing = wildcardDisallow.filter((p) => !list(group.disallow).includes(p));
  check(missing.length === 0, `${agents(group).join("/")} restates every "*" Disallow`,
    `missing ${missing.join(", ")} — that agent would be allowed in`);
}

console.log("\nother crawlers are untouched:");
for (const agent of MUST_BE_UNTHROTTLED) {
  const own = named.find((g) => agents(g).includes(agent));
  check(!own, `${agent} has no group of its own, so it reads "*" and gets no Crawl-delay`,
    `found a dedicated group with crawlDelay=${own?.crawlDelay}`);
}

console.log("\nsitemap:");
check(Boolean(file.sitemap), "sitemap is still declared");

console.log(failures === 0 ? "\nPASS: robots.txt groups are correctly scoped.\n" : `\nFAIL: ${failures} problem(s).\n`);
process.exit(failures === 0 ? 0 : 1);
