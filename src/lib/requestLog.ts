/**
 * One-line request logging, so a traffic spike can be attributed after the fact.
 *
 * This exists because of a specific failure. Neon billed 90.59 GiB of network
 * transfer in a single day — 584% over the three-day average — and the cause
 * could not be established afterwards, because NOTHING recorded who was asking.
 * Vercel's own request logs carry method, path, status and cache state, but no
 * user-agent and no client address, and they are retained for roughly 24 hours;
 * by the time the bill was noticed the day in question was unreadable. The
 * difference between "Googlebot discovered 4,302 new URLs" and "a scraper is
 * looping" is the entire diagnosis, and neither was recoverable.
 *
 * So the user-agent is written into the log line itself, where it survives as
 * long as the log does and can be aggregated with `vercel logs --json`.
 *
 * NOT logged: IP address, cookies, query strings, or anything identifying a
 * person. The agent string and the path are what attribute load; the rest would
 * be collecting personal data to solve a capacity problem.
 */

/** Coarse buckets, ordered most specific first — the first match wins. */
const AGENTS: [label: string, pattern: RegExp][] = [
  ["googlebot", /googlebot|google-inspectiontool|storebot-google/i],
  ["bingbot", /bingbot|adidxbot/i],
  ["ahrefsbot", /ahrefsbot/i],
  ["semrushbot", /semrushbot/i],
  ["yandexbot", /yandex(bot|images)/i],
  ["ai-crawler", /gptbot|oai-searchbot|chatgpt-user|claudebot|anthropic-ai|perplexitybot|ccbot|bytespider|amazonbot|meta-externalagent/i],
  ["seo-tool", /mj12bot|dotbot|dataforseo|screaming frog|serpstat|blexbot|petalbot/i],
  ["monitor", /uptimerobot|pingdom|statuscake|betteruptime|vercel-screenshot|vercel-favicon/i],
  // Deliberately last among the bots: a generic token matches plenty of the
  // named agents above, so it must not shadow them.
  ["other-bot", /bot\b|crawler|spider|scrap|headless|python-requests|curl|wget|go-http-client|axios|okhttp/i],
];

export type AgentClass = (typeof AGENTS)[number][0] | "browser" | "none";

export function classifyAgent(userAgent: string | null | undefined): AgentClass {
  if (!userAgent) return "none";
  for (const [label, pattern] of AGENTS) if (pattern.test(userAgent)) return label as AgentClass;
  return "browser";
}

/**
 * A single line, prefixed so it can be isolated with
 * `vercel logs --json | grep '\[req\]'` and split on spaces.
 *
 * THE MIDDLE IS WHAT GETS DROPPED, not the tail. This first shipped as a plain
 * slice(0, 120) on the theory that the discriminating part of an agent string
 * is near the front. It is not, for exactly the agents worth identifying: a
 * crawler that wants to look like a browser sends the full Chrome preamble and
 * names itself in a trailing "(compatible; SomeBot/1.0; +https://...)" clause.
 * The first production sample logged twelve requests as `ai-crawler` and
 * truncated every one of them at "Safari/537.36 (c" — classified, but
 * unnameable, which is half the point of logging it at all.
 *
 * So keep both ends. The head carries platform and engine, the tail carries
 * identity, and the elision in between is the part that is the same on every
 * agent string ever sent.
 */
const UA_MAX = 180;
const UA_HEAD = 100;
const UA_TAIL = 70;

export function formatRequestLog(input: { method: string; path: string; userAgent: string | null }): string {
  const agent = classifyAgent(input.userAgent);
  const collapsed = (input.userAgent ?? "-").replace(/\s+/g, " ");
  const raw =
    collapsed.length <= UA_MAX ? collapsed : `${collapsed.slice(0, UA_HEAD)}…${collapsed.slice(-UA_TAIL)}`;
  return `[req] agent=${agent} method=${input.method} path=${input.path} ua="${raw}"`;
}
